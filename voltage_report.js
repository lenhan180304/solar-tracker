'use strict';
/*
  BÁO CÁO ĐIỆN (V · A · W) CỦA PV VÀ ẮC QUY – nhiều sheet, biểu đồ Excel thật.
    Sheet "TỔNG QUAN": thông tin, thống kê toàn khoảng, bảng tổng hợp từng ngày (hoặc từng tháng) có liên kết mở sheet, 3 biểu đồ xu hướng.
    Mỗi NGÀY (khoảng ≤ 1 tháng) hoặc mỗi THÁNG (6 tháng, 1 năm) có sheet riêng: bảng thống kê V/A/W, 3 biểu đồ (V, A, W; PV và ắc quy) và bảng dữ liệu (hàng tiêu đề cố định, có bộ lọc).
  Nguyên tắc: chỉ dùng số đo thực đã lưu; thiếu dữ liệu = ô trống (không điền 0); ngày không có dữ liệu thì không có sheet.
  Hai chế độ nguồn dữ liệu:
    raw    : từng mẫu gốc; thống kê là công thức Excel (kèm giá trị tính sẵn)
    hourly : trung bình theo giờ (mỗi dòng = 1 giờ); thống kê tính từ tổng/min/max THẬT của mọi mẫu trong giờ, ghi dạng giá trị
*/
const ExcelJS = require('exceljs');
const { addCharts } = require('./xlsx_charts');

const RANGES = { '7d': { days: 7, label: '7 ngày', file: '7_Days' }, '1m': { days: 30, label: '1 tháng', file: '1_Month' },
                 '6m': { days: 182, label: '6 tháng', file: '6_Months' }, '1y': { days: 365, label: '1 năm', file: '1_Year' } };
const FONT = 'Calibri';
const C = { navy: 'FF1E40AF', head: 'FFDBEAFE', zebra: 'FFF1F5F9', border: 'FFCBD5E1', text: 'FF1E293B', mute: 'FF64748B' };
const KEYS = ['pvV', 'pvI', 'pvP', 'batV', 'batI', 'batP'];
const META = { pvV: { n: 'PV Voltage', u: 'V', f: '0.00' }, pvI: { n: 'PV Current', u: 'A', f: '0.000' }, pvP: { n: 'PV Power', u: 'W', f: '0.00' },
               batV: { n: 'Battery Voltage', u: 'V', f: '0.00' }, batI: { n: 'Battery Current', u: 'A', f: '0.000' }, batP: { n: 'Battery Power', u: 'W', f: '0.00' } };
const DCOL = { pvV: 'M', pvI: 'N', pvP: 'O', batV: 'P', batI: 'Q', batP: 'R' };   // cột dữ liệu trong sheet nhóm
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const pad = (n) => String(n).padStart(2, '0');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const bd = () => ({ top: { style: 'thin', color: { argb: C.border } }, bottom: { style: 'thin', color: { argb: C.border } }, left: { style: 'thin', color: { argb: C.border } }, right: { style: 'thin', color: { argb: C.border } } });
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const dmy = (ms, off) => { const d = new Date(ms + off); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const dmyhms = (ms, off) => { const d = new Date(ms + off); return `${dmy(ms, off)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };

/* ---- chuẩn hoá nguồn: rows = [{ts, pvV.., h?}] ---- */
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
    if (r.h) { n += r.h.n; sum += r.h[k].sum; if (r.h[k].min < mn) mn = r.h[k].min; if (r.h[k].max > mx) mx = r.h[k].max; }
    else { const v = r[k]; if (v === null) continue; n++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  return n ? { n, avg: sum / n, min: mn, max: mx } : { n: 0, avg: null, min: null, max: null };
}
function statAll(rows) { const o = {}; KEYS.forEach(k => { o[k] = statOf(rows, k); }); return o; }
/* dùng cho xem trước (tóm tắt nhanh) */
function summarize(data) { const st = statAll(data.rows); return { mode: data.mode, n: data.rows.length, pv: st.pvV, bat: st.batV, pvI: st.pvI, pvP: st.pvP, batI: st.batI, batP: st.batP }; }

/* gom theo ngày/tháng địa phương */
function groupRows(rows, off, byMonth) {
  const map = new Map();
  for (const r of rows) {
    const d = new Date(r.ts + off);
    const key = byMonth ? d.getUTCFullYear() * 100 + d.getUTCMonth() : Math.floor((r.ts + off) / 86400000);
    let g = map.get(key);
    if (!g) {
      const startLocal = byMonth ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) : key * 86400000;
      g = { key, startLocal, rows: [], name: byMonth ? `T${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}` : `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`,
            label: byMonth ? `Tháng ${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : `${WD[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` };
      map.set(key, g);
    }
    g.rows.push(r);
  }
  return [...map.values()].sort((a, b) => a.key - b.key);
}

