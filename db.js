'use strict';
/*
  Lưu trữ: PostgreSQL (khi có DATABASE_URL, ví dụ Neon free) hoặc bộ nhớ RAM (dev/test).
  Bảng: users, telemetry (chi tiết 10 s, giữ RETENTION_DAYS),
        telemetry_hourly (tổng hợp theo giờ, GIỮ VĨNH VIỄN ~1 MB/năm/thiết bị), command_log
*/

// 6 đại lượng được tổng hợp theo giờ: khóa JS -> tên cột SQL
const METRICS = [
  ['pvV', 'pv_v'], ['pvI', 'pv_i'], ['pvP', 'pv_p'],
  ['batV', 'bat_v'], ['batI', 'bat_i'], ['batP', 'bat_p'],
];
const HOUR = 3600000;
const hourOf = (ts) => Math.floor(ts / HOUR) * HOUR;

function memoryStore() {
  const users = new Map();
  const telemetry = [];
  const logs = [];
  const hourly = new Map(); // `${device}|${hour}` -> {device, ts, n, pvV:{sum,min,max}, ...}
  return {
    kind: 'memory',
    async init() {},
    async getUser(u) { return users.get(u) || null; },
    async listUsers() { return [...users.values()].map(({ username, role }) => ({ username, role })); },
    async createUser(username, hash, role) {
      if (users.has(username)) throw new Error('EXISTS');
      users.set(username, { username, password_hash: hash, role });
    },
    async deleteUser(u) { users.delete(u); },
    async countAdmins() { return [...users.values()].filter(x => x.role === 'admin').length; },
    async insertTelemetry(device, ts, r) {
      telemetry.push({ device, ts, ...r });
      if (telemetry.length > 200000) telemetry.splice(0, 10000);
    },
    async queryTelemetry(device, since) { return telemetry.filter(r => r.device === device && r.ts >= since); },
    async addHourly(device, ts, r) {
      const key = device + '|' + hourOf(ts);
      let h = hourly.get(key);
      if (!h) {
        h = { device, ts: hourOf(ts), n: 0 };
        METRICS.forEach(([k]) => { h[k] = { sum: 0, min: Infinity, max: -Infinity }; });
        hourly.set(key, h);
      }
      h.n += 1;
      METRICS.forEach(([k]) => { const v = r[k]; h[k].sum += v; h[k].min = Math.min(h[k].min, v); h[k].max = Math.max(h[k].max, v); });
    },
    async queryHourly(device, since) {
      return [...hourly.values()].filter(h => h.device === device && h.ts >= since).sort((a, b) => a.ts - b.ts);
    },
    async insertLog(row) { logs.push(row); if (logs.length > 5000) logs.shift(); },
    async listLogs(device, limit) { return logs.filter(r => r.device === device).slice(-limit).reverse(); },
    async purge(before) {
      for (let i = telemetry.length - 1; i >= 0; i--) if (telemetry[i].ts < before) telemetry.splice(i, 1);
    },
  };
}

