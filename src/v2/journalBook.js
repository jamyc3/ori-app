// Ori v2 — the journal as a keepsake PDF book.
//
// The whole journal, laid out on the same garden paper as the shareable letter
// card (letterCard.js): a cover, then newest-day-first pages of your words, that
// day's check-in and that night's letter — ready to keep or print.
//
// Same reasoning as the letter card: we hand-draw each page on a <canvas>
// (WKWebView rasterises canvas reliably, where DOM-snapshot libraries drop
// fonts/colours on iOS), then assemble the page images into a PDF by hand —
// one JPEG image per page via the PDF /DCTDecode filter, so no PDF library and
// no extra dependency. Pages flow: a line that doesn't fit starts a new page,
// so long entries are never truncated.

import { gatherJournal, prettyDate, shortDate, todayIso } from './journalData.js';

// Garden palette — mirrors letterCard.js / the v2 paper tokens. Hard-coded
// because canvas can't read CSS custom properties.
const PAPER = '#FBF7F0';
const INK = '#2B2824';
const MUTED = '#8A8175';
const FAINT = '#B8B09D';
const BLOOM = '#C98660';
const LINE = 'rgba(45,42,36,0.12)';

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// US Letter at 200 DPI. Canvas px aspect == page-point aspect, so the image
// fills the page with no distortion.
const PT_W = 612, PT_H = 792;          // page size in PDF points (1/72")
const PAGE_W = 1700, PAGE_H = 2200;    // canvas pixels (8.5×11 @ 200dpi)
const MX = 175;                         // side margin
const MT = 195;                         // top margin (content top)
const MB = 205;                         // bottom margin
const CW = PAGE_W - MX * 2;             // content width
const CONTENT_BOTTOM = PAGE_H - MB;

const STYLES = {
  day:      { font: SERIF, size: 54, lh: 72, color: INK },
  checkin:  { font: SANS,  size: 27, lh: 42, color: MUTED, italic: true },
  time:     { font: SANS,  size: 23, lh: 38, color: MUTED, spacing: 2, upper: true },
  body:     { font: SERIF, size: 36, lh: 55, color: INK },
  eyebrow:  { font: SANS,  size: 24, lh: 40, color: BLOOM, spacing: 4, upper: true },
  headline: { font: SERIF, size: 46, lh: 60, color: INK },
  para:     { font: SERIF, size: 36, lh: 55, color: INK },
  sig:      { font: SERIF, size: 35, lh: 52, color: MUTED, italic: true },
};

const GAP = { day: 66, entry: 32, inner: 12, letter: 42, para: 26, sig: 30, checkin: 10, headline: 10 };

function fontStr(st) {
  return `${st.italic ? 'italic ' : ''}${st.size}px ${st.font}`;
}

