import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Drives the real app. Run `npm run test:e2e` (it builds first).

let app: ElectronApplication;
let page: Page;
const dir = mkdtempSync(join(tmpdir(), 'nyah-'));

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], env: { ...process.env, NODE_ENV: 'production', NYAH_LIBRARY_DIR: join(dir, 'library'), NYAH_RECOVERY_DIR: join(dir, 'recovery') } });
  page = await app.firstWindow();
  page.on('pageerror', (err) => console.error('Page error:', err.message));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.waitForSelector('[data-testid="stage"]');
});

test.afterAll(async () => {
  // Answer "Discard Changes" to the unsaved-changes prompt.
  await app?.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync;
  });
  await app?.close();
});

type Snapshot = { names: string[]; selection: string[]; dirty: boolean; tool: string; points: number };
/** Reads editor state through the debug handle. */
async function state(): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = (window as any).__nyah.store.getState();
    const names: string[] = [];
    const walk = (p: any) => {
      names.push(p.name);
      p.children.forEach(walk);
    };
    s.project.scene.layers.forEach((l: any) => walk(l.root));
    return { names, selection: s.selection, dirty: s.dirty, tool: s.tool, points: s.points.length };
  });
}

async function pathPointCount(name: string): Promise<number> {
  return page.evaluate((n) => {
    const s = (window as any).__nyah.store.getState();
    let found: any;
    const walk = (p: any) => {
      if (p.name === n) found = p;
      p.children.forEach(walk);
    };
    s.project.scene.layers.forEach((l: any) => walk(l.root));
    return found.paths[0].points.length;
  }, name);
}

async function menu(command: string) {
  await app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', cmd), command);
}

/** Canvas-relative mouse helpers. */
async function canvasBox() {
  return (await page.getByTestId('stage').boundingBox())!;
}
async function drag(from: [number, number], to: [number, number]) {
  const b = await canvasBox();
  await page.mouse.move(b.x + from[0], b.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + (from[0] + to[0]) / 2, b.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 4 });
  await page.mouse.up();
}
async function click(at: [number, number], options: { clickCount?: number } = {}) {
  const b = await canvasBox();
  await page.mouse.click(b.x + at[0], b.y + at[1], options);
}

test('starts with an empty scene and one background layer', async () => {
  expect(await page.title()).toBe('Nyahmation');
  expect(await page.evaluate(() => typeof window.nyah?.importFile)).toBe('function');
  await expect(page.getByTestId('layer-row')).toHaveCount(1);
  await expect(page.getByTestId('layer-row')).toContainText('Background');
});

test('draws a rectangle, then undo and redo it', async () => {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await drag([300, 200], [460, 320]);
  let s = await state();
  expect(s.names).toContain('Rectangle 1');
  expect(s.selection).toHaveLength(1);
  await expect(page.getByTestId('properties')).toContainText('Fill & stroke');

  // Cmd/Ctrl shortcuts are native menu accelerators, which synthetic key
  // presses don't reach, so trigger the menu items directly.
  await menu('undo');
  await expect.poll(async () => (await state()).names).not.toContain('Rectangle 1');
  await menu('redo');
  await expect.poll(async () => (await state()).names).toContain('Rectangle 1');
  expect((await state()).dirty).toBe(true);
});

test('draws an ellipse and a closed pen shape', async () => {
  await page.keyboard.press('l');
  await drag([520, 200], [640, 300]);
  await page.keyboard.press('p');
  await click([300, 420]);
  await click([420, 420]);
  await click([360, 520]);
  await click([300, 420]); // back on the first point closes it
  const s = await state();
  expect(s.names).toEqual(expect.arrayContaining(['Ellipse 1', 'Path 1']));
  expect(await pathPointCount('Path 1')).toBe(3);
});

