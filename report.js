'use strict';
/*
  Tạo file Excel báo cáo từ bảng tổng hợp theo giờ.
  Sheet 1 "Tổng kết ngày"  : mỗi ngày một dòng (TB / nhỏ nhất / lớn nhất, điện năng PV ước tính, độ phủ dữ liệu)
  Sheet 2 "Theo giờ"        : mỗi giờ một dòng
  Sheet 3 "Thông tin"       : thiết bị, khoảng thời gian, cách tính
  Thời gian hiển thị theo múi giờ cố định TZ_OFFSET_HOURS (mặc định +7, Việt Nam).
*/
const ExcelJS = require('exceljs');

const SAMPLE_SEC = 10;               // chu kỳ lấy mẫu của server (giây)
const SAMPLES_PER_HOUR = 3600 / SAMPLE_SEC;
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');
function fmtDate(localMs) { const d = new Date(localMs); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; }

async function buildWorkbook({ deviceId, deviceName, rows, since, until, tzHours }) {
  const off = tzHours * 3600000;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Solar Tracker Cloud';
  wb.created = new Date();

  const head = (ws) => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF95738' } };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    ws.getRow(1).height = 34;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // ---------------- Theo giờ ----------------
  const wh = wb.addWorksheet('Theo giờ');
  wh.columns = [
    { header: 'Thời gian (giờ bắt đầu)', key: 't', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Số mẫu', key: 'n', width: 9 },
    { header: 'PV điện áp TB (V)', key: 'pvVa', width: 14, style: { numFmt: '0.00' } },
    { header: 'PV điện áp min (V)', key: 'pvVn', width: 14, style: { numFmt: '0.00' } },
    { header: 'PV điện áp max (V)', key: 'pvVx', width: 14, style: { numFmt: '0.00' } },
    { header: 'PV dòng điện TB (A)', key: 'pvIa', width: 14, style: { numFmt: '0.000' } },
    { header: 'PV công suất TB (W)', key: 'pvPa', width: 14, style: { numFmt: '0.00' } },
    { header: 'PV công suất max (W)', key: 'pvPx', width: 14, style: { numFmt: '0.00' } },
    { header: 'PV điện năng ước tính (Wh)', key: 'pvWh', width: 16, style: { numFmt: '0.00' } },
    { header: 'Ắc quy điện áp TB (V)', key: 'batVa', width: 14, style: { numFmt: '0.00' } },
    { header: 'Ắc quy điện áp min (V)', key: 'batVn', width: 14, style: { numFmt: '0.00' } },
    { header: 'Ắc quy điện áp max (V)', key: 'batVx', width: 14, style: { numFmt: '0.00' } },
    { header: 'Ắc quy dòng điện TB (A)', key: 'batIa', width: 14, style: { numFmt: '0.000' } },
    { header: 'Ắc quy công suất TB (W)', key: 'batPa', width: 14, style: { numFmt: '0.00' } },
  ];
  head(wh);

  const days = new Map(); // ngày địa phương -> bộ cộng dồn
  for (const h of rows) {
    const n = h.n || 1;
    const avg = (k) => h[k].sum / n;
    const wattHours = avg('pvP') * (n * SAMPLE_SEC) / 3600; // TB công suất x thời gian đã lấy mẫu
    wh.addRow({
      t: new Date(h.ts + off), n,
      pvVa: avg('pvV'), pvVn: h.pvV.min, pvVx: h.pvV.max, pvIa: avg('pvI'), pvPa: avg('pvP'), pvPx: h.pvP.max, pvWh: wattHours,
      batVa: avg('batV'), batVn: h.batV.min, batVx: h.batV.max, batIa: avg('batI'), batPa: avg('batP'),
    });

    const dayKey = Math.floor((h.ts + off) / DAY) * DAY;
    let d = days.get(dayKey);
    if (!d) {
      d = { n: 0, wh: 0, peakP: -Infinity };
      ['pvV', 'pvI', 'pvP', 'batV', 'batI', 'batP'].forEach(k => { d[k] = { sum: 0, min: Infinity, max: -Infinity }; });
      days.set(dayKey, d);
    }
    d.n += n; d.wh += wattHours;
    ['pvV', 'pvI', 'pvP', 'batV', 'batI', 'batP'].forEach(k => {
      d[k].sum += h[k].sum; d[k].min = Math.min(d[k].min, h[k].min); d[k].max = Math.max(d[k].max, h[k].max);
    });
  }

  // ---------------- Tổng kết ngày ----------------
  const wd = wb.addWorksheet('Tổng kết ngày', { properties: { tabColor: { argb: 'FFF95738' } } });
  wd.columns = [
    { header: 'Ngày', key: 'day', width: 13, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Số mẫu', key: 'n', width: 9 },
    { header: 'Độ phủ dữ liệu (%)', key: 'cov', width: 12, style: { numFmt: '0.0' } },
    { header: 'PV điện áp TB (V)', key: 'pvVa', width: 13, style: { numFmt: '0.00' } },
    { header: 'PV điện áp min (V)', key: 'pvVn', width: 13, style: { numFmt: '0.00' } },
    { header: 'PV điện áp max (V)', key: 'pvVx', width: 13, style: { numFmt: '0.00' } },
    { header: 'PV dòng điện TB (A)', key: 'pvIa', width: 13, style: { numFmt: '0.000' } },
    { header: 'PV công suất TB (W)', key: 'pvPa', width: 13, style: { numFmt: '0.00' } },
    { header: 'PV công suất đỉnh (W)', key: 'pvPx', width: 13, style: { numFmt: '0.00' } },
    { header: 'PV điện năng ước tính (Wh)', key: 'pvWh', width: 15, style: { numFmt: '0.00' } },
    { header: 'Ắc quy điện áp TB (V)', key: 'batVa', width: 13, style: { numFmt: '0.00' } },
    { header: 'Ắc quy điện áp min (V)', key: 'batVn', width: 13, style: { numFmt: '0.00' } },
    { header: 'Ắc quy điện áp max (V)', key: 'batVx', width: 13, style: { numFmt: '0.00' } },
    { header: 'Ắc quy dòng điện TB (A)', key: 'batIa', width: 13, style: { numFmt: '0.000' } },
    { header: 'Ắc quy công suất TB (W)', key: 'batPa', width: 13, style: { numFmt: '0.00' } },
  ];
  head(wd);
  let totalWh = 0, totalN = 0;
  [...days.keys()].sort((a, b) => a - b).forEach(k => {
    const d = days.get(k);
    totalWh += d.wh; totalN += d.n;
    wd.addRow({
      day: new Date(k), n: d.n, cov: Math.min(100, d.n / (24 * SAMPLES_PER_HOUR) * 100),
      pvVa: d.pvV.sum / d.n, pvVn: d.pvV.min, pvVx: d.pvV.max, pvIa: d.pvI.sum / d.n,
      pvPa: d.pvP.sum / d.n, pvPx: d.pvP.max, pvWh: d.wh,
      batVa: d.batV.sum / d.n, batVn: d.batV.min, batVx: d.batV.max, batIa: d.batI.sum / d.n, batPa: d.batP.sum / d.n,
    });
  });
  if (days.size) {
    const r = wd.addRow({ day: 'TỔNG', n: totalN, pvWh: totalWh });
    r.font = { bold: true };
    r.getCell('day').alignment = { horizontal: 'right' };
  }
  if (!days.size) wd.addRow({ day: 'Chưa có dữ liệu trong khoảng thời gian này' });

  // ---------------- Thông tin ----------------
  const wi = wb.addWorksheet('Thông tin');
  wi.columns = [{ width: 30 }, { width: 80 }];
  const info = [
    ['Thiết bị', `${deviceName || deviceId} (${deviceId})`],
    ['Từ', fmtDate(since + off)],
    ['Đến', fmtDate(until + off)],
    ['Múi giờ hiển thị', `UTC${tzHours >= 0 ? '+' : ''}${tzHours}`],
    ['Tạo lúc', `${fmtDate(Date.now() + off)} ${pad(new Date(Date.now() + off).getUTCHours())}:${pad(new Date(Date.now() + off).getUTCMinutes())}`],
    ['Chu kỳ lấy mẫu', `${SAMPLE_SEC} giây (chỉ ghi khi ESP32 online và máy chủ đang chạy)`],
    ['Số mẫu', 'Số lần đo trong khoảng thời gian; tối đa 360 mẫu/giờ, 8.640 mẫu/ngày'],
    ['Độ phủ dữ liệu', 'Số mẫu thực tế / số mẫu tối đa. Thấp nghĩa là ESP32 hoặc máy chủ từng mất kết nối'],
    ['Điện năng PV ước tính (Wh)', 'Công suất trung bình × thời gian đã lấy mẫu. Là số ước tính, không phải đồng hồ đo điện'],
    ['Ắc quy', 'Dòng điện/công suất lấy nguyên giá trị đo của INA219 #2 (dấu theo chiều cắm cảm biến)'],
  ];
  info.forEach(([a, b]) => { const r = wi.addRow([a, b]); r.getCell(1).font = { bold: true }; r.getCell(2).alignment = { wrapText: true, vertical: 'top' }; });

  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook, SAMPLE_SEC };