// Greedy word-wrap of `text` to `maxW` at style `st` (uppercased first for caps
// styles). Returns an array of lines.
function wrap(ctx, text, st, maxW) {
  ctx.font = fontStr(st);
  const src = st.upper ? String(text).toUpperCase() : String(text);
  const words = src.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// Flatten the whole journal into a flat op list: 'line' (one rendered line),
// 'space' (vertical gap), 'rule' (the ❀ day divider) and 'keep' (a break hint
// so a day heading is never stranded at the foot of a page).
function buildOps(measure, data) {
  const ops = [];
  const line = (text, st) => ops.push({ type: 'line', text, st, h: st.lh });
  const space = (h) => ops.push({ type: 'space', h });
  const wrapPush = (text, st) => { for (const l of wrap(measure, text, st, CW)) line(l, st); };

  data.days.forEach((day, di) => {
    if (di > 0) { space(GAP.day); ops.push({ type: 'rule', h: 70 }); }
    ops.push({ type: 'keep', h: 320 }); // keep heading + first lines together

    wrapPush(prettyDate(day), STYLES.day);

    const score = data.who5ByDay[day];
    if (score != null) { space(GAP.checkin); wrapPush(`Wellbeing check-in — ${Math.round(score)} out of 100`, STYLES.checkin); }

    for (const e of data.entriesByDay[day] || []) {
      space(GAP.entry);
      if (e.when) {
        const tag = e.source === 'reflection' ? ' · reflection'
          : (e.source === 'checkin' || !e.source ? '' : ' · imported');
        wrapPush(`${e.when}${tag}`, STYLES.time);
      }
      const paras = String(e.text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
      paras.forEach((p, pi) => { if (pi > 0) space(GAP.inner); wrapPush(p, STYLES.body); });
    }

    const letter = data.lettersByDay[day];
    if (letter) {
      space(GAP.letter);
      wrapPush('The letter', STYLES.eyebrow);
      if (letter.headline) { space(GAP.headline); wrapPush(String(letter.headline).trim(), STYLES.headline); }
      const paras = Array.isArray(letter.paragraphs) ? letter.paragraphs : [];
      for (const p of paras) {
        const t = String(p || '').trim();
        if (t) { space(GAP.para); wrapPush(t, STYLES.para); }
      }
      space(GAP.sig); wrapPush('— Ori', STYLES.sig);
    }
  });
  return ops;
}

// Pack ops into pages. A 'space' never leads a page; a 'line'/'rule' that would
// overflow starts a new page; a 'keep' breaks early if too little room remains.
function paginate(ops) {
  const pages = [];
  let cur = [];
  let y = MT;
  const flush = () => { if (cur.length) pages.push(cur); cur = []; y = MT; };
  for (const op of ops) {
    if (op.type === 'space') { if (cur.length && y + op.h <= CONTENT_BOTTOM) y += op.h; continue; }
    if (op.type === 'keep') { if (cur.length && CONTENT_BOTTOM - y < op.h) flush(); continue; }
    if (y + op.h > CONTENT_BOTTOM) flush();
    cur.push({ op, y });
    y += op.h;
  }
  flush();
  return pages.length ? pages : [[]];
}

// ---- painting ------------------------------------------------------------

function paintPaper(ctx) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const vg = ctx.createRadialGradient(PAGE_W / 2, PAGE_H * 0.32, 200, PAGE_W / 2, PAGE_H * 0.5, PAGE_H * 0.8);
  vg.addColorStop(0, 'rgba(255,255,255,0)');
  vg.addColorStop(1, 'rgba(120,100,70,0.05)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(60, 60, PAGE_W - 120, PAGE_H - 120);
}

function paintFooter(ctx, pageNo) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = FAINT;
  ctx.font = `24px ${SANS}`;
  ctx.fillText(pageNo != null ? `Ori · ${pageNo}` : 'Ori', PAGE_W / 2, PAGE_H - 96);
}

function drawDivider(ctx, y) {
  const cy = y + 34;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(MX, cy); ctx.lineTo(PAGE_W / 2 - 54, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PAGE_W / 2 + 54, cy); ctx.lineTo(PAGE_W - MX, cy); ctx.stroke();
  ctx.fillStyle = FAINT;
  ctx.font = `40px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('❀', PAGE_W / 2, cy);
}

function drawLine(ctx, op, y) {
  const st = op.st;
  ctx.fillStyle = st.color;
  ctx.font = fontStr(st);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const baseY = y + st.size;
  if (st.spacing) {
    let x = MX;
    for (const ch of op.text) { ctx.fillText(ch, x, baseY); x += ctx.measureText(ch).width + st.spacing; }
  } else {
    ctx.fillText(op.text, MX, baseY);
  }
}

// Draw centred letter-spaced caps (used on the cover).
function drawCenteredCaps(ctx, text, cx, baseY, size, font, spacing, color) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  const chars = [...String(text).toUpperCase()];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  let x = cx - total / 2;
  for (const ch of chars) { ctx.fillText(ch, x, baseY); x += ctx.measureText(ch).width + spacing; }
}

async function pageToJpeg(canvas) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

function newPageCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  return canvas;
}

async function renderCover(data) {
  const canvas = newPageCanvas();
  const ctx = canvas.getContext('2d');
  paintPaper(ctx);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BLOOM;
  ctx.font = `92px ${SERIF}`;
  ctx.fillText('❀', PAGE_W / 2, PAGE_H * 0.30);

  ctx.fillStyle = INK;
  ctx.font = `150px ${SERIF}`;
  ctx.fillText('Ori', PAGE_W / 2, PAGE_H * 0.30 + 205);

  ctx.fillStyle = MUTED;
  ctx.font = `italic 56px ${SERIF}`;
  ctx.fillText('the journal', PAGE_W / 2, PAGE_H * 0.30 + 290);

  const meta = `${data.days.length} day${data.days.length === 1 ? '' : 's'}  ·  ${data.entryCount} entr${data.entryCount === 1 ? 'y' : 'ies'}  ·  ${data.letterCount} letter${data.letterCount === 1 ? '' : 's'}`;
  drawCenteredCaps(ctx, meta, PAGE_W / 2, PAGE_H * 0.62, 27, SANS, 3, FAINT);

  const first = shortDate(data.days[data.days.length - 1]);
  const last = shortDate(data.days[0]);
  ctx.fillStyle = MUTED;
  ctx.font = `34px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText(data.days.length === 1 ? first : `${first} — ${last}`, PAGE_W / 2, PAGE_H * 0.62 + 68);

  ctx.fillStyle = FAINT;
  ctx.font = `25px ${SANS}`;
  ctx.fillText('Kept on your own device', PAGE_W / 2, PAGE_H - 150);

  return pageToJpeg(canvas);
}

async function renderContentPage(pageOps, pageNo) {
  const canvas = newPageCanvas();
  const ctx = canvas.getContext('2d');
  paintPaper(ctx);
  for (const { op, y } of pageOps) {
    if (op.type === 'rule') drawDivider(ctx, y);
    else if (op.type === 'line') drawLine(ctx, op, y);
  }
  paintFooter(ctx, pageNo);
  const jpeg = await pageToJpeg(canvas);
  canvas.width = 0; canvas.height = 0; // release memory before the next page
  return jpeg;
}

// ---- PDF assembly --------------------------------------------------------

// Assemble same-size JPEG pages into one PDF (one full-page image each).
function imagesToPdf(jpegPages) {
  const enc = new TextEncoder();
  const parts = [];
  let pos = 0;
  const out = (data) => {
    const u8 = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(u8);
    pos += u8.length;
  };

  const N = jpegPages.length;
  const objCount = 2 + 3 * N;            // catalog + pages + (image,content,page)×N
  const offsets = new Array(objCount + 1).fill(0);
  const mark = (n) => { offsets[n] = pos; };

  out('%PDF-1.3\n');
  out(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // binary marker

  mark(1);
  out('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = [];
  for (let i = 0; i < N; i++) kids.push(`${5 + 3 * i} 0 R`);
  mark(2);
  out(`2 0 obj\n<< /Type /Pages /Count ${N} /Kids [${kids.join(' ')}] >>\nendobj\n`);

  for (let i = 0; i < N; i++) {
    const imgN = 3 + 3 * i, contN = 4 + 3 * i, pageN = 5 + 3 * i;
    const jpeg = jpegPages[i];

    mark(imgN);
    out(`${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${PAGE_W} /Height ${PAGE_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    out(jpeg);
    out('\nendstream\nendobj\n');

    const content = `q\n${PT_W} 0 0 ${PT_H} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = enc.encode(content);
    mark(contN);
    out(`${contN} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    out(contentBytes);
    out('\nendstream\nendobj\n');

    mark(pageN);
    out(`${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>\nendobj\n`);
  }

  const xrefStart = pos;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= objCount; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out(xref);
  out(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  let total = 0;
  for (const p of parts) total += p.length;
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return new Blob([buf], { type: 'application/pdf' });
}

// Build the book. Returns { blob, filename, pages } — or null if the journal
// is empty (nothing to bind).
export async function buildJournalBook() {
  try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* ignore */ }

  const data = gatherJournal();
  if (!data.days.length) return null;

  const measure = document.createElement('canvas').getContext('2d');
  const pageOpsList = paginate(buildOps(measure, data));

  const jpegs = [await renderCover(data)];
  for (let i = 0; i < pageOpsList.length; i++) {
    jpegs.push(await renderContentPage(pageOpsList[i], i + 1));
  }

  const blob = imagesToPdf(jpegs);
  return { blob, filename: `ori-journal-${todayIso()}.pdf`, pages: jpegs.length };
}

// ---- save / share --------------------------------------------------------

function isIos() {
  try { return window.Capacitor?.getPlatform?.() === 'ios'; } catch { return false; }
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

// iOS → system share sheet (Files, Mail, AirDrop) via Filesystem; web → Web
// Share with the file when supported, else a direct download.
export async function shareJournalBook(blob, filename) {
  if (isIos()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      await Share.share({ title: 'Ori — the journal', url: uri });
      return true;
    } catch (e) {
      console.warn('Journal-book share failed:', e?.message || e);
      return false;
    }
  }
  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Ori — the journal' });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return true; // user dismissed — not a failure
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
