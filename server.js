'use strict';
/*
  SOLAR TRACKER CLOUD BACKEND
  ESP32 --MQTT/TLS--> Broker <--MQTT/TLS-- Backend --HTTPS/WSS--> Website công khai

  - Đăng nhập: bcrypt + JWT (cookie HttpOnly/Secure/SameSite=Strict, hết hạn SESSION_HOURS)
  - Phân quyền: viewer (giám sát) / operator (điều khiển) / admin (điều khiển + quản lý user)
  - Lệnh: kiểm tra quyền + whitelist + giá trị -> MQTT QoS1 kèm id -> chờ ACK ESP32 (timeout 5 s)
          -> chỉ báo thành công khi ESP32 xác nhận; ghi nhật ký mọi lệnh.
  - Không bao giờ gửi lệnh *_hold (Cloud chỉ bấm từng bước 10°).
*/
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const makeStore = require('./db');
const { buildWorkbook } = require('./report');
const { buildReport, MAX_ROWS } = require('./report_xlsx');

// ------------------------------------------------------------------ cấu hình
const env = process.env;
const PORT = Number(env.PORT || 8080);
const JWT_SECRET = env.JWT_SECRET || '';
const SESSION_HOURS = Number(env.SESSION_HOURS || 8);
const COOKIE_SECURE = env.COOKIE_SECURE !== 'false';
const ACK_TIMEOUT_MS = 5000;
const OFFLINE_AFTER_MS = 15000;
const SAMPLE_EVERY_MS = Math.max(100, Number(env.SAMPLE_EVERY_MS || 10000));   // (biến môi trường chỉ để kiểm thử nhanh; mặc định 10 s)
const RETENTION_DAYS = Number(env.RETENTION_DAYS || 30);   // dữ liệu chi tiết (10 s/mẫu) giữ bao nhiêu ngày; bảng tổng hợp theo giờ giữ vĩnh viễn
const TZ_HOURS = Number.isFinite(Number(env.TZ_OFFSET_HOURS)) && env.TZ_OFFSET_HOURS !== undefined ? Number(env.TZ_OFFSET_HOURS) : 7; // múi giờ hiển thị trong Excel (VN = +7)
// DEVICES="tracker01:Solar Tracker 01,tracker02:Mái nhà"
const DEVICES = (env.DEVICES || 'tracker01:Solar Tracker 01').split(',').map(s => s.trim()).filter(Boolean).map(s => {
  const [id, ...name] = s.split(':');
  return { id: id.trim(), name: (name.join(':') || id).trim() };
}).filter(d => /^[A-Za-z0-9_-]{1,32}$/.test(d.id));
const DEVICE_IDS = new Set(DEVICES.map(d => d.id));

if (JWT_SECRET.length < 32) { console.error('JWT_SECRET phải dài >= 32 ký tự'); process.exit(1); }
if (!env.MQTT_URL) { console.error('Thiếu MQTT_URL (vd: mqtts://xxxx.s1.eu.hivemq.cloud:8883)'); process.exit(1); }

const store = makeStore(env.DATABASE_URL);
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

// ------------------------------------------------------------------ lệnh hợp lệ (giống firmware)
const ALLOWED_CMDS = new Set([
  'm1_left', 'm1_right', 'm2_left', 'm2_right', 'm2_up', 'm2_down',
  'stop', 'auto', 'auto_toggle', 'cal_zero', 'reset_cal', 'set_home',
  'speed_up', 'speed_down', 'speed_set',
  'fan_thresh_up', 'fan_thresh_down', 'fan_thresh_set', 'fan_on', 'fan_off', 'fan_auto', 'night_on', 'night_auto', 'wx_refresh', 'estop_toggle',
]);
const SAFETY_CMDS = new Set(['stop', 'estop_toggle']);

function validateValue(c, val) {
  if (c === 'speed_set') { const v = Number(val); return Number.isInteger(v) && v >= 1 && v <= 5 ? { ok: true, v } : { ok: false }; }
  if (c === 'fan_thresh_set') { const v = Number(val); return Number.isFinite(v) && v >= 20 && v <= 70 ? { ok: true, v } : { ok: false }; }
  if (c === 'auto') return typeof val === 'boolean' ? { ok: true, v: val } : { ok: false };
  return { ok: true, v: undefined };
}

