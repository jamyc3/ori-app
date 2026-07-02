// Ori v2 — shareable letter card.
//
// Renders one letter as a single keepsake image (the garden paper, the date,
// the headline, the letter in Ori's voice, the signature) that a person can
// save to Photos or share. "Take one letter out and keep it."
//
// Canvas, not html-to-image: WKWebView rasterises a hand-drawn canvas reliably,
// whereas DOM-snapshot libraries routinely drop custom fonts/colors on iOS.
// The card auto-grows in height so the WHOLE letter fits at a readable size —
// we never truncate the user's own words to fit a fixed frame.

// The garden palette (mirrors parts-lib GP / the v2 paper tokens). Hard-coded
// because canvas can't read CSS custom properties.
const PAPER = '#FBF7F0';
const INK = '#2B2824';
const MUTED = '#8A8175';
const FAINT = '#B8B09D';
const BLOOM = '#C98660';
const LINE = 'rgba(45,42,36,0.12)';

const W = 1080;                       // fixed width; height is computed
const PAD_X = 110;
const PAD_TOP = 132;
const PAD_BOTTOM = 128;
const CONTENT_W = W - PAD_X * 2;

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Wrap `text` to lines that fit `maxW` at the current ctx font.
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
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
  return lines;
}

// Build a render plan (lines + their fonts/sizes), so we can measure total
// height first, size the canvas, then paint in a second pass.
function planBlocks(ctx, { dateline, salutation, headline, paragraphs, signature }) {
  const blocks = [];
  const add = (text, { font, size, lh, color, gap = 0, align = 'left', italic = false, spacing = 0 }) => {
    ctx.font = `${italic ? 'italic ' : ''}${size}px ${font}`;
    const lines = wrapLines(ctx, text, CONTENT_W);
    blocks.push({ lines, size, lh, color, gap, align, font, italic, spacing });
  };
  if (dateline) add(dateline.toUpperCase(), { font: SANS, size: 27, lh: 38, color: MUTED, gap: 0, spacing: 3 });
  if (salutation) add(salutation, { font: SERIF, size: 38, lh: 54, color: INK, gap: 34 });
  if (headline) add(headline, { font: SERIF, size: 58, lh: 70, color: INK, gap: 28 });
  for (const p of paragraphs || []) {
    if (p && p.trim()) add(p.trim(), { font: SERIF, size: 35, lh: 54, color: INK, gap: 30 });
  }
  if (signature) add(signature, { font: SERIF, size: 35, lh: 50, color: MUTED, gap: 40, italic: true });
  return blocks;
}

function measureHeight(blocks) {
  let h = PAD_TOP;
  for (const b of blocks) h += b.gap + b.lines.length * b.lh;
  return h + PAD_BOTTOM + 56; // + footer wordmark band
}

function paint(ctx, blocks, height) {
  // Paper + subtle vignette.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, height);
  const vg = ctx.createRadialGradient(W / 2, height * 0.32, 120, W / 2, height * 0.5, height * 0.8);
  vg.addColorStop(0, 'rgba(255,255,255,0)');
  vg.addColorStop(1, 'rgba(120,100,70,0.05)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, height);

  // Hairline frame.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(44, 44, W - 88, height - 88);

  // Top flower glyph.
  ctx.fillStyle = BLOOM;
  ctx.font = `52px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('❀', W / 2, 92);

  // Text blocks.
  ctx.textAlign = 'left';
  let y = PAD_TOP;
  for (const b of blocks) {
    y += b.gap;
    ctx.fillStyle = b.color;
    ctx.font = `${b.italic ? 'italic ' : ''}${b.size}px ${b.font}`;
    for (const line of b.lines) {
      if (b.spacing) {
        // letter-spaced caps (dateline) — draw char by char.
        let x = PAD_X;
        for (const ch of line) {
          ctx.fillText(ch, x, y + b.size);
          x += ctx.measureText(ch).width + b.spacing;
        }
      } else {
        ctx.fillText(line, PAD_X, y + b.size);
      }
      y += b.lh;
    }
  }

  // Footer wordmark.
  ctx.textAlign = 'center';
  ctx.fillStyle = FAINT;
  ctx.font = `26px ${SANS}`;
  ctx.fillText('Ori', W / 2, height - 70);
}

// Render the card. Returns { blob, dataUrl, width, height }.
export async function buildLetterCard(content) {
  // Best-effort: let bundled fonts settle before measuring (no-op if unsupported).
  try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* ignore */ }

  const measure = document.createElement('canvas').getContext('2d');
  const blocks = planBlocks(measure, content);
  // Size to the content (with a modest floor) so the card always looks complete
  // — a fixed tall frame stranded a half-page of emptiness under short letters.
  const height = Math.max(760, Math.round(measureHeight(blocks)));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  paint(ctx, blocks, height);

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return { blob, dataUrl, width: W, height };
}

function isIos() {
  try { return window.Capacitor?.getPlatform?.() === 'ios'; } catch { return false; }
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

// Save / share the card. iOS → system share sheet (Photos, Messages, AirDrop)
// via Filesystem; web → Web Share with the file when supported, else download.
export async function shareLetterCard({ blob, dataUrl }, filename, title) {
  if (isIos()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      await Share.share({ title: title || 'A letter from Ori', url: uri });
      return true;
    } catch (e) {
      console.warn('Letter-card share failed:', e?.message || e);
      return false;
    }
  }
  // Web: prefer the native share sheet with the image file.
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: title || 'A letter from Ori' });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return true; // user dismissed — not a failure
  }
  // Fallback: download the PNG.
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
