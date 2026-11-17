'use strict';
/*
  KIỂM THỬ bộ tạo báo cáo Excel. Dữ liệu ở đây là DỮ LIỆU GIẢ LẬP CHỈ DÙNG ĐỂ KIỂM THỬ (không bao giờ đi vào hệ thống thật).
  Chạy:  node test_report.js <thư_mục_xuất>
  Tạo 3 file: full.xlsx (đủ dữ liệu + khoảng mất kết nối + INA219 lỗi + firmware cũ chưa có LDR), sparse.xlsx (dữ liệu thiếu nhiều), tracking_only.xlsx.
*/
const fs = require('fs');
const path = require('path');
const { buildReport } = require('../report_xlsx');

const out = process.argv[2] || '.';
fs.mkdirSync(out, { recursive: true });
const T0 = Date.UTC(2026, 10, 16, 0, 0, 0);          // 16/11/2026 00:00 UTC (hiển thị +7)
const STEP = 10000;

function synth() {
  const samples = [];
  for (let k = 0; k < 8640; k++) {
    const ts = T0 + k * STEP;
    const h = ((ts - T0) / 3600000 + 7) % 24;                       // giờ địa phương
    if (k >= 3000 && k < 3120) continue;                            // mất kết nối 20 phút (không có mẫu)
    const sun = Math.max(0, Math.sin((h - 6) / 12 * Math.PI));
    const pvOk = !(k >= 5000 && k < 5180);                          // INA219 PV lỗi 30 phút
    const batOk = true;
    const pvV = pvOk ? 12 + 6 * sun : null, pvI = pvOk ? 1.6 * sun : null;
    const row = {
      ts, pvV, pvI, pvP: pvOk ? pvV * pvI : null,
      batV: batOk ? 12.2 + 0.6 * sun : null, batI: batOk ? 0.5 * sun - 0.05 : null, batP: batOk ? (12.2 + 0.6 * sun) * (0.5 * sun - 0.05) : null,
      m1: 20 + 140 * Math.min(1, h / 24), m2: 30 + 100 * sun, temp: 30,
      ldrTL: 500 + 200 * sun, ldrTR: 520 + 180 * sun, ldrBL: 480 + 210 * sun, ldrBR: 505 + 190 * sun,
      dH: Math.round(20 * Math.sin(k / 50)), dV: Math.round(15 * Math.cos(k / 70)),
      auto: k >= 6000 && k < 6300 ? 0 : 1, trk: sun > 0.05 ? 'LDR LOCKED' : 'NIGHT_HOLD',
      flags: (pvOk ? 0 : 8) | (sun <= 0.05 ? 2 : 0) | (k % 40 < 3 ? 32 : 0),
    };
    if (k < 1000) { row.ldrTL = row.ldrTR = row.ldrBL = row.ldrBR = null; row.dH = row.dV = null; row.auto = null; row.trk = null; row.flags = null; }   // firmware cũ: chưa ghi LDR/chế độ
    samples.push(row);
  }
  const events = [
    { ts: T0 + 2999 * STEP + 5000, kind: 'ESP32 Disconnected', mode: 'AUTO', status: 'OFFLINE', descr: 'Quá 15 s không nhận được dữ liệu' },
    { ts: T0 + 3120 * STEP, kind: 'ESP32 Connected', mode: 'AUTO', status: 'ONLINE', descr: 'Nhận lại dữ liệu từ ESP32' },
    { ts: T0 + 5000 * STEP, kind: 'Sensor Error', mode: 'AUTO', status: 'ONLINE', descr: 'INA219 PV không phản hồi' },
    { ts: T0 + 5180 * STEP, kind: 'Sensor Recovered', mode: 'AUTO', status: 'ONLINE', descr: 'INA219 PV đã đọc được lại' },
    { ts: T0 + 6000 * STEP, kind: 'MANUAL Mode', mode: 'MANUAL', status: 'ONLINE', descr: 'Chế độ bám chuyển sang MANUAL' },
    { ts: T0 + 6300 * STEP, kind: 'AUTO Mode', mode: 'AUTO', status: 'ONLINE', descr: 'Chế độ bám chuyển sang AUTO' },
    { ts: T0 + 6100 * STEP, kind: 'Motor Activated', mode: 'MANUAL', status: 'ONLINE', descr: 'Motor 1 (trục đứng) bắt đầu quay: PHẢI • góc 80.0°' },
    { ts: T0 + 6101 * STEP, kind: 'Motor Activated', mode: 'MANUAL', status: 'ONLINE', descr: 'Motor 2 (trục ngang) bắt đầu quay: TRÁI • góc 60.0°' },
    { ts: T0 + 7000 * STEP, kind: 'Emergency Stop', mode: 'AUTO', status: 'E-STOP', descr: 'Dừng khẩn cấp được kích hoạt' },
  ].sort((a, b) => a.ts - b.ts);
  return { samples, events };
}

(async () => {
  const { samples, events } = synth();
  const base = { deviceId: 'tracker01', deviceName: 'Solar Tracker 01', from: T0, to: T0 + 86400000, tzHours: 7, sampleSec: 10, online: true, retentionDays: 30 };
  fs.writeFileSync(path.join(out, 'full.xlsx'), await buildReport({ ...base, samples, events, type: 'all' }));
  fs.writeFileSync(path.join(out, 'tracking_only.xlsx'), await buildReport({ ...base, samples: samples.slice(0, 600), events: [], type: 'tracking' }));
  fs.writeFileSync(path.join(out, 'overview_only.xlsx'), await buildReport({ ...base, samples: samples.slice(2000, 2400), events, type: 'overview' }));
  // dữ liệu thưa/thiếu: chỉ vài mẫu, nhiều ô null, không có sự kiện
  const sparse = [0, 1, 2, 3, 4].map(i => ({ ts: T0 + i * STEP, pvV: i === 2 ? null : 15, pvI: i === 2 ? null : 1, pvP: i === 2 ? null : 15, batV: null, batI: null, batP: null, m1: 90, m2: 60, ldrTL: null, ldrTR: null, ldrBL: null, ldrBR: null, dH: null, dV: null, auto: null, trk: null, flags: null }));
  fs.writeFileSync(path.join(out, 'sparse.xlsx'), await buildReport({ ...base, samples: sparse, events: [], type: 'all' }));
  fs.writeFileSync(path.join(out, 'truth.json'), JSON.stringify({ n: samples.length, STEP, gapSec: 30 }));
  console.log('OK', samples.length, 'mẫu,', events.length, 'sự kiện');
})().catch(e => { console.error(e); process.exit(1); });
