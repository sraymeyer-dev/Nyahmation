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

/** Sends a menu command and waits until the page has handled it. */
async function menu(command: string) {
  const before = await page.evaluate(() => (window as any).__nyahMenuCount ?? 0);
  await app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', cmd), command);
  await page.waitForFunction((n) => ((window as any).__nyahMenuCount ?? 0) > n, before);
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

  // The added layer remembers the library item, and can be updated from it (L5).
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByTestId('layer-row').first().click();
  await expect(page.getByTestId('library-source')).toContainText('From the library: Pip the puppet');
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByRole('button', { name: 'Update from library' }).click();
  await expect(page.getByText(/Updated “Pip the puppet” from the library: \d+ parts kept their animation, 0 new, 0 removed\./)).toBeVisible();
  // Saving it again offers to replace the item as a new version, rather than adding a copy.
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Save to library…' }).click();
  await expect(page.getByLabel('Replace the library version')).toBeChecked();
  await expect(page.getByLabel('Library item name')).toHaveValue('Pip the puppet');
  await page.locator('.save-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved a new version of “Pip the puppet”/)).toBeVisible();
  await expect(page.getByTestId('library-item')).toHaveCount(1);
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

  // Drag the X block's left edge 2 frames later: X now starts on frame 54, and D holds longer (LS4).
  const edge = row('Mouth').locator('.tl-block.key-X [data-testid="block-edge"]').last();
  await edge.scrollIntoViewIfNeeded();
  const box = (await edge.boundingBox())!;
  const zoom = await page.evaluate(() => (window as any).__nyah.store.getState().timeline.zoom);
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2 + zoom, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(box.x + 2 + zoom * 2 + 1, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  poses = await drawingPoses('Mouth');
  expect(poses).toEqual(expect.arrayContaining([[50, 'C'], [51, 'D'], [54, 'X']]));
  expect(poses.some(([f]) => f === 52)).toBe(false);
  await page.keyboard.press('Escape');
});

test('auto lip sync fills in mouth shapes from the dialogue', async () => {
  test.skip(!existsSync(join(__dirname, '..', 'vendor', 'rhubarb')), 'Rhubarb Lip Sync is not installed (npm run setup)');
  await row('Mouth').locator('.tl-name').click();
  await page.getByRole('button', { name: 'Auto lip sync…' }).click();
  const dialogBox = page.getByTestId('lipsync-dialog');
  await expect(dialogBox).toContainText('Auto lip sync for “Mouth”');
  await expect(dialogBox.getByLabel('Dialogue sound')).toHaveValue(/.+/);
  // While the dialog is open, typing goes to it, not to the mouth.
  await dialogBox.getByLabel('Dialogue words').fill('Hello there.');
  await dialogBox.getByRole('button', { name: 'Start' }).click();
  await expect(dialogBox).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/Lip sync for “line”: \d+ mouth change/)).toBeVisible();
  const clip = await page.evaluate(() => (window as any).__nyah.store.getState().project.scene.audio[0]);
  const poses = await drawingPoses('Mouth');
  const inside = poses.filter(([f]) => f >= clip.startFrame && f < clip.startFrame + Math.ceil(clip.duration * 24));
  expect(inside.length).toBeGreaterThan(0);
  // One undo takes it all away again.
  await menu('undo');
  expect(await drawingPoses('Mouth')).not.toEqual(poses);
  await menu('redo');
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

  // MOV with ProRes 4444, see-through, for video editors (E3).
  const mov = join(dir, 'clip.mov');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, mov);
  await dialogBox.getByLabel('Export format').selectOption('mov');
  await dialogBox.getByRole('checkbox').check();
  await expect(dialogBox.getByTestId('export-sound')).toContainText('uncompressed');
  await dialogBox.getByRole('button', { name: 'Export again…' }).click();
  await expect(dialogBox.getByText(`Saved to ${mov}`)).toBeVisible({ timeout: 60_000 });
  expect(await streams(mov)).toEqual(expect.arrayContaining(['Video: prores', 'Audio: pcm_s16le']));
  const ffmpeg = (await import('ffmpeg-static')).default as unknown as string;
  const info = spawnSync(ffmpeg, ['-hide_banner', '-i', mov], { encoding: 'utf8' }).stderr;
  expect(info).toMatch(/prores.*4444/);
  expect(info).toContain('yuva444p'); // with its see-through channel

  // WebM (VP9 + Opus, see-through) and MP4 with H.265 (E4).
  const webm = join(dir, 'clip.webm');
  const hevc = join(dir, 'clip-h265.mp4');
  for (const [format, file, codecs] of [
    ['webm', webm, ['Video: vp9', 'Audio: opus']],
    ['hevc', hevc, ['Video: hevc', 'Audio: aac']],
  ] as const) {
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog;
    }, file);
    await dialogBox.getByLabel('Export format').selectOption(format);
    await dialogBox.getByRole('button', { name: 'Export again…' }).click();
    await expect(dialogBox.getByText(`Saved to ${file}`)).toBeVisible({ timeout: 90_000 });
    expect(await streams(file)).toEqual(expect.arrayContaining([...codecs]));
  }
  // The WebM keeps its see-through channel.
  expect(spawnSync(ffmpeg, ['-hide_banner', '-c:v', 'libvpx-vp9', '-i', webm], { encoding: 'utf8' }).stderr).toContain('yuva420p');
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