function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 5 });
  const q = (text, params) => pool.query(text, params);

  // Câu lệnh upsert tổng hợp theo giờ (sinh sẵn một lần)
  const hCols = METRICS.flatMap(([, c]) => [`${c}_sum`, `${c}_min`, `${c}_max`]);
  const upsertSql =
    `INSERT INTO telemetry_hourly(device,hour_ts,n,${hCols.join(',')}) VALUES($1,$2,1,${hCols.map((_, i) => '$' + (i + 3)).join(',')})
     ON CONFLICT (device,hour_ts) DO UPDATE SET n=telemetry_hourly.n+1,` +
    METRICS.map(([, c]) =>
      `${c}_sum=telemetry_hourly.${c}_sum+EXCLUDED.${c}_sum,` +
      `${c}_min=LEAST(telemetry_hourly.${c}_min,EXCLUDED.${c}_min),` +
      `${c}_max=GREATEST(telemetry_hourly.${c}_max,EXCLUDED.${c}_max)`).join(',');

  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users(
        username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('viewer','operator','admin')),
        created_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS telemetry(
        device TEXT NOT NULL, ts BIGINT NOT NULL,
        pv_v REAL, pv_i REAL, pv_p REAL, bat_v REAL, bat_i REAL, bat_p REAL,
        m1 REAL, m2 REAL, temp REAL)`);
      await q(`CREATE INDEX IF NOT EXISTS telemetry_dev_ts ON telemetry(device, ts)`);
      await q(`CREATE TABLE IF NOT EXISTS telemetry_hourly(
        device TEXT NOT NULL, hour_ts BIGINT NOT NULL, n INTEGER NOT NULL,
        ${METRICS.map(([, c]) => `${c}_sum DOUBLE PRECISION NOT NULL, ${c}_min REAL NOT NULL, ${c}_max REAL NOT NULL`).join(', ')},
        PRIMARY KEY (device, hour_ts))`);
      await q(`CREATE TABLE IF NOT EXISTS command_log(
        id BIGSERIAL PRIMARY KEY, ts BIGINT NOT NULL, device TEXT NOT NULL, username TEXT NOT NULL,
        cmd TEXT NOT NULL, val TEXT, result TEXT NOT NULL, latency_ms INTEGER, ip TEXT)`);
      await q(`CREATE INDEX IF NOT EXISTS command_log_dev_ts ON command_log(device, ts DESC)`);
    },
    async getUser(u) { return (await q('SELECT username,password_hash,role FROM users WHERE username=$1', [u])).rows[0] || null; },
    async listUsers() { return (await q('SELECT username,role FROM users ORDER BY username')).rows; },
    async createUser(username, hash, role) {
      try { await q('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)', [username, hash, role]); }
      catch (e) { if (e.code === '23505') throw new Error('EXISTS'); throw e; }
    },
    async deleteUser(u) { await q('DELETE FROM users WHERE username=$1', [u]); },
    async countAdmins() { return Number((await q("SELECT count(*) c FROM users WHERE role='admin'")).rows[0].c); },
    async insertTelemetry(device, ts, r) {
      await q(`INSERT INTO telemetry(device,ts,pv_v,pv_i,pv_p,bat_v,bat_i,bat_p,m1,m2,temp)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [device, ts, r.pvV, r.pvI, r.pvP, r.batV, r.batI, r.batP, r.m1, r.m2, r.temp]);
    },
    async queryTelemetry(device, since) {
      const rows = (await q(`SELECT ts,pv_v,pv_i,pv_p,bat_v,bat_i,bat_p FROM telemetry
                             WHERE device=$1 AND ts>=$2 ORDER BY ts`, [device, since])).rows;
      return rows.map(r => ({ ts: Number(r.ts), pvV: r.pv_v, pvI: r.pv_i, pvP: r.pv_p, batV: r.bat_v, batI: r.bat_i, batP: r.bat_p }));
    },
    async addHourly(device, ts, r) {
      const params = [device, hourOf(ts)];
      METRICS.forEach(([k]) => params.push(r[k], r[k], r[k])); // sum, min, max của mẫu đầu tiên
      await q(upsertSql, params);
    },
    async queryHourly(device, since) {
      const rows = (await q('SELECT * FROM telemetry_hourly WHERE device=$1 AND hour_ts>=$2 ORDER BY hour_ts', [device, since])).rows;
      return rows.map(r => {
        const h = { device, ts: Number(r.hour_ts), n: r.n };
        METRICS.forEach(([k, c]) => { h[k] = { sum: Number(r[c + '_sum']), min: r[c + '_min'], max: r[c + '_max'] }; });
        return h;
      });
    },
    async insertLog(row) {
      await q(`INSERT INTO command_log(ts,device,username,cmd,val,result,latency_ms,ip) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.ts, row.device, row.username, row.cmd, row.val, row.result, row.latency_ms, row.ip]);
    },
    async listLogs(device, limit) {
      return (await q(`SELECT ts,username,cmd,val,result,latency_ms FROM command_log
                       WHERE device=$1 ORDER BY ts DESC LIMIT $2`, [device, limit])).rows.map(r => ({ ...r, ts: Number(r.ts) }));
    },
    async purge(before) {
      // chỉ xóa dữ liệu chi tiết cũ và nhật ký quá 90 ngày; bảng tổng hợp theo giờ được giữ vĩnh viễn
      await q('DELETE FROM telemetry WHERE ts<$1', [before]);
      await q('DELETE FROM command_log WHERE ts<$1', [before - 83 * 86400000]);
    },
  };
}

module.exports = (url) => (url ? pgStore(url) : memoryStore());
module.exports.METRICS = METRICS;
