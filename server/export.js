// Exportação de relatórios em Excel (.xlsx) e PDF.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { money, br } = require('./analytics');

const cellText = (v) => (v && typeof v === 'object' && 'money' in v) ? money(v.money || 0) : (v == null ? '' : String(v));

async function toExcel(res, title, data, from, to, storeName) {
  const wb = new ExcelJS.Workbook();
  wb.creator = storeName;
  const ws = wb.addWorksheet(title.slice(0, 30));
  ws.addRow([storeName]).font = { bold: true, size: 14 };
  ws.addRow([`${title} — ${br(from)} a ${br(to)}`]).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(data.columns);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5E59' } }; });
  const put = (r) => {
    const row = ws.addRow(r.map(v => (v && typeof v === 'object' && 'money' in v) ? (v.money || 0) / 100 : v));
    r.forEach((v, i) => { if (v && typeof v === 'object' && 'money' in v) row.getCell(i + 1).numFmt = '"R$" #,##0.00'; });
    return row;
  };
  data.rows.forEach(put);
  if (data.totals) put(data.totals).font = { bold: true };
  if (data.note) { ws.addRow([]); ws.addRow([data.note]).font = { italic: true }; }
  ws.columns.forEach((col, i) => {
    let w = 10;
    col.eachCell({ includeEmpty: false }, (c, rn) => { if (rn > 3) w = Math.max(w, String(c.value ?? '').length + 2); });
    col.width = Math.min(50, w);
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-${from}-a-${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

function toPdf(res, title, data, from, to, storeName) {
  const landscape = data.columns.length > 5;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-${from}-a-${to}.pdf"`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(15).text(storeName);
  doc.font('Helvetica').fontSize(11).text(`${title} — ${br(from)} a ${br(to)}`);
  doc.fontSize(8).fillColor('#666').text(`Gerado em ${new Date().toLocaleString('pt-BR')}`).fillColor('#000');
  doc.moveDown(0.8);

  const width = doc.page.width - 72;
  const colW = width / data.columns.length;
  const drawRow = (cells, bold, shade) => {
    const texts = cells.map(cellText);
    const h = Math.max(...texts.map(t => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).heightOfString(t, { width: colW - 6 }))) + 6;
    if (doc.y + h > doc.page.height - 40) doc.addPage();
    const y = doc.y;
    if (shade) doc.rect(36, y, width, h).fill(shade).fillColor('#000');
    texts.forEach((t, i) => {
      doc.fillColor(shade === '#0B5E59' ? '#fff' : '#000').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
        .text(t, 36 + i * colW + 3, y + 3, { width: colW - 6 });
    });
    doc.fillColor('#000');
    doc.y = y + h;
    doc.moveTo(36, doc.y).lineTo(36 + width, doc.y).strokeColor('#ddd').lineWidth(0.5).stroke();
  };
  drawRow(data.columns, true, '#0B5E59');
  if (!data.rows.length) { doc.moveDown().font('Helvetica').fontSize(10).text('Nenhum registro no período.', 36); }
  data.rows.forEach((r, i) => drawRow(r, false, i % 2 ? '#f4f0e7' : null));
  if (data.totals) drawRow(data.totals, true, '#e3f3f1');
  if (data.note) { doc.moveDown().font('Helvetica-Oblique').fontSize(8).text(data.note, 36, doc.y, { width }); }
  doc.end();
}

module.exports = { toExcel, toPdf };
