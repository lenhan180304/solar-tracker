'use strict';
/*
  BÁO CÁO EXCEL SOLAR TRACKER – 5 sheet, biểu đồ Excel thật (xem xlsx_charts.js).
  Nguyên tắc dữ liệu:
    - Mọi số liệu đến từ các mẫu đo đã lưu (bảng telemetry) và nhật ký sự kiện đã ghi nhận (bảng events). KHÔNG tạo/ước lượng/điền số liệu.
    - Dữ liệu thiếu (INA219 không phản hồi, firmware cũ chưa gửi LDR...) = ô TRỐNG, tuyệt đối không thay bằng 0.
      Giá trị đo bằng 0 là số 0 thật. Lý do thiếu được ghi ở cột "Device Status".
    - Mọi thống kê là CÔNG THỨC Excel tham chiếu bảng dữ liệu -> chỉnh/bổ sung dữ liệu thì tự cập nhật (kèm giá trị tính sẵn để xem ngay).
*/
const ExcelJS = require('exceljs');
const { addCharts } = require('./xlsx_charts');

const MAX_ROWS = 100000;

const S1 = '1-TỔNG QUAN', S2 = '2-DỮ LIỆU ĐO', S3 = '3-PHÂN TÍCH NĂNG LƯỢNG', S4 = '4-PHÂN TÍCH BÁM NẮNG', S5 = '5-NHẬT KÝ HỆ THỐNG';
const FONT = 'Calibri';
const C = { navy: 'FF1E40AF', head: 'FFDBEAFE', zebra: 'FFF1F5F9', border: 'FFCBD5E1', text: 'FF1E293B', mute: 'FF64748B', warn: 'FFB45309', warnBg: 'FFFEF3C7', red: 'FFB91C1C' };
const CH = { pv: '2563EB', bat: '16A34A', volt: '7C3AED', curr: '0891B2', gray: '64748B' };

const pad = (n) => String(n).padStart(2, '0');
const fmtLocal = (ms, off) => { const d = new Date(ms + off); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const q = (name) => `'${name}'!`;                                   // tiền tố tham chiếu sheet
function stat(arr) {
  const v = arr.filter(x => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { n: 0, min: null, max: null, avg: null, last: null };
  let s = 0, mn = Infinity, mx = -Infinity;
  for (const x of v) { s += x; if (x < mn) mn = x; if (x > mx) mx = x; }
  return { n: v.length, min: mn, max: mx, avg: s / v.length, last: v[v.length - 1] };
}
function statusText(f) {
  if (f === null || f === undefined) return '';
  const p = [];
  if (f & 1) p.push('E-STOP'); if (f & 2) p.push('NIGHT'); if (f & 4) p.push('SIM');
  if (f & 8) p.push('INA219 PV LỖI'); if (f & 16) p.push('INA219 ẮC QUY LỖI'); if (f & 128) p.push('DHT11 LỖI');
  return p.length ? p.join(' | ') : 'OK';
}
function motorText(f) {
  if (f === null || f === undefined) return '';
  const p = []; if (f & 32) p.push('M1 quay'); if (f & 64) p.push('M2 quay');
  return p.length ? p.join(' | ') : 'Dừng';
}

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { name: FONT, bold: true, color: { argb: C.text }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.head } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { top: { style: 'thin', color: { argb: C.border } }, bottom: { style: 'thin', color: { argb: C.border } }, left: { style: 'thin', color: { argb: C.border } }, right: { style: 'thin', color: { argb: C.border } } };
  });
  row.height = 32;
}
function titleBar(ws, text, cols, sub) {
  ws.mergeCells(1, 1, 1, cols);
  const c = ws.getCell(1, 1);
  c.value = text; c.font = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;
  if (sub) {
    ws.mergeCells(2, 1, 2, cols);
    const s = ws.getCell(2, 1); s.value = sub; s.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } };
    s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }
}
function cellBorder(c) { c.border = { top: { style: 'thin', color: { argb: C.border } }, bottom: { style: 'thin', color: { argb: C.border } }, left: { style: 'thin', color: { argb: C.border } }, right: { style: 'thin', color: { argb: C.border } } }; }
function section(ws, r, text, cols) {
  ws.mergeCells(r, 1, r, cols);
  const c = ws.getCell(r, 1); c.value = text;
  c.font = { name: FONT, bold: true, size: 12, color: { argb: 'FF1E40AF' } };
  c.border = { bottom: { style: 'medium', color: { argb: 'FF2563EB' } } };
  ws.getRow(r).height = 22;
}
function printSetup(ws, title, landscape) {
  ws.pageSetup = { orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.8, bottom: 0.7, header: 0.3, footer: 0.3 } };
  ws.headerFooter = { oddHeader: `&L&"Calibri,Bold"SOLAR TRACKER – MEASUREMENT REPORT&R&"Calibri,Regular"${title}`, oddFooter: '&L&"Calibri,Regular"Solar Tracking & Monitoring System&C&"Calibri,Regular"Trang &P / &N&R&D' };
}

