// Builds docs/Nyahmation-User-Manual.pdf: captures annotated screenshots of
// the real app (capture.mjs), lays out the manual (content.mjs) as HTML, and
// prints it to PDF with Electron's own Chromium, so nothing else needs to
// be installed.
//
//   npm run manual             (builds the app first)
//   node scripts/manual/make.mjs --reuse   (skip capturing; reuse out/manual)
//
// On Linux without a display, run it under xvfb-run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { capture } from './capture.mjs';
import { manualHtml } from './content.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'out/manual');
const pdfPath = join(root, 'docs/Nyahmation-User-Manual.pdf');
const require = createRequire(import.meta.url);

const figures = process.argv.includes('--reuse') && existsSync(join(outDir, 'figures.json'))
  ? JSON.parse(readFileSync(join(outDir, 'figures.json'), 'utf8'))
  : await capture(outDir);

// ---- Annotated figures ------------------------------------------------------------

const BADGE_R = 13;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Where a callout's number goes, just outside its box or point. `k` = page scale (see figure). */
function badgeAt(c, width, height, k) {
  const R = BADGE_R / k;
  const side = c.badge ?? 'tl';
  let x;
  let y;
  if (c.box) {
    const { x: bx, y: by, w, h } = c.box;
    const gap = R + 5 / k;
    const cx = bx + w / 2;
    const cy = by + h / 2;
    ({ x, y } = {
      t: { x: cx, y: by - gap },
      b: { x: cx, y: by + h + gap },
      l: { x: bx - gap, y: cy },
      r: { x: bx + w + gap, y: cy },
      tl: { x: bx + R + 4 / k, y: by + R + 4 / k },
      tr: { x: bx + w - R - 4 / k, y: by + R + 4 / k },
      bl: { x: bx + R + 4 / k, y: by + h - R - 4 / k },
      br: { x: bx + w - R - 4 / k, y: by + h - R - 4 / k },
    }[side]);
  } else {
    const d = 34 / k;
    const dd = d * 0.72;
    ({ x, y } = {
      t: { x: c.point.x, y: c.point.y - d },
      b: { x: c.point.x, y: c.point.y + d },
      l: { x: c.point.x - d, y: c.point.y },
      r: { x: c.point.x + d, y: c.point.y },
      tl: { x: c.point.x - dd, y: c.point.y - dd },
      tr: { x: c.point.x + dd, y: c.point.y - dd },
      bl: { x: c.point.x - dd, y: c.point.y + dd },
      br: { x: c.point.x + dd, y: c.point.y + dd },
    }[side]);
  }
  const m = R + 2 / k;
  return { x: Math.min(width - m, Math.max(m, x)), y: Math.min(height - m, Math.max(m, y)) };
}

/** Printed width of a figure, in inches: whole-window shots fill the column; crops are smaller. */
function printWidth(f) {
  if (f.width >= 1100) return 6.9;
  if (f.width >= 700) return f.height > f.width * 0.75 ? 4.9 : 5.6;
  return f.height > f.width ? 2.7 : 3.3;
}

function figure(name, caption) {
  const f = figures[name];
  if (!f) throw new Error(`No figure "${name}"`);
  const img = pathToFileURL(join(outDir, f.file)).href;
  // Callouts print at the same size whatever the screenshot's scale: k is
  // how much bigger one screenshot pixel prints than in a full-width shot.
  const inches = printWidth(f);
  const k = (inches / f.width) * (1400 / 6.9);
  const shapes = [];
  const badges = [];
  f.callouts.forEach((c, i) => {
    const n = i + 1;
    const b = badgeAt(c, f.width, f.height, k);
    if (c.box) {
      const { x, y, w, h } = c.box;
      const rect = `x="${x}" y="${y}" width="${w}" height="${h}" rx="${5 / k}"`;
      shapes.push(`<rect class="halo" ${rect}/><rect class="ring" ${rect}/>`);
    } else {
      const { x, y } = c.point;
      const len = Math.hypot(b.x - x, b.y - y);
      const r = 14 / k;
      if (len > r + BADGE_R / k) {
        const ux = (b.x - x) / len;
        const uy = (b.y - y) / len;
        const line = `x1="${x + ux * r}" y1="${y + uy * r}" x2="${b.x - (ux * BADGE_R) / k}" y2="${b.y - (uy * BADGE_R) / k}"`;
        shapes.push(`<line class="halo" ${line}/><line class="ring" ${line}/>`);
      }
      shapes.push(`<circle class="halo" cx="${x}" cy="${y}" r="${r}"/><circle class="ring" cx="${x}" cy="${y}" r="${r}"/>`);
    }
    badges.push(
      `<g transform="translate(${b.x} ${b.y}) scale(${1 / k})"><circle class="badge" r="${BADGE_R}"/><text class="badge-num" y="4.6">${n}</text></g>`,
    );
  });
  const legend = f.callouts.map((c, i) => `<li><span class="num">${i + 1}</span><span>${esc(c.label)}</span></li>`).join('');
  return `
<figure class="shot ${f.width < 700 ? 'narrow' : ''}" id="fig-${name}" style="--w:${inches}in">
  <div class="frame" style="aspect-ratio:${f.width}/${f.height}">
    <img src="${img}" alt="">
    <svg viewBox="0 0 ${f.width} ${f.height}" preserveAspectRatio="none" style="--k:${k}">${shapes.join('')}${badges.join('')}</svg>
  </div>
  <figcaption>
    <p class="caption">${caption}</p>
    <ol class="legend ${f.callouts.length > 5 && f.width >= 700 ? 'two' : ''}">${legend}</ol>
  </figcaption>
</figure>`;
}

