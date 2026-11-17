'use strict';
// KIỂM THỬ báo cáo V/A/W. Dữ liệu ở đây là GIẢ LẬP CHỈ DÙNG ĐỂ KIỂM THỬ.  node test/test_voltage.js <thư_mục_xuất> [số_mẫu_7_ngày]
const fs = require('fs'), path = require('path');
const { buildVoltageReport, fromRaw, fromHourly } = require('../voltage_report');
const out = process.argv[2] || '.'; fs.mkdirSync(out, { recursive: true });
const N = Number(process.argv[3] || 60480);
const to = Date.now();
const run = async (name, range, days, data) => {
  const t = Date.now();
  const buf = await buildVoltageReport({ deviceId: 'tracker01', deviceName: 'Solar Tracker 01', range, from: to - days * 86400000, to, data, tzHours: 7 });
  fs.writeFileSync(path.join(out, name), buf);
  console.log(name, data.rows.length, 'dòng', Date.now() - t, 'ms', (buf.length / 1e6).toFixed(2), 'MB, RSS', (process.memoryUsage().rss / 1e6).toFixed(0), 'MB');
};
(async () => {
  const from = to - 7 * 86400000, samples = [];
  for (let k = 0; k < N; k++) {
    if (k > 1000 && k < 1100) continue;
    const ts = from + k * 10000, sun = Math.max(0, Math.sin(((ts % 86400000) / 3600000 + 7 - 6) / 12 * Math.PI)), pvOk = !(k >= 5000 && k < 5200);
    const pvV = 12 + 6 * sun, pvI = 1.5 * sun, batV = 12.2 + 0.5 * sun, batI = 0.4 * sun - 0.05;
    samples.push({ ts, pvV: pvOk ? pvV : null, pvI: pvOk ? pvI : null, pvP: pvOk ? pvV * pvI : null, batV, batI, batP: batV * batI });
  }
  await run('rpt_7d.xlsx', '7d', 7, fromRaw(samples));
  const mk = (days) => { const hs = []; const t0 = Math.floor((to - days * 86400000) / 3600000) * 3600000; for (let h = 0; h < days * 24; h++) { const ts = t0 + h * 3600000, sun = Math.max(0, Math.sin(((ts % 86400000) / 3600000 + 1) / 12 * Math.PI)), b = 12 + 6 * sun;
    const m = (v) => ({ sum: v * 360, min: v * 0.9, max: v * 1.1 }); hs.push({ ts, n: 360, pvV: m(b), pvI: m(1.5 * sun + 0.01), pvP: m(b * 1.5 * sun + 0.01), batV: m(12.3), batI: m(0.3 * sun + 0.01), batP: m(3.7 * sun + 0.01) }); } return hs; };
  await run('rpt_1m.xlsx', '1m', 30, fromHourly(mk(30)));
  await run('rpt_6m.xlsx', '6m', 182, fromHourly(mk(182)));
  await run('rpt_1y.xlsx', '1y', 365, fromHourly(mk(365)));
})();
