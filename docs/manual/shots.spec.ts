import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';

// Screenshots for the user manual, taken from the real app. Each picture is
// saved to docs/manual/shots/<name>.jpg, and the places its numbered pink
// callouts point at go into shots.json, so manual.html can draw them.

type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type Mark = Box | Point;

const OUT = join(__dirname, 'shots');
const INDEX = join(OUT, 'shots.json');

let app: ElectronApplication;
let page: Page;
let cdp: import('@playwright/test').CDPSession;
const dir = mkdtempSync(join(tmpdir(), 'nyah-manual-'));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  app = await electron.launch({
    args: ['--force-device-scale-factor=2', '.'],
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, NODE_ENV: 'production', NYAH_LIBRARY_DIR: join(dir, 'library'), NYAH_RECOVERY_DIR: join(dir, 'recovery') },
  });
  page = await app.firstWindow();
  page.on('pageerror', (err) => console.error('Page error:', err.message));
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.setViewportSize({ width: 1400, height: 860 });
  // Pictures at twice the resolution, so they stay sharp in print.
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 2, mobile: false });
  await page.waitForSelector('[data-testid="stage"]');
  await page.evaluate(() => localStorage.clear());
});

test.afterAll(async () => {
  await app?.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync;
  });
  await app?.close();
});

// ---------------------------------------------------------------- helpers

async function menu(command: string) {
  const before = await page.evaluate(() => (window as any).__nyahMenuCount ?? 0);
  await app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', cmd), command);
  await page.waitForFunction((n) => ((window as any).__nyahMenuCount ?? 0) > n, before);
}

async function box(l: Locator): Promise<Box> {
  await expect(l.first()).toBeVisible();
  return (await l.first().boundingBox())!;
}

/** A box around several boxes. */
function around(...boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const b = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: b - y };
}

/** The part of `b` inside `c`. */
function within(b: Box, c: Box): Box {
  const x = Math.max(b.x, c.x);
  const y = Math.max(b.y, c.y);
  return { x, y, width: Math.min(b.x + b.width, c.x + c.width) - x, height: Math.min(b.y + b.height, c.y + c.height) - y };
}

function pad(b: Box, d = 3): Box {
  return { x: b.x - d, y: b.y - d, width: b.width + 2 * d, height: b.height + 2 * d };
}

async function stageBox(): Promise<Box> {
  return box(page.getByTestId('stage'));
}

/** A point on the canvas (canvas px) in page px. */
async function onStage(p: Point | null): Promise<Point> {
  if (!p) throw new Error('No such point');
  const s = await stageBox();
  return { x: s.x + p.x, y: s.y + p.y };
}

async function partPoint(name: string, local = { x: 0, y: 0 }, frame = false): Promise<Point> {
  return onStage(await page.evaluate(([n, l, f]) => ((window as any).__nyah[f ? 'framePartScreen' : 'partScreen'])(n, l), [name, local, frame] as const));
}

async function jointPoint(name: string): Promise<Point> {
  return onStage(await page.evaluate((n) => (window as any).__nyah.jointScreen(n), name));
}

/**
 * Takes a picture of `clip` (page px; the whole window if null), and records
 * where its callouts go: boxes get an outline, points a numbered dot.
 */
async function shot(name: string, clip: Box | null, marks: Mark[] = [], hover?: Point) {
  if (hover) await page.mouse.move(hover.x, hover.y);
  else await page.mouse.move(1399, 859); // no hover highlights
  await page.waitForTimeout(250);
  const area = clip ?? { x: 0, y: 0, width: 1400, height: 860 };
  const r = (v: number) => Math.round(v * 10) / 10;
  const rel = marks.map((m) =>
    'width' in m
      ? { x: r(m.x - area.x), y: r(m.y - area.y), w: r(m.width), h: r(m.height) }
      : { x: r(m.x - area.x), y: r(m.y - area.y) },
  );
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { ...area, scale: 1 } });
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'));
  const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
  index[name] = { w: r(area.width), h: r(area.height), marks: rel };
  writeFileSync(INDEX, JSON.stringify(index, null, 1));
  // The same, as a script manual.html can load from disk.
  writeFileSync(join(OUT, 'shots.js'), `window.SHOTS = ${JSON.stringify(index)};\n`);
}