// ------------------------------------------------------------------ trạng thái thiết bị
const devices = new Map(); // id -> {status:boolean, data, lastState, lastSample}
DEVICES.forEach(d => devices.set(d.id, { status: false, data: null, lastState: 0, lastSample: 0 }));
const isOnline = (id) => { const d = devices.get(id); return !!d && d.status && Date.now() - d.lastState < OFFLINE_AFTER_MS; };

// ------------------------------------------------------------------ MQTT
const mq = mqtt.connect(env.MQTT_URL, {
  username: env.MQTT_USER, password: env.MQTT_PASS,
  clientId: 'st-backend-' + crypto.randomBytes(4).toString('hex'),
  reconnectPeriod: 3000, connectTimeout: 15000, rejectUnauthorized: true, clean: true,
});
mq.on('connect', () => { console.log('[MQTT] connected'); mq.subscribe(['st/+/state', 'st/+/status', 'st/+/ack'], { qos: 1 }); });
mq.on('error', e => console.error('[MQTT]', e.message));
mq.on('close', () => console.log('[MQTT] closed'));

// ---- Nhật ký sự kiện: CHỈ ghi khi quan sát được thay đổi thật trong dữ liệu ESP32 gửi lên (không suy đoán) ----
const lastOnline = new Map();
function logEvent(id, ts, kind, mode, status, descr) {
  store.insertEvent({ device: id, ts, kind, mode: mode || null, status: status || null, descr: descr || null }).catch(e => console.error('[DB] event', e.message));
}
function noteOnline(id, why) {
  const on = isOnline(id), prev = lastOnline.get(id);
  lastOnline.set(id, on);
  if (prev === undefined || prev === on) return;          // lần đầu: chỉ lấy mốc, không ghi sự kiện
  const d = devices.get(id);
  logEvent(id, Date.now(), on ? 'ESP32 Connected' : 'ESP32 Disconnected', d.lastMode, on ? 'ONLINE' : 'OFFLINE', why);
  if (!on) d.prev = null;                                  // sau khi mất kết nối, lấy lại mốc so sánh mới
}
function flagsOf(j) {
  return (j.eStop ? 1 : 0) | (j.isNight ? 2 : 0) | (j.simMode ? 4 : 0) | (j.inaPV === false ? 8 : 0) | (j.inaBattery === false ? 16 : 0) |
         (j.motor1Running ? 32 : 0) | (j.motor2Running ? 64 : 0) | (j.dhtOK === false ? 128 : 0);
}
function trackEvents(id, d, j, ts) {
  const cur = { auto: !!j.autoMode, es: !!j.eStop, night: !!j.isNight, sim: !!j.simMode, m1: !!j.motor1Running, m2: !!j.motor2Running,
                pv: j.inaPV !== false, bat: j.inaBattery !== false, dht: j.dhtOK !== false, trk: String(j.trackStatus || '') };
  const prev = d.prev; d.prev = cur;
  d.lastMode = cur.auto ? 'AUTO' : 'MANUAL';
  if (!prev) return;                                        // chưa có mốc -> không ghi gì
  const mode = d.lastMode, st = cur.es ? 'E-STOP' : (cur.night ? 'NIGHT' : 'ONLINE');
  const ev = (kind, descr) => logEvent(id, ts, kind, mode, st, descr);
  if (prev.auto !== cur.auto) ev(cur.auto ? 'AUTO Mode' : 'MANUAL Mode', 'Chế độ bám chuyển sang ' + mode);
  if (prev.es !== cur.es) ev(cur.es ? 'Emergency Stop' : 'Emergency Stop Released', cur.es ? 'Dừng khẩn cấp được kích hoạt' : 'Đã nhả dừng khẩn cấp');
  if (prev.night !== cur.night) ev(cur.night ? 'Night Mode Entered' : 'Night Mode Exited', cur.night ? 'Vào chế độ ban đêm' : 'Thoát chế độ ban đêm');
  if (prev.sim !== cur.sim) ev(cur.sim ? 'Simulation Entered' : 'Simulation Exited', cur.sim ? 'Vào chế độ mô phỏng (MATLAB)' : 'Quay về chế độ thật');
  if (prev.m1 !== cur.m1) ev(cur.m1 ? 'Motor Activated' : 'Motor Stopped', 'Motor 1 (trục đứng) ' + (cur.m1 ? 'bắt đầu quay: ' + (j.motor1State || '') : 'dừng') + ' • góc ' + Number(j.motor1Angle).toFixed(1) + '°');
  if (prev.m2 !== cur.m2) ev(cur.m2 ? 'Motor Activated' : 'Motor Stopped', 'Motor 2 (trục ngang) ' + (cur.m2 ? 'bắt đầu quay: ' + (j.motor2State || '') : 'dừng') + ' • góc ' + Number(j.motor2Angle).toFixed(1) + '°');
  if (prev.trk !== cur.trk && cur.trk) ev('Tracking Status', (prev.trk || '--') + ' → ' + cur.trk);
  if (prev.pv !== cur.pv) ev(cur.pv ? 'Sensor Recovered' : 'Sensor Error', 'INA219 PV ' + (cur.pv ? 'đã đọc được lại' : 'không phản hồi'));
  if (prev.bat !== cur.bat) ev(cur.bat ? 'Sensor Recovered' : 'Sensor Error', 'INA219 ắc quy ' + (cur.bat ? 'đã đọc được lại' : 'không phản hồi'));
  if (prev.dht !== cur.dht) ev(cur.dht ? 'Sensor Recovered' : 'Sensor Error', 'DHT11 ' + (cur.dht ? 'đã đọc được lại' : 'không đọc được'));
}