test('the camera zooms and pans on the timeline, and only changes what you see', async () => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Animate' }).click();
  const partPoses = () => page.evaluate(() => JSON.stringify((window as any).__nyah.store.getState().project.scene.tracks.filter((t: any) => t.partId !== 'camera')));
  const posesBefore = await partPoses();
  const headBefore = await debug<Pt>('framePartScreen', 'Head');
  const handBefore = await debug<Pt>('framePartScreen', 'Hand (back)');

  // Camera tool, frame 24: zoom to 200% from Properties.
  await page.keyboard.press('c');
  await goToFrame(23);
  const zoom = page.getByLabel('Camera zoom');
  await zoom.fill('200');
  await zoom.press('Enter');
  // Frame 1 keeps the whole scene (the first pose also records where it started).
  await expect(page.getByTestId('tl-camera').locator('.tl-mark')).toHaveCount(2);
  const cam = () => page.evaluate(() => (window as any).__nyah.camera());
  expect((await cam()).zoom).toBeCloseTo(2);

  // Through the camera, the character looks twice as big...
  const head = await debug<Pt>('framePartScreen', 'Head');
  const hand = await debug<Pt>('framePartScreen', 'Hand (back)');
  const spread = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  expect(spread(head, hand) / spread(headBefore, handBefore)).toBeGreaterThan(1.6);
  // ...but on the stage nothing moved: the characters' poses are untouched.
  expect(await partPoses()).toBe(posesBefore);

  // Drag with the Camera tool: the picture follows the mouse, so the camera looks further left.
  const before = await cam();
  await drag([600, 300], [700, 300]);
  const after = await cam();
  expect(after.x).toBeLessThan(before.x - 20);
  await page.screenshot({ path: 'test-results/camera-view.png' });

  // Off: the stage, with the camera's frame drawn on it.
  await page.getByLabel('Camera view').first().uncheck();
  await page.waitForTimeout(50);
  await page.screenshot({ path: 'test-results/camera-stage.png' });
  await page.getByLabel('Camera view').first().check();
});

test('a layer fixed to the camera follows a part, keeping its size', async () => {
  // Draw a name tag above Pip's head on a new layer (Build mode).
  await page.getByRole('tab', { name: 'Build' }).click();
  await menu('newBackgroundLayer');
  await page.keyboard.press('m');
  const head = (await debug<Pt>('partScreen', 'Head'))!;
  await drag([head.x - 30, head.y - 120], [head.x + 30, head.y - 90]);
  const tagName = (await state()).selection.length ? await page.evaluate(() => {
    const s = (window as any).__nyah.store.getState();
    return (window as any).__nyah.nameOf(s.selection[0]);
  }) : '';
  expect(tagName).toMatch(/^Rectangle/);
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByTestId('layer-row').filter({ hasText: 'Background' }).first().click();
  await page.getByLabel('Fixed to camera').check();
  await page.getByLabel('Follows part').selectOption({ label: 'Head' });

  // Animate: the camera zooms (from the previous test) and Pip walks right.
  await page.getByRole('tab', { name: 'Animate' }).click();
  const tagAt = (f: number) =>
    page.evaluate(([n, frame]) => {
      const nyah = (window as any).__nyah;
      nyah.store.set({ frame });
      const headPart = nyah.part('Head');
      return { tag: nyah.frameMiddleScreen(n), head: nyah.framePartScreen('Head', headPart.joint.pivot), size: nyah.frameScreenScale(n) };
    }, [tagName, f] as const);
  const a = await tagAt(0);
  const b = await tagAt(23);
  // The head moved on screen (the camera zoomed in 200%), and the tag moved with it,
  // staying above the bigger head: twice as far from the neck...
  expect(Math.hypot(b.head.x - a.head.x, b.head.y - a.head.y)).toBeGreaterThan(20);
  expect(b.tag.x - b.head.x).toBeCloseTo(2 * (a.tag.x - a.head.x), 0);
  expect(b.tag.y - b.head.y).toBeCloseTo(2 * (a.tag.y - a.head.y), 0);
  // ...but at the same size on screen.
  expect(b.size).toBeCloseTo(a.size, 3);
  await page.screenshot({ path: 'test-results/camera-follow.png' });
});

