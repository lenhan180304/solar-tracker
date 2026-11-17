'use strict';
/*
  Chèn BIỂU ĐỒ EXCEL THẬT (DrawingML) vào file .xlsx do ExcelJS tạo ra.
  ExcelJS không hỗ trợ biểu đồ, nên sau khi ghi workbook ta mở gói .xlsx (zip) bằng JSZip và thêm:
    xl/charts/chartN.xml, xl/drawings/drawingN.xml (+ .rels), quan hệ trong sheet, Content_Types.
  Mọi biểu đồ là "XY Scatter với đường thẳng" (trục X = thời gian đo dạng số serial Excel, KHÔNG làm tròn về ngày),
  tham chiếu trực tiếp tới ô dữ liệu -> tự cập nhật khi người dùng sửa/bổ sung dữ liệu trong bảng, chỉnh sửa được trong Excel.
  Ô trống => đường đứt đoạn (dispBlanksAs = gap), không nối qua khoảng thiếu dữ liệu và không vẽ số 0.
*/
const JSZip = require('jszip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const FONT = 'Calibri';
const rich = (text, sz, bold, rot) =>
  `<c:tx><c:rich><a:bodyPr${rot ? ` rot="${rot}" vert="horz"` : ''}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"><a:latin typeface="${FONT}"/></a:defRPr></a:pPr>` +
  `<a:r><a:rPr lang="vi-VN" sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill><a:latin typeface="${FONT}"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;

function seriesXml(s, i) {
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>` +
    `<c:spPr><a:ln w="${s.width || 15875}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:round/></a:ln></c:spPr>` +
    `<c:marker><c:symbol val="none"/></c:marker>` +
    `<c:xVal><c:numRef><c:f>${esc(s.x)}</c:f></c:numRef></c:xVal>` +
    `<c:yVal><c:numRef><c:f>${esc(s.y)}</c:f></c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
}

/* spec: {title, xTitle, yTitle, series:[{name,x,y,color}], xFmt, yFmt, legend} */
function chartXml(spec) {
  const ln = (c, w) => `<c:spPr><a:ln w="${w}"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:ln></c:spPr>`;
  const txPr = (sz) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"><a:solidFill><a:srgbClr val="475569"/></a:solidFill><a:latin typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="vi-VN"/></a:p></c:txPr>`;
  const xAx = `<c:valAx><c:axId val="50010001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>` +
    `<c:title>${rich(spec.xTitle || 'Thời gian đo', 1000, false)}<c:overlay val="0"/></c:title>` +
    `<c:numFmt formatCode="${esc(spec.xFmt || 'dd/mm hh:mm')}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `${ln('94A3B8', 9525)}${txPr(900)}<c:crossAx val="50010002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;
  const yAx = `<c:valAx><c:axId val="50010002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>` +
    `<c:majorGridlines>${ln('E2E8F0', 6350)}</c:majorGridlines>` +
    `<c:title>${rich(spec.yTitle || '', 1000, false, '-5400000')}<c:overlay val="0"/></c:title>` +
    `<c:numFmt formatCode="${esc(spec.yFmt || 'General')}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `${ln('94A3B8', 9525)}${txPr(900)}<c:crossAx val="50010001"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;
  const legend = (spec.series.length > 1 || spec.legend)
    ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr(900)}</c:legend>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:lang val="vi-VN"/><c:roundedCorners val="0"/>` +
    `<c:chart><c:title>${rich(spec.title, 1200, true)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>` +
    spec.series.map(seriesXml).join('') +
    `<c:axId val="50010001"/><c:axId val="50010002"/></c:scatterChart>${xAx}${yAx}</c:plotArea>${legend}` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></c:spPr>` +
    `</c:chartSpace>`;
}

function anchorXml(a, idx, rid) {
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${a.col + a.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row + a.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${idx + 1}" name="Chart ${idx}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}">` +
    `<c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

/*
  buf: Buffer xlsx do ExcelJS; sheetsCharts: [{ sheetNo (1-based, theo thứ tự addWorksheet), charts:[{anchor:{col,row,cols,rows}, spec}] }]
  Trả về Buffer xlsx mới đã có biểu đồ.
*/
async function addCharts(buf, sheetsCharts) {
  const zip = await JSZip.loadAsync(buf);
  let ct = await zip.file('[Content_Types].xml').async('string');
  const add = [];
  let chartNo = 0, drawNo = 0;

  // ánh xạ sheetNo -> đường dẫn sheet thật trong workbook.xml (ExcelJS đặt sheet1.xml.. theo thứ tự)
  for (const sc of sheetsCharts) {
    if (!sc.charts.length) continue;
    drawNo += 1;
    const sheetPath = `xl/worksheets/sheet${sc.sheetNo}.xml`;
    let sx = await zip.file(sheetPath).async('string');
    if (!/xmlns:r=/.test(sx.slice(0, 600))) sx = sx.replace(/<worksheet /, `<worksheet xmlns:r="${NS_R}" `);

    // quan hệ của sheet (tạo mới hoặc thêm vào)
    const relPath = `xl/worksheets/_rels/sheet${sc.sheetNo}.xml.rels`;
    let rels = zip.file(relPath) ? await zip.file(relPath).async('string') : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const rid = 'rIdChartDraw' + drawNo;
    rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${NS_R}/drawing" Target="../drawings/drawing${drawNo}.xml"/></Relationships>`);
    zip.file(relPath, rels);

    // <drawing> phải đứng trước legacyDrawing/tableParts/extLst (thứ tự schema)
    const tag = `<drawing r:id="${rid}"/>`;
    const m = /<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[ >/]/.exec(sx);
    sx = m ? sx.slice(0, m.index) + tag + sx.slice(m.index) : sx.replace('</worksheet>', tag + '</worksheet>');
    zip.file(sheetPath, sx);

    // drawing + chart
    let anchors = '', drel = '';
    sc.charts.forEach((c, i) => {
      chartNo += 1;
      zip.file(`xl/charts/chart${chartNo}.xml`, chartXml(c.spec));
      drel += `<Relationship Id="rId${i + 1}" Type="${NS_R}/chart" Target="../charts/chart${chartNo}.xml"/>`;
      anchors += anchorXml(c.anchor, i + 1, 'rId' + (i + 1));
      add.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    });
    zip.file(`xl/drawings/drawing${drawNo}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${drawNo}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drel}</Relationships>`);
    add.push(`<Override PartName="/xl/drawings/drawing${drawNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  }
  ct = ct.replace('</Types>', add.join('') + '</Types>');
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

module.exports = { addCharts, chartXml };