function state<T>(fn: (s: any) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__nyah.store.getState())`) as Promise<T>;
}

async function setFrame(frame: number) {
  await page.evaluate((f) => (window as any).__nyah.store.set({ frame: f }), frame);
  await expect(page.getByTestId('frame')).toContainText(`${frame + 1} /`);
}

async function openDemo() {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync;
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  await expect(page.locator('.outliner')).toContainText('Pip');
}

async function mode(m: 'Build' | 'Animate') {
  await page.getByRole('tab', { name: m }).click();
}

function outlineRow(name: string) {
  return page.locator('.outliner .outline-row').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
}

function tlRow(name: string) {
  return page.getByTestId('tl-part').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
}

async function select(name: string) {
  await outlineRow(name).first().locator('.name').first().click();
}

const props = () => page.getByTestId('properties');
const toolButton = (name: string) => page.locator('.toolbar').getByRole('button', { name: new RegExp(`^${name}`) });

/** A row of the Properties panel, by its label. */
function propRow(label: string) {
  return props().locator('.row').filter({ has: page.locator('.row-label', { hasText: new RegExp(`^${label}$`) }) });
}

function section(title: string) {
  return props().locator('section.section').filter({ has: page.locator('h3', { hasText: new RegExp(`^${title}`, 'i') }) });
}

// ---------------------------------------------------------------- shots

test('workspace', async () => {
  await openDemo();
  await mode('Build');
  await select('Upper arm (front)');
  await page.evaluate(() => (window as any).__nyah.store.set({ status: 'Opened the demo puppet, Pip.' }));
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => (window as any).__nyah.selectedScreen());
  const joint = await jointPoint('Upper arm (front)');
  await shot('workspace', null, [
    pad(await box(page.locator('.mode-switch'))),
    pad(await box(page.locator('.topbar .file'))),
    pad(await box(page.locator('.topbar .status'))),
    pad(await box(page.locator('.preview-quality'))),
    pad(around(await box(page.getByRole('button', { name: 'Import…' })), await box(page.locator('.topbar').getByRole('button', { name: 'Save' })))),
    pad(await box(page.locator('.toolbar')), 1),
    pad(await box(page.locator('.tool-options')), 1),
    pad(await stageBox(), -4),
    sel ? joint : joint,
    pad(await box(page.locator('.sidebar .tabs'))),
    pad(await box(page.locator('.outliner')), 1),
    pad(await box(props()), 1),
  ]);
});

// Speech-like sound: syllables of voiced buzz with pauses between words, so
// the waveform looks like dialogue.
function speechWav(seconds: number, rate = 24000): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Syllables: [start, length, loudness]
  const syl: [number, number, number][] = [];
  let t = 0.15;
  while (t < seconds - 0.3) {
    const words = 1 + Math.floor(rnd() * 3);
    for (let w = 0; w < words && t < seconds - 0.3; w++) {
      const len = 0.12 + rnd() * 0.16;
      syl.push([t, len, 0.35 + rnd() * 0.6]);
      t += len + 0.02;
    }
    t += 0.12 + rnd() * 0.25;
  }
  for (let i = 0; i < n; i++) {
    const time = i / rate;
    let v = 0;
    for (const [s, len, loud] of syl) {
      if (time < s || time > s + len) continue;
      const env = Math.sin((Math.PI * (time - s)) / len) ** 0.6;
      const f0 = 130 + 25 * Math.sin(time * 3);
      let buzz = 0;
      for (let h = 1; h <= 8; h++) buzz += Math.sin(2 * Math.PI * f0 * h * time) / h;
      v += loud * env * (buzz * 0.45 + (rnd() - 0.5) * 0.25);
    }
    b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 16000))), 44 + i * 2);
  }
  return b;
}

async function drag(from: Point, to: Point, hold?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  if (hold) await hold();
  await page.mouse.up();
}

async function newProject() {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync;
  });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('new');
}

/** Zooms the canvas so a part's origin sits at `target` (canvas px). */
async function focus(name: string, zoom: number, target: Point) {
  await page.evaluate(
    ([n, z, t]) => {
      const nyah = (window as any).__nyah;
      const st = nyah.store.getState();
      const sp = nyah.partScreen(n);
      const scene = { x: (sp.x - st.view.panX) / st.view.zoom, y: (sp.y - st.view.panY) / st.view.zoom };
      nyah.store.set({ view: { zoom: z, panX: t.x - scene.x * z, panY: t.y - scene.y * z } });
    },
    [name, zoom, target] as const,
  );
  await page.waitForTimeout(150);
}

/** The part's path points in page px. */
async function pathPoints(name: string): Promise<Point[]> {
  const local = await page.evaluate((n) => (window as any).__nyah.part(n).paths[0].points.map((p: any) => p.anchor), name);
  const out: Point[] = [];
  for (const p of local) out.push(await partPoint(name, p));
  return out;
}

test('drawing', async () => {
  await newProject();
  await page.evaluate(() => {
    const st = (window as any).__nyah.store;
    st.commit({ ...st.getState().project, swatches: ['#f4c7a1', '#5b8def', '#ffd54f', '#ef6c7a', '#7cb97a', '#3a3f58'] });
  });
  const s = await stageBox();
  await toolButton('Ellipse').click();
  await drag({ x: s.x + 250, y: s.y + 250 }, { x: s.x + 430, y: s.y + 420 });
  await toolButton('Star').click();
  await drag({ x: s.x + 520, y: s.y + 240 }, { x: s.x + 700, y: s.y + 420 });
  // A second colour for the star, from the swatches.
  await props().getByLabel('Swatch #ffd54f').click();
  await toolButton('Rectangle').click();
  await page.getByLabel('Corner radius').fill('16');
  await page.getByLabel('Corner radius').press('Enter');
  await drag({ x: s.x + 790, y: s.y + 270 }, { x: s.x + 1000, y: s.y + 410 });
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => (window as any).__nyah.selectedScreen());
  const shapeTools = around(await box(toolButton('Pen')), await box(toolButton('Line')));
  await shot('drawing', null, [
    pad(shapeTools, 2),
    pad(await box(page.locator('.tool-options label').first())),
    { x: s.x + 1000, y: s.y + 270 },
    pad(await box(page.locator('.outliner .outline-list')), 1),
    pad(await box(section('Fill')), 0),
  ]);
  void sel;
});

test('points', async () => {
  await select('Star 1');
  await toolButton('Points').click();
  await focus('Star 1', 1.1, { x: 520, y: 290 });
  const pts = await pathPoints('Star 1');
  // Select the top point.
  const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
  await page.mouse.click(top.x, top.y);
  const other = pts[3]!;
  const mid = { x: (pts[4]!.x + pts[5]!.x) / 2, y: (pts[4]!.y + pts[5]!.y) / 2 };
  const s = await stageBox();
  const area = { x: 0, y: s.y - 44, width: s.x + 820, height: 560 };
  await shot('points', area, [
    pad(await box(toolButton('Points')), 1),
    top,
    other,
    mid,
    pad(await box(page.locator('.tool-options .hint'))),
  ]);
  await page.keyboard.press('Escape');
});

const center = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('layers', async () => {
  await openDemo();
  await mode('Build');
  for (const name of ['Head', 'Upper arm (back)']) await outlineRow(name).first().getByRole('button', { name: 'Collapse' }).click();
  await select('Hand');
  const hand = outlineRow('Hand').first();
  const handBox = await box(hand);
  const area = pad(await box(page.locator('.outliner')), 0);
  const hoverAt = { x: handBox.x + 40, y: handBox.y + handBox.height / 2 };
  await page.mouse.move(hoverAt.x, hoverAt.y);
  const eye = await box(hand.getByRole('button', { name: 'Hide' }));
  const lock = await box(hand.getByRole('button', { name: 'Lock' }));
  await shot(
    'layers',
    area,
    [
      pad(around(await box(page.getByRole('button', { name: '+ Character' })), await box(page.getByRole('button', { name: '+ Background' }))), 2),
      pad(await box(page.getByTestId('layer-row').filter({ hasText: 'Pip' })), -1),
      pad(await box(hand.locator('.name')), 2),
      pad(eye, 2),
      pad(lock, 2),
      pad(await box(page.getByTestId('layer-row').filter({ hasText: 'Scenery' })), -1),
    ],
    hoverAt,
  );
});

test('joints', async () => {
  await toolButton('Joints').click();
  await select('Forearm (front)');
  const s = await stageBox();
  await focus('Torso', 0.8, { x: s.width / 2 - 60, y: s.height / 2 - 20 });
  const shoulder = await jointPoint('Upper arm (front)');
  const elbow = await jointPoint('Forearm (front)');
  const wrist = await jointPoint('Hand');
  await shot('joints', null, [
    pad(await box(toolButton('Joints')), 1),
    elbow,
    { x: (elbow.x + wrist.x) / 2, y: (elbow.y + wrist.y) / 2 },
    shoulder,
    pad(await box(section('Joint')), 0),
  ]);
});

test('pose', async () => {
  await toolButton('Pose').click();
  await select('Hand');
  const s = await stageBox();
  await focus('Torso', 0.8, { x: 420, y: s.height / 2 - 40 });
  const hand = await partPoint('Hand');
  const to = { x: hand.x + 120, y: hand.y - 170 };
  await drag(hand, to, async () => {
    await page.waitForTimeout(200);
    const elbow = await jointPoint('Forearm (front)');
    const shoulder = await jointPoint('Upper arm (front)');
    await shot('pose', { x: 0, y: 0, width: 1000, height: 860 }, [pad(await box(toolButton('Pose')), 1), to, elbow, shoulder], to);
  });
  await menu('undo');
});

test('library', async () => {
  await page.getByTestId('layer-row').filter({ hasText: 'Scenery' }).click();
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Save to library…' }).click();
  await page.getByLabel('Library item name').fill('Sunny hills');
  await page.getByLabel('Tags').fill('outdoors, day');
  await page.locator('.save-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByTestId('layer-row').filter({ hasText: 'Pip' }).click();
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Save to library…' }).click();
  await page.getByLabel('Library item name').fill('Pip the puppet');
  await page.getByLabel('Tags').fill('kid, demo');
  await page.locator('.save-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(2);
  const pip = page.getByTestId('library-item').filter({ hasText: 'Pip the puppet' });
  const side = await box(page.locator('.sidebar'));
  const list = await box(page.getByTestId('library-list'));
  const area = { x: side.x, y: side.y, width: side.width, height: list.y - side.y + 150 };
  await shot('library', area, [
    pad(await box(page.getByLabel('Search library')), 2),
    pad(around(await box(page.getByRole('button', { name: '↻' })), await box(page.getByRole('button', { name: 'Folder' }))), 2),
    pad(await box(page.locator('.save-row')), 1),
    pad(await box(pip), -1),
    pad(await box(pip.getByRole('button', { name: 'Add' })), 2),
    pad(await box(pip.getByRole('button', { name: /^Delete/ })), 2),
  ]);
  // A layer that came from the library: add Pip again and look at its properties.
  await pip.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByTestId('layer-row').first().click();
  const src = section('Library');
  await src.scrollIntoViewIfNeeded();
  await shot('library-source', pad(await box(src), 0), []);
});

const bar = () => page.locator('.timeline-bar');
const barCheck = (label: string) => bar().locator('label.check').filter({ hasText: label });

test('animate', async () => {
  await openDemo();
  await mode('Animate');
  await menu('zoomFit');
  await setFrame(33);
  await select('Forearm (front)');
  await page.waitForTimeout(200);
  const playhead = await box(page.locator('.tl-playhead'));
  const tl = await box(page.getByTestId('timeline'));
  await shot('animate', null, [
    pad(around(await box(bar().getByRole('button', { name: 'Previous frame' })), await box(page.getByTestId('frame'))), 2),
    pad(around(await box(bar().getByRole('button', { name: 'In' })), await box(bar().getByRole('button', { name: 'Out' }))), 2),
    pad(around(await box(barCheck('Sound while scrubbing')), await box(barCheck('Camera view'))), 2),
    pad(around(await box(bar().getByRole('button', { name: 'Zoom timeline out' })), await box(bar().getByRole('button', { name: 'Export…' }))), 2),
    pad(await box(page.getByTestId('tl-scene').locator('.tl-name')), -1),
    pad(await box(page.getByTestId('tl-camera').locator('.tl-name')), -1),
    pad(await box(page.getByTestId('tl-layer').filter({ hasText: 'Pip' }).locator('.tl-name')), -1),
    pad(around(await box(tlRow('Leg (left)').locator('.tl-name')), await box(tlRow('Torso').locator('.tl-name'))), -1),
    pad(await box(tlRow('Torso').locator('.tl-mark').nth(1)), 3),
    { x: playhead.x + playhead.width / 2, y: tl.y + tl.height - 20 },
    pad(await box(props()), 1),
    pad(await box(page.locator('.toolbar')), 1),
  ]);
});

test('timing', async () => {
  await setFrame(22);
  const mark = tlRow('Forearm (front)').locator('.tl-mark[data-frame="22"]');
  await mark.click();
  await page.waitForTimeout(150);
  const tb = await box(page.locator('.timeline'));
  const easing = props().getByLabel('Pose easing');
  await easing.scrollIntoViewIfNeeded();
  const top = Math.min(tb.y - 110, (await box(easing)).y - 16);
  const area = { x: 0, y: top, width: 1400, height: 860 - top };
  await shot('timing', area, [
    pad(await box(mark), 3),
    pad(await box(tlRow('Forearm (front)').locator('.tl-mark[data-frame="30"]')), 3),
    pad(await box(easing), 2),
    pad(await box(props().getByRole('button', { name: 'Delete pose' })), 2),
  ]);
});

test('curve', async () => {
  await props().getByLabel('Pose easing').selectOption({ label: 'Custom curve…' });
  const editor = page.getByTestId('curve-editor');
  await expect(editor).toBeVisible();
  // A little overshoot, so the curve is interesting.
  const presets = editor.getByRole('button', { name: 'Overshoot' });
  if (await presets.count()) await presets.click();
  await editor.scrollIntoViewIfNeeded();
  const eb = await box(editor);
  await shot('curve', pad(eb, 8), [
    center(await box(page.getByTestId('curve-handle-1'))),
    center(await box(page.getByTestId('curve-handle-2'))),
    pad(around(await box(editor.getByRole('button', { name: 'Gentle' })), await box(editor.getByRole('button', { name: 'Anticipate' }))), 2),
    pad(around(await box(editor.getByLabel('Curve handle 1 time')), await box(editor.getByLabel('Curve handle 2 amount'))), 2),
  ]);
  await menu('undo');
});

test('onion', async () => {
  await page.keyboard.press('Escape');
  await barCheck('Onion skin').locator('input').check();
  const s = await stageBox();
  await setFrame(10);
  const earlier = await partPoint('Hand', { x: 0, y: 10 }, true);
  await setFrame(14);
  const later = await partPoint('Hand', { x: 0, y: 10 }, true);
  await setFrame(12);
  const b = await box(bar());
  const area = { x: s.x + s.width / 2 - 420, y: b.y + b.height - 600, width: 840, height: 600 };
  await shot('onion', area, [pad(await box(barCheck('Onion skin')), 2), earlier, later]);
  await barCheck('Onion skin').locator('input').uncheck();
});

test('pins', async () => {
  await setFrame(5);
  await toolButton('Pin').click();
  const foot = await partPoint('Leg (left)', { x: 0, y: 190 }, true);
  await page.mouse.click(foot.x, foot.y);
  await expect(page.getByText(/Pinned “Leg \(left\)”/)).toBeVisible();
  await setFrame(20);
  const pinned = await partPoint('Leg (left)', { x: 0, y: 190 }, true);
  await select('Leg (left)');
  await tlRow('Leg (left)').scrollIntoViewIfNeeded();
  await shot('pins', null, [
    pad(await box(toolButton('Pin')), 1),
    pinned,
    within(pad(await box(tlRow('Leg (left)').locator('.tl-pin')), 2), await box(page.getByTestId('timeline'))),
    pad(await box(page.locator('.topbar .status')), 2),
  ]);
});

// ---------------------------------------------------------------- camera and backgrounds

async function cameraFrame(): Promise<Box> {
  const corners = await page.evaluate(() => {
    const n = (window as any).__nyah;
    const cam = n.camera();
    const sc = n.store.getState().project.scene;
    const w = sc.width / cam.zoom;
    const h = sc.height / cam.zoom;
    return [n.stageScreen({ x: cam.x - w / 2, y: cam.y - h / 2 }), n.stageScreen({ x: cam.x + w / 2, y: cam.y + h / 2 })];
  });
  const a = await onStage(corners[0]);
  const b = await onStage(corners[1]);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

test('camera', async () => {
  await openDemo();
  await mode('Animate');
  await menu('zoomFit');
  await toolButton('Camera').click();
  await setFrame(35);
  const zoom = page.getByLabel('Camera zoom');
  await zoom.fill('170');
  await zoom.press('Enter');
  const head = await page.evaluate(() => (window as any).__nyah.part('Pip').rest);
  const cx = page.getByLabel('Camera X');
  await cx.fill(String(Math.round(head.x + 60)));
  await cx.press('Enter');
  const cy = page.getByLabel('Camera Y');
  await cy.fill(String(Math.round(head.y - 230)));
  await cy.press('Enter');
  await barCheck('Camera view').locator('input').uncheck();
  await menu('zoomFit');
  await page.waitForTimeout(200);
  await shot('camera', null, [
    pad(await box(toolButton('Camera')), 1),
    pad(await cameraFrame(), 4),
    within(pad(await box(page.getByTestId('tl-camera')), -1), await box(page.getByTestId('timeline'))),
    pad(await box(barCheck('Camera view')), 2),
    pad(await box(section('Camera')), 0),
  ]);
  await barCheck('Camera view').locator('input').check();
  await page.waitForTimeout(200);
  await shot('camera-view', await stageBox(), []);
});

test('layer camera', async () => {
  await mode('Build');
  await menu('newBackgroundLayer');
  await page.getByTestId('layer-row').filter({ has: page.locator('.name', { hasText: /^Background$/ }) }).first().click();
  const name = props().getByLabel('Layer name');
  await name.fill('Speech bubble');
  await name.press('Enter');
  const s = await stageBox();
  const headTop = await partPoint('Head', { x: 0, y: -120 });
  await toolButton('Rectangle').click();
  await drag({ x: headTop.x + 40, y: headTop.y - 70 }, { x: headTop.x + 200, y: headTop.y - 10 });
  await page.getByTestId('layer-row').filter({ hasText: 'Speech bubble' }).click();
  const sec = section('Camera and scrolling');
  await sec.scrollIntoViewIfNeeded();
  void s;
  await shot('layer-camera', pad(await box(sec), 0), [
    pad(await box(propRow('Fixed')), 0),
    pad(await box(propRow('Depth')), 0),
    pad(await box(propRow('Scroll')), 0),
    pad(await box(propRow('Repeat')), 0),
  ]);
  await props().getByLabel('Fixed to camera').check();
  await props().getByLabel('Follows part').selectOption({ label: 'Head' });
  await sec.scrollIntoViewIfNeeded();
  await shot('layer-follow', pad(await box(sec), 0), [pad(await box(propRow('Fixed')), 0), pad(await box(propRow('Follows')), 0)]);
});

test('gradient', async () => {
  await openDemo();
  await mode('Build');
  await menu('zoomFit');
  await toolButton('Select').click();
  await select('Sun');
  const fillType = props().getByLabel('Fill type');
  await fillType.selectOption({ label: 'Gradient (round)' });
  await page.evaluate(() => {
    const n = (window as any).__nyah;
    const st = n.store.getState();
    const sun = n.part('Sun');
    const style = sun.style;
    const fillGradient = { ...style.fillGradient, stops: [{ offset: 0, color: '#fff6c2' }, { offset: 1, color: '#ff9f1c' }] };
    const walk = (p: any): any => (p.id === sun.id ? { ...p, style: { ...style, fill: '#fff6c2', fillGradient } } : { ...p, children: p.children.map(walk) });
    const layers = st.project.scene.layers.map((l: any) => ({ ...l, root: walk(l.root) }));
    n.store.commit({ ...st.project, scene: { ...st.project.scene, layers } });
  });
  await fillType.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const sun = await partPoint('Sun', { x: 1560, y: 220 });
  await shot('gradient', null, [
    { x: sun.x, y: sun.y },
    pad(await box(propRow('Fill type')), 0),
    pad(around(await box(props().getByLabel('Gradient start colour')), await box(props().getByLabel('Gradient end colour'))), 3),
  ]);
});

test('sky', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const sky = props().getByLabel('Sky gradient');
  await sky.check();
  await sky.scrollIntoViewIfNeeded();
  const sec = section('Scene');
  await shot('sky', pad(await box(sec), 0), [pad(await box(propRow('Sky')), 0)]);
});

test('effects', async () => {
  await openDemo();
  await mode('Build');
  await menu('zoomFit');
  await toolButton('Select').click();
  await page.getByTestId('layer-row').filter({ hasText: 'Pip' }).click();
  const add = props().getByLabel('Add effect');
  await add.selectOption('shadow');
  await add.selectOption('contact');
  await page.waitForTimeout(300);
  const sec = section('Layer effects');
  await sec.scrollIntoViewIfNeeded();
  const head = await page.evaluate(() => {
    const pts = (window as any).__nyah.part('Head').paths[0].points.map((p: any) => p.anchor);
    const xs = pts.map((p: any) => p.x);
    const ys = pts.map((p: any) => p.y);
    return { x: Math.max(...xs), y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });
  const shadow = await partPoint('Head', { x: head.x + 6, y: head.y + 22 });
  const pip = await page.evaluate(() => (window as any).__nyah.part('Pip').rest);
  const contact = await onStage(await page.evaluate((x) => (window as any).__nyah.stageScreen({ x, y: 912 }), pip.x as number));
  const shadowBlock = props().getByTestId('effect-shadow');
  await shot('effects', null, [
    shadow,
    contact,
    pad(await box(propRow('Blend')), 0),
    pad(await box(shadowBlock), 1),
    pad(await box(props().getByTestId('effect-contact')), 1),
    pad(await box(propRow('Add')), 0),
    pad(await box(shadowBlock.getByRole('button').first()), 2),
  ]);
});

test('cycle', async () => {
  await mode('Animate');
  await setFrame(0);
  await page.getByTestId('layer-row').filter({ hasText: 'Pip' }).click();
  await props().getByLabel('Repeat as a cycle').check();
  const from = props().getByLabel('Cycle from frame');
  await from.fill('1');
  await from.press('Enter');
  const to = props().getByLabel('Cycle to frame');
  await to.fill('24');
  await to.press('Enter');
  await setFrame(12);
  await page.waitForTimeout(200);
  const tb = await box(page.locator('.timeline'));
  const cycleRow = propRow('Cycle');
  await cycleRow.scrollIntoViewIfNeeded();
  const top = Math.min(tb.y - 20, (await box(propRow('Animate on'))).y - 20);
  const area = { x: 0, y: top, width: 1400, height: 860 - top };
  const tl = await box(page.getByTestId('timeline'));
  await shot('cycle', area, [
    pad(await box(propRow('Animate on')), 0),
    pad(await box(cycleRow), 0),
    pad(around(await box(propRow('From')), await box(propRow('To'))), 0),
    pad(await box(propRow('Moves')), 0),
    within(pad(await box(page.locator('.tl-cycle-range').first()), 1), tl),
    within(pad(await box(page.getByTestId('tl-cycle').first()), 1), tl),
  ]);
});

// ---------------------------------------------------------------- sound, lip sync, export

test('sound', async () => {
  await openDemo();
  await mode('Animate');
  await menu('zoomFit');
  const wav = join(dir, 'hello.wav');
  writeFileSync(wav, speechWav(2.4));
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, wav);
  await setFrame(2);
  await menu('import');
  const clip = page.getByTestId('audio-clip');
  await expect(clip).toHaveCount(1);
  await clip.click();
  await page.waitForTimeout(200);
  await shot('sound', null, [
    pad(await box(page.getByRole('button', { name: 'Import…' })), 2),
    within(pad(await box(clip), 1), await box(page.getByTestId('timeline'))),
    pad(await box(barCheck('Sound while scrubbing')), 2),
    pad(await box(section('Sound')), 0),
  ]);
});

test('mouths', async () => {
  await mode('Build');
  await select('Mouth');
  const sec = section('Drawings');
  await sec.scrollIntoViewIfNeeded();
  const list = page.getByTestId('drawing-list');
  const rows = list.locator('.drawing-row');
  const r = rows.nth(1);
  const area = await box(page.locator('.properties-body'));
  await shot('mouths', area, [
    pad(await box(propRow('Drawing set')), 0),
    pad(await box(propRow('Used for')), 0),
    pad(await box(r.locator('button').first()), 1),
    pad(await box(r.locator('input')), 1),
    pad(await box(r.locator('.name')), 1),
    pad(await box(r.locator('button').last()), 1),
  ]);
});

test('lipsync', async () => {
  await mode('Animate');
  await tlRow('Mouth').scrollIntoViewIfNeeded();
  await tlRow('Mouth').locator('.tl-name').click();
  await expect(page.getByTestId('drawing-palette')).toBeVisible();
  await setFrame(4);
  for (const k of ['c', 'e', 'b', 'd', 'a', 'x']) await page.keyboard.press(k);
  await setFrame(8);
  // A taller timeline, so the dialogue and the Mouth row show together.
  const grip = await box(page.locator('.timeline-resize'));
  await drag(center(grip), { x: grip.x + grip.width / 2, y: grip.y - 170 });
  await page.getByTestId('timeline').evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(150);
  const palette = page.getByTestId('drawing-palette');
  const tl = await box(page.getByTestId('timeline'));
  const mouth = await partPoint('Mouth', { x: 0, y: 0 }, true);
  await shot('lipsync', null, [
    pad(await box(palette), 0),
    pad(await box(palette.locator('button').nth(2)), 1),
    pad(await box(palette.getByLabel('Frames per key')), 2),
    pad(await box(palette.getByRole('button', { name: 'Auto lip sync…' })), 2),
    within(pad(await box(tlRow('Mouth').locator('.tl-lane')), 0), tl),
    within(pad(await box(page.getByTestId('tl-audio')), 0), tl),
    mouth,
  ]);
});

test('auto lip sync', async () => {
  await page.getByTestId('drawing-palette').getByRole('button', { name: 'Auto lip sync…' }).click();
  const dlg = page.getByTestId('lipsync-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Dialogue words').fill("Hello! I'm Pip. Nice to meet you.");
  await shot('autolipsync', pad(await box(dlg), 6), [
    pad(await box(dlg.getByLabel('Dialogue sound')), 2),
    pad(await box(dlg.getByLabel('Dialogue language')), 2),
    pad(await box(dlg.getByLabel('Dialogue words')), 2),
    pad(await box(dlg.getByRole('button', { name: 'Start' })), 2),
  ]);
  await dlg.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Escape');
});

test('export', async () => {
  await menu('export');
  const dlg = page.getByRole('dialog', { name: 'Export video' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Export format').selectOption('mov');
  const see = dlg.getByRole('checkbox');
  await shot('export', pad(await box(dlg), 6), [
    pad(await box(dlg.getByLabel('Export format')), 2),
    pad(await box(dlg.getByLabel('Export size')), 2),
    pad(await box(dlg.getByLabel('Export range')), 2),
    pad(await box(see.locator('xpath=..')), 2),
    pad(await box(dlg.getByTestId('export-sound')), 2),
    pad(await box(dlg.getByRole('button', { name: /^Export/ })), 2),
  ]);
  await dlg.getByRole('button', { name: 'Close' }).click();
});

// ---------------------------------------------------------------- recovery (last: it reloads the page)

test('recovery', async () => {
  await openDemo();
  const saved = join(dir, 'My cartoon.nyah');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, saved);
  await menu('saveAs');
  await expect.poll(() => existsSync(saved)).toBe(true);
  await newProject();
  const recovery = join(dir, 'recovery');
  mkdirSync(recovery, { recursive: true });
  const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
  writeFileSync(join(recovery, `${id}.nyah`), readFileSync(saved));
  writeFileSync(join(recovery, `${id}.json`), JSON.stringify({ name: 'My cartoon.nyah', path: saved, savedAt: Date.now() - 3 * 60_000 }));
  await page.reload();
  await page.waitForSelector('[data-testid="stage"]');
  const prompt = page.getByTestId('recovery');
  await expect(prompt).toContainText('My cartoon.nyah');
  await shot('recovery', pad(await box(prompt.locator('.modal').or(prompt).first()), 6), []);
  await prompt.getByRole('button', { name: 'Delete' }).click();
});
