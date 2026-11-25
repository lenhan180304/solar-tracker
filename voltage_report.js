'use strict';
/*
  BÁO CÁO ĐIỆN ÁP (chỉ điện áp PV và ắc quy) – 4 sheet, biểu đồ Excel thật:
    1. SUMMARY          : khoảng thời gian, thời điểm xuất, số mẫu, điện áp PV / ắc quy trung bình – cao nhất – thấp nhất
    2. PV VOLTAGE       : Date | Time | PV Voltage (V)
    3. BATTERY VOLTAGE  : Date | Time | Battery Voltage (V)
    4. VOLTAGE CHARTS   : biểu đồ điện áp PV theo thời gian, biểu đồ điện áp ắc quy theo thời gian
  Không đưa LDR, motor, GPIO, nhiệt độ/độ ẩm hay thông số thiết bị vào file.
  Chỉ dùng số đo thực đã lưu; mẫu nào thiếu giá trị (INA219 không phản hồi) thì không có dòng trong sheet đó (không điền 0).
  Hai chế độ nguồn dữ liệu (ghi rõ trong SUMMARY và đầu mỗi sheet):
    raw    : từng mẫu đo gốc, không gộp
    hourly : trung bình theo giờ (mỗi dòng = 1 giờ) – dùng khi khoảng dài (6 tháng, 1 năm) hoặc dữ liệu chi tiết cũ đã được dọn;
             Cao nhất / Thấp nhất vẫn lấy từ mọi mẫu đo thật trong giờ, không phải từ giá trị trung bình.
  Cột Date và Time cùng chứa thời điểm đo đầy đủ (định dạng hiển thị khác nhau) để biểu đồ dùng đúng trục thời gian.
*/
const ExcelJS = require('exceljs');
const { addCharts } = require('./xlsx_charts');

const RANGES = { '7d': { days: 7, label: '7 ngày', file: '7_Days' }, '1m': { days: 30, label: '1 tháng', file: '1_Month' },
                 '6m': { days: 182, label: '6 tháng', file: '6_Months' }, '1y': { days: 365, label: '1 năm', file: '1_Year' } };