test('a sky, a gradient fill, parallax depth and a scrolling layer', async () => {
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.getByRole('tab', { name: 'Layers' }).click();
  const pixel = (at: Pt) =>
    page.evaluate((p) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="stage"]')!;
      const dpr = window.devicePixelRatio || 1;
      return [...c.getContext('2d')!.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data.slice(0, 3)];
    }, at);
  const stagePoint = (x: number, y: number) => page.evaluate(([px, py]) => (window as any).__nyah.stageScreen({ x: px, y: py }), [x, y] as const);

  // Sky: a gradient behind everything, from the scene's properties.
  await page.keyboard.press('Escape');
  await page.getByLabel('Sky gradient').check();
  await page.getByLabel('Sky top colour').fill('#0000ff');
  await page.waitForTimeout(50);
  const top = await pixel(await stagePoint(200, 3));
  expect(top[2]).toBeGreaterThan(200);
  expect(top[0]).toBeLessThan(40);

  // A round gradient on the sun: its middle and its edge differ.
  const sun = (await debug<Pt>('partScreen', 'Sun', { x: 1560, y: 220 }))!;
  await click([sun.x, sun.y]);
  await page.getByLabel('Fill type').selectOption('radial');
  await page.getByLabel('Gradient end colour').fill('#ff0000');
  await page.waitForTimeout(50);
  const middle = await pixel(sun);
  const edge = await pixel(await stagePoint(1560 + 80, 220));
  expect(edge[0]! - edge[1]!).toBeGreaterThan(middle[0]! - middle[1]! + 40);

  // The scenery layer: half depth, scrolling left, repeating.
  await page.getByTestId('layer-row').filter({ hasText: 'Scenery' }).click();
  const depth = page.getByLabel('Layer depth');
  await depth.fill('0.5');
  await depth.press('Enter');
  const speed = page.getByLabel('Scroll speed');
  await speed.fill('-240');
  await speed.press('Enter');
  await page.getByLabel('Repeat sideways').check();

  await page.getByRole('tab', { name: 'Animate' }).click();
  const sunAt = (f: number) =>
    page.evaluate((frame) => {
      const nyah = (window as any).__nyah;
      nyah.store.set({ frame });
      return nyah.framePartScreen('Sun', { x: 1560, y: 220 });
    }, f);
  const zoom = await page.evaluate(() => (window as any).__nyah.store.getState().view.zoom);
  const s0 = await sunAt(0);
  const s12 = await sunAt(12);
  // Half a second at -240 px a second: 120 px left (the layer repeats every 2000 px).
  expect((s12.x - s0.x) / zoom).toBeCloseTo(-120, 0);
  // Once it has slid far enough, a copy fills the gap behind it.
  expect(await page.evaluate(() => (window as any).__nyah.repeatCount('Scenery'))).toBe(0);
  await sunAt(60);
  expect(await page.evaluate(() => (window as any).__nyah.repeatCount('Scenery'))).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/scenery.png' });

  // The camera pans 400 px right; the half-depth scenery only shifts 200 px on screen.
  await page.keyboard.press('c');
  await goToFrame(12);
  const before = await sunAt(12);
  const camX = page.getByLabel('Camera X');
  await camX.fill('1360');
  await camX.press('Enter');
  const after = await sunAt(12);
  expect((after.x - before.x) / zoom).toBeCloseTo(-200, 0);
});