const pending = new Map(); // cmdId -> {ws, reqId, device, user, c, val, t0, timer, ip}

mq.on('message', (topic, payload) => {
  const m = /^st\/([A-Za-z0-9_-]{1,32})\/(state|status|ack)$/.exec(topic);
  if (!m || !DEVICE_IDS.has(m[1])) return;
  const id = m[1], kind = m[2];
  let j; try { j = JSON.parse(payload.toString()); } catch { return; }
  const d = devices.get(id);

  if (kind === 'status') {
    const was = isOnline(id);
    d.status = !!j.online;
    if (!d.status) d.lastState = 0;
    if (was !== isOnline(id)) { noteOnline(id, d.status ? 'Broker báo ESP32 online' : 'Broker báo ESP32 offline (LWT)'); broadcast(id, { type: 'device', device: id, online: isOnline(id) }); }
    return;
  }
  if (kind === 'state') {
    d.data = j; d.lastState = Date.now(); d.status = true;
    noteOnline(id, 'Nhận gói trạng thái từ ESP32');
    trackEvents(id, d, j, d.lastState);
    broadcast(id, { type: 'state', device: id, online: true, data: j });
    if (Date.now() - d.lastSample >= SAMPLE_EVERY_MS) {
      d.lastSample = Date.now();
      const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
      // INA219 không có -> lưu NULL (thiếu dữ liệu), KHÔNG lưu số 0 giả. Firmware cũ không gửi cờ inaPV/inaBattery -> coi là có.
      const pvOk = j.inaPV !== false, batOk = j.inaBattery !== false;
      const sample = {
        pvV: pvOk ? n(j.solarVoltage) : null, pvI: pvOk ? n(j.solarCurrent) : null, pvP: pvOk ? n(j.solarPower) : null,
        batV: batOk ? n(j.batteryVoltage) : null, batI: batOk ? n(j.batteryCurrent) : null, batP: batOk ? n(j.batteryPower) : null,
        m1: n(j.motor1Angle), m2: n(j.motor2Angle), temp: j.dhtOK ? n(j.temp) : null,
        ldrTL: n(j.ldrTL), ldrTR: n(j.ldrTR), ldrBL: n(j.ldrBL), ldrBR: n(j.ldrBR), dH: n(j.diffH), dV: n(j.diffV),
        auto: j.autoMode === undefined ? null : (j.autoMode ? 1 : 0), trk: j.trackStatus ? String(j.trackStatus).slice(0, 40) : null, flags: flagsOf(j),
      };
      store.insertTelemetry(id, d.lastSample, sample).catch(e => console.error('[DB] telemetry', e.message));
      // tổng hợp theo giờ (giữ vĩnh viễn) – chỉ ghi khi đủ 6 đại lượng hợp lệ
      if (['pvV', 'pvI', 'pvP', 'batV', 'batI', 'batP'].every(k => sample[k] !== null)) {
        store.addHourly(id, d.lastSample, sample).catch(e => console.error('[DB] hourly', e.message));
      }
    }
    return;
  }
  if (kind === 'ack') {
    const p = pending.get(String(j.id || ''));
    if (!p || p.device !== id) return;
    finish(p, String(j.id), !!j.ok, j.ok ? 'OK' : String(j.reason || 'REJECTED'));
  }
});