async function buildReport(o) {
  const off = o.tzHours * 3600000;
  const samples = o.samples || [], events = o.events || [];
  const N = samples.length;
  const type = o.type || 'all';
  const gapSec = Math.max(1, Math.round((o.sampleSec || 10) * 3));
  const want = {
    s3: type === 'energy' || type === 'all',
    s4: type === 'tracking' || type === 'all',
    s5: type === 'tracking' || type === 'all',
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Solar Tracker Cloud'; wb.created = new Date(); wb.title = 'Solar Tracker – Measurement Report';
  wb.calcProperties = { fullCalcOnLoad: true };

  // ====== chỉ số cột trong sheet dữ liệu ======
  const L = { ts: 'B', pvV: 'C', pvI: 'D', pvP: 'E', bV: 'F', bI: 'G', bP: 'H', tl: 'I', tr: 'J', bl: 'K', br: 'L', dH: 'M', dV: 'N', m1: 'O', m2: 'P', mode: 'Q', st: 'R', trk: 'S', mot: 'T', dt: 'U', en: 'V' };
  const last = N + 1;                                           // hàng cuối của bảng dữ liệu (hàng 1 = tiêu đề)
  const rng = (col) => `${q(S2)}$${col}$2:$${col}$${last}`;
  const rngRaw = (col) => `${col}2:${col}${last}`;
  const col = (k) => samples.map(r => num(r[k]));

  // ---------- số liệu tính sẵn (để hiển thị ngay cả khi chưa tính lại công thức) ----------
  const st = {
    pvV: stat(col('pvV')), pvI: stat(col('pvI')), pvP: stat(col('pvP')), bV: stat(col('batV')), bI: stat(col('batI')), bP: stat(col('batP')),
    tl: stat(col('ldrTL')), tr: stat(col('ldrTR')), bl: stat(col('ldrBL')), br: stat(col('ldrBR')), dH: stat(col('dH')), dV: stat(col('dV')), m1: stat(col('m1')), m2: stat(col('m2')),
  };
  // tích phân hình thang công suất PV, bỏ các khoảng > gapSec hoặc thiếu công suất
  const dts = [], ens = [];
  let eWh = 0, validSec = 0, exclGapN = 0, exclGapSec = 0, exclMissN = 0, autoSec = 0, manSec = 0;
  for (let i = 0; i < N; i++) {
    if (i === 0) { dts.push(null); ens.push(null); continue; }
    const dt = (samples[i].ts - samples[i - 1].ts) / 1000;
    dts.push(dt);
    const p1 = num(samples[i - 1].pvP), p2 = num(samples[i].pvP);
    if (dt > gapSec) { exclGapN++; exclGapSec += dt; ens.push(null); }
    else if (p1 === null || p2 === null) { exclMissN++; ens.push(null); }
    else { const e = (p1 + p2) / 2 * dt / 3600; ens.push(e); eWh += e; validSec += dt; }
    if (dt <= gapSec) { if (samples[i].auto === 1) autoSec += dt; else if (samples[i].auto === 0) manSec += dt; }
  }
  const pvPeakIdx = (() => { let bi = -1, bv = -Infinity; samples.forEach((r, i) => { const v = num(r.pvP); if (v !== null && v > bv) { bv = v; bi = i; } }); return bi; })();
  const validPv = col('pvV').filter(v => v !== null).length;
  const trkValid = samples.filter(r => [r.ldrTL, r.ldrTR, r.ldrBL, r.ldrBR].every(v => num(v) !== null)).length;
  const evCount = (pred) => events.filter(pred).length;
  const nDisc = evCount(e => e.kind === 'ESP32 Disconnected');
  const nM1 = evCount(e => e.kind === 'Motor Activated' && /Motor 1/.test(e.descr || ''));
  const nM2 = evCount(e => e.kind === 'Motor Activated' && /Motor 2/.test(e.descr || ''));
  const nEstop = evCount(e => e.kind === 'Emergency Stop');
  const firstTs = N ? samples[0].ts : o.from, lastTs = N ? samples[N - 1].ts : o.to;
  const expected = Math.max(1, Math.round((Math.min(o.to, lastTs) - Math.max(o.from, firstTs)) / ((o.sampleSec || 10) * 1000)) + 1);
  const coverage = Math.min(100, N / expected * 100);

  // ================= SHEET 1: TỔNG QUAN =================
  const w1 = wb.addWorksheet(S1, { properties: { tabColor: { argb: 'FF1E40AF' } }, views: [{ showGridLines: false }] });
  w1.columns = [{ width: 40 }, { width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  titleBar(w1, 'SOLAR TRACKER – MEASUREMENT REPORT', 8, 'Báo cáo đo đạc hệ thống bám nắng • dữ liệu thực tế đã lưu trên Cloud');
  section(w1, 4, 'A. THÔNG TIN BÁO CÁO', 8);
  const info = [
    ['Tên báo cáo', 'SOLAR TRACKER – MEASUREMENT REPORT'],
    ['Tên hệ thống', 'Solar Tracking & Monitoring System'],
    ['Thiết bị', `${o.deviceName || o.deviceId} (${o.deviceId})`],
    ['Bộ điều khiển', 'ESP32'],
    ['Khoảng thời gian đã chọn', `${fmtLocal(o.from, off)}  →  ${fmtLocal(o.to, off)}`],
    ['Thời gian bắt đầu đo (mẫu đầu tiên)', N ? fmtLocal(firstTs, off) : 'N/A'],
    ['Thời gian kết thúc đo (mẫu cuối cùng)', N ? fmtLocal(lastTs, off) : 'N/A'],
    ['Ngày xuất báo cáo', fmtLocal(Date.now(), off) + `  (UTC${o.tzHours >= 0 ? '+' : ''}${o.tzHours})`],
    ['Tổng số mẫu dữ liệu', null],
    ['Trạng thái kết nối thiết bị trong thời gian đo', `Độ phủ mẫu ${coverage.toFixed(1)}% (${N}/${expected} mẫu dự kiến) • ${events.length ? nDisc + ' lần mất kết nối được ghi nhận' : 'chưa có sự kiện kết nối nào được ghi nhận'} • hiện tại: ${o.online ? 'ONLINE' : 'OFFLINE'}`],
  ];
  info.forEach((p, i) => {
    const r = 5 + i; w1.getCell(r, 1).value = p[0];
    w1.getCell(r, 1).font = { name: FONT, bold: true, color: { argb: C.text } };
    const v = w1.getCell(r, 2);
    if (p[1] === null) { v.value = { formula: `COUNTA(${rng(L.ts)})`, result: N }; v.numFmt = '#,##0'; v.alignment = { horizontal: 'left' }; }
    else { v.value = p[1]; }
    v.font = { name: FONT, color: { argb: C.text } };
    w1.mergeCells(r, 2, r, 8);
    for (let k = 1; k <= 8; k++) { const c = w1.getCell(r, k); c.border = { bottom: { style: 'hair', color: { argb: C.border } } }; }
  });
  w1.getCell(14, 2).alignment = { wrapText: true, vertical: 'top' }; w1.getRow(14).height = 32;

  section(w1, 16, 'B. CÁC CHỈ SỐ NĂNG LƯỢNG CHÍNH', 8);
  const hdr = w1.getRow(17); hdr.values = ['Thông số', 'Giá trị', 'Đơn vị']; styleHeader(hdr);
  const fx = (agg, colKey, d) => ({ formula: `IF(COUNT(${rng(L[colKey])})=0,"N/A",${agg}(${rng(L[colKey])}))`, result: d === null ? 'N/A' : d });
  const kpis = [
    ['Điện áp PV trung bình', fx('AVERAGE', 'pvV', st.pvV.avg), 'V', '0.00'],
    ['Dòng điện PV trung bình', fx('AVERAGE', 'pvI', st.pvI.avg), 'A', '0.000'],
    ['Công suất PV trung bình', fx('AVERAGE', 'pvP', st.pvP.avg), 'W', '0.00'],
    ['Công suất PV lớn nhất', fx('MAX', 'pvP', st.pvP.max), 'W', '0.00'],
    ['Điện áp ắc quy trung bình', fx('AVERAGE', 'bV', st.bV.avg), 'V', '0.00'],
    ['Dòng sạc trung bình (dòng ắc quy, dấu theo chiều nối INA219 #2)', fx('AVERAGE', 'bI', st.bI.avg), 'A', '0.000'],
    ['Tổng năng lượng thu được (tích phân hình thang)', { formula: `IF(COUNT(${rng(L.en)})=0,"N/A",SUM(${rng(L.en)}))`, result: validSec > 0 ? eWh : 'N/A' }, 'Wh', '0.00'],
    ['Tỷ lệ dữ liệu hợp lệ (mẫu có điện áp PV / tổng mẫu)', { formula: `IF(COUNTA(${rng(L.ts)})=0,"N/A",COUNT(${rng(L.pvV)})/COUNTA(${rng(L.ts)}))`, result: N ? validPv / N : 'N/A' }, '%', '0.0%'],
  ];
  kpis.forEach((k, i) => {
    const r = 18 + i; const a = w1.getCell(r, 1), b = w1.getCell(r, 2), u = w1.getCell(r, 3);
    a.value = k[0]; b.value = k[1]; u.value = k[2]; b.numFmt = k[3];
    a.font = { name: FONT, color: { argb: C.text } }; b.font = { name: FONT, bold: true, size: 12, color: { argb: 'FF1E40AF' } }; u.font = { name: FONT, color: { argb: C.mute } };
    b.alignment = { horizontal: 'right' }; a.alignment = { wrapText: true, vertical: 'middle' };
    if (i % 2) [a, b, u].forEach(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }; });
    [a, b, u].forEach(cellBorder);
  });
  w1.getRow(23).height = 30;
  const note1 = w1.getCell(27, 1);
  w1.mergeCells(27, 1, 27, 8);
  note1.value = 'Giá trị "N/A" = không đủ dữ liệu để tính. Dữ liệu thiếu để trống, không thay bằng 0. Năng lượng chỉ cộng các khoảng liên tục (xem quy tắc ở Sheet 3 khi có).';
  note1.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; note1.alignment = { wrapText: true, vertical: 'top' }; w1.getRow(27).height = 28;
  section(w1, 29, 'C. BIỂU ĐỒ TỔNG QUAN (liên kết với sheet "2-DỮ LIỆU ĐO")', 8);
  printSetup(w1, 'Tổng quan hệ thống', false);

  // ================= SHEET 2: DỮ LIỆU ĐO =================
  const w2 = wb.addWorksheet(S2, { properties: { tabColor: { argb: 'FF2563EB' } }, views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const cols = [
    ['STT', 7, '0'], ['Timestamp', 20, 'dd/mm/yyyy hh:mm:ss'], ['PV Voltage (V)', 13, '0.00'], ['PV Current (A)', 13, '0.000'], ['PV Power (W)', 13, '0.00'],
    ['Battery Voltage (V)', 14, '0.00'], ['Battery Current (A)', 14, '0.000'], ['Battery Power (W)', 14, '0.00'],
    ['LDR TL', 9, '0'], ['LDR TR', 9, '0'], ['LDR BL', 9, '0'], ['LDR BR', 9, '0'], ['ΔH', 9, '0'], ['ΔV', 9, '0'],
    ['Motor 1 (°)', 11, '0.0'], ['Motor 2 (°)', 11, '0.0'], ['Tracking Mode', 13, '@'], ['Device Status', 24, '@'], ['Tracking Status', 22, '@'], ['Motor State', 14, '@'],
    ['Δt (s) [tính toán]', 13, '0.0'], ['PV Energy (Wh) [tính toán]', 16, '0.0000'],
  ];
  w2.columns = cols.map(c => ({ width: c[1], style: { numFmt: c[2], font: { name: FONT, size: 11 } } }));
  const h2 = w2.getRow(1); h2.values = cols.map(c => c[0]); styleHeader(h2);
  const gapRef = `${q(S3)}$B$5`;                                 // ô ngưỡng khoảng trống (Sheet 3) – nếu không có Sheet 3 dùng hằng số
  const gapExpr = want.s3 ? gapRef : String(gapSec);
  const rows = new Array(N);
  for (let i = 0; i < N; i++) {
    const s = samples[i], r = i + 2;
    const row = w2.getRow(r);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = new Date(s.ts + off);
    const setN = (c, v) => { const x = num(v); if (x !== null) row.getCell(c).value = x; };
    setN(3, s.pvV); setN(4, s.pvI); setN(5, s.pvP); setN(6, s.batV); setN(7, s.batI); setN(8, s.batP);
    setN(9, s.ldrTL); setN(10, s.ldrTR); setN(11, s.ldrBL); setN(12, s.ldrBR); setN(13, s.dH); setN(14, s.dV); setN(15, s.m1); setN(16, s.m2);
    if (s.auto === 1) row.getCell(17).value = 'AUTO'; else if (s.auto === 0) row.getCell(17).value = 'MANUAL';
    const stx = statusText(s.flags); if (stx) row.getCell(18).value = stx;
    if (s.trk) row.getCell(19).value = s.trk;
    const mt = motorText(s.flags); if (mt) row.getCell(20).value = mt;
    if (i > 0) {
      row.getCell(21).value = { formula: `IF(AND(ISNUMBER(B${r}),ISNUMBER(B${r - 1})),(B${r}-B${r - 1})*86400,"")`, result: dts[i] };
      row.getCell(22).value = { formula: `IF(AND(ISNUMBER(E${r}),ISNUMBER(E${r - 1}),ISNUMBER(U${r})),IF(U${r}<=${gapExpr},(E${r}+E${r - 1})/2*U${r}/3600,""),"")`, result: ens[i] === null ? '' : ens[i] };
    }
    rows[i] = row;
  }
  if (N) {
    w2.autoFilter = `A1:V${last}`;
    // tô xen kẽ + cảnh báo bằng định dạng có điều kiện (không gán style từng ô -> file nhẹ)
    w2.addConditionalFormatting({ ref: `A2:V${last}`, rules: [{ type: 'expression', priority: 2, formulae: ['MOD(ROW(),2)=0'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.zebra } } } }] });
    w2.addConditionalFormatting({ ref: `R2:R${last}`, rules: [{ type: 'expression', priority: 1, formulae: ['AND(R2<>"",R2<>"OK")'], style: { font: { color: { argb: C.warn }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.warnBg } } } }] });
  }
  w2.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '1:1' };
  w2.headerFooter = { oddHeader: '&L&"Calibri,Bold"SOLAR TRACKER – MEASUREMENT REPORT&R&"Calibri,Regular"Dữ liệu đo', oddFooter: '&LSolar Tracking & Monitoring System&CTrang &P / &N&R&D' };

  // ================= SHEET 3: PHÂN TÍCH NĂNG LƯỢNG =================
  let sheetNo = 2; const sheetNos = { s1: 1, s2: 2 };
  const statTable = (ws, startRow, items, withCount) => {
    const h = ws.getRow(startRow); h.values = ['Thông số', 'Min', 'Max', 'Average', 'Latest', 'Đơn vị', 'Số mẫu hợp lệ']; styleHeader(h);
    items.forEach((it, i) => {
      const r = startRow + 1 + i, rg = rng(L[it.key]);
      ws.getCell(r, 1).value = it.label;
      const f = (agg, d) => ({ formula: `IF(COUNT(${rg})=0,"N/A",${agg}(${rg}))`, result: d === null ? 'N/A' : d });
      ws.getCell(r, 2).value = f('MIN', it.s.min); ws.getCell(r, 3).value = f('MAX', it.s.max); ws.getCell(r, 4).value = f('AVERAGE', it.s.avg);
      ws.getCell(r, 5).value = { formula: `IFERROR(LOOKUP(2,1/ISNUMBER(${rg}),${rg}),"N/A")`, result: it.s.last === null ? 'N/A' : it.s.last };
      ws.getCell(r, 6).value = it.unit;
      ws.getCell(r, 7).value = { formula: `COUNT(${rg})`, result: it.s.n };
      for (let k = 2; k <= 5; k++) { ws.getCell(r, k).numFmt = it.fmt; ws.getCell(r, k).alignment = { horizontal: 'right' }; }
      for (let k = 1; k <= 7; k++) { const c = ws.getCell(r, k); c.font = { name: FONT, color: { argb: C.text }, bold: k === 1 }; cellBorder(c); if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }; }
    });
    return startRow + items.length;
  };
  const chartsBySheet = [];
  const chart = (title, yTitle, series, yFmt) => ({
    title, xTitle: 'Thời gian đo', yTitle, yFmt,
    series: series.map(s => ({ name: s.name, color: s.color, x: rng(L.ts), y: rng(L[s.key]) })),
  });
  const grid = (list, startRow, perRow, cw, rh) => list.map((spec, i) => ({ anchor: { col: (i % perRow) * cw, row: startRow + Math.floor(i / perRow) * (rh + 1), cols: cw, rows: rh }, spec }));

  // charts của sheet 1 (3 biểu đồ, xếp dọc, rộng 8 cột)
  const c1 = [
    chart('Công suất PV theo thời gian', 'Công suất PV (W)', [{ name: 'PV Power (W)', key: 'pvP', color: CH.pv }], '0.0'),
    chart('Điện áp PV và điện áp ắc quy theo thời gian', 'Điện áp (V)', [{ name: 'PV Voltage (V)', key: 'pvV', color: CH.volt }, { name: 'Battery Voltage (V)', key: 'bV', color: CH.bat }], '0.0'),
    chart('Dòng điện PV và dòng điện ắc quy theo thời gian', 'Dòng điện (A)', [{ name: 'PV Current (A)', key: 'pvI', color: CH.curr }, { name: 'Battery Current (A)', key: 'bI', color: CH.bat }], '0.00'),
  ];
  const sc1 = c1.map((spec, i) => ({ anchor: { col: 0, row: 29 + i * 20, cols: 8, rows: 19 }, spec }));
  if (N) chartsBySheet.push({ sheetNo: 1, charts: sc1 });

  if (want.s3) {
    sheetNo += 1; sheetNos.s3 = sheetNo;
    const w3 = wb.addWorksheet(S3, { properties: { tabColor: { argb: 'FF0891B2' } }, views: [{ showGridLines: false }] });
    w3.columns = [{ width: 42 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
    titleBar(w3, 'PHÂN TÍCH NĂNG LƯỢNG (ENERGY ANALYSIS)', 10, `Khoảng dữ liệu: ${N ? fmtLocal(firstTs, off) + ' → ' + fmtLocal(lastTs, off) : 'N/A'}`);
    section(w3, 4, 'THAM SỐ TÍNH NĂNG LƯỢNG', 10);
    w3.getCell(5, 1).value = 'Ngưỡng khoảng thời gian tối đa giữa 2 mẫu liên tiếp (giây) – có thể chỉnh';
    const g = w3.getCell(5, 2); g.value = gapSec; g.font = { name: FONT, bold: true, color: { argb: 'FF1E40AF' } }; g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }; cellBorder(g); g.numFmt = '0';
    w3.getCell(5, 1).font = { name: FONT, color: { argb: C.text } };
    w3.mergeCells(6, 1, 6, 10);
    const rule = w3.getCell(6, 1);
    rule.value = `Quy tắc: E = Σ [(Pᵢ + Pᵢ₊₁)/2] × Δt (Wh), Δt tính bằng giờ. Chỉ cộng khi hai mẫu liên tiếp đều có công suất PV và Δt ≤ ngưỡng (mặc định ${gapSec} s = 3 × chu kỳ lấy mẫu ${o.sampleSec || 10} s). ` +
      'Khoảng thời gian dài hơn ngưỡng (mất kết nối / thiếu dữ liệu) và khoảng có mẫu thiếu công suất KHÔNG được tích phân và không được nội suy.';
    rule.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; rule.alignment = { wrapText: true, vertical: 'top' }; w3.getRow(6).height = 44;
    section(w3, 8, 'THỐNG KÊ THÔNG SỐ (Min / Max / Average / Latest)', 10);
    statTable(w3, 9, [
      { label: 'PV Voltage', key: 'pvV', s: st.pvV, unit: 'V', fmt: '0.00' }, { label: 'PV Current', key: 'pvI', s: st.pvI, unit: 'A', fmt: '0.000' }, { label: 'PV Power', key: 'pvP', s: st.pvP, unit: 'W', fmt: '0.00' },
      { label: 'Battery Voltage', key: 'bV', s: st.bV, unit: 'V', fmt: '0.00' }, { label: 'Battery Current', key: 'bI', s: st.bI, unit: 'A', fmt: '0.000' }, { label: 'Battery Power', key: 'bP', s: st.bP, unit: 'W', fmt: '0.00' },
    ]);
    section(w3, 17, 'NĂNG LƯỢNG PV (TÍCH PHÂN HÌNH THANG)', 10);
    const E = rng(L.en), U = rng(L.dt);
    const eRows = [
      ['Tổng năng lượng PV thu được', { formula: `IF(COUNT(${E})=0,"N/A",SUM(${E}))`, result: validSec > 0 ? eWh : 'N/A' }, 'Wh', '0.000'],
      ['Tổng năng lượng PV thu được', { formula: `IF(COUNT(${E})=0,"N/A",SUM(${E})/1000)`, result: validSec > 0 ? eWh / 1000 : 'N/A' }, 'kWh', '0.00000'],
      ['Thời gian dữ liệu liên tục được tích phân', { formula: `SUMPRODUCT(ISNUMBER(${E})*1,${U})/3600`, result: validSec / 3600 }, 'giờ', '0.000'],
      ['Số khoảng bị loại do mất kết nối / thiếu dữ liệu (Δt > ngưỡng)', { formula: `COUNTIF(${U},">"&$B$5)`, result: exclGapN }, 'khoảng', '0'],
      ['Tổng thời gian của các khoảng bị loại (Δt > ngưỡng)', { formula: `SUMIF(${U},">"&$B$5)/3600`, result: exclGapSec / 3600 }, 'giờ', '0.000'],
      ['Số khoảng bị loại do thiếu công suất PV (INA219 lỗi)', { formula: `SUMPRODUCT(ISNUMBER(${U})*1,(${U}<=$B$5)*1,(1-ISNUMBER(${E})))`, result: exclMissN }, 'khoảng', '0'],
      ['Công suất PV đỉnh', { formula: `IF(COUNT(${rng(L.pvP)})=0,"N/A",MAX(${rng(L.pvP)}))`, result: st.pvP.max === null ? 'N/A' : st.pvP.max }, 'W', '0.00'],
      ['Thời điểm công suất PV đỉnh', { formula: `IF(COUNT(${rng(L.pvP)})=0,"N/A",INDEX(${rng(L.ts)},MATCH(MAX(${rng(L.pvP)}),${rng(L.pvP)},0)))`, result: pvPeakIdx >= 0 ? new Date(samples[pvPeakIdx].ts + off) : 'N/A' }, '', 'dd/mm/yyyy hh:mm:ss'],
    ];
    eRows.forEach((er, i) => {
      const r = 18 + i; w3.getCell(r, 1).value = er[0]; const v = w3.getCell(r, 2); v.value = er[1]; v.numFmt = er[3]; w3.getCell(r, 3).value = er[2];
      for (let k = 1; k <= 3; k++) { const c = w3.getCell(r, k); c.font = { name: FONT, color: { argb: k === 2 ? 'FF1E40AF' : C.text }, bold: k === 2 }; cellBorder(c); if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }; }
      v.alignment = { horizontal: 'right' };
    });
    w3.getColumn(2).width = 20;
    section(w3, 27, 'BIỂU ĐỒ (liên kết với sheet "2-DỮ LIỆU ĐO")', 10);
    const c3 = [
      chart('PV Power – Công suất pin mặt trời theo thời gian', 'Công suất (W)', [{ name: 'PV Power (W)', key: 'pvP', color: CH.pv }], '0.0'),
      chart('PV Voltage – Điện áp tấm pin theo thời gian', 'Điện áp (V)', [{ name: 'PV Voltage (V)', key: 'pvV', color: CH.volt }], '0.0'),
      chart('PV Current – Dòng điện tấm pin theo thời gian', 'Dòng điện (A)', [{ name: 'PV Current (A)', key: 'pvI', color: CH.curr }], '0.00'),
      chart('Battery Voltage – Điện áp ắc quy theo thời gian', 'Điện áp (V)', [{ name: 'Battery Voltage (V)', key: 'bV', color: CH.bat }], '0.0'),
      chart('Battery Current – Dòng điện ắc quy theo thời gian', 'Dòng điện (A)', [{ name: 'Battery Current (A)', key: 'bI', color: CH.bat }], '0.00'),
    ];
    if (N) chartsBySheet.push({ sheetNo, charts: grid(c3, 28, 1, 8, 18) });
    printSetup(w3, 'Phân tích năng lượng', true);
  }

  // ================= SHEET 4: PHÂN TÍCH BÁM NẮNG =================
  if (want.s4) {
    sheetNo += 1; sheetNos.s4 = sheetNo;
    const w4 = wb.addWorksheet(S4, { properties: { tabColor: { argb: 'FF7C3AED' } }, views: [{ showGridLines: false }] });
    w4.columns = [{ width: 46 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
    titleBar(w4, 'PHÂN TÍCH BÁM NẮNG (TRACKING ANALYSIS)', 10, 'Chỉ tính các thông số có dữ liệu thực tế; không suy đoán số lần động cơ quay nếu hệ thống không ghi nhận sự kiện.');
    section(w4, 4, 'THỐNG KÊ CẢM BIẾN & ĐỘNG CƠ', 10);
    statTable(w4, 5, [
      { label: 'LDR Top Left (TL)', key: 'tl', s: st.tl, unit: '0–1000', fmt: '0' }, { label: 'LDR Top Right (TR)', key: 'tr', s: st.tr, unit: '0–1000', fmt: '0' },
      { label: 'LDR Bottom Left (BL)', key: 'bl', s: st.bl, unit: '0–1000', fmt: '0' }, { label: 'LDR Bottom Right (BR)', key: 'br', s: st.br, unit: '0–1000', fmt: '0' },
      { label: 'Sai lệch ngang ΔH', key: 'dH', s: st.dH, unit: 'ADC', fmt: '0' }, { label: 'Sai lệch dọc ΔV', key: 'dV', s: st.dV, unit: 'ADC', fmt: '0' },
      { label: 'Góc Motor 1 (trục đứng)', key: 'm1', s: st.m1, unit: '°', fmt: '0.0' }, { label: 'Góc Motor 2 (trục ngang)', key: 'm2', s: st.m2, unit: '°', fmt: '0.0' },
    ]);
    section(w4, 15, 'BẢNG ĐÁNH GIÁ HOẠT ĐỘNG', 10);
    const hh = w4.getRow(16); hh.values = ['Chỉ tiêu', 'Giá trị', 'Đơn vị', 'Nguồn / cách tính']; styleHeader(hh);
    const noEv = events.length === 0;
    const evVal = (n) => (noEv ? 'N/A' : n);
    const MODE = rng(L.mode), UU = rng(L.dt);
    const ev = [
      ['Số lần hệ thống điều chỉnh hướng – Motor 1', evVal(nM1), 'lần', noEv ? 'N/A: chưa ghi nhận sự kiện nào trong khoảng này' : 'Đếm sự kiện "Motor Activated" (Motor 1) trong sheet 5', '0'],
      ['Số lần hệ thống điều chỉnh hướng – Motor 2', evVal(nM2), 'lần', noEv ? 'N/A: chưa ghi nhận sự kiện nào trong khoảng này' : 'Đếm sự kiện "Motor Activated" (Motor 2) trong sheet 5', '0'],
      ['Thời gian hoạt động AUTO', { formula: `SUMIFS(${UU},${MODE},"AUTO",${UU},"<="&${gapExpr})/3600`, result: autoSec / 3600 }, 'giờ', 'Σ Δt các mẫu ở chế độ AUTO (bỏ khoảng mất dữ liệu)', '0.000'],
      ['Thời gian hoạt động MANUAL', { formula: `SUMIFS(${UU},${MODE},"MANUAL",${UU},"<="&${gapExpr})/3600`, result: manSec / 3600 }, 'giờ', 'Σ Δt các mẫu ở chế độ MANUAL (bỏ khoảng mất dữ liệu)', '0.000'],
      ['Số lần mất kết nối', evVal(nDisc), 'lần', noEv ? 'N/A: chưa ghi nhận sự kiện nào trong khoảng này' : 'Đếm sự kiện "ESP32 Disconnected"', '0'],
      ['Số lần dừng khẩn cấp (E-STOP)', evVal(nEstop), 'lần', noEv ? 'N/A: chưa ghi nhận sự kiện nào trong khoảng này' : 'Đếm sự kiện "Emergency Stop"', '0'],
      ['Tỷ lệ dữ liệu tracking hợp lệ (đủ 4 LDR / tổng mẫu)', { formula: `IF(COUNTA(${rng(L.ts)})=0,"N/A",SUMPRODUCT(ISNUMBER(${rng(L.tl)})*ISNUMBER(${rng(L.tr)})*ISNUMBER(${rng(L.bl)})*ISNUMBER(${rng(L.br)}))/COUNTA(${rng(L.ts)}))`, result: N ? trkValid / N : 'N/A' }, '%', 'Mẫu có đủ 4 giá trị LDR', '0.0%'],
    ];
    ev.forEach((e, i) => {
      const r = 17 + i;
      w4.getCell(r, 1).value = e[0]; const v = w4.getCell(r, 2); v.value = e[1]; v.numFmt = e[4]; w4.getCell(r, 3).value = e[2]; w4.getCell(r, 4).value = e[3];
      w4.mergeCells(r, 4, r, 10);
      for (let k = 1; k <= 4; k++) { const c = w4.getCell(r, k); c.font = { name: FONT, color: { argb: k === 2 ? 'FF1E40AF' : (k === 4 ? C.mute : C.text) }, bold: k === 2, size: k === 4 ? 10 : 11 }; cellBorder(c); if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }; }
      v.alignment = { horizontal: 'right' };
    });
    section(w4, 26, 'BIỂU ĐỒ (liên kết với sheet "2-DỮ LIỆU ĐO")', 10);
    const c4 = [
      chart('ΔH – Sai lệch ngang theo thời gian', 'ΔH (ADC)', [{ name: 'ΔH', key: 'dH', color: CH.pv }], '0'),
      chart('ΔV – Sai lệch dọc theo thời gian', 'ΔV (ADC)', [{ name: 'ΔV', key: 'dV', color: CH.curr }], '0'),
      chart('Góc quay Motor 1 và Motor 2 theo thời gian', 'Góc (°)', [{ name: 'Motor 1 (trục đứng)', key: 'm1', color: CH.pv }, { name: 'Motor 2 (trục ngang)', key: 'm2', color: CH.gray }], '0'),
      chart('Giá trị 4 cảm biến LDR theo thời gian', 'LDR (0–1000)', [{ name: 'LDR TL', key: 'tl', color: CH.pv }, { name: 'LDR TR', key: 'tr', color: CH.volt }, { name: 'LDR BL', key: 'bl', color: CH.curr }, { name: 'LDR BR', key: 'br', color: CH.gray }], '0'),
    ];
    if (N) chartsBySheet.push({ sheetNo, charts: grid(c4, 27, 1, 8, 18) });
    printSetup(w4, 'Phân tích bám nắng', true);
  }

  // ================= SHEET 5: NHẬT KÝ HỆ THỐNG =================
  if (want.s5) {
    sheetNo += 1;
    const w5 = wb.addWorksheet(S5, { properties: { tabColor: { argb: 'FFF59E0B' } }, views: [{ state: 'frozen', ySplit: 1 }] });
    const cols5 = [['STT', 7], ['Timestamp', 20], ['Event', 26], ['Tracking Mode', 14], ['Device Status', 16], ['Description', 80]];
    w5.columns = cols5.map(c => ({ width: c[1], style: { font: { name: FONT, size: 11 } } }));
    const h5 = w5.getRow(1); h5.values = cols5.map(c => c[0]); styleHeader(h5);
    events.forEach((e, i) => {
      const r = w5.getRow(i + 2);
      r.getCell(1).value = i + 1; r.getCell(2).value = new Date(e.ts + off); r.getCell(2).numFmt = 'dd/mm/yyyy hh:mm:ss';
      r.getCell(3).value = e.kind; if (e.mode) r.getCell(4).value = e.mode; if (e.status) r.getCell(5).value = e.status; if (e.descr) r.getCell(6).value = e.descr;
    });
    if (!events.length) {
      const r = w5.getRow(2); r.getCell(2).value = 'Không có sự kiện nào được hệ thống ghi nhận trong khoảng thời gian đã chọn.';
      r.getCell(2).font = { name: FONT, italic: true, color: { argb: C.mute } };
    } else {
      const lastE = events.length + 1;
      w5.autoFilter = `A1:F${lastE}`;
      w5.addConditionalFormatting({ ref: `A2:F${lastE}`, rules: [{ type: 'expression', priority: 2, formulae: ['MOD(ROW(),2)=0'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.zebra } } } }] });
      w5.addConditionalFormatting({ ref: `C2:C${lastE}`, rules: [{ type: 'expression', priority: 1, formulae: ['OR(C2="Emergency Stop",C2="Sensor Error",C2="ESP32 Disconnected")'], style: { font: { color: { argb: C.red }, bold: true } } }] });
    }
    w5.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '1:1' };
    w5.headerFooter = { oddHeader: '&L&"Calibri,Bold"SOLAR TRACKER – MEASUREMENT REPORT&R&"Calibri,Regular"Nhật ký hệ thống', oddFooter: '&LSolar Tracking & Monitoring System&CTrang &P / &N&R&D' };
  }

  const raw = await wb.xlsx.writeBuffer();
  return addCharts(Buffer.from(raw), chartsBySheet);
}

module.exports = { buildReport, MAX_ROWS };