/** A small scene for effects: two overlapping red and green squares in one group, and a yellow eye with a blue pupil. */
function effectsScene() {
  const style = (fill: string) => ({ fill, stroke: null, strokeWidth: 0, lineCap: 'round', lineJoin: 'round', fillRule: 'nonzero' });
  const square = (size: number) => [
    { closed: true, points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: size, y: 0 } }, { anchor: { x: size, y: size } }, { anchor: { x: 0, y: size } }] },
  ];
  const part = (id: string, name: string, kind: string, x: number, y: number, extra: object = {}) => ({
    id,
    name,
    kind,
    rest: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
    joint: { pivot: { x: 0, y: 0 } },
    opacity: 1,
    visible: true,
    drawOrder: 0,
    children: [],
    ...extra,
  });
  const a = part('a', 'Red', 'shape', 200, 200, { paths: square(100), style: style('#ff0000'), drawOrder: 1 });
  const b = part('b', 'Green', 'shape', 250, 200, { paths: square(100), style: style('#00ff00'), drawOrder: 2 });
  const group = part('g', 'Squares', 'group', 0, 0, { children: [a, b] });
  const pupil = part('pupil', 'Pupil', 'shape', 80, 20, { paths: square(60), style: style('#0000ff'), drawOrder: 2 });
  const eye = part('eye', 'Eye', 'shape', 600, 200, { paths: square(100), style: style('#ffff00'), drawOrder: 1, children: [pupil] });
  return {
    format: 'nyahmation',
    version: 5,
    scene: {
      width: 1000,
      height: 500,
      fps: 24,
      durationFrames: 24,
      background: '#ffffff',
      stepping: 1,
      layers: [
        { id: 'squares', name: 'Squares', kind: 'character', root: part('sq', 'Squares', 'group', 0, 0, { children: [group] }) },
        { id: 'eyes', name: 'Eyes', kind: 'character', root: part('ey', 'Eyes', 'group', 0, 0, { children: [eye] }) },
      ],
      tracks: [],
      audio: [],
    },
    drawingSets: [],
    assets: [],
  };
}

async function stagePixel(x: number, y: number): Promise<number[]> {
  await page.waitForTimeout(60);
  return page.evaluate(([sx, sy]) => {
    const p = (window as any).__nyah.stageScreen({ x: sx, y: sy });
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="stage"]')!;
    const dpr = window.devicePixelRatio || 1;
    return [...c.getContext('2d')!.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data.slice(0, 3)];
  }, [x, y] as const);
}

/** A part's row in the Layers panel, by exact name. */
const outlineRow = (name: string) => page.getByTestId('part-row').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

const near = (a: number[], b: number[], tolerance = 12) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

test('a drop shadow on a group is one shadow of the whole group', async () => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.evaluate((json) => (window as any).__nyah.loadProjectJson(json), effectsScene());
  await page.getByRole('tab', { name: 'Layers' }).click();
  expect(near(await stagePixel(420, 250), [255, 255, 255])).toBe(true);

  // Select the group and give it a hard shadow 100 px to the right.
  await outlineRow('Squares').click();
  await page.getByLabel('Add effect').selectOption('shadow');
  await expect(page.getByTestId('effect-shadow')).toBeVisible();
  for (const [label, value] of [
    ['Drop shadow direction', '0'],
    ['Drop shadow distance', '100'],
    ['Drop shadow softness', '0'],
    ['Drop shadow opacity', '50'],
  ]) {
    await page.getByLabel(label).fill(value);
    await page.getByLabel(label).press('Enter');
  }
  const single = await stagePixel(420, 250); // behind the green square's shadow only
  const overlap = await stagePixel(370, 250); // where both squares' shadows would overlap
  expect(near(single, [128, 128, 128], 20)).toBe(true);
  // One shadow of the whole group: no darker patch where the squares overlap.
  expect(near(overlap, single, 6)).toBe(true);
  await page.screenshot({ path: 'test-results/effects-shadow.png' });
});

test('blend modes, clipping, haze and an animated glow', async () => {
  // Multiply: green over red makes black, only inside the group.
  await outlineRow('Green').click();
  await page.getByLabel('Blend mode').selectOption('multiply');
  expect(near(await stagePixel(275, 250), [0, 0, 0], 20)).toBe(true);
  expect(near(await stagePixel(325, 250), [0, 255, 0], 20)).toBe(true);

  // Clipping: the pupil only shows on the eye.
  expect(near(await stagePixel(720, 250), [0, 0, 255])).toBe(true);
  await outlineRow('Eye').click();
  await page.getByLabel('Clip children').check();
  expect(near(await stagePixel(720, 250), [255, 255, 255])).toBe(true);
  expect(near(await stagePixel(690, 250), [0, 0, 255])).toBe(true);

  // Layer haze: the whole Eyes layer fades toward the background colour.
  await page.getByTestId('layer-row').filter({ hasText: 'Eyes' }).click();
  await page.getByLabel('Add effect').selectOption('haze');
  await page.getByLabel('Haze amount').fill('100');
  await page.getByLabel('Haze amount').press('Enter');
  expect(near(await stagePixel(650, 250), [255, 255, 255])).toBe(true);
  await page.getByLabel('Remove Haze').click();
  expect(near(await stagePixel(650, 250), [255, 255, 0])).toBe(true);

  // Animate a glow on the eye: bigger on frame 10.
  await outlineRow('Eye').click();
  await page.getByLabel('Add effect').selectOption('glow');
  await page.getByRole('tab', { name: 'Animate' }).click();
  await goToFrame(10);
  await page.getByLabel('Outer glow size').fill('60');
  await page.getByLabel('Outer glow size').press('Enter');
  const track = await page.evaluate(() =>
    (window as any).__nyah.store.getState().project.scene.tracks.find((t: any) => t.partId === 'eye' && t.channel.endsWith(':size')),
  );
  expect(track.poses.map((p: any) => [p.frame, p.value])).toEqual([
    [0, 18],
    [10, 60],
  ]);
  await expect(row('Eye').locator('.tl-mark')).toHaveCount(2);
  const glowAt = async (f: number) => {
    await page.evaluate((frame) => (window as any).__nyah.store.set({ frame }), f);
    return stagePixel(600 - 25, 250); // just left of the eye
  };
  const weak = await glowAt(0);
  const strong = await glowAt(10);
  expect(strong[2]!).toBeLessThan(weak[2]! - 10); // more yellow (less blue) at the bigger glow
  await page.screenshot({ path: 'test-results/effects-glow.png' });
});