const FONT = 'Calibri';
const C = { navy: 'FF1E40AF', head: 'FFDBEAFE', zebra: 'FFF1F5F9', border: 'FFCBD5E1', text: 'FF1E293B', mute: 'FF64748B' };
// giữ đủ 6 khoá cho xem trước (summarize) như cũ; file Excel chỉ dùng pvV và batV
const KEYS = ['pvV', 'pvI', 'pvP', 'batV', 'batI', 'batP'];
const pad = (n) => String(n).padStart(2, '0');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const bd = () => ({ top: { style: 'thin', color: { argb: C.border } }, bottom: { style: 'thin', color: { argb: C.border } }, left: { style: 'thin', color: { argb: C.border } }, right: { style: 'thin', color: { argb: C.border } } });
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const dmy = (ms, off) => { const d = new Date(ms + off); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const dmyhms = (ms, off) => { const d = new Date(ms + off); return `${dmy(ms, off)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const serial = (ms, off) => (ms + off) / 86400000 + 25569;      // số serial Excel theo giờ địa phương

/* ---- chuẩn hoá nguồn: rows = [{ts, pvV.., h?}] (giữ nguyên giao diện hàm cũ) ---- */
function fromRaw(samples) {
  const rows = samples.map(s => { const r = { ts: s.ts }; KEYS.forEach(k => { r[k] = isNum(s[k]) ? s[k] : null; }); return r; }).filter(r => KEYS.some(k => r[k] !== null));
  return { mode: 'raw', rows };
}
function fromHourly(hours) {
  const rows = hours.filter(h => h.n > 0).map(h => { const r = { ts: h.ts, h }; KEYS.forEach(k => { r[k] = h[k].sum / h.n; }); return r; });
  return { mode: 'hourly', rows };
}
function statOf(rows, k) {
  let n = 0, sum = 0, mn = Infinity, mx = -Infinity;
  for (const r of rows) {
    if (r.h) { if (!r.h[k] || !isNum(r.h[k].sum)) continue; n += r.h.n; sum += r.h[k].sum; if (r.h[k].min < mn) mn = r.h[k].min; if (r.h[k].max > mx) mx = r.h[k].max; }
    else { const v = r[k]; if (v === null) continue; n++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  return n ? { n, avg: sum / n, min: mn, max: mx } : { n: 0, avg: null, min: null, max: null };
}
/* dùng cho xem trước (tóm tắt nhanh) – giữ nguyên định dạng trả về */
function summarize(data) {
  const o = {}; KEYS.forEach(k => { o[k] = statOf(data.rows, k); });
  return { mode: data.mode, n: data.rows.length, pv: o.pvV, bat: o.batV, pvI: o.pvI, pvP: o.pvP, batI: o.batI, batP: o.batP };
}

function styleHead(c) { c.font = { name: FONT, bold: true, color: { argb: C.text } }; c.fill = fill(C.head); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = bd(); }
function putTitle(ws, text, sub, cols) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1); t.value = text; t.font = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } }; t.fill = fill(C.navy); t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1); s.value = sub; s.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; s.alignment = { indent: 1, wrapText: true };
}
function putSection(ws, r, text, cols) {
  ws.mergeCells(r, 1, r, cols); const c = ws.getCell(r, 1); c.value = text;
  c.font = { name: FONT, bold: true, size: 12, color: { argb: C.navy } }; c.border = { bottom: { style: 'medium', color: { argb: 'FF2563EB' } } }; ws.getRow(r).height = 22;
}
function putInfo(ws, r, label, value, cols, fmt) {
  ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { name: FONT, bold: true, color: { argb: C.text } };
  ws.mergeCells(r, 2, r, cols); const v = ws.getCell(r, 2); v.value = value; if (fmt) v.numFmt = fmt;
  v.font = { name: FONT, color: { argb: C.text } }; v.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
  for (let k = 1; k <= cols; k++) ws.getCell(r, k).border = { bottom: { style: 'hair', color: { argb: C.border } } };
}

async function buildVoltageReport(o) {
  const off = o.tzHours * 3600000;
  const { mode, rows } = o.data;
  const hourly = mode === 'hourly';
  const long = RANGES[o.range].days > 31;
  const pvRows = rows.filter(r => r.pvV !== null), batRows = rows.filter(r => r.batV !== null);
  const stPv = statOf(rows, 'pvV'), stBat = statOf(rows, 'batV');
  const srcText = hourly
    ? 'Trung bình theo giờ (mỗi dòng = trung bình điện áp trong 1 giờ). Trung bình / cao nhất / thấp nhất trong SUMMARY tính từ mọi mẫu đo thật, không phải từ giá trị trung bình giờ.'
    : 'Mẫu đo gốc, không gộp (mỗi dòng = 1 lần đo).';
  const chunks = []; const sink = new (require('stream').Writable)({ write(c, e, cb) { chunks.push(c); cb(); } });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: false });
  wb.creator = 'Solar Tracker Cloud'; wb.created = new Date(); wb.title = 'Solar Tracker – Voltage Report';

  // ================= 1. SUMMARY =================
  {
    const ws = wb.addWorksheet('SUMMARY', { properties: { tabColor: { argb: C.navy } }, views: [{ showGridLines: false }] });
    ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
    putTitle(ws, 'SOLAR TRACKER – VOLTAGE REPORT', `Điện áp tấm pin (PV) và ắc quy • ${o.deviceName || o.deviceId} • số đo thực tế đã lưu trên Cloud`, 5);
    putSection(ws, 4, 'THÔNG TIN BÁO CÁO', 5);
    putInfo(ws, 5, 'Khoảng thời gian báo cáo', `${dmy(o.from, off)}  →  ${dmy(o.to, off)}  (${RANGES[o.range].label}, giờ UTC+${o.tzHours})`, 5);
    putInfo(ws, 6, 'Thời điểm xuất báo cáo', dmyhms(Date.now(), off), 5);
    putInfo(ws, 7, 'Số lượng mẫu đo', `${rows.length.toLocaleString('en-US')} ${hourly ? 'dòng trung bình giờ' : 'mẫu'}  (PV hợp lệ: ${pvRows.length.toLocaleString('en-US')} • ắc quy hợp lệ: ${batRows.length.toLocaleString('en-US')})`, 5);
    putInfo(ws, 8, 'Nguồn dữ liệu', srcText, 5);
    ws.getRow(8).height = hourly ? 44 : 18;
    putSection(ws, 10, 'THỐNG KÊ ĐIỆN ÁP', 5);
    ['Thông số', 'Trung bình (V)', 'Cao nhất (V)', 'Thấp nhất (V)', 'Số mẫu hợp lệ'].forEach((h, i) => { const c = ws.getCell(11, 1 + i); c.value = h; styleHead(c); });
    ws.getRow(11).height = 24;
    [['Điện áp PV (PV Voltage)', stPv], ['Điện áp ắc quy (Battery Voltage)', stBat]].forEach(([name, s], i) => {
      const r = 12 + i, vals = [name, s.avg, s.max, s.min, s.n * (hourly ? 1 : 1)];
      vals.forEach((v, c) => {
        const cell = ws.getCell(r, 1 + c); cell.value = v === null ? 'N/A' : v; cell.border = bd();
        cell.font = { name: FONT, bold: c === 0 || (c >= 1 && c <= 3), color: { argb: c >= 1 && c <= 3 ? C.navy : C.text } };
        if (c >= 1 && c <= 3) { cell.numFmt = '0.00'; cell.alignment = { horizontal: 'right' }; }
        if (c === 4) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; }
        if (i % 2) cell.fill = fill(C.zebra);
      });
    });
    ws.mergeCells(15, 1, 15, 5);
    const nt = ws.getCell(15, 1);
    nt.value = 'Chỉ tính các mẫu có giá trị. Mẫu thiếu dữ liệu (cảm biến INA219 không phản hồi) không được tính và không thay bằng 0.' +
      (hourly ? ' "Số mẫu hợp lệ" là tổng số lần đo thật trong các giờ.' : '');
    nt.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; nt.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(15).height = 30;
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    for (let r = 1; r <= 15; r++) ws.getRow(r).commit();
    await ws.commit();
  }

  // ================= 2, 3. DỮ LIỆU ĐIỆN ÁP =================
  async function dataSheet(name, title, key, list, tab) {
    const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: tab } }, views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ width: 14 }, { width: 12 }, { width: 18 }];
    ['Date', 'Time', title].forEach((h, i) => { const c = ws.getCell(1, 1 + i); c.value = h; styleHead(c); });
    ws.getRow(1).height = 24;
    if (list.length) ws.autoFilter = `A1:C${list.length + 1}`;
    ws.getRow(1).commit();
    for (let i = 0; i < list.length; i++) {
      const r = list[i], row = ws.getRow(i + 2), t = serial(r.ts, off);
      const a = row.getCell(1); a.value = t; a.numFmt = 'dd/mm/yyyy'; a.alignment = { horizontal: 'center' };
      const b = row.getCell(2); b.value = t; b.numFmt = hourly ? 'hh:mm' : 'hh:mm:ss'; b.alignment = { horizontal: 'center' };
      const v = row.getCell(3); v.value = Math.round(r[key] * 1000) / 1000; v.numFmt = '0.00';
      if (i % 2) [a, b, v].forEach(c => { c.fill = fill(C.zebra); });
      row.commit();
    }
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    await ws.commit();
  }
  await dataSheet('PV VOLTAGE', 'PV Voltage (V)', 'pvV', pvRows, 'FF2563EB');
  await dataSheet('BATTERY VOLTAGE', 'Battery Voltage (V)', 'batV', batRows, 'FF16A34A');

  // ================= 4. VOLTAGE CHARTS =================
  {
    const ws = wb.addWorksheet('VOLTAGE CHARTS', { properties: { tabColor: { argb: 'FF7C3AED' } }, views: [{ showGridLines: false }] });
    ws.columns = Array(12).fill({ width: 11 });
    putTitle(ws, 'BIỂU ĐỒ ĐIỆN ÁP THEO THỜI GIAN', `${dmy(o.from, off)} → ${dmy(o.to, off)} • ${hourly ? 'trung bình theo giờ' : 'mẫu đo gốc'} • biểu đồ liên kết trực tiếp với sheet PV VOLTAGE và BATTERY VOLTAGE`, 12);
    for (let r = 1; r <= 40; r++) ws.getRow(r).commit();
    await ws.commit();
  }
  await wb.commit();

  const xf = long ? 'dd/mm/yyyy' : 'dd/mm hh:mm';
  const ref = (sheet, n, col) => `'${sheet}'!$${col}$2:$${col}$${n + 1}`;
  const charts = [];
  if (pvRows.length) charts.push({ anchor: { col: 0, row: 3, cols: 12, rows: 18 },
    spec: { title: 'Điện áp PV theo thời gian', xTitle: 'Thời gian đo', yTitle: 'Điện áp (V)', yFmt: '0.0', xFmt: xf,
      series: [{ name: 'PV Voltage (V)', color: '2563EB', x: ref('PV VOLTAGE', pvRows.length, 'A'), y: ref('PV VOLTAGE', pvRows.length, 'C') }] } });
  if (batRows.length) charts.push({ anchor: { col: 0, row: 22, cols: 12, rows: 18 },
    spec: { title: 'Điện áp ắc quy theo thời gian', xTitle: 'Thời gian đo', yTitle: 'Điện áp (V)', yFmt: '0.0', xFmt: xf,
      series: [{ name: 'Battery Voltage (V)', color: '16A34A', x: ref('BATTERY VOLTAGE', batRows.length, 'A'), y: ref('BATTERY VOLTAGE', batRows.length, 'C') }] } });
  return charts.length ? addCharts(Buffer.concat(chunks), [{ sheetNo: 4, charts }]) : Buffer.concat(chunks);
}

module.exports = { buildVoltageReport, fromRaw, fromHourly, summarize, RANGES };
