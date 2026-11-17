'use strict';
// Kiểm thử đầu-cuối: broker MQTT cục bộ + server Cloud thật + "ESP32" giả lập gửi trạng thái (DỮ LIỆU CHỈ ĐỂ KIỂM THỬ).
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const makeAedes = require('aedes');
const mqtt = require('mqtt');
const CLOUD = process.argv[2] || path.join(__dirname, '..'), OUT = process.argv[3] || '.';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const chk = (n, c, i) => { if (!c) fails++; console.log((c ? '  [OK]   ' : '  [LỖI]  ') + n + (c ? '' : '  -> ' + JSON.stringify(i))); };

(async () => {
  const aedes = makeAedes();
  const broker = net.createServer(aedes.handle);
  await new Promise(r => broker.listen(18830, '127.0.0.1', r));
  const env = { ...process.env, MQTT_URL: 'mqtt://127.0.0.1:18830', JWT_SECRET: 'test-secret-test-secret-test-secret', COOKIE_SECURE: 'false', PORT: '18090',
    SAMPLE_EVERY_MS: '200', ADMIN_USER: 'admin', ADMIN_PASS: 'admin-pass-12345', DEVICES: 'tracker01:Solar Tracker 01' };
  const srv = spawn(process.execPath, ['server.js'], { cwd: CLOUD, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let slog = ''; srv.stdout.on('data', d => slog += d); srv.stderr.on('data', d => slog += d);
  for (let i = 0; i < 50 && !/HTTP\] Solar Tracker/.test(slog); i++) await sleep(200);
  chk('server khởi động', /HTTP\] Solar Tracker/.test(slog), slog.slice(-300));
  const base = 'http://127.0.0.1:18090';

  // đăng nhập
  const lr = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin-pass-12345' }) });
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
  chk('đăng nhập', lr.status === 200 && cookie.startsWith('st_sess='), lr.status);
  const H = { cookie };

  // "ESP32" giả lập
  const dev = mqtt.connect('mqtt://127.0.0.1:18830', { clientId: 'esp-sim' });
  await new Promise(r => dev.on('connect', r));
  const st = { solarVoltage: 17.5, solarCurrent: 0.9, solarPower: 15.75, batteryVoltage: 12.7, batteryCurrent: 0.45, batteryPower: 5.7, motor1Angle: 90, motor2Angle: 60,
    motor1Running: false, motor2Running: false, motor1State: 'STOP', motor2State: 'STOP', autoMode: true, eStop: false, isNight: false, simMode: false,
    ldrTL: 520, ldrTR: 540, ldrBL: 500, ldrBR: 510, diffH: 30, diffV: 20, trackStatus: 'LDR LOCKED', inaPV: true, inaBattery: true, dhtOK: true, temp: 31 };
  const pub = () => dev.publish('st/tracker01/state', JSON.stringify(st));
  dev.publish('st/tracker01/status', JSON.stringify({ online: true }));
  const t0 = Date.now();
  // pha 1: 3 s ổn định (cơ sở so sánh, KHÔNG được sinh sự kiện)
  for (let i = 0; i < 30; i++) { pub(); await sleep(100); }
  // pha 2: các thay đổi thật
  st.autoMode = false; for (let i = 0; i < 5; i++) { pub(); await sleep(100); }           // MANUAL
  st.motor1Running = true; st.motor1State = 'PHẢI'; for (let i = 0; i < 5; i++) { pub(); await sleep(100); }   // Motor 1 Activated
  st.motor1Running = false; st.motor1State = 'STOP'; for (let i = 0; i < 3; i++) { pub(); await sleep(100); }
  st.autoMode = true; for (let i = 0; i < 3; i++) { pub(); await sleep(100); }            // AUTO
  st.inaPV = false; st.solarVoltage = 0; st.solarCurrent = 0; st.solarPower = 0; for (let i = 0; i < 8; i++) { pub(); await sleep(100); }  // INA PV lỗi
  st.inaPV = true; st.solarVoltage = 17.9; st.solarCurrent = 1.0; st.solarPower = 17.9; for (let i = 0; i < 8; i++) { pub(); await sleep(100); }
  st.eStop = true; for (let i = 0; i < 3; i++) { pub(); await sleep(100); }               // E-STOP
  st.eStop = false; for (let i = 0; i < 3; i++) { pub(); await sleep(100); }
  // pha 3: mất kết nối > 15 s
  console.log('  ... chờ 17 s để thiết bị bị coi là mất kết nối');
  await sleep(17500);
  st.ldrTL = 600; for (let i = 0; i < 15; i++) { pub(); await sleep(100); }               // kết nối lại
  await sleep(500);
  const t1 = Date.now() + 1000;

  // ---- API ----
  const prev = await (await fetch(`${base}/api/report/preview?device=tracker01&from=${t0 - 1000}&to=${t1}`, { headers: H })).json();
  console.log('  preview:', JSON.stringify(prev));
  chk('preview: có mẫu', prev.n > 20, prev);
  chk('preview: mẫu có LDR = tổng mẫu', prev.ldr === prev.n, prev);
  chk('preview: có sự kiện', prev.events >= 8, prev);
  const bad = await fetch(`${base}/api/report.xlsx?device=tracker01&from=1000&to=2000`, { headers: H });
  chk('khoảng không có dữ liệu -> 404, không tạo báo cáo', bad.status === 404, bad.status);
  const bad2 = await fetch(`${base}/api/report.xlsx?device=tracker01&from=${t1}&to=${t0}`, { headers: H });
  chk('khoảng sai thứ tự -> 400', bad2.status === 400, bad2.status);
  const noauth = await fetch(`${base}/api/report.xlsx?device=tracker01&from=${t0}&to=${t1}`);
  chk('chưa đăng nhập -> 401', noauth.status === 401, noauth.status);
  await sleep(3200);
  const r = await fetch(`${base}/api/report.xlsx?device=tracker01&from=${t0 - 1000}&to=${t1}&type=all`, { headers: H });
  const cd = r.headers.get('content-disposition') || '';
  chk('xuất báo cáo 200 + đúng loại file', r.status === 200 && /spreadsheetml/.test(r.headers.get('content-type')), r.status);
  chk('tên file Solar_Tracker_Report_YYYY-MM-DD_HH-mm.xlsx', /filename="Solar_Tracker_Report_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx"/.test(cd), cd);
  fs.writeFileSync(path.join(OUT, 'e2e_report.xlsx'), Buffer.from(await r.arrayBuffer()));
  fs.writeFileSync(path.join(OUT, 'e2e_summary.json'), JSON.stringify({ preview: prev, expectInaErrSamples: 'có' }));
  const ev = (await (await fetch(`${base}/api/report/preview?device=tracker01&from=${t0 - 1000}&to=${t1}`, { headers: H })).json()).events;
  console.log('  số sự kiện đã ghi:', ev);

  dev.end(); srv.kill(); broker.close(); aedes.close();
  console.log(fails ? 'CÓ LỖI' : 'TẤT CẢ ĐẠT');
  setTimeout(() => process.exit(fails ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