test('groups that look the same as last frame are reused, not redrawn', async () => {
  // The squares' shadow group doesn't move; stepping through frames reuses it.
  const stats = () => page.evaluate(() => ({ ...(window as any).__nyah.groupStats }));
  await page.evaluate(() => (window as any).__nyah.store.set({ frame: 3 }));
  await page.waitForTimeout(50);
  const before = await stats();
  for (let f = 4; f < 8; f++) {
    await page.evaluate((frame) => (window as any).__nyah.store.set({ frame }), f);
    await page.waitForTimeout(30);
  }
  const after = await stats();
  expect(after.reused - before.reused).toBeGreaterThanOrEqual(4);
});

test('copies, cuts and pastes parts in Build mode', async () => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.getByRole('tab', { name: 'Layers' }).click();
  const count = (name: string) => state().then((s) => s.names.filter((n) => n === name).length);
  const selectedAt = () => page.evaluate(() => (window as any).__nyah.selectedScreen());

  // Copy the hand, paste twice: each copy lands a little further down and right.
  await outlineRow('Hand').click();
  const original = await selectedAt();
  await menu('copy');
  await menu('paste');
  await expect(page.getByText('Pasted “Hand”.')).toBeVisible();
  expect(await count('Hand')).toBe(2);
  const first = await selectedAt();
  await menu('paste');
  expect(await count('Hand')).toBe(3);
  const second = await selectedAt();
  const zoom = await page.evaluate(() => (window as any).__nyah.store.getState().view.zoom);
  expect((first.x - original.x) / zoom).toBeCloseTo(20, 0);
  expect((second.x - first.x) / zoom).toBeCloseTo(20, 0);
  expect((second.y - first.y) / zoom).toBeCloseTo(20, 0);
  // Undo takes a paste away.
  await menu('undo');
  expect(await count('Hand')).toBe(2);

  // A mouth keeps using the same drawing set, not a copy of it.
  const sets = () => page.evaluate(() => (window as any).__nyah.store.getState().project.drawingSets.length);
  const setsBefore = await sets();
  await outlineRow('Mouth').click();
  await menu('copy');
  await menu('paste');
  expect(await count('Mouth')).toBe(2);
  expect(await sets()).toBe(setsBefore);

  // Cut removes, paste brings back.
  await outlineRow('Eyes').click();
  await menu('cut');
  expect(await count('Eyes')).toBe(0);
  await menu('paste');
  expect(await count('Eyes')).toBe(1);

  // A whole layer.
  const layers = () => page.getByTestId('layer-row').count();
  const layersBefore = await layers();
  await page.getByTestId('layer-row').filter({ hasText: 'Scenery' }).click();
  await menu('copy');
  await menu('paste');
  expect(await layers()).toBe(layersBefore + 1);

  // In a text field, Copy and Paste work on the text instead.
  const name = page.getByLabel('Layer name');
  await name.fill('Scenery copy');
  await name.selectText();
  await menu('copy');
  expect(await layers()).toBe(layersBefore + 1);
  await name.press('Escape');
});