function styleHead(c) { c.font = { name: FONT, bold: true, color: { argb: C.text } }; c.fill = fill(C.head); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = bd(); }
function putTitle(ws, text, sub, cols) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1); t.value = text; t.font = { name: FONT, bold: true, size: 16, color: { argb: 'FFFFFFFF' } }; t.fill = fill(C.navy); t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1); s.value = sub; s.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; s.alignment = { indent: 1 };
}
function putSection(ws, r, text, cols) {
  ws.mergeCells(r, 1, r, cols); const c = ws.getCell(r, 1); c.value = text;
  c.font = { name: FONT, bold: true, size: 12, color: { argb: C.navy } }; c.border = { bottom: { style: 'medium', color: { argb: 'FF2563EB' } } }; ws.getRow(r).height = 22;
}
function putInfo(ws, r, label, value, cols) {
  ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { name: FONT, bold: true, color: { argb: C.text } };
  ws.mergeCells(r, 2, r, cols); const v = ws.getCell(r, 2); v.value = value; v.font = { name: FONT, color: { argb: C.text } }; v.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
  for (let k = 1; k <= cols; k++) ws.getCell(r, k).border = { bottom: { style: 'hair', color: { argb: C.border } } };
}
/* bảng thống kê 6 hàng (V/A/W của PV và ắc quy); trả về {row của từng key} để liên kết */
function putStatTable(ws, top, st, formulaRefs /* {key: 'M$2:M$500'} hoặc null */) {
  ['Thông số', 'Đơn vị', 'Trung bình', 'Thấp nhất', 'Cao nhất', 'Số mẫu hợp lệ'].forEach((h, i) => { const c = ws.getCell(top, 1 + i); c.value = h; styleHead(c); });
  ws.getRow(top).height = 26;
  KEYS.forEach((k, i) => {
    const r = top + 1 + i, m = META[k], s = st[k], rg = formulaRefs && formulaRefs[k];
    ws.getCell(r, 1).value = m.n; ws.getCell(r, 2).value = m.u;
    const fx = (agg, d) => rg ? { formula: `IF(COUNT(${rg})=0,"N/A",${agg}(${rg}))`, result: d === null ? 'N/A' : d } : (d === null ? 'N/A' : d);
    ws.getCell(r, 3).value = fx('AVERAGE', s.avg); ws.getCell(r, 4).value = fx('MIN', s.min); ws.getCell(r, 5).value = fx('MAX', s.max);
    ws.getCell(r, 6).value = rg ? { formula: `COUNT(${rg})`, result: s.n } : s.n;
    for (let c = 1; c <= 6; c++) {
      const cell = ws.getCell(r, c); cell.border = bd(); cell.font = { name: FONT, bold: c === 1 || (c >= 3 && c <= 5), color: { argb: c >= 3 && c <= 5 ? C.navy : C.text } };
      if (c >= 3 && c <= 5) { cell.numFmt = m.f; cell.alignment = { horizontal: 'right' }; } if (c === 6) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; } if (c === 2) cell.alignment = { horizontal: 'center' };
      if (i % 2) cell.fill = fill(C.zebra);
    }
  });
}
const q = (name) => `'${name}'!`;
const mkChart = (title, yTitle, series, yFmt, xFmt) => ({ title, xTitle: 'Thời gian đo', yTitle, yFmt, xFmt, series });
const PVC = '2563EB', BATC = '16A34A';