// ---- Page ---------------------------------------------------------------------------

const fontDir = dirname(require.resolve('@fontsource-variable/inter/package.json'));
const font = (file) => pathToFileURL(join(fontDir, 'files', file)).href;
const icon = pathToFileURL(join(root, 'build/icon.png')).href;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nyahmation User Manual</title>
<style>
@font-face { font-family: 'Inter'; src: url('${font('inter-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 900; font-style: normal; }
@font-face { font-family: 'Inter'; src: url('${font('inter-latin-wght-italic.woff2')}') format('woff2'); font-weight: 100 900; font-style: italic; }
@page {
  size: Letter; margin: 0.75in 0.8in 0.8in;
  @bottom-left { content: 'Nyahmation User Manual'; font: 7.5pt Inter, sans-serif; color: #8a8f99; }
  @bottom-right { content: counter(page); font: 7.5pt Inter, sans-serif; color: #8a8f99; }
}
@page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
:root {
  --ink: #1d2027; --muted: #5d6270; --line: #dfe2e8; --accent: #4f6ef7; --accent-2: #7a6cf0;
  --tint: #f3f5fb; --call: #e8177d; --tip: #fff6e0; --tip-line: #f0c46a;
}
* { box-sizing: border-box; }
html { font-family: 'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; }
h1, h2, h3 { line-height: 1.2; font-weight: 700; letter-spacing: -0.01em; }
h1 { font-size: 22pt; margin: 0 0 4pt; color: var(--ink); }
.chapter-num { font-size: 10pt; margin: 0 0 6pt; line-height: 1.2; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-bottom: 6pt; }
h2 { font-size: 13.5pt; margin: 18pt 0 6pt; break-after: avoid; }
h3 { font-size: 11pt; margin: 14pt 0 4pt; break-after: avoid; }
p { margin: 0 0 7pt; }
.lede { font-size: 11.5pt; color: var(--muted); margin-bottom: 14pt; }
section.chapter { break-before: page; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin: 2pt 0; }
kbd { font-family: inherit; font-size: 8.8pt; font-weight: 600; border: 1px solid #c9ccd6; border-bottom-width: 2px; border-radius: 4px; padding: 0 4pt; background: #fafbfc; white-space: nowrap; }
.ui { font-weight: 600; }
code { font-family: 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace; font-size: 8.8pt; background: var(--tint); padding: 1pt 3pt; border-radius: 3px; }
pre { font-family: 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace; font-size: 8.8pt; background: #1e1f22; color: #e6e6e6; padding: 8pt 10pt; border-radius: 6px; margin: 0 0 9pt; white-space: pre-wrap; break-inside: avoid; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt; font-size: 9.6pt; break-inside: auto; }
th { text-align: left; font-weight: 600; color: var(--muted); font-size: 8.4pt; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1.5px solid var(--ink); padding: 4pt 6pt; }
td { border-bottom: 1px solid var(--line); padding: 4.5pt 6pt; vertical-align: top; }
table.keys { font-size: 9.2pt; }
table.keys td { padding: 3.2pt 5pt; }
table.keys td:first-child { white-space: normal; width: 62%; }
table.keys td:last-child { white-space: nowrap; text-align: right; }
table.keep { break-inside: avoid; }
tr { break-inside: avoid; }
td:first-child { font-weight: 600; white-space: nowrap; }
table.wrap td:first-child { white-space: normal; }
.tip, .note { border-left: 3px solid var(--tip-line); background: var(--tip); padding: 7pt 10pt; border-radius: 0 6px 6px 0; margin: 6pt 0 11pt; break-inside: avoid; }
.note { border-left-color: var(--accent); background: var(--tint); }
.tip b:first-child, .note b:first-child { margin-right: 3pt; }
.steps { counter-reset: step; list-style: none; padding-left: 0; }
.steps > li { counter-increment: step; position: relative; padding-left: 24pt; margin: 5pt 0; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 16pt; height: 16pt; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 700; font-size: 8.5pt; line-height: 16pt; text-align: center; }

/* Annotated screenshots */
figure.shot { margin: 8pt 0 14pt; break-inside: avoid; }
figure.shot .frame { position: relative; width: var(--w); margin: 0 auto; border-radius: 6px; overflow: hidden; border: 1px solid #c9cdd6; }
figure.shot.narrow { display: grid; grid-template-columns: var(--w) 1fr; gap: 16pt; align-items: start; }
figure.shot img { display: block; width: 100%; height: 100%; }
figure.shot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
svg .halo { fill: none; stroke: #fff; stroke-width: calc(6.5px / var(--k)); opacity: 0.9; }
svg .ring { fill: none; stroke: var(--call); stroke-width: calc(3px / var(--k)); }
svg .badge { fill: var(--call); stroke: #fff; stroke-width: 2.5px; }
svg .badge-num { fill: #fff; font: 700 13px Inter, sans-serif; text-anchor: middle; }
figcaption { margin-top: 7pt; }
figcaption .caption { font-size: 9.2pt; color: var(--muted); font-style: italic; margin-bottom: 4pt; }
figure.shot.narrow figcaption { margin-top: 0; }
ol.legend { list-style: none; padding: 0; margin: 0; font-size: 9.2pt; line-height: 1.35; }
ol.legend.two { columns: 2; column-gap: 16pt; }
ol.legend li { display: flex; gap: 6pt; align-items: flex-start; margin: 0 0 4pt; break-inside: avoid; }
ol.legend .num { flex: none; width: 15pt; height: 15pt; border-radius: 50%; background: var(--call); color: #fff; font-weight: 700; font-size: 8pt; line-height: 15pt; text-align: center; margin-top: 0.5pt; }

/* Cover */
.cover { page: cover; height: 11in; position: relative; overflow: hidden; background: linear-gradient(160deg, #7a6cf0 0%, #4f8cff 100%); color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.cover img { width: 2.6in; height: 2.6in; margin-bottom: 0.25in; filter: drop-shadow(0 12px 24px rgba(0,0,0,0.25)); }
.cover h1 { color: #fff; font-size: 40pt; margin: 0; letter-spacing: -0.02em; }
.cover .sub { font-size: 16pt; opacity: 0.92; margin-top: 8pt; }
.cover .meta { position: absolute; bottom: 0.7in; left: 0; right: 0; font-size: 10pt; opacity: 0.85; }

/* Contents */
.toc { break-before: page; }
.toc ol { list-style: none; padding: 0; margin: 12pt 0 0; columns: 1; }
.toc li { display: flex; gap: 10pt; padding: 7pt 0; border-bottom: 1px solid var(--line); font-size: 11pt; }
.toc li .n { color: var(--accent); font-weight: 700; width: 20pt; }
.toc li a { color: var(--ink); text-decoration: none; font-weight: 600; }
.toc li .d { color: var(--muted); font-size: 9.5pt; margin-left: auto; text-align: right; max-width: 55%; }

/* Mouth chart */
.mouths { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; margin: 6pt 0 12pt; }
.mouths div { border: 1px solid var(--line); border-radius: 6px; padding: 6pt 8pt; break-inside: avoid; }
.mouths .hl { font-weight: 700; color: var(--ink); }
.mouths b { display: inline-block; width: 18pt; height: 18pt; border-radius: 4px; color: #111; text-align: center; line-height: 18pt; margin-right: 6pt; }
.mouths span { font-weight: 600; }
.mouths small { display: block; color: var(--muted); font-size: 8.8pt; margin-top: 2pt; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18pt; align-items: start; }
a { color: var(--accent); }
</style>
</head>
<body>
${manualHtml({ figure, icon, version: pkg.version })}
</body>
</html>`;

const htmlPath = join(outDir, 'manual.html');
writeFileSync(htmlPath, html);

// ---- Print with Electron ---------------------------------------------------------------

const app = await electron.launch({ args: [join(root, 'scripts/manual/print-main.cjs'), htmlPath, pdfPath] });
await app.waitForEvent('close', { timeout: 120_000 });
if (!existsSync(pdfPath)) throw new Error('The PDF was not written.');
console.log(`Wrote ${pdfPath}`);