test('copies a pose onto another frame and onto a copy of the character', async () => {
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.getByTestId('layer-row').filter({ hasText: 'Pip' }).click();
  await menu('copy');
  await menu('paste'); // a second Pip, with no animation
  await page.getByRole('tab', { name: 'Animate' }).click();
  const ids = await page.evaluate(() => {
    const layers = (window as any).__nyah.store.getState().project.scene.layers.filter((l: any) => l.name === 'Pip');
    const forearm = (root: any) => {
      const walk = (p: any): any => (p.name === 'Forearm (front)' ? p : p.children.map(walk).find(Boolean));
      return walk(root).id;
    };
    return { pip: layers[0].root.id, copy: layers[1].root.id, pipArm: forearm(layers[0].root), copyArm: forearm(layers[1].root) };
  });
  const value = (id: string, frame: number) => page.evaluate(([i, f]) => (window as any).__nyah.channelValue(i, 'rotation', f), [id, frame] as const);
  const select = (id: string) => page.evaluate((i) => (window as any).__nyah.store.set({ selection: [i], cameraSelected: false }), id);
  const pipAt20 = await value(ids.pipArm, 20);
  expect(await value(ids.copyArm, 20)).not.toBeCloseTo(pipAt20);

  // Copy Pip's pose on frame 21, paste it onto the copy: the arms match.
  await goToFrame(20);
  await select(ids.pip);
  await menu('copy');
  await select(ids.copy);
  await menu('paste');
  await expect(page.getByText(/Pasted the pose from frame 21 onto \d+ parts on frame 21/)).toBeVisible();
  expect(await value(ids.copyArm, 20)).toBeCloseTo(pipAt20);

  // Paste it onto a later frame of Pip himself: a hold of that pose.
  await goToFrame(60);
  await select(ids.pip);
  await menu('paste');
  expect(await value(ids.pipArm, 60)).toBeCloseTo(pipAt20);
});

test('in Animate mode, sending a part back is a draw-order swap from that frame', async () => {
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Animate' }).click();
  await goToFrame(30);
  await page.evaluate(() => {
    const nyah = (window as any).__nyah;
    nyah.store.set({ selection: [nyah.part('Upper arm (front)').id] });
  });
  const order = (frame: number) => page.evaluate((f) => (window as any).__nyah.paintOrder('Pip', f), frame);
  const before = await order(30);
  await menu('sendToBack');
  await expect(page.getByText('Upper arm (front) moves to the back from frame 31.')).toBeVisible();
  expect((await order(30))[0]).toBe('Upper arm (front)');
  expect(await order(29)).toEqual(before);
  await expect(row('Upper arm (front)').locator('.tl-mark[data-frame="30"]')).toHaveCount(1);
  // The rest pose isn't touched.
  await page.getByRole('tab', { name: 'Build' }).click();
  expect((await order(0))[0]).not.toBe('Upper arm (front)');
});

test('a custom easing curve, and stretching a range of poses', async () => {
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Animate' }).click();
  // Select Torso's first pose mark and give it a custom curve.
  await row('Torso').locator('.tl-mark').first().click();
  await page.getByLabel('Pose easing').selectOption('custom');
  await expect(page.getByTestId('curve-editor')).toBeVisible();
  const ease = () =>
    page.evaluate(() => {
      const nyah = (window as any).__nyah;
      const s = nyah.store.getState();
      const torso = nyah.part('Torso').id;
      const mark = s.timeline.marks[0];
      return s.project.scene.tracks.filter((t: any) => t.partId === torso).map((t: any) => t.poses.find((p: any) => p.frame === mark.frame)?.ease).find(Boolean);
    });
  expect(await ease()).toEqual({ bezier: [0.42, 0, 0.58, 1] });
  await page.getByRole('button', { name: 'Overshoot' }).click();
  expect(await ease()).toEqual({ bezier: [0.3, 0, 0.3, 1.35] });
  // Drag the second handle up: more overshoot.
  await page.getByTestId('curve-editor').scrollIntoViewIfNeeded();
  const handle = (await page.getByTestId('curve-handle-2').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 20, { steps: 4 });
  await page.mouse.up();
  expect((await ease()).bezier[3]).toBeGreaterThan(1.35);
  await page.screenshot({ path: 'test-results/curve-editor.png' });

  // Stretch frames 11–21 of the whole scene to 21 frames: later poses move 10 frames on.
  await page.keyboard.press('Escape');
  const lastPose = () =>
    page.evaluate(() => {
      const s = (window as any).__nyah.store.getState();
      return Math.max(...s.project.scene.tracks.filter((t: any) => t.channel !== 'drawing').flatMap((t: any) => t.poses.map((p: any) => p.frame)));
    });
  const before = await lastPose();
  await goToFrame(10);
  await page.keyboard.press('i');
  await goToFrame(20);
  await page.keyboard.press('o');
  const stretch = page.getByLabel('Stretch loop to frames');
  await expect(stretch).toHaveValue('11');
  await stretch.fill('21');
  await stretch.press('Enter');
  expect(await lastPose()).toBe(before + 10);
  await expect(stretch).toHaveValue('21');
  expect(await page.evaluate(() => (window as any).__nyah.store.getState().loop)).toEqual({ in: 10, out: 30 });
});

