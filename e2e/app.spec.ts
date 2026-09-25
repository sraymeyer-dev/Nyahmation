import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Drives the real app. Run `npm run test:e2e` (it builds first).

let app: ElectronApplication;
let page: Page;
const dir = mkdtempSync(join(tmpdir(), 'nyah-'));

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], env: { ...process.env, NODE_ENV: 'production' } });
  page = await app.firstWindow();
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
  await page.getByRole('slider', { name: 'Frame' }).fill('22');
  await page.getByTestId('stage').click();
  await expect(page.getByTestId('frame')).toHaveText('23 / 72');
  await page.waitForTimeout(50);
  const pose = await signature();
  await nextFrame();
  expect(await signature()).toBe(pose);
  await nextFrame();
  expect(await signature()).not.toBe(pose);
});