async function buildVoltageReport(o) {
  const off = o.tzHours * 3600000;
  const { mode, rows } = o.data;
  const hourly = mode === 'hourly';
  const byMonth = RANGES[o.range].days > 31;
  const groups = groupRows(rows, off, byMonth).map(g => ({ ...g, st: statAll(g.rows) }));
  const allSt = statAll(rows);
  const chunks = []; const sink = new (require('stream').Writable)({ write(c, e, cb) { chunks.push(c); cb(); } });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: false });
  wb.creator = 'Solar Tracker Cloud'; wb.created = new Date(); wb.title = 'Solar Tracker – Electrical Report (V, A, W)';
  const chartsBySheet = [];
  const unitName = byMonth ? 'tháng' : 'ngày';
  const STAT_TOP = 10, STAT_ROW = (i) => STAT_TOP + 1 + i;       // hàng của key thứ i trong bảng thống kê (cùng vị trí ở mọi sheet nhóm)

  // ================= TỔNG QUAN =================
  {
    const ws = wb.addWorksheet('TỔNG QUAN', { properties: { tabColor: { argb: C.navy } }, views: [{ showGridLines: false }] });
    ws.columns = [{ width: 28 }, ...Array(13).fill({ width: 13 })];
    putTitle(ws, 'SOLAR TRACKER – ELECTRICAL MONITORING REPORT (V · A · W)', `Điện áp, dòng điện, công suất của PV và ắc quy • ${o.deviceName || o.deviceId} • dữ liệu thực tế đã lưu trên Cloud`, 14);
    putSection(ws, 4, 'THÔNG TIN BÁO CÁO', 14);
    putInfo(ws, 5, 'Khoảng thời gian báo cáo', `${dmy(o.from, off)}  →  ${dmy(o.to, off)}  (${RANGES[o.range].label}, UTC+${o.tzHours})`, 14);
    putInfo(ws, 6, 'Ngày xuất báo cáo', dmyhms(Date.now(), off), 14);
    putInfo(ws, 7, 'Tổng số mẫu đo', rows.length.toLocaleString('en-US') + (hourly ? ' dòng (mỗi dòng = trung bình 1 giờ)' : ' mẫu gốc, không gộp'), 14);
    putInfo(ws, 8, 'Cách xem từng ' + unitName, `Mỗi ${unitName} có một sheet riêng (tên sheet = ${unitName}) gồm bảng thống kê V/A/W, 3 biểu đồ và bảng dữ liệu. Bấm vào tên ${unitName} trong bảng bên dưới để mở.` +
      (hourly ? ' Dữ liệu dùng giá trị trung bình theo giờ (dữ liệu chi tiết cũ đã được dọn); Thấp nhất / Cao nhất vẫn lấy từ mọi mẫu đo thật.' : ''), 14);
    ws.getRow(8).height = 44;
    putSection(ws, STAT_TOP - 1, 'THỐNG KÊ TOÀN KHOẢNG THỜI GIAN', 14);
    putStatTable(ws, STAT_TOP, allSt, null);
    const T = STAT_TOP + 8;                                        // bảng tổng hợp từng nhóm
    putSection(ws, T - 1, `TỔNG HỢP TỪNG ${unitName.toUpperCase()}`, 14);
    const heads = [byMonth ? 'Tháng' : 'Ngày', 'Số mẫu', 'PV V TB', 'PV V min', 'PV V max', 'PV A TB', 'PV W TB', 'PV W max', 'Bat V TB', 'Bat V min', 'Bat V max', 'Bat A TB', 'Bat W TB', 'Mốc (cho biểu đồ)'];
    heads.forEach((h, i) => { const c = ws.getCell(T, 1 + i); c.value = h; styleHead(c); }); ws.getRow(T).height = 26;
    // ô liên kết tới thống kê của sheet nhóm: cột C = Trung bình, D = Thấp nhất, E = Cao nhất ; hàng theo key
    const link = (g, key, colL, val) => ({ formula: `IF(ISNUMBER(${q(g.name)}${colL}${STAT_ROW(KEYS.indexOf(key))}),${q(g.name)}${colL}${STAT_ROW(KEYS.indexOf(key))},"")`, result: val === null ? '' : val });
    groups.forEach((g, i) => {
      const r = T + 1 + i, s = g.st;
      ws.getCell(r, 1).value = { formula: `HYPERLINK("#'${g.name}'!A1","${g.label}")`, result: g.label };
      ws.getCell(r, 2).value = { formula: `${q(g.name)}F${STAT_ROW(0)}`, result: g.st.pvV.n };
      const cells = [[3, 'pvV', 'C', s.pvV.avg], [4, 'pvV', 'D', s.pvV.min], [5, 'pvV', 'E', s.pvV.max], [6, 'pvI', 'C', s.pvI.avg], [7, 'pvP', 'C', s.pvP.avg], [8, 'pvP', 'E', s.pvP.max],
                     [9, 'batV', 'C', s.batV.avg], [10, 'batV', 'D', s.batV.min], [11, 'batV', 'E', s.batV.max], [12, 'batI', 'C', s.batI.avg], [13, 'batP', 'C', s.batP.avg]];
      cells.forEach(([c, key, col, val]) => { const cell = ws.getCell(r, c); cell.value = link(g, key, col, val); cell.numFmt = META[key].f; });
      ws.getCell(r, 14).value = g.startLocal / 86400000 + 25569; ws.getCell(r, 14).numFmt = 'dd/mm/yyyy';
      for (let c = 1; c <= 14; c++) { const cell = ws.getCell(r, c); cell.border = bd(); cell.font = { name: FONT, color: { argb: c === 1 ? 'FF2563EB' : (c === 14 ? C.mute : C.text) }, underline: c === 1 }; if (c > 1) cell.alignment = { horizontal: 'right' }; if (i % 2) cell.fill = fill(C.zebra); }
    });
    const lastT = T + groups.length;
    const CH = T + groups.length + 2;
    putSection(ws, CH - 1, `BIỂU ĐỒ XU HƯỚNG THEO ${unitName.toUpperCase()} (giá trị trung bình)`, 14);
    const X = `${q('TỔNG QUAN')}$N$${T + 1}:$N$${lastT}`, Y = (col) => `${q('TỔNG QUAN')}$${col}$${T + 1}:$${col}$${lastT}`;
    const xf = 'dd/mm/yyyy';
    const ch = [
      mkChart(`Điện áp trung bình theo ${unitName}`, 'Điện áp (V)', [{ name: 'PV Voltage (V)', color: PVC, x: X, y: Y('C') }, { name: 'Battery Voltage (V)', color: BATC, x: X, y: Y('I') }], '0.0', xf),
      mkChart(`Dòng điện trung bình theo ${unitName}`, 'Dòng điện (A)', [{ name: 'PV Current (A)', color: PVC, x: X, y: Y('F') }, { name: 'Battery Current (A)', color: BATC, x: X, y: Y('L') }], '0.00', xf),
      mkChart(`Công suất trung bình theo ${unitName}`, 'Công suất (W)', [{ name: 'PV Power (W)', color: PVC, x: X, y: Y('G') }, { name: 'Battery Power (W)', color: BATC, x: X, y: Y('M') }], '0.0', xf),
    ];
    chartsBySheet.push({ sheetNo: 1, charts: ch.map((spec, i) => ({ anchor: { col: 0, row: CH + i * 17, cols: 9, rows: 16 }, spec })) });
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    for (let r = 1; r <= CH + 3 * 17 + 1; r++) ws.getRow(r).commit();
    await ws.commit();
  }

  // ================= SHEET TỪNG NGÀY / THÁNG =================
  const dataHeads = ['STT', 'Ngày', 'Thời gian' , 'PV Voltage (V)', 'PV Current (A)', 'PV Power (W)', 'Battery Voltage (V)', 'Battery Current (A)', 'Battery Power (W)', 'Thời điểm đo (cho biểu đồ)'];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi], N = g.rows.length, last = N + 1;
    const ws = wb.addWorksheet(g.name, { properties: { tabColor: { argb: 'FF2563EB' } }, views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
    ws.columns = [{ width: 28 }, { width: 11 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 3 },
                  { width: 7 }, { width: 12 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 20 }];
    putTitle(ws, `${g.label} – ELECTRICAL REPORT`, `${o.deviceName || o.deviceId} • V · A · W của PV và ắc quy`, 8);
    putSection(ws, 4, byMonth ? 'THÔNG TIN THÁNG' : 'THÔNG TIN NGÀY', 8);
    putInfo(ws, 5, byMonth ? 'Tháng' : 'Ngày', g.label, 8);
    ws.getCell(6, 1).value = 'Tổng số mẫu đo'; ws.getCell(6, 1).font = { name: FONT, bold: true, color: { argb: C.text } };
    ws.mergeCells(6, 2, 6, 8);
    const cnt = ws.getCell(6, 2); cnt.value = hourly ? { formula: `COUNTA(S2:S${last})`, result: N } : { formula: `COUNTA(S2:S${last})`, result: N }; cnt.numFmt = '#,##0'; cnt.alignment = { horizontal: 'left' }; cnt.font = { name: FONT, color: { argb: C.text } };
    for (let k = 1; k <= 8; k++) ws.getCell(6, k).border = { bottom: { style: 'hair', color: { argb: C.border } } };
    putInfo(ws, 7, 'Nguồn dữ liệu', hourly ? 'Trung bình theo giờ (mỗi dòng = 1 giờ)' : 'Mẫu đo gốc, không gộp (mỗi dòng = 1 mẫu)', 8);
    putSection(ws, STAT_TOP - 1, `BẢNG THỐNG KÊ ${byMonth ? 'THÁNG' : 'NGÀY'}`, 8);
    const refs = {}; KEYS.forEach(k => { refs[k] = `$${DCOL[k]}$2:$${DCOL[k]}$${last}`; });
    putStatTable(ws, STAT_TOP, g.st, hourly ? null : refs);
    ws.mergeCells(17, 1, 17, 8);
    const nt = ws.getCell(17, 1);
    nt.value = hourly ? 'Trung bình = tổng mọi mẫu đo / số mẫu; Thấp nhất / Cao nhất = nhỏ nhất / lớn nhất của mọi mẫu đo thật (không phải của trung bình giờ). Dữ liệu thiếu không được tính, không thay bằng 0.'
                      : 'Chỉ tính các mẫu hợp lệ. Dữ liệu thiếu (INA219 không phản hồi) để trống và không được tính, không thay bằng 0. Thống kê là công thức Excel theo bảng dữ liệu bên phải.';
    nt.font = { name: FONT, italic: true, size: 10, color: { argb: C.mute } }; nt.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(17).height = 28;
    putSection(ws, 19, 'BIỂU ĐỒ (liên kết với bảng dữ liệu bên phải)', 8);
    let leftLast = 19 + 3 * 17 + 1;
    // tháng: bảng thống kê từng ngày trong tháng
    let dayRows = [];
    if (byMonth) {
      const days = groupRows(g.rows, off, false).map(d => ({ ...d, st: statAll(d.rows) }));
      const top = leftLast + 2;
      putSection(ws, top - 1, 'THỐNG KÊ TỪNG NGÀY TRONG THÁNG', 8);
      ['Ngày', 'PV V TB', 'PV V min', 'PV V max', 'PV A TB', 'PV W TB', 'Bat V TB', 'Bat W TB'].forEach((h, i) => { const c = ws.getCell(top, 1 + i); c.value = h; styleHead(c); });
      days.forEach((d, i) => {
        const r = top + 1 + i, s = d.st;
        const vals = [d.label, s.pvV.avg, s.pvV.min, s.pvV.max, s.pvI.avg, s.pvP.avg, s.batV.avg, s.batP.avg], fm = [null, '0.00', '0.00', '0.00', '0.000', '0.00', '0.00', '0.00'];
        vals.forEach((v, c) => { const cell = ws.getCell(r, 1 + c); cell.value = v === null ? '' : v; if (fm[c]) { cell.numFmt = fm[c]; cell.alignment = { horizontal: 'right' }; } cell.border = bd(); cell.font = { name: FONT, color: { argb: C.text } }; if (i % 2) cell.fill = fill(C.zebra); });
      });
      leftLast = top + days.length + 1;
    }
    // bảng dữ liệu bên phải
    dataHeads.forEach((h, i) => { const c = ws.getCell(1, 10 + i); c.value = h; styleHead(c); });
    const fm = { J: '0', K: 'dd/mm/yyyy', L: 'hh:mm:ss', M: '0.00', N: '0.000', O: '0.00', P: '0.00', Q: '0.000', R: '0.00', S: 'dd/mm/yyyy hh:mm:ss' };
    const al = { J: 'center', K: 'center', L: 'center' };
    for (const [c, f] of Object.entries(fm)) { const cc = ws.getColumn(c); cc.numFmt = f; cc.font = { name: FONT, size: 11, color: { argb: c === 'S' ? C.mute : C.text } }; cc.alignment = { horizontal: al[c] || 'right' }; }
    for (let k = 10; k <= 19; k++) { const c = ws.getCell(1, k); c.numFmt = 'General'; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.font = { name: FONT, bold: true, color: { argb: C.text } }; }
    ws.getRow(1).height = 32;
    if (N) {
      ws.autoFilter = `J1:S${last}`;
      ws.addConditionalFormatting({ ref: `J2:S${last}`, rules: [{ type: 'expression', priority: 1, formulae: ['MOD(ROW(),2)=0'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.zebra } } } }] });
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    const putRow = (i) => {
      const r = g.rows[i], x = i + 2, row = ws.getRow(x);
      const secs = Math.round((r.ts + off) / 1000), day = Math.floor(secs / 86400), tod = secs - day * 86400;
      row.getCell(10).value = i + 1; row.getCell(11).value = day + 25569; row.getCell(12).value = tod / 86400;
      KEYS.forEach((k, j) => { if (r[k] !== null) row.getCell(13 + j).value = r[k]; });
      row.getCell(19).value = { formula: `K${x}+L${x}`, result: day + 25569 + tod / 86400 };
    };
    const lastRow = Math.max(N + 1, leftLast);
    for (let r = 1; r <= lastRow; r++) { if (r >= 2 && r - 2 < N) putRow(r - 2); ws.getRow(r).commit(); }
    await ws.commit();
    // biểu đồ của sheet nhóm (sheet thứ gi+2)
    const sq = q(g.name), X = `${sq}$S$2:$S$${last}`, Y = (k) => `${sq}$${DCOL[k]}$2:$${DCOL[k]}$${last}`;
    const xf = byMonth ? 'dd/mm' : 'hh:mm';
    const ch = [
      mkChart(`${g.label} – Điện áp (V)`, 'Điện áp (V)', [{ name: 'PV Voltage (V)', color: PVC, x: X, y: Y('pvV') }, { name: 'Battery Voltage (V)', color: BATC, x: X, y: Y('batV') }], '0.0', xf),
      mkChart(`${g.label} – Dòng điện (A)`, 'Dòng điện (A)', [{ name: 'PV Current (A)', color: PVC, x: X, y: Y('pvI') }, { name: 'Battery Current (A)', color: BATC, x: X, y: Y('batI') }], '0.00', xf),
      mkChart(`${g.label} – Công suất (W)`, 'Công suất (W)', [{ name: 'PV Power (W)', color: PVC, x: X, y: Y('pvP') }, { name: 'Battery Power (W)', color: BATC, x: X, y: Y('batP') }], '0.0', xf),
    ];
    chartsBySheet.push({ sheetNo: gi + 2, charts: ch.map((spec, i) => ({ anchor: { col: 0, row: 19 + i * 17, cols: 8, rows: 16 }, spec })) });
  }
  await wb.commit();
  return addCharts(Buffer.concat(chunks), chartsBySheet);
}

module.exports = { buildVoltageReport, fromRaw, fromHourly, summarize, RANGES };