test('mirrors a pose, and swaps sides for a walk', async () => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Animate' }).click();
  await goToFrame(20);
  const ids = await page.evaluate(() => {
    const nyah = (window as any).__nyah;
    const id = (n: string) => nyah.part(n).id;
    return { pip: nyah.store.getState().project.scene.layers.find((l: any) => l.name === 'Pip').root.id, front: id('Upper arm (front)'), back: id('Upper arm (back)') };
  });
  const rest = (id: string) => page.evaluate((i) => (window as any).__nyah.partById(i).rest.rotation, id);
  const rot = (id: string) => page.evaluate(([i]) => (window as any).__nyah.channelValue(i, 'rotation', 20), [id] as const);
  const before = { front: await rot(ids.front), back: await rot(ids.back) };
  await page.evaluate((i) => (window as any).__nyah.store.set({ selection: [i] }), ids.pip);

  await menu('mirrorPose');
  await expect(page.getByText(/Mirrored the pose on frame 21/)).toBeVisible();
  // The front arm takes the back arm's pose, turned the other way (measured from rest).
  expect(await rot(ids.front)).toBeCloseTo((await rest(ids.front)) - (before.back - (await rest(ids.back))));
  // Mirroring again gives the pose back.
  await menu('mirrorPose');
  expect(await rot(ids.front)).toBeCloseTo(before.front);

  await menu('swapSides');
  await expect(page.getByText(/Swapped the sides of the pose on frame 21/)).toBeVisible();
  expect(await rot(ids.front)).toBeCloseTo((await rest(ids.front)) + (before.back - (await rest(ids.back))));
});

test('a layer can repeat as a cycle, and change its stepping over time', async () => {
  await menu('openDemo');
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByTestId('layer-row').filter({ hasText: 'Pip' }).click();
  await page.getByLabel('Repeat as a cycle').check();
  await page.getByLabel('Cycle from frame').fill('1');
  await page.getByLabel('Cycle from frame').press('Enter');
  await page.getByLabel('Cycle to frame').fill('25');
  await page.getByLabel('Cycle to frame').press('Enter');
  await page.getByLabel('Cycle to frame').press('Escape'); // leave the field, so arrow keys step frames
  await expect(page.getByTestId('tl-cycle')).toContainText('repeats 1–25');
  const hand = (f: number) =>
    page.evaluate((frame) => {
      const nyah = (window as any).__nyah;
      nyah.store.set({ frame });
      return nyah.framePartScreen('Hand');
    }, f);
  // Frame 31 plays frame 7 again.
  const a = await hand(6);
  const b = await hand(30);
  expect(b.x).toBeCloseTo(a.x, 1);
  expect(b.y).toBeCloseTo(a.y, 1);
  await page.screenshot({ path: 'test-results/cycle.png' });

  // From frame 41, Pip is on twos: a mark on the layer row, and frames 42 and 43 show the same step.
  await goToFrame(40);
  await page.getByTestId('layer-row').filter({ hasText: 'Pip' }).click();
  await page.getByLabel('Layer stepping').selectOption('2');
  await expect(page.getByText('Pip is on twos from frame 41.')).toBeVisible();
  const steppingPoses = await page.evaluate(() => {
    const s = (window as any).__nyah.store.getState();
    const root = s.project.scene.layers.find((l: any) => l.name === 'Pip').root.id;
    return s.project.scene.tracks.find((t: any) => t.partId === root && t.channel === 'stepping').poses.map((p: any) => [p.frame, p.value]);
  });
  expect(steppingPoses).toEqual([
    [0, 1],
    [40, 2],
  ]);
  await expect(page.getByTestId('tl-layer').filter({ hasText: 'Pip' }).locator('.tl-mark[data-frame="40"]')).toHaveCount(1);
});