function finish(p, cmdId, ok, result) {
  clearTimeout(p.timer);
  pending.delete(cmdId);
  const latency = Date.now() - p.t0;
  store.insertLog({ ts: p.t0, device: p.device, username: p.user, cmd: p.c, val: p.val === undefined ? null : String(p.val), result, latency_ms: latency, ip: p.ip })
    .catch(e => console.error('[DB] log', e.message));
  send(p.ws, { type: 'ack', reqId: p.reqId, ok, reason: ok ? '' : result, latency });
}

// ------------------------------------------------------------------ HTTP
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss: ws:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    ...(COOKIE_SECURE ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  });
  next();
});
app.use(express.json({ limit: '8kb' }));

function parseCookies(h) {
  const out = {};
  (h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
async function userFromReq(req) {
  const tok = parseCookies(req.headers.cookie).st_sess;
  if (!tok) return null;
  try {
    const p = jwt.verify(tok, JWT_SECRET, { algorithms: ['HS256'] });
    const u = await store.getUser(p.sub);           // user bị xóa -> phiên hết hiệu lực ngay
    return u ? { username: u.username, role: u.role } : null;
  } catch { return null; }
}
const auth = (roles) => async (req, res, next) => {
  const u = await userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  req.user = u; next();
};
// chống CSRF cho API thay đổi dữ liệu: yêu cầu JSON + cùng origin
function sameOrigin(req, res, next) {
  const o = req.headers.origin;
  if (o && new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Origin không hợp lệ' });
  next();
}

// rate limit đăng nhập: 10 lần / 15 phút / IP
const loginHits = new Map();
function loginLimited(ip) {
  const now = Date.now(), w = 15 * 60000;
  const arr = (loginHits.get(ip) || []).filter(t => now - t < w);
  arr.push(now); loginHits.set(ip, arr);
  return arr.length > 10;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of loginHits) if (!v.some(t => now - t < 900000)) loginHits.delete(k); }, 600000).unref();

app.get('/healthz', (req, res) => res.json({ ok: true, mqtt: mq.connected, db: store.kind }));

app.post('/api/login', sameOrigin, async (req, res) => {
  if (loginLimited(req.ip)) return res.status(429).json({ error: 'Quá nhiều lần thử, vui lòng chờ 15 phút' });
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Thiếu thông tin' });
  const u = await store.getUser(username);
  // luôn so sánh bcrypt (kể cả khi user không tồn tại) để không lộ tài khoản qua thời gian phản hồi
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  const tok = jwt.sign({ sub: u.username, role: u.role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: SESSION_HOURS * 3600 });
  res.cookie('st_sess', tok, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict', maxAge: SESSION_HOURS * 3600000, path: '/' });
  res.json({ username: u.username, role: u.role });
});
app.post('/api/logout', (req, res) => { res.clearCookie('st_sess', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', auth(), (req, res) => res.json(req.user));
app.get('/api/devices', auth(), (req, res) => res.json(DEVICES.map(d => ({ ...d, online: isOnline(d.id) }))));

app.get('/api/history', auth(), async (req, res) => {
  const dev = String(req.query.device || '');
  const ranges = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
  if (!DEVICE_IDS.has(dev) || !ranges[req.query.range]) return res.status(400).json({ error: 'Tham số không hợp lệ' });
  if (req.query.range === '7d' || req.query.range === '30d') {
    // dài hạn: dùng bảng tổng hợp theo giờ (giữ vĩnh viễn), mỗi giờ một điểm = trung bình trong giờ đó
    const hrs = await store.queryHourly(dev, Math.floor((Date.now() - ranges[req.query.range]) / 3600000) * 3600000);
    return res.json(hrs.map(h => {
      const n = h.n || 1, a = (k) => h[k].sum / n;
      return { t: h.ts + 1800000, pvP: a('pvP'), pvV: a('pvV'), pvI: a('pvI'), batP: a('batP'), batV: a('batV'), batI: a('batI') };
    }));
  }
  const rows = await store.queryTelemetry(dev, Date.now() - ranges[req.query.range]);
  const B = Math.max(1, Math.ceil(rows.length / 360)); // tối đa 360 điểm
  const out = [];
  for (let i = 0; i < rows.length; i += B) {
    const g = rows.slice(i, i + B), avg = k => g.reduce((s, r) => s + (Number(r[k]) || 0), 0) / g.length;
    out.push({ t: g[g.length - 1].ts, pvP: avg('pvP'), pvV: avg('pvV'), pvI: avg('pvI'), batP: avg('batP'), batV: avg('batV'), batI: avg('batI') });
  }
  res.json(out);
});

// ---------------- BÁO CÁO EXCEL MỚI (5 sheet, biểu đồ Excel thật) ----------------
const exportHits = new Map();
function parseRange(q) {
  const to = Number(q.to) || Date.now();
  const from = Number(q.from) || (to - 86400000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return { error: 'Khoảng thời gian không hợp lệ (bắt đầu phải trước kết thúc)' };
  if (to - from > 366 * 86400000) return { error: 'Khoảng thời gian tối đa 366 ngày' };
  return { from, to };
}
app.get('/api/report/preview', auth(), async (req, res) => {
  const dev = String(req.query.device || '');
  if (!DEVICE_IDS.has(dev)) return res.status(400).json({ error: 'Thiết bị không hợp lệ' });
  const r = parseRange(req.query); if (r.error) return res.status(400).json({ error: r.error });
  const c = await store.countTelemetry(dev, r.from, r.to);
  const ev = await store.listEvents(dev, r.from, r.to, 100000);
  const hourly = await store.queryHourly(dev, Math.floor(r.from / 3600000) * 3600000);
  const hourlyN = hourly.filter(h => h.ts <= r.to).length;
  const expected = Math.max(1, Math.round((Math.min(r.to, Date.now()) - r.from) / SAMPLE_EVERY_MS));
  res.json({ ...c, events: ev.length, hourlyRows: hourlyN, expected, coverage: c.n ? Math.min(100, c.n / expected * 100) : 0,
             maxRows: MAX_ROWS, retentionDays: RETENTION_DAYS, sampleSec: SAMPLE_EVERY_MS / 1000, online: isOnline(dev) });
});
app.get('/api/report.xlsx', auth(), async (req, res) => {
  const dev = String(req.query.device || '');
  if (!DEVICE_IDS.has(dev)) return res.status(400).json({ error: 'Thiết bị không hợp lệ' });
  const r = parseRange(req.query); if (r.error) return res.status(400).json({ error: r.error });
  const type = ['all', 'overview', 'energy', 'tracking'].includes(req.query.type) ? req.query.type : 'all';
  const last = exportHits.get(req.user.username) || 0;
  if (Date.now() - last < 3000) return res.status(429).json({ error: 'Vui lòng chờ vài giây rồi thử lại' });
  exportHits.set(req.user.username, Date.now());
  try {
    const c = await store.countTelemetry(dev, r.from, r.to);
    if (!c.n) return res.status(404).json({ error: 'Không có dữ liệu đo trong khoảng thời gian đã chọn. Báo cáo sẽ không được tạo.' });
    if (c.n > MAX_ROWS) return res.status(413).json({ error: `Khoảng thời gian có ${c.n} mẫu, vượt giới hạn ${MAX_ROWS} mẫu mỗi báo cáo. Hãy chọn khoảng ngắn hơn.` });
    const samples = await store.queryTelemetryRange(dev, r.from, r.to, MAX_ROWS + 1);
    const events = await store.listEvents(dev, r.from, r.to, 50000);
    const dv = DEVICES.find(d => d.id === dev);
    const buf = await buildReport({ deviceId: dev, deviceName: dv && dv.name, samples, events, from: r.from, to: r.to, type,
                                    tzHours: TZ_HOURS, sampleSec: SAMPLE_EVERY_MS / 1000, online: isOnline(dev), retentionDays: RETENTION_DAYS });
    const loc = new Date(Date.now() + TZ_HOURS * 3600000).toISOString();     // YYYY-MM-DDTHH:mm...
    const name = `Solar_Tracker_Report_${loc.slice(0, 10)}_${loc.slice(11, 13)}-${loc.slice(14, 16)}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('[REPORT]', e);
    res.status(500).json({ error: 'Không tạo được báo cáo: ' + e.message });
  }
});

// Xuất báo cáo Excel THEO GIỜ (cũ, giữ nguyên để xem dài hạn > thời gian lưu chi tiết): GET /api/export.xlsx?device=..&days=7
app.get('/api/export.xlsx', auth(), async (req, res) => {
  const dev = String(req.query.device || '');
  const days = Math.min(366, Math.max(1, parseInt(req.query.days, 10) || 7));
  if (!DEVICE_IDS.has(dev)) return res.status(400).json({ error: 'Thiết bị không hợp lệ' });
  const last = exportHits.get(req.user.username) || 0;
  if (Date.now() - last < 3000) return res.status(429).json({ error: 'Vui lòng chờ vài giây rồi thử lại' });
  exportHits.set(req.user.username, Date.now());

  const until = Date.now();
  const since = until - days * 86400000;
  const rows = await store.queryHourly(dev, Math.floor(since / 3600000) * 3600000);
  const dv = DEVICES.find(d => d.id === dev);
  const buf = await buildWorkbook({ deviceId: dev, deviceName: dv && dv.name, rows, since, until, tzHours: TZ_HOURS });
  const stamp = (ms) => new Date(ms + TZ_HOURS * 3600000).toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="solar-tracker_${dev}_${stamp(since)}_${stamp(until)}.xlsx"`,
    'Cache-Control': 'no-store',
  });
  res.send(Buffer.from(buf));
});

app.get('/api/logs', auth(['operator', 'admin']), async (req, res) => {
  const dev = String(req.query.device || '');
  if (!DEVICE_IDS.has(dev)) return res.status(400).json({ error: 'Thiết bị không hợp lệ' });
  res.json(await store.listLogs(dev, 100));
});

app.get('/api/users', auth(['admin']), async (req, res) => res.json(await store.listUsers()));
app.post('/api/users', sameOrigin, auth(['admin']), async (req, res) => {
  const { username, password, role } = req.body || {};
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Tên tài khoản 3-32 ký tự [A-Za-z0-9_.-]' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Mật khẩu 8-72 ký tự' });
  if (!['viewer', 'operator', 'admin'].includes(role)) return res.status(400).json({ error: 'Quyền không hợp lệ' });
  try { await store.createUser(username, await bcrypt.hash(password, 12), role); res.json({ ok: true }); }
  catch (e) { res.status(e.message === 'EXISTS' ? 409 : 500).json({ error: e.message === 'EXISTS' ? 'Tài khoản đã tồn tại' : 'Lỗi máy chủ' }); }
});
app.delete('/api/users/:name', sameOrigin, auth(['admin']), async (req, res) => {
  const name = req.params.name;
  if (name === req.user.username) return res.status(400).json({ error: 'Không thể tự xóa tài khoản đang đăng nhập' });
  const u = await store.getUser(name);
  if (!u) return res.status(404).json({ error: 'Không tồn tại' });
  if (u.role === 'admin' && (await store.countAdmins()) <= 1) return res.status(400).json({ error: 'Phải còn ít nhất 1 admin' });
  await store.deleteUser(name);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0, index: 'index.html' }));

// ------------------------------------------------------------------ WebSocket (WSS qua HTTPS của nền tảng)
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host !== req.headers.host) return socket.destroy(); // chống CSWSH
    const user = await userFromReq(req);
    const device = url.searchParams.get('device');
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!user) return ws.close(4401, 'unauthorized');
      if (!DEVICE_IDS.has(device)) return ws.close(4400, 'bad device');
      ws.user = user; ws.device = device; ws.ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
      ws.isAlive = true; ws.cmdTimes = []; ws.exp = jwtExp(req);
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (raw) => onWsMessage(ws, raw));
      const d = devices.get(device);
      send(ws, { type: 'state', device, online: isOnline(device), data: d.data });
    });
  } catch { socket.destroy(); }
});
function jwtExp(req) { try { return jwt.decode(parseCookies(req.headers.cookie).st_sess).exp * 1000; } catch { return 0; } }

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(device, obj) { const s = JSON.stringify(obj); wss.clients.forEach(c => { if (c.readyState === 1 && c.device === device) c.send(s); }); }

