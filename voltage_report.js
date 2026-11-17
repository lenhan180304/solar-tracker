'use strict';
/*
  BÁO CÁO ĐIỆN ÁP – 1 sheet "SOLAR REPORT", chỉ gồm điện áp PV và điện áp ắc quy.
  Bố cục: khối trái (A–H) = thông tin, bảng thống kê, 2 biểu đồ Excel thật; khối phải (J–O) = bảng dữ liệu đo (hàng 1 cố định, có bộ lọc).
  Nguyên tắc: chỉ dùng số đo thực đã lưu; thiếu dữ liệu = ô trống (không điền 0); thống kê là công thức Excel (kèm giá trị tính sẵn).
  Hai chế độ nguồn dữ liệu:
    raw    : từng mẫu gốc (mỗi dòng = 1 mẫu đo)                       – khi khoảng thời gian còn trong thời gian lưu chi tiết và không quá nhiều dòng
    hourly : trung bình theo giờ (mỗi dòng = 1 giờ), kèm Min/Max thật  – khi khoảng dài hơn (dữ liệu chi tiết đã được dọn). Ghi rõ trong file.
*/
const ExcelJS = require('exceljs');
const { addCharts } = require('./xlsx_charts');

const RANGES = { '7d': { days: 7, label: '7 ngày', file: '7_Days' }, '1m': { days: 30, label: '1 tháng', file: '1_Month' },
                 '6m': { days: 182, label: '6 tháng', file: '6_Months' }, '1y': { days: 365, label: '1 năm', file: '1_Year' } };