test('shape tools: union, subtract, intersect and exclude', async () => {
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.evaluate((json) => (window as any).__nyah.loadProjectJson(json), effectsScene());
  await page.getByRole('tab', { name: 'Layers' }).click();
  // Red and Green overlap in 250–300; subtract Green from Red (Red is behind).
  const ids = await page.evaluate(() => ['a', 'b']);
  await page.evaluate((sel) => (window as any).__nyah.store.set({ selection: sel }), ids);
  await menu('boolSubtract');
  await expect(page.getByText('Cut 2 shapes.')).toBeVisible();
  expect(await state().then((s) => s.names)).not.toContain('Green');
  expect(near(await stagePixel(225, 250), [255, 0, 0])).toBe(true);
  expect(near(await stagePixel(275, 250), [255, 255, 255])).toBe(true); // cut away
  await menu('undo');
  await page.evaluate((sel) => (window as any).__nyah.store.set({ selection: sel }), ids);
  await menu('boolIntersect');
  expect(near(await stagePixel(225, 250), [255, 255, 255])).toBe(true);
  expect(near(await stagePixel(275, 250), [255, 0, 0])).toBe(true); // only the overlap, in Red's colour
  await menu('undo');
  await page.evaluate((sel) => (window as any).__nyah.store.set({ selection: sel }), ids);
  await menu('boolUnion');
  expect(near(await stagePixel(325, 250), [255, 0, 0])).toBe(true);
  await menu('undo');
  await page.evaluate((sel) => (window as any).__nyah.store.set({ selection: sel }), ids);
  await menu('boolExclude');
  expect(near(await stagePixel(275, 250), [255, 255, 255])).toBe(true); // the overlap is a hole
  expect(near(await stagePixel(325, 250), [255, 0, 0])).toBe(true);
});

test('colour swatches and the eyedropper', async () => {
  await outlineRow('Eye').click();
  await expect(page.getByTestId('swatches')).toBeVisible();
  // Keep the eye's yellow as a swatch, then paint the pupil with it.
  await page.getByLabel('Add the fill colour to the swatches').click();
  await expect(page.getByLabel('Swatch #ffff00')).toBeVisible();
  await outlineRow('Pupil').click();
  await page.getByLabel('Swatch #ffff00').click();
  expect(await page.evaluate(() => (window as any).__nyah.part('Pupil').style.fill)).toBe('#ffff00');
  // Shift-click paints the outline.
  await page.getByLabel('Swatch #ffff00').click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => (window as any).__nyah.part('Pupil').style.stroke)).toBe('#ffff00');
  // Swatches are saved with the project.
  expect(await page.evaluate(() => (window as any).__nyah.store.getState().project.swatches)).toEqual(['#ffff00']);
  // The eyedropper (the system's colour picker is replaced here).
  await page.evaluate(() => {
    (window as any).EyeDropper = class {
      async open() {
        return { sRGBHex: '#123456' };
      }
    };
  });
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.getByRole('tab', { name: 'Build' }).click(); // re-render so the button appears
  await outlineRow('Pupil').click();
  await page.getByLabel('Pick fill colour from the screen').click();
  await expect.poll(() => page.evaluate(() => (window as any).__nyah.part('Pupil').style.fill)).toBe('#123456');
  // Option/Alt-click removes a swatch.
  await page.getByLabel('Swatch #ffff00').click({ modifiers: ['Alt'] });
  await expect(page.getByLabel('Swatch #ffff00')).toHaveCount(0);
});

test('a contact shadow sits on the ground under a group, and shrinks as it rises', async () => {
  await page.getByRole('tab', { name: 'Build' }).click();
  await page.evaluate((json) => (window as any).__nyah.loadProjectJson(json), effectsScene());
  await page.getByRole('tab', { name: 'Layers' }).click();
  await outlineRow('Squares').click();
  expect(near(await stagePixel(275, 306), [255, 255, 255])).toBe(true);
  await page.getByLabel('Add effect').selectOption('contact');
  await expect(page.getByTestId('effect-contact')).toBeVisible();
  // The ground starts at the squares' lowest point (300): a soft dark oval just under them.
  expect(await page.getByLabel('Contact shadow ground').inputValue()).toBe('300');
  const under = await stagePixel(275, 305);
  expect(under[0]!).toBeLessThan(235);
  // Lift the squares 150 px (in Animate mode): the oval stays on the ground, fainter and smaller.
  await page.getByRole('tab', { name: 'Animate' }).click();
  await goToFrame(5);
  await page.getByLabel('Y', { exact: true }).fill('-150');
  await page.getByLabel('Y', { exact: true }).press('Enter');
  const lifted = await stagePixel(275, 305);
  expect(lifted[0]!).toBeGreaterThan(under[0]! + 10);
  expect(lifted[0]!).toBeLessThan(255);
  await page.screenshot({ path: 'test-results/contact-shadow.png' });
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