async function onWsMessage(ws, raw) {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type !== 'cmd') return;
  const reqId = String(m.reqId || '').slice(0, 40);
  const reject = (reason) => {
    store.insertLog({ ts: Date.now(), device: ws.device, username: ws.user.username, cmd: String(m.c || '').slice(0, 24), val: m.val === undefined ? null : String(m.val).slice(0, 16), result: reason, latency_ms: 0, ip: ws.ip }).catch(() => {});
    send(ws, { type: 'ack', reqId, ok: false, reason });
  };

  // 1) phiên còn hạn + quyền (kiểm tra lại từ DB mỗi lệnh)
  if (ws.exp && Date.now() > ws.exp) { ws.close(4401, 'expired'); return; }
  const u = await store.getUser(ws.user.username);
  if (!u) { ws.close(4401, 'unauthorized'); return; }
  if (!['operator', 'admin'].includes(u.role)) return reject('FORBIDDEN');

  // 2) lệnh hợp lệ (Cloud: không cho phép *_hold)
  const c = String(m.c || '');
  if (c.endsWith('_hold')) return reject('HOLD_DISABLED');
  if (!ALLOWED_CMDS.has(c)) return reject('UNKNOWN_CMD');
  const vv = validateValue(c, m.val);
  if (!vv.ok) return reject('BAD_VALUE');
  if (m.device !== ws.device) return reject('BAD_DEVICE');

  // 3) giới hạn tần suất: 5 lệnh / 3 s / kết nối (lệnh an toàn luôn qua)
  const now = Date.now();
  ws.cmdTimes = ws.cmdTimes.filter(t => now - t < 3000);
  if (!SAFETY_CMDS.has(c) && ws.cmdTimes.length >= 5) return reject('RATE_LIMIT');
  ws.cmdTimes.push(now);

  // 4) thiết bị online + mỗi thiết bị chỉ 1 lệnh thường đang chờ ACK (tránh xung đột giữa nhiều người dùng Cloud)
  if (!isOnline(ws.device) || !mq.connected) return reject('OFFLINE');
  if (!SAFETY_CMDS.has(c) && [...pending.values()].some(p => p.device === ws.device && !SAFETY_CMDS.has(p.c))) return reject('BUSY');

  // 5) gửi qua MQTT QoS1, chờ ACK
  const cmdId = crypto.randomBytes(9).toString('base64url'); // 12 ký tự
  const p = { ws, reqId, device: ws.device, user: u.username, c, val: vv.v, t0: now, ip: ws.ip };
  p.timer = setTimeout(() => { if (pending.has(cmdId)) finish(p, cmdId, false, 'TIMEOUT'); }, ACK_TIMEOUT_MS);
  pending.set(cmdId, p);
  const msg = { id: cmdId, c, ts: now };
  if (vv.v !== undefined) msg.v = vv.v;
  mq.publish(`st/${ws.device}/cmd`, JSON.stringify(msg), { qos: 1 }, (err) => { if (err && pending.has(cmdId)) finish(p, cmdId, false, 'PUBLISH_FAILED'); });
}

