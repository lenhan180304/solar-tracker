'use strict';
// KIỂM THỬ báo cáo điện áp. Dữ liệu ở đây là GIẢ LẬP CHỈ DÙNG ĐỂ KIỂM THỬ.  node test/test_voltage.js <thư_mục_xuất> [số_mẫu]
const fs = require('fs'), path = require('path');
const { buildVoltageReport, fromRaw, fromHourly } = require('../voltage_report');
const out = process.argv[2] || '.'; fs.mkdirSync(out, { recursive: true });
const N = Number(process.argv[3] || 60480);
const to = Date.now(), from = to - 7 * 86400000;
(async () => {
  const samples = [];
  for (let k = 0; k < N; k++) {
    if (k > 1000 && k < 1100) continue;                         // mất kết nối
    const ts = from + k * 10000, pvOk = !(k >= 5000 && k < 5200);
    samples.push({ ts, pvV: pvOk ? 12 + 6 * Math.abs(Math.sin(k / 3000)) : null, batV: 12.2 + 0.5 * Math.sin(k / 4000) });
  }
  let t = Date.now();
  let buf = await buildVoltageReport({ deviceId: 'tracker01', deviceName: 'Solar Tracker 01', range: '7d', from, to, data: fromRaw(samples), tzHours: 7 });
  fs.writeFileSync(path.join(out, 'volt_raw.xlsx'), buf);
  console.log('raw', N, 'dòng', Date.now() - t, 'ms', (buf.length / 1e6).toFixed(2), 'MB, RSS', (process.memoryUsage().rss / 1e6).toFixed(0), 'MB');
  const hours = []; for (let h = 0; h < 24 * 365; h++) { const b = 12 + Math.sin(h / 12); hours.push({ ts: Math.floor((to - 365 * 86400000) / 3600000) * 3600000 + h * 3600000, n: 360, pvV: { sum: b * 360, min: b - 1, max: b + 1 }, batV: { sum: 12.3 * 360, min: 12, max: 12.6 } }); }
  t = Date.now();
  buf = await buildVoltageReport({ deviceId: 'tracker01', deviceName: 'Solar Tracker 01', range: '1y', from: to - 365 * 86400000, to, data: fromHourly(hours), tzHours: 7 });
  fs.writeFileSync(path.join(out, 'volt_hourly.xlsx'), buf);
  console.log('hourly', hours.length, 'dòng', Date.now() - t, 'ms', (buf.length / 1e6).toFixed(2), 'MB');
})();