test('selects and moves a shape, and edits points', async () => {
  await page.keyboard.press('v');
  await click([380, 260]); // inside the rectangle
  let s = await state();
  expect(s.selection).toHaveLength(1);
  await expect(page.getByLabel('Part name')).toHaveValue('Rectangle 1');
  const before = await page.getByLabel('X', { exact: true }).inputValue();
  await drag([380, 260], [420, 260]);
  const after = await page.getByLabel('X', { exact: true }).inputValue();
  expect(Number(after)).toBeGreaterThan(Number(before));

  // Points tool: double-click the top edge to add a point.
  await page.keyboard.press('a');
  await click([420, 200], { clickCount: 2 });
  expect(await pathPointCount('Rectangle 1')).toBe(5);
  s = await state();
  expect(s.points).toBe(1);
  await page.keyboard.press('Delete');
  expect(await pathPointCount('Rectangle 1')).toBe(4);
});

test('groups shapes and adds layers', async () => {
  await page.keyboard.press('v');
  await menu('selectAll');
  await expect.poll(async () => (await state()).selection.length).toBe(3);
  await menu('group');
  await expect.poll(async () => (await state()).names).toContain('Group 1');
  let s = await state();
  await page.getByRole('button', { name: '+ Character' }).click();
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  // The new layer is on top, so it's listed first.
  await expect(page.getByTestId('layer-row').first()).toContainText('Character');
  s = await state();
  expect(s.names[0]).toBe('Background');
});