// heartbeat WS + phát hiện thiết bị offline
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
}, 30000).unref();
setInterval(() => {
  for (const id of DEVICE_IDS) {
    const on = isOnline(id);
    if (lastOnline.get(id) !== on) { noteOnline(id, on ? 'Nhận lại dữ liệu từ ESP32' : 'Quá ' + (OFFLINE_AFTER_MS / 1000) + ' s không nhận được dữ liệu'); broadcast(id, { type: 'device', device: id, online: on }); }
  }
}, 3000).unref();
setInterval(() => store.purge(Date.now() - RETENTION_DAYS * 86400000).catch(e => console.error('[DB] purge', e.message)), 3600000).unref();

// ------------------------------------------------------------------ khởi động
(async () => {
  await store.init();
  if (env.ADMIN_USER && env.ADMIN_PASS && (await store.countAdmins()) === 0) {
    if (env.ADMIN_PASS.length < 10) { console.error('ADMIN_PASS phải >= 10 ký tự'); process.exit(1); }
    await store.createUser(env.ADMIN_USER, await bcrypt.hash(env.ADMIN_PASS, 12), 'admin');
    console.log('[AUTH] Đã tạo admin ban đầu:', env.ADMIN_USER);
  }
  server.listen(PORT, () => console.log(`[HTTP] Solar Tracker Cloud :${PORT} | DB=${store.kind} | devices=${[...DEVICE_IDS].join(',')}`));
})().catch(e => { console.error(e); process.exit(1); });
