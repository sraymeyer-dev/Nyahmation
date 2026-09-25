import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], env: { ...process.env, NODE_ENV: 'production' } });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="stage"]');
});

test.afterAll(async () => {
  await app?.close();
});

/** A cheap fingerprint of what's drawn on the canvas. */
async function canvasSignature(): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]!) | 0;
    return String(hash);
  });
}

test('opens a window with the preload API available', async () => {
  expect(await page.title()).toBe('Nyahmation');
  expect(await page.evaluate(() => typeof window.nyah?.saveProject)).toBe('function');
});

test('draws the demo puppet and moves between frames', async () => {
  await expect(page.getByTestId('frame')).toHaveText('1 / 72');
  const first = await canvasSignature();
  for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('frame')).toHaveText('15 / 72');
  expect(await canvasSignature()).not.toBe(first);
  await page.screenshot({ path: 'test-results/frame-15.png' });
});

test('on twos, the in-between frame after a pose repeats it', async () => {
  await page.getByLabel('Animate on').selectOption('2');
  // Frame index 22 is a pose; 23 should look the same, 24 should differ.
  await page.getByRole('slider', { name: 'Frame' }).fill('22');
  await page.getByTestId('stage').click();
  await expect(page.getByTestId('frame')).toHaveText('23 / 72');
  const pose = await canvasSignature();
  await page.keyboard.press('ArrowRight');
  expect(await canvasSignature()).toBe(pose);
  await page.keyboard.press('ArrowRight');
  expect(await canvasSignature()).not.toBe(pose);
});

test('saves a .nyah file and opens it again', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'nyah-')), 'Demo.nyah');
  // Replace the native dialogs, which a test can't click.
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
  }, path);

  await page.getByRole('button', { name: 'Save As…' }).click();
  await expect(page.getByText('Saved Demo.nyah')).toBeVisible();

  await page.getByRole('button', { name: 'Open…' }).click();
  await expect(page.getByText('Opened Demo.nyah')).toBeVisible();
  await expect(page.getByTestId('frame')).toHaveText('1 / 72');
});