test('imports an SVG with its layers, and reports what it skipped', async () => {
  const svgPath = join(dir, 'pip.svg');
  writeFileSync(
    svgPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
      <g id="Head"><circle id="Face" cx="150" cy="120" r="80" fill="#f2c9a0" stroke="#3b2a20" stroke-width="6"/>
      <path id="Smile" d="M110 140 Q150 180 190 140" fill="none" stroke="#3b2a20" stroke-width="6"/></g>
      <text x="0" y="290">Pip</text>
    </svg>`,
  );
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, svgPath);
  await page.getByRole('button', { name: 'Import…' }).click();
  await expect(page.getByTestId('notice')).toContainText('Text was skipped');
  const s = await state();
  expect(s.names).toEqual(expect.arrayContaining(['pip', 'Head', 'Face', 'Smile']));
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.screenshot({ path: 'test-results/editor.png' });
});

test('imports a PNG as an image part', async () => {
  const pngPath = join(dir, 'dot.png');
  // A 1×1 PNG.
  writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, pngPath);
  await menu('import');
  await expect.poll(async () => (await state()).names).toContain('dot');
  await expect(page.getByTestId('properties')).toContainText('1 × 1 pixels');
});

test('will not draw on a locked layer', async () => {
  await page.keyboard.press('Escape');
  const layer = page.getByTestId('layer-row').first();
  await layer.click();
  await layer.getByRole('button', { name: 'Lock' }).click();
  const count = (await state()).names.length;
  await page.keyboard.press('m');
  await drag([700, 500], [760, 560]);
  expect((await state()).names.length).toBe(count);
  await expect(page.getByText(/is locked/)).toBeVisible();
  await layer.getByRole('button', { name: 'Unlock' }).click();
});

test('saves and reopens a project', async () => {
  const path = join(dir, 'Drawing.nyah');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
  }, path);
  const before = (await state()).names;
  await menu('saveAs');
  await expect(page.getByText('Saved Drawing.nyah')).toBeVisible();
  expect((await state()).dirty).toBe(false);
  await menu('open');
  await expect(page.getByText('Opened Drawing.nyah')).toBeVisible();
  expect((await state()).names).toEqual(before);
});

test('the demo plays in Animate mode, on ones and on twos', async () => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await expect(page.getByTestId('frame')).toHaveText('1 / 72');
  const signature = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]!) | 0;
      return h;
    });
  const nextFrame = async () => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
  };
  for (let i = 0; i < 14; i++) await nextFrame();
  await expect(page.getByTestId('frame')).toHaveText('15 / 72');
  await page.screenshot({ path: 'test-results/animate.png' });

  // On twos: frame 22 is a pose, 23 repeats it, 24 moves on.
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Animate on').selectOption('2');
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 22; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('frame')).toHaveText('23 / 72');
  await page.waitForTimeout(50);
  const pose = await signature();
  await nextFrame();
  expect(await signature()).toBe(pose);
  await nextFrame();
  expect(await signature()).not.toBe(pose);

  // View on ones (preview only): the in-between on frame 24 is shown after all.
  await page.keyboard.press('ArrowLeft');
  await page.getByLabel('View on ones').check();
  await page.waitForTimeout(50);
  expect(await signature()).not.toBe(pose);
  await page.getByLabel('View on ones').uncheck();
  await page.waitForTimeout(50);
  expect(await signature()).toBe(pose);
});

type Pt = { x: number; y: number };
const debug = <T,>(fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__nyah[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;

test('the Pose tool bends the arm to follow a dragged hand', async () => {
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('k');
  const torsoBefore = await debug<{ rest: object }>('part', 'Torso');
  const hand = (await debug<Pt>('partScreen', 'Hand', { x: 0, y: 18 }))!;
  const target = { x: hand.x + 60, y: hand.y - 90 };
  await drag([hand.x, hand.y], [target.x, target.y]);
  const reached = (await debug<Pt>('partScreen', 'Hand', { x: 0, y: 18 }))!;
  expect(Math.hypot(reached.x - target.x, reached.y - target.y)).toBeLessThan(1.5);
  // The torso is above the shoulder's chain root, so it didn't move.
  expect((await debug<{ rest: object }>('part', 'Torso')).rest).toEqual(torsoBefore.rest);
  expect((await debug<{ rest: { rotation: number } }>('part', 'Forearm (front)')).rest.rotation).not.toBe(0);
  await page.screenshot({ path: 'test-results/pose.png' });
});

test('the Joints tool moves a joint without moving the artwork', async () => {
  await page.keyboard.press('j');
  const neck = (await debug<Pt>('jointScreen', 'Head'))!;
  const headCentre = (await debug<Pt>('partScreen', 'Head', { x: 0, y: -95 }))!;
  await drag([neck.x, neck.y], [neck.x, neck.y - 30]);
  const movedNeck = (await debug<Pt>('jointScreen', 'Head'))!;
  expect(movedNeck.y).toBeLessThan(neck.y - 20);
  const centreAfter = (await debug<Pt>('partScreen', 'Head', { x: 0, y: -95 }))!;
  expect(centreAfter.x).toBeCloseTo(headCentre.x, 1);
  expect(centreAfter.y).toBeCloseTo(headCentre.y, 1);
  await expect(page.getByLabel('Chain root')).toBeChecked();
});

test('saves a character to the library and adds a copy', async () => {
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByTestId('layer-row').filter({ hasText: 'Pip' }).click();
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Save to library…' }).click();
  await page.getByLabel('Library item name').fill('Pip the puppet');
  await page.getByLabel('Tags').fill('kid, demo');
  await page.locator('.save-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(1);
  await expect(page.getByTestId('library-item')).toContainText('Pip the puppet');
  await expect(page.getByTestId('library-item')).toContainText('Character · kid, demo');
  expect(existsSync(join(dir, 'library', 'Pip the puppet.nyahitem'))).toBe(true);

  await page.getByTestId('library-item').getByRole('button', { name: 'Add' }).click();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(page.getByTestId('layer-row')).toHaveCount(3);
  await expect(page.getByTestId('layer-row').first()).toContainText('Pip the puppet');
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.screenshot({ path: 'test-results/library.png' });
});

// ---- Phase 3: animating ------------------------------------------------------

const trackFrames = (part: string, channel = 'rotation') =>
  page.evaluate(
    ([name, ch]) => {
      const n = (window as any).__nyah;
      const id = n.part(name).id;
      const t = n.store.getState().project.scene.tracks.find((x: any) => x.partId === id && x.channel === ch);
      return t ? t.poses.map((p: any) => p.frame) : [];
    },
    [part, channel],
  );

async function goToFrame(f: number) {
  await page.keyboard.press('Home');
  for (let i = 0; i < f; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('frame')).toContainText(`${f + 1} /`);
}

function row(name: string) {
  return page.getByTestId('tl-part').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
}

async function dragMark(rowName: string, frame: number, frames: number, modifier?: 'Shift' | 'Control') {
  const mark = row(rowName).locator(`.tl-mark[data-frame="${frame}"]`);
  await mark.scrollIntoViewIfNeeded();
  const box = (await mark.boundingBox())!;
  const zoom = await page.evaluate(() => (window as any).__nyah.store.getState().timeline.zoom);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (frames * zoom) / 2, y, { steps: 3 });
  await page.mouse.move(x + frames * zoom, y, { steps: 3 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test('posing on a frame in Animate mode records poses and shows marks', async () => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.keyboard.press('k');
  await goToFrame(33);
  // Drag the hand as drawn on this frame.
  const at = await debug<Pt>('framePartScreen', 'Hand', { x: 0, y: 18 });
  await drag([at.x, at.y], [at.x - 80, at.y + 60]);
  expect(await trackFrames('Forearm (front)')).toContain(33);
  await expect(row('Forearm (front)').locator('.tl-mark[data-frame="33"]')).toHaveCount(1);
  // Frames before 33 are unchanged: frame 30 keeps its pose.
  expect(await trackFrames('Forearm (front)')).toContain(30);
  await page.screenshot({ path: 'test-results/timeline.png' });
});

test('dragging a pose mark retimes it; Shift-drag ripples everything after it', async () => {
  expect(await trackFrames('Upper arm (front)')).toEqual([0, 14, 22, 30, 33, 38, 46, 62]);
  await dragMark('Upper arm (front)', 14, -4);
  expect(await trackFrames('Upper arm (front)')).toEqual([0, 10, 22, 30, 33, 38, 46, 62]);
  // Ripple: pull 22 back to 20 and everything after moves 2 frames earlier.
  await dragMark('Upper arm (front)', 22, -2, 'Shift');
  expect(await trackFrames('Upper arm (front)')).toEqual([0, 10, 20, 28, 31, 36, 44, 60]);
  // Other parts are not affected by a part row.
  expect(await trackFrames('Forearm (front)')).toEqual([0, 14, 22, 30, 33, 38, 46, 62]);
});

test('Ctrl-drag copies a pose (a hold), and Delete removes selected poses', async () => {
  await dragMark('Upper arm (front)', 10, 4, 'Control');
  expect(await trackFrames('Upper arm (front)')).toEqual([0, 10, 14, 20, 28, 31, 36, 44, 60]);
  await row('Upper arm (front)').locator('.tl-mark[data-frame="14"]').scrollIntoViewIfNeeded();
  await row('Upper arm (front)').locator('.tl-mark[data-frame="14"]').click();
  await page.keyboard.press('Delete');
  expect(await trackFrames('Upper arm (front)')).toEqual([0, 10, 20, 28, 31, 36, 44, 60]);
  await menu('undo');
  await expect.poll(() => trackFrames('Upper arm (front)')).toEqual([0, 10, 14, 20, 28, 31, 36, 44, 60]);
});

test('the layer row moves every part, but leaves lip sync alone', async () => {
  const mouthBefore = await trackFrames('Mouth', 'drawing');
  const layerRow = page.getByTestId('tl-layer').filter({ hasText: 'Pip' });
  const mark = layerRow.locator('.tl-mark[data-frame="62"]');
  await mark.scrollIntoViewIfNeeded();
  const box = (await mark.boundingBox())!;
  const zoom = await page.evaluate(() => (window as any).__nyah.store.getState().timeline.zoom);
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 5 + 3 * zoom, box.y + 5, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await trackFrames('Forearm (front)')).toContain(65);
  expect(await trackFrames('Mouth', 'drawing')).toEqual(mouthBefore);
});

test('the Pin tool pins a part, shown as a bar on the timeline', async () => {
  await goToFrame(5);
  await page.keyboard.press('p');
  await menu('zoomFit');
  const foot = await debug<Pt>('framePartScreen', 'Leg (left)', { x: 0, y: 190 });
  await click([foot.x, foot.y]);
  await expect(page.getByText(/Pinned “Leg \(left\)”/)).toBeVisible();
  await expect(row('Leg (left)').locator('.tl-pin')).toHaveCount(1);
  expect(await trackFrames('Leg (left)', 'pin')).toEqual([5]);
});

/** A 16-bit mono WAV: a 440 Hz tone. */
function toneWav(seconds: number, rate = 48000): Buffer {
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
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  return b;
}

async function drawingPoses(name: string): Promise<[number, string][]> {
  return page.evaluate((n) => {
    const s = (window as any).__nyah.store.getState();
    const part = (window as any).__nyah.part(n);
    const track = s.project.scene.tracks.find((t: any) => t.partId === part.id && t.channel === 'drawing');
    return track ? track.poses.map((p: any) => [p.frame, p.value]) : [];
  }, name);
}

test('imports a sound onto the Sound row, with a waveform, and moves it', async () => {
  const wavPath = join(dir, 'line.wav');
  writeFileSync(wavPath, toneWav(1.5));
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, wavPath);
  await goToFrame(3);
  await menu('import');
  const clip = page.getByTestId('audio-clip');
  await expect(clip).toHaveCount(1);
  await expect(page.getByTestId('properties')).toContainText('Sound');
  const audio = () => page.evaluate(() => (window as any).__nyah.store.getState().project.scene.audio);
  expect((await audio())[0]).toMatchObject({ name: 'line', startFrame: 3 });
  expect((await audio())[0].duration).toBeCloseTo(1.5, 2);
  // Drag it two frames earlier.
  const box = (await clip.boundingBox())!;
  const zoom = await page.evaluate(() => (window as any).__nyah.store.getState().timeline.zoom);
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 - zoom, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(box.x + 20 - 2 * zoom, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  expect((await audio())[0].startFrame).toBe(1);
  await page.screenshot({ path: 'test-results/sound.png' });
});

test('lip sync: typing mouth letters on the Mouth row sets shapes and moves on', async () => {
  await row('Mouth').locator('.tl-name').click();
  await expect(page.getByTestId('drawing-palette')).toBeVisible();
  await expect(page.getByTestId('drawing-list')).toBeVisible();
  await goToFrame(50);
  await page.keyboard.press('c');
  await page.keyboard.press('d');
  await page.keyboard.press('a');
  await expect(page.getByTestId('frame')).toContainText('54 /');
  let poses = await drawingPoses('Mouth');
  expect(poses).toEqual(expect.arrayContaining([[50, 'C'], [51, 'D'], [52, 'A']]));
  // Backspace steps back and clears that entry: D holds instead.
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('frame')).toContainText('53 /');
  poses = await drawingPoses('Mouth');
  expect(poses.some(([f]) => f === 52)).toBe(false);
  expect(poses).toEqual(expect.arrayContaining([[50, 'C'], [51, 'D']]));
  await expect(row('Mouth').locator('.tl-block.key-C')).not.toHaveCount(0);
  // Numbers pick drawings in order too: 1 is the first (X, rest).
  await page.keyboard.press('1');
  expect(await drawingPoses('Mouth')).toEqual(expect.arrayContaining([[52, 'X']]));
  await page.screenshot({ path: 'test-results/lipsync.png' });
  await page.keyboard.press('Escape');
});

test('exports a PNG sequence and an MP4 of the loop range', async () => {
  await goToFrame(0);
  await page.keyboard.press('i');
  await goToFrame(11);
  await page.keyboard.press('o');
  const pngDir = join(dir, 'frames');
  const mp4 = join(dir, 'clip.mp4');
  await app.evaluate(({ dialog }, [folder, file]) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, [pngDir, mp4]);

  await menu('export');
  const dialogBox = page.getByRole('dialog', { name: 'Export video' });
  await dialogBox.getByLabel('Export format').selectOption('png');
  await dialogBox.getByLabel('Export size').selectOption('720');
  await dialogBox.getByLabel('Export range').selectOption('loop');
  await dialogBox.getByRole('button', { name: 'Export…' }).click();
  await expect(dialogBox.getByTestId('export-done')).toBeVisible({ timeout: 30_000 });
  expect(readdirSync(pngDir).filter((f) => f.endsWith('.png'))).toHaveLength(12);

  await dialogBox.getByLabel('Export format').selectOption('mp4');
  await dialogBox.getByRole('button', { name: 'Export again…' }).click();
  await expect(dialogBox.getByText(`Saved to ${mp4}`)).toBeVisible({ timeout: 60_000 });
  expect(statSync(mp4).size).toBeGreaterThan(1000);
  // The video has the sound in it, and the PNG folder has it as a WAV.
  expect(await streams(mp4)).toEqual(expect.arrayContaining(['Video: h264', 'Audio: aac']));
  expect(existsSync(join(pngDir, 'soundtrack.wav'))).toBe(true);
  await dialogBox.getByRole('button', { name: 'Close' }).click();
});

/** The stream types FFmpeg sees in a file, like "Video: h264". */
async function streams(file: string): Promise<string[]> {
  const ffmpeg = (await import('ffmpeg-static')).default as unknown as string;
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  return [...r.stderr.matchAll(/Stream #\S+.*?: (Video|Audio): (\w+)/g)].map((m) => `${m[1]}: ${m[2]}`);
}

test('makes a mouth switch layer from shapes named after mouth shapes', async () => {
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('new');
  await page.getByRole('button', { name: 'Rectangle' }).click();
  for (const [i, name] of ['X', 'A', 'D'].entries()) {
    await drag([200 + i * 120, 200], [280 + i * 120, 240]);
    const field = page.getByLabel('Part name');
    await field.fill(name);
    await field.press('Enter');
    await field.blur();
  }
  await menu('selectAll');
  await menu('makeSwitchLayer');
  await expect(page.getByText(/Made a mouth with 3 shapes/)).toBeVisible();
  const s = await state();
  expect(s.names).toContain('Mouth');
  expect(s.names).not.toContain('A');
  const set = await page.evaluate(() => (window as any).__nyah.store.getState().project.drawingSets[0]);
  expect(set.vocabulary).toBe('mouth');
  expect(set.drawings.map((d: any) => d.key).sort()).toEqual(['A', 'D', 'X']);
  await expect(page.getByTestId('drawing-list')).toBeVisible();
});

test('a .nyah file opened from Finder opens in the app', async () => {
  const file = join(dir, 'Mouth test.nyah');
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, file);
  await menu('saveAs');
  await expect.poll(() => existsSync(file)).toBe(true);
  await menu('new');
  expect((await state()).names).not.toContain('Mouth');
  // What macOS does when the file is double-clicked or dropped on the Dock icon.
  await app.evaluate(({ app: electronApp }, p) => {
    electronApp.emit('open-file', { preventDefault() {} }, p);
  }, file);
  await expect(page.getByText('Opened Mouth test.nyah')).toBeVisible();
  expect((await state()).names).toContain('Mouth');
});

test('preview quality draws the canvas at lower resolution, and is remembered', async () => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  // The choice is remembered between runs, so start from Full.
  await page.getByLabel('Preview quality').selectOption('1');
  const sharpness = () =>
    page.evaluate(() => {
      // Edge energy between neighbouring pixels: blurred edges score lower.
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="stage"]')!;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i + 4 < d.length; i += 4 * 3) {
        sum += (d[i]! - d[i + 4]!) ** 2 + (d[i + 1]! - d[i + 5]!) ** 2 + (d[i + 2]! - d[i + 6]!) ** 2;
        n++;
      }
      return sum / n;
    });
  await page.waitForTimeout(100);
  const full = await sharpness();
  await page.getByLabel('Preview quality').selectOption('0.25');
  await page.waitForTimeout(100);
  expect(await sharpness()).toBeLessThan(full * 0.8);
  await page.screenshot({ path: 'test-results/preview-quarter.png' });
  expect(await page.evaluate(() => localStorage.getItem('nyah.previewQuality'))).toBe('0.25');
  await page.getByLabel('Preview quality').selectOption('1');
});

test('measures preview speed and shows the playback rate', async () => {
  await menu('measurePreview');
  await expect(page.getByTestId('notice')).toContainText('Preview speed on this computer', { timeout: 20_000 });
  await expect(page.getByTestId('notice')).toContainText('Quarter:');
  await page.getByTestId('notice').getByRole('button', { name: 'Dismiss' }).click();

  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('playback-rate')).toContainText(/Showing \d+ of 24 fps/);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('tab', { name: 'Build' }).click();
});

test('autosaves unsaved work, and deletes the autosave once saved', async () => {
  const recovery = join(dir, 'recovery');
  const autosaves = () => (existsSync(recovery) ? readdirSync(recovery).filter((f) => f.endsWith('.nyah')) : []);
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.keyboard.press('m');
  await drag([300, 300], [360, 350]);
  expect((await state()).dirty).toBe(true);
  await expect.poll(autosaves, { timeout: 10_000 }).toHaveLength(1);

  const path = join(dir, 'Autosaved.nyah');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, path);
  await menu('saveAs');
  await expect.poll(autosaves, { timeout: 10_000 }).toHaveLength(0);
});

test('offers back work left by a crash, and restores it', async () => {
  // What a crashed session leaves behind: its last autosave and a description.
  const saved = join(dir, 'Before the crash.nyah');
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, saved);
  await menu('saveAs');
  await expect.poll(() => existsSync(saved)).toBe(true);
  await menu('new');
  const recovery = join(dir, 'recovery');
  mkdirSync(recovery, { recursive: true });
  const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
  copyFileSync(saved, join(recovery, `${id}.nyah`));
  writeFileSync(join(recovery, `${id}.json`), JSON.stringify({ name: 'Before the crash.nyah', path: saved, savedAt: Date.now() }));

  await page.reload();
  await page.waitForSelector('[data-testid="stage"]');
  await expect(page.getByTestId('recovery')).toContainText('Before the crash.nyah');
  await page.screenshot({ path: 'test-results/recovery.png' });
  await page.getByTestId('recovery').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('recovery')).toHaveCount(0);
  const s = await state();
  expect(s.names).toContain('Forearm (front)');
  expect(s.dirty).toBe(true);
  expect(await page.evaluate(() => (window as any).__nyah.store.getState().file?.name)).toBe('Before the crash.nyah');
  // Restoring writes this window's own autosave, then removes the crashed one.
  await expect.poll(() => existsSync(join(recovery, `${id}.nyah`)), { timeout: 10_000 }).toBe(false);
  expect(readdirSync(recovery).filter((f) => f.endsWith('.nyah'))).toHaveLength(1);
});

test('if the page crashes, it reloads and offers the unsaved work back', async () => {
  // The restored project from the previous test is unsaved and autosaved.
  const recovery = join(dir, 'recovery');
  await expect.poll(() => readdirSync(recovery).filter((f) => f.endsWith('.nyah')).length, { timeout: 10_000 }).toBe(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer());
  // Playwright's handle on the crashed page is gone, so look at the reloaded page from the main process.
  // Gives up after a second: a call made while the page is still crashed never answers.
  const inPage = (js: string) =>
    Promise.race([
      app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(code), js).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
  await expect.poll(() => inPage(`document.querySelector('[data-testid="recovery"]')?.textContent ?? ''`), { timeout: 15_000 }).toContain('Before the crash.nyah');
  await inPage(`[...document.querySelectorAll('[data-testid="recovery"] button')].find((b) => b.textContent === 'Restore').click()`);
  await expect
    .poll(() => inPage(`JSON.stringify(window.__nyah.store.getState().project.scene.layers.map((l) => l.name))`), { timeout: 10_000 })
    .toContain('Pip');
});