const SHEET = 'SOLAR REPORT';
const FONT = 'Calibri';
const C = { navy: 'FF1E40AF', head: 'FFDBEAFE', zebra: 'FFF1F5F9', border: 'FFCBD5E1', text: 'FF1E293B', mute: 'FF64748B' };
const pad = (n) => String(n).padStart(2, '0');
const dmy = (ms, off) => { const d = new Date(ms + off); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const dmyhms = (ms, off) => { const d = new Date(ms + off); return `${dmy(ms, off)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const bd = () => ({ top: { style: 'thin', color: { argb: C.border } }, bottom: { style: 'thin', color: { argb: C.border } }, left: { style: 'thin', color: { argb: C.border } }, right: { style: 'thin', color: { argb: C.border } } });
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/* Chuẩn hoá nguồn dữ liệu -> {mode, rows:[{ts,pv,bat}], stat:{pv:{n,avg,min,max},bat:{...}}} (stat tính từ dữ liệu thật) */
function fromRaw(samples) {
  const rows = samples.map(s => ({ ts: s.ts, pv: isNum(s.pvV) ? s.pvV : null, bat: isNum(s.batV) ? s.batV : null })).filter(r => r.pv !== null || r.bat !== null);
  const st = (k) => { let n = 0, sum = 0, mn = Infinity, mx = -Infinity; for (const r of rows) { const v = r[k]; if (v === null) continue; n++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; } return n ? { n, avg: sum / n, min: mn, max: mx } : { n: 0, avg: null, min: null, max: null }; };
  return { mode: 'raw', rows, stat: { pv: st('pv'), bat: st('bat') } };
}
function fromHourly(hours) {
  const rows = hours.filter(h => h.n > 0).map(h => ({ ts: h.ts, pv: h.pvV.sum / h.n, bat: h.batV.sum / h.n, n: h.n, pvMin: h.pvV.min, pvMax: h.pvV.max, batMin: h.batV.min, batMax: h.batV.max }));
  const st = (k, mk, xk) => { let n = 0, sum = 0, mn = Infinity, mx = -Infinity; for (const h of hours) { if (!(h.n > 0)) continue; n += h.n; sum += h[k].sum; if (h[k].min < mn) mn = h[k].min; if (h[k].max > mx) mx = h[k].max; } return n ? { n, avg: sum / n, min: mn, max: mx } : { n: 0, avg: null, min: null, max: null }; };
  return { mode: 'hourly', rows, stat: { pv: st('pvV'), bat: st('batV') } };
}

async function buildVoltageReport(o) {
  const off = o.tzHours * 3600000;
  const { mode, rows, stat } = o.data;
  const N = rows.length, hourly = mode === 'hourly';
  const last = N + 1;
  // Ghi dạng STREAM (từng hàng được đẩy xuống bộ đệm rồi giải phóng) để tiết kiệm RAM trên Render free (512 MB)
  const chunks = []; const sink = new (require('stream').Writable)({ write(c, e, cb) { chunks.push(c); cb(); } });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: false });
  wb.creator = 'Solar Tracker Cloud'; wb.created = new Date(); wb.title = 'Solar Tracker – Voltage Monitoring Report';
  wb.calcProperties = { fullCalcOnLoad: true };
  const ws = wb.addWorksheet(SHEET, { properties: { tabColor: { argb: C.navy } }, views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  ws.columns = [{ width: 30 }, { width: 17 }, { width: 17 }, { width: 17 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 3 },
                { width: 7 }, { width: 13 }, { width: 12 }, { width: 17 }, { width: 19 }, { width: 21 }];
  const col = { stt: 'J', day: 'K', time: 'L', pv: 'M', bat: 'N', dt: 'O' };
  const R = (c) => `$${c}$2:$${c}$${last}`;
  const unitTxt = hourly ? ' – TB theo giờ' : '';

  // ---------- khối trái ----------
  ws.mergeCells('A1:H1');
  const t = ws.getCell('A1'); t.value = 'SOLAR TRACKER – VOLTAGE MONITORING REPORT';
  t.font = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } }; t.fill = fill(C.navy); t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells('A2:H2');
  const sub = ws.getCell('A2'); sub.value = `Báo cáo điện áp PV và ắc quy • ${o.deviceName || o.deviceId} • dữ liệu thực tế đã lưu trên Cloud`;
  sub.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; sub.alignment = { indent: 1 };
  const section = (r, text) => { ws.mergeCells(r, 1, r, 8); const c = ws.getCell(r, 1); c.value = text; c.font = { name: FONT, bold: true, size: 12, color: { argb: C.navy } }; c.border = { bottom: { style: 'medium', color: { argb: 'FF2563EB' } } }; ws.getRow(r).height = 22; };
  section(4, 'THÔNG TIN BÁO CÁO');
  const info = [
    ['Khoảng thời gian báo cáo', `${dmy(o.from, off)}  →  ${dmy(o.to, off)}  (${RANGES[o.range].label}, UTC+${o.tzHours})`],
    ['Ngày xuất báo cáo', dmyhms(Date.now(), off)],
    ['Tổng số mẫu đo hợp lệ', null],
    ['Nguồn dữ liệu', hourly ? 'Trung bình theo giờ (mỗi dòng = 1 giờ; dữ liệu chi tiết cũ đã được dọn, bảng tổng hợp giờ được giữ lâu dài)' : 'Mẫu đo gốc, không gộp (mỗi dòng = 1 mẫu)'],
  ];
  info.forEach((p, i) => {
    const r = 5 + i; ws.getCell(r, 1).value = p[0]; ws.getCell(r, 1).font = { name: FONT, bold: true, color: { argb: C.text } };
    ws.mergeCells(r, 2, r, 8); const v = ws.getCell(r, 2);
    if (p[1] === null) { v.value = { formula: `COUNTA(${col.dt}2:${col.dt}${last})`, result: N }; v.numFmt = '#,##0'; v.alignment = { horizontal: 'left' }; }
    else { v.value = p[1]; v.alignment = { wrapText: true, vertical: 'top' }; }
    v.font = { name: FONT, color: { argb: C.text } };
    for (let k = 1; k <= 8; k++) ws.getCell(r, k).border = { bottom: { style: 'hair', color: { argb: C.border } } };
  });
  if (hourly) ws.getRow(8).height = 30;

  section(10, 'BẢNG THỐNG KÊ ĐIỆN ÁP');
  const hdr = ws.getRow(11); hdr.values = ['Thông số', 'Điện áp trung bình (V)', 'Thấp nhất (V)', 'Cao nhất (V)'];
  for (let k = 1; k <= 4; k++) { const c = hdr.getCell(k); c.font = { name: FONT, bold: true, color: { argb: C.text } }; c.fill = fill(C.head); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = bd(); }
  hdr.height = 32;
  const statRow = (r, label, key, colL, s) => {
    const rg = R(colL);
    const fx = (agg, d) => hourly ? (d === null ? 'N/A' : d) : { formula: `IF(COUNT(${rg})=0,"N/A",${agg}(${rg}))`, result: d === null ? 'N/A' : d };
    ws.getCell(r, 1).value = label; ws.getCell(r, 2).value = fx('AVERAGE', s.avg); ws.getCell(r, 3).value = fx('MIN', s.min); ws.getCell(r, 4).value = fx('MAX', s.max);
    for (let k = 1; k <= 4; k++) { const c = ws.getCell(r, k); c.border = bd(); c.font = { name: FONT, bold: k === 1, color: { argb: k === 1 ? C.text : C.navy }, size: k === 1 ? 11 : 12 }; if (k > 1) { c.numFmt = '0.00'; c.alignment = { horizontal: 'right' }; } }
  };
  statRow(12, 'Điện áp PV', 'pv', col.pv, stat.pv); statRow(13, 'Điện áp ắc quy', 'bat', col.bat, stat.bat);
  ws.mergeCells('A14:H14');
  const nt = ws.getCell('A14');
  nt.value = hourly ? 'Trung bình = tổng mọi mẫu đo / số mẫu; Thấp nhất / Cao nhất = giá trị nhỏ nhất / lớn nhất của mọi mẫu đo thật trong khoảng thời gian (không phải của giá trị trung bình giờ). Dữ liệu thiếu không được tính, không thay bằng 0.'
                  : 'Chỉ tính các mẫu hợp lệ. Dữ liệu thiếu (INA219 không phản hồi) để trống trong bảng và không được tính, không thay bằng 0.';
  nt.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; nt.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(14).height = 28;

  section(16, 'BIỂU ĐỒ ĐIỆN ÁP THEO THỜI GIAN (liên kết với bảng dữ liệu bên phải)');

  // ---------- khối phải: bảng dữ liệu ----------
  const heads = ['STT', 'Ngày', 'Thời gian', 'PV Voltage (V)' + unitTxt, 'Battery Voltage (V)' + unitTxt, 'Thời điểm đo (cho biểu đồ)'];
  heads.forEach((h, i) => { const c = ws.getCell(1, 10 + i); c.value = h; c.font = { name: FONT, bold: true, color: { argb: C.text } }; c.fill = fill(C.head); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = bd(); });
  const fmts = { J: '0', K: 'dd/mm/yyyy', L: 'hh:mm:ss', M: '0.00', N: '0.00', O: 'dd/mm/yyyy hh:mm:ss' };
  const putRow = (i) => {
    const r = rows[i], x = i + 2, row = ws.getRow(x);
    const secs = Math.round((r.ts + off) / 1000), day = Math.floor(secs / 86400), tod = secs - day * 86400;
    row.getCell(10).value = i + 1;
    row.getCell(11).value = day + 25569;
    row.getCell(12).value = tod / 86400;
    if (r.pv !== null) row.getCell(13).value = r.pv;
    if (r.bat !== null) row.getCell(14).value = r.bat;
    row.getCell(15).value = { formula: `K${x}+L${x}`, result: day + 25569 + tod / 86400 };
  };
  // kiểu theo CỘT (không gán từng ô -> file/RAM nhẹ)
  const al = { J: 'center', K: 'center', L: 'center', M: 'right', N: 'right', O: 'right' };
  for (const [c, f] of Object.entries(fmts)) { const cc = ws.getColumn(c); cc.numFmt = f; cc.font = { name: FONT, size: 11, color: { argb: c === 'O' ? C.mute : C.text } }; cc.alignment = { horizontal: al[c] }; }
  for (let k = 10; k <= 15; k++) { const c = ws.getCell(1, k); c.font = { name: FONT, bold: true, color: { argb: C.text } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.numFmt = 'General'; }
  if (N) {
    ws.autoFilter = `J1:O${last}`;
    ws.addConditionalFormatting({ ref: `J2:O${last}`, rules: [{ type: 'expression', priority: 1, formulae: ['MOD(ROW(),2)=0'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.zebra } } } }] });
  }
  ws.getRow(1).height = 32;
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  const lastRow = Math.max(N + 1, 54);
  for (let r = 1; r <= lastRow; r++) { if (r >= 2 && r - 2 < N) putRow(r - 2); ws.getRow(r).commit(); }
  await ws.commit(); await wb.commit();
  const q = `'${SHEET}'!`;
  const xFmt = o.range === '7d' ? 'dd/mm hh:mm' : 'dd/mm/yyyy';
  const mk = (title, yTitle, name, c, color) => ({ title, xTitle: 'Ngày và thời gian đo', yTitle, yFmt: '0.0', xFmt, series: [{ name, color, x: q + R(col.dt), y: q + R(c) }] });
  const charts = N ? [{ sheetNo: 1, charts: [
    { anchor: { col: 0, row: 16, cols: 8, rows: 18 }, spec: mk('Điện áp PV theo thời gian', 'Điện áp PV (V)', 'PV Voltage (V)', col.pv, '2563EB') },
    { anchor: { col: 0, row: 35, cols: 8, rows: 18 }, spec: mk('Điện áp ắc quy theo thời gian', 'Điện áp ắc quy (V)', 'Battery Voltage (V)', col.bat, '16A34A') },
  ] }] : [];
  return addCharts(Buffer.concat(chunks), charts);
}

module.exports = { buildVoltageReport, fromRaw, fromHourly, RANGES };
