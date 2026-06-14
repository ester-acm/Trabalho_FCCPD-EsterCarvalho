'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const SRC = path.join(__dirname, '..', 'relatorio.md');
const OUT = path.join(__dirname, '..', 'relatorio.pdf');

const CM = 28.3465;
const INDENT = 1.25 * CM;
const LINE_GAP = 7;
const FONT = 'Times-Roman';
const FONT_BOLD = 'Times-Bold';

const md = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

const doc = new PDFDocument({
  size: 'A4',
  bufferPages: true,
  margins: { top: 3 * CM, bottom: 2 * CM, left: 3 * CM, right: 2 * CM },
});
doc.pipe(fs.createWriteStream(OUT));
doc.font(FONT).fontSize(12);

function renderInline(text, opts = {}) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== '');
  const runs = parts.map((p) => {
    const bold = p.startsWith('**') && p.endsWith('**');
    return { text: bold ? p.slice(2, -2) : p, bold };
  });
  for (let i = 1; i < runs.length; i++) {
    const m = runs[i].text.match(/^(\s+)/);
    if (m) { runs[i - 1].text += m[1]; runs[i].text = runs[i].text.slice(m[1].length); }
  }
  runs.forEach((run, i) => {
    doc.font(run.bold ? FONT_BOLD : FONT);
    doc.text(run.text, { continued: i < runs.length - 1, lineGap: LINE_GAP, ...opts });
  });
}

function ensureSpace(needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

let inHeader = true;

for (const raw of lines) {
  const t = raw.trimEnd();

  if (t === '') { doc.moveDown(0.3); continue; }

  if (t.startsWith('# ')) {
    doc.font(FONT_BOLD).fontSize(14).text(t.slice(2), { align: 'center', lineGap: LINE_GAP });
    doc.font(FONT).fontSize(12);
    inHeader = true;
    continue;
  }

  if (t.startsWith('### ')) {
    inHeader = false;
    doc.moveDown(0.5);
    ensureSpace(80);
    doc.font(FONT_BOLD).fontSize(12).text(t.slice(4), { lineGap: LINE_GAP });
    doc.font(FONT);
    continue;
  }
  if (t.startsWith('## ')) {
    inHeader = false;
    doc.moveDown(0.6);
    ensureSpace(80);
    doc.font(FONT_BOLD).fontSize(12).text(t.slice(3), { lineGap: LINE_GAP });
    doc.font(FONT);
    doc.moveDown(0.2);
    continue;
  }

  if (inHeader) {
    doc.font(FONT).fontSize(12).text(t, { align: 'center', lineGap: 2 });
    continue;
  }

  if (t.startsWith('- ')) {
    renderInline('•  ' + t.slice(2), { indent: INDENT, align: 'justify', paragraphGap: 2 });
    continue;
  }

  renderInline(t, { indent: INDENT, align: 'justify', paragraphGap: 2 });
}

const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  doc.font(FONT).fontSize(10);
  const x = doc.page.width - 2 * CM - 40;
  doc.text(String(i + 1), x, CM, { width: 40, align: 'right', lineBreak: false });
}

doc.end();
console.log('PDF (ABNT) gerado em', OUT);
