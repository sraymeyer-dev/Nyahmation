// Prints docs/manual/manual.html to docs/manual/Nyahmation-User-Manual.pdf.
// `npm run manual` takes fresh screenshots first; run this on its own to
// reprint after editing the text.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = join(root, 'docs', 'manual', 'manual.html');
const pdf = join(root, 'docs', 'manual', 'Nyahmation-User-Manual.pdf');

// Playwright's own browser if it's installed, otherwise a preinstalled Chromium.
const fallback = '/opt/pw-browsers/chromium';
let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  if (!existsSync(fallback)) throw err;
  browser = await chromium.launch({ executablePath: fallback });
}

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const problems = await page.evaluate(() => window.MANUAL_PROBLEMS ?? ['The page script did not run.']);
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  const all = [...problems, ...errors, ...broken.map((s) => `Missing picture ${s}`)];
  if (all.length) {
    console.error(all.join('\n'));
    process.exitCode = 1;
  }
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
  console.log(`Wrote ${pdf}`);
} finally {
  await browser.close();
}
