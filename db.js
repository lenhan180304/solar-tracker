'use strict';
/*
  Lưu trữ: PostgreSQL (khi có DATABASE_URL, ví dụ Neon free) hoặc bộ nhớ RAM (dev/test).
  Bảng: users, telemetry, command_log
*/

function memoryStore() {
  const users = new Map();
  const telemetry = [];
  const logs = [];
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
    async insertLog(row) {
      await q(`INSERT INTO command_log(ts,device,username,cmd,val,result,latency_ms,ip) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.ts, row.device, row.username, row.cmd, row.val, row.result, row.latency_ms, row.ip]);
    },
    async listLogs(device, limit) {
      return (await q(`SELECT ts,username,cmd,val,result,latency_ms FROM command_log
                       WHERE device=$1 ORDER BY ts DESC LIMIT $2`, [device, limit])).rows.map(r => ({ ...r, ts: Number(r.ts) }));
    },
    async purge(before) {
      await q('DELETE FROM telemetry WHERE ts<$1', [before]);
      await q('DELETE FROM command_log WHERE ts<$1', [before - 83 * 86400000]); // log giữ 90 ngày
    },
  };
}

module.exports = (url) => (url ? pgStore(url) : memoryStore());
