// Drives the built app through the scenes shown in the user manual and saves
// a screenshot of each, plus where every numbered callout goes. Callout
// positions come from the real on-screen elements, so they stay right when
// the layout changes. Used by make.mjs.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';

const W = 1400;
const H = 860;

/** A 16-bit mono WAV with a few "syllables" of tone, so the waveform has shape. */
function speechLikeWav(seconds, rate = 48000) {
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
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syllable = Math.max(0, Math.sin(Math.PI * t * 4.2)) ** 2 * (0.55 + 0.45 * Math.sin(t * 1.7));
    const v = Math.sin(2 * Math.PI * 180 * t) * 0.6 + Math.sin(2 * Math.PI * 360 * t) * 0.3;
    b.writeInt16LE(Math.round(v * syllable * 20000), 44 + i * 2);
  }
  return b;
}

export async function capture(outDir) {
  const imgDir = join(outDir, 'img');
  mkdirSync(imgDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'nyah-manual-'));
  const figures = {};

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'production', NYAH_LIBRARY_DIR: join(work, 'library') },
  });
  const page = await app.firstWindow();
  // Render at 2× so the screenshots are sharp in print.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await page.waitForSelector('[data-testid="stage"]');
  await page.evaluate(() => {
    window.confirm = () => true;
  });

  // ---- helpers -----------------------------------------------------------------
  const menu = (cmd) =>
    app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', c), cmd);
  const mockOpen = (paths) =>
    app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p });
    }, paths);
  const settle = (ms = 250) => page.waitForTimeout(ms);
  const stage = async () => (await page.getByTestId('stage').boundingBox());
  /** Screen point (page CSS px) of a spot in a part's drawing. */
  const partPoint = async (name, local = { x: 0, y: 0 }, frame = false) => {
    const s = await stage();
    const p = await page.evaluate(([n, l, f]) => window.__nyah[f ? 'framePartScreen' : 'partScreen'](n, l), [name, local, frame]);
    return { x: s.x + p.x, y: s.y + p.y };
  };
  const jointPoint = async (name) => {
    const s = await stage();
    const p = await page.evaluate((n) => window.__nyah.jointScreen(n), name);
    return { x: s.x + p.x, y: s.y + p.y };
  };
  const box = async (locator, pad = 3) => {
    const b = await locator.first().boundingBox();
    if (!b) throw new Error(`No box for ${locator}`);
    return { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
  };
  const union = (...bs) => {
    const x = Math.min(...bs.map((b) => b.x));
    const y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  };
  const $ = (sel) => page.locator(sel);
  const button = (name) => page.getByRole('button', { name, exact: true });
  const row = (name) =>
    page.getByTestId('tl-part').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
  const outlineRow = (name) => page.locator('.outline-row').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
  const goToFrame = async (f) => {
    await page.keyboard.press('Home');
    for (let i = 0; i < f; i++) await page.keyboard.press('ArrowRight');
  };
  const drag = async (from, to, steps = 8) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
    await page.mouse.move(to.x, to.y, { steps });
    await page.mouse.up();
  };
  const selectPart = async (name) => {
    await page.evaluate((n) => {
      const nyah = window.__nyah;
      const p = nyah.part(n);
      nyah.store.set({ selection: [p.id], points: [] });
    }, name);
    await settle(100);
  };
  /** Zooms the canvas by `factor`, centred on a page point (the point ends up mid-canvas, shifted by `dy`). */
  const zoomOn = async (point, factor, dy = 0) => {
    const st = await stage();
    await page.evaluate(
      ([px, py, f, cx, cy]) => {
        const { store } = window.__nyah;
        const v = store.getState().view;
        store.set({ view: { zoom: v.zoom * f, panX: cx - (px - v.panX) * f, panY: cy - (py - v.panY) * f } });
      },
      [point.x - st.x, point.y - st.y, factor, st.width / 2, st.height / 2 + dy],
    );
    await settle(150);
  };
  /** Drags the timeline's top edge to make it taller. */
  const growTimeline = async (by) => {
    const edge = await page.locator('.timeline-resize').boundingBox();
    await drag({ x: edge.x + 300, y: edge.y + 3 }, { x: edge.x + 300, y: edge.y + 3 - by }, 4);
  };
  const setStatus = (status) => page.evaluate((s) => window.__nyah.store.set({ status: s }), status);

  /**
   * Saves a screenshot. Callouts: { label, box } (outlined area) or
   * { label, point } (a spot), with an optional badge side: 'tl','tr','bl',
   * 'br','l','r','t','b'. `clip` crops to part of the window.
   */
  const shot = async (name, callouts, clip) => {
    await settle(300);
    const area = clip ?? { x: 0, y: 0, w: W, h: H };
    // Through the DevTools protocol, which keeps the 2× pixels.
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 90,
      clip: { x: area.x, y: area.y, width: area.w, height: area.h, scale: 1 },
    });
    writeFileSync(join(imgDir, `${name}.jpg`), Buffer.from(data, 'base64'));
    figures[name] = {
      file: `img/${name}.jpg`,
      width: area.w,
      height: area.h,
      callouts: callouts.map((c) => ({
        ...c,
        box: c.box && { ...c.box, x: c.box.x - area.x, y: c.box.y - area.y },
        point: c.point && { x: c.point.x - area.x, y: c.point.y - area.y },
      })),
    };
  };

  // ---- 1. The workspace (Build mode) ------------------------------------------------
  await menu('openDemo');
  await settle(400);
  await menu('zoomFit');
  await selectPart('Upper arm (front)');
  await setStatus('Opened the demo puppet');
  await shot('workspace', [
    { label: 'Mode switch: Build (draw and rig) or Animate (pose on the timeline)', box: await box($('.mode-switch')), badge: 'b' },
    { label: 'Project name; a dot means there are unsaved changes', box: await box($('.topbar .file')), badge: 'b' },
    { label: 'Status: what just happened, and tips', box: await box($('.topbar .status')), badge: 'b' },
    { label: 'Import art or sound, and Save', box: union(await box(button('Import…')), await box(button('Save'))), badge: 'b' },
    { label: 'Toolbar: the drawing, rigging and view tools', box: await box($('.toolbar'), 2), badge: 'r' },
    { label: 'Tool options, grid and snap, and zoom', box: await box($('.tool-options'), 1), badge: 'b' },
    { label: 'The canvas: the white area is the scene (what gets exported)', box: await box(page.getByTestId('stage'), -40), badge: 'tl' },
    { label: 'Selected part, with handles to scale and rotate it', point: await partPoint('Upper arm (front)', { x: 0, y: 40 }), badge: 'l' },
    { label: 'Panel tabs: Layers and Library', box: await box($('.sidebar .tabs')), badge: 'l' },
    { label: 'Layers panel: every layer and part, front to back', box: await box($('.outline-list'), -2), badge: 'l' },
    { label: 'Properties of whatever is selected', box: await box(page.getByTestId('properties'), -2), badge: 'l' },
  ]);

  // ---- 2. Drawing shapes ------------------------------------------------------------------
  await menu('new');
  await settle(300);
  await menu('zoomFit');
  let s = await stage();
  await button('Ellipse').click();
  await drag({ x: s.x + 170, y: s.y + 230 }, { x: s.x + 360, y: s.y + 420 });
  await button('Star').click();
  await drag({ x: s.x + 430, y: s.y + 230 }, { x: s.x + 620, y: s.y + 420 });
  await button('Rectangle').click();
  await drag({ x: s.x + 690, y: s.y + 250 }, { x: s.x + 880, y: s.y + 400 });
  await setStatus('');
  await shot('drawing', [
    { label: 'Shape tools: Pen, Rectangle, Ellipse, Polygon, Star and Line', box: union(await box(button('Pen')), await box(button('Line'))), badge: 'r' },
    { label: 'Options for the current tool (here, the rectangle’s corner radius)', box: await box($('.tool-options label').first()), badge: 'b' },
    { label: 'The new shape is selected: drag handles to resize, the round handle to rotate', point: { x: s.x + 785, y: s.y + 325 }, badge: 'b' },
    { label: 'Each shape appears in the Layers panel, inside the active layer', box: await box($('.outline-list .outline-row').nth(1), 1), badge: 'l' },
    { label: 'Fill and stroke: colour, width, line ends and corners', box: await box($('.properties .section').nth(1), -2), badge: 'l' },
  ]);

  // ---- 3. Editing points ----------------------------------------------------------------------
  await button('Points').click();
  await page.mouse.dblclick(s.x + 525, s.y + 330);
  await settle(200);
  // Click the star's top point to select it.
  const starTop = { x: s.x + 525, y: s.y + 230 };
  await page.mouse.click(starTop.x, starTop.y);
  await shot(
    'points',
    [
      { label: 'Points tool (A)', box: await box(button('Points')), badge: 'r' },
      { label: 'A selected point (filled). Drag to move it; Delete removes it', point: starTop, badge: 'tl' },
      { label: 'Other points of the shape. Double-click a point to make it smooth or sharp', point: { x: s.x + 620, y: s.y + 297 }, badge: 'r' },
      { label: 'Double-click anywhere on a curve to add a point', point: { x: s.x + 790, y: s.y + 250 }, badge: 't' },
      { label: 'Hints for the current tool', box: await box($('.tool-options .hint')), badge: 'b' },
    ],
    { x: 0, y: 0, w: 1000, h: 620 },
  );
  await page.keyboard.press('Escape');

  // ---- 4. Layers panel ----------------------------------------------------------------------------
  await menu('openDemo');
  await settle(400);
  await menu('zoomFit');
  await button('Select').click();
  await selectPart('Hand');
  const sideClip = await box($('.sidebar'), 0);
  await shot(
    'layers',
    [
      { label: 'Add a character layer or a background layer', box: union(await box(button('+ Character')), await box(button('+ Background'))), badge: 'b' },
      { label: 'A character layer (C) holds one rigged character', box: await box(outlineRow('Pip').first(), 0), badge: 'l' },
      { label: 'Parts inside parts: the hand is inside the forearm, inside the upper arm', box: await box(outlineRow('Hand').first(), 0), badge: 'l' },
      { label: 'Show or hide', box: await box(outlineRow('Pip').first().locator('.flag').first(), 1), badge: 'b' },
      { label: 'Lock, so it can’t be selected or drawn on', box: await box(outlineRow('Pip').first().locator('.flag').nth(1), 1), badge: 'b' },
      { label: 'A background layer (B) sits behind the characters', box: await box(outlineRow('Scenery').first(), 0), badge: 'l' },
    ],
    { x: sideClip.x, y: 0, w: sideClip.w, h: 420 },
  );

  // ---- 5. Joints -------------------------------------------------------------------------------------
  await button('Joints').click();
  await selectPart('Forearm (front)');
  await zoomOn(await partPoint('Torso', { x: 0, y: 0 }), 2.1, 40);
  const elbow = await jointPoint('Forearm (front)');
  const shoulder = await jointPoint('Upper arm (front)');
  const neck = await jointPoint('Head');
  const jointSection = page.locator('.properties .section').filter({ hasText: 'Joint' }).first();
  await shot('joints', [
    { label: 'Joints tool (J): shows the skeleton', box: await box(button('Joints')), badge: 'r' },
    { label: 'A joint: where a part turns. Drag it to move the joint without moving the drawing', point: elbow, badge: 'r' },
    { label: 'Bones link each joint to the joints of the parts inside it', point: { x: (elbow.x + shoulder.x) / 2, y: (elbow.y + shoulder.y) / 2 }, badge: 'l' },
    { label: 'A chain root (square): posing a hand stops here, so the body doesn’t tip over', point: neck, badge: 'tl' },
    { label: 'Joint settings: exact position, chain root, limits and bend direction', box: await box(jointSection, -2), badge: 'l' },
  ]);

  // ---- 6. Posing with the Pose tool --------------------------------------------------------------------
  await button('Pose').click();
  const hand = await partPoint('Hand', { x: 0, y: 18 });
  await drag(hand, { x: hand.x + 70, y: hand.y - 150 }, 10);
  const handAfter = await partPoint('Hand', { x: 0, y: 18 });
  await page.mouse.move(handAfter.x, handAfter.y);
  await settle(200);
  const elbowAfter = await jointPoint('Forearm (front)');
  const shoulderAfter = await jointPoint('Upper arm (front)');
  await shot(
    'pose',
    [
      { label: 'Pose tool (K)', box: await box(button('Pose')), badge: 'r' },
      { label: 'Drag the hand: it follows the mouse…', point: handAfter, badge: 'r' },
      { label: '…the elbow bends…', point: elbowAfter, badge: 'r' },
      { label: '…and the shoulder swings. The joints that will turn are highlighted', point: shoulderAfter, badge: 'l' },
    ],
    { x: 0, y: 0, w: 1000, h: 860 },
  );
  await menu('undo');
  await menu('zoomFit');

  // ---- 7. Library ------------------------------------------------------------------------------------------
  await button('Select').click();
  await page.evaluate(() => {
    const nyah = window.__nyah;
    const root = nyah.store.getState().project.scene.layers.find((l) => l.name === 'Pip').root;
    nyah.store.set({ selection: [root.id], sidebarTab: 'library' });
  });
  await settle(200);
  await button('Save to library…').click();
  await page.getByLabel('Library item name').fill('Pip the puppet');
  await page.getByLabel('Tags').fill('kid, demo');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await page.getByTestId('library-list').getByText('Pip the puppet').waitFor();
  await shot(
    'library',
    [
      { label: 'Search by name or tag', box: await box($('.library .search')), badge: 'b' },
      { label: 'Reload, and open the library folder in Finder', box: union(await box(page.getByTitle('Reload the library folder')), await box(button('Folder'))), badge: 'b' },
      { label: 'Save the selected layer or parts as a library item', box: await box(button('Save to library…')), badge: 'l' },
      { label: 'A saved item, with a picture, its kind and tags', box: await box($('.library-item .meta')), badge: 'b' },
      { label: 'Add a fresh copy to this project', box: await box($('.library-item').getByRole('button', { name: 'Add' })), badge: 'b' },
      { label: 'Move the item to the Trash', box: await box($('.library-item .icon')), badge: 'r' },
    ],
    { x: sideClip.x, y: 0, w: sideClip.w, h: 260 },
  );
  await page.evaluate(() => window.__nyah.store.set({ sidebarTab: 'layers' }));

  // ---- 8. Animate mode ---------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Animate' }).click();
  await settle(300);
  await menu('zoomFit');
  await goToFrame(33);
  await selectPart('Forearm (front)');
  await setStatus('');
  const mark = row('Forearm (front)').locator('.tl-mark[data-frame="30"]');
  await shot('animate', [
    { label: 'Play and pause (Space), step a frame (← →), and the current frame', box: union(await box($('.timeline-bar button').first()), await box(page.getByTestId('frame'))), badge: 't' },
    { label: 'Loop range: I and O set where playback loops', box: union(await box(button('In')), await box(button('Out'))), badge: 't' },
    { label: 'Sound while scrubbing, and onion skin', box: union(await box($('.timeline-bar .check').first()), await box($('.timeline-bar .check').nth(1))), badge: 't' },
    { label: 'Timeline zoom, and Export', box: union(await box(page.getByRole('button', { name: 'Zoom timeline out' })), await box($('.timeline-bar .primary'))), badge: 't' },
    { label: 'The Scene row: every pose in the scene', box: await box($('.tl-scene .tl-name'), 0), badge: 'r' },
    { label: 'A layer row: every pose of that character', box: await box(page.getByTestId('tl-layer').first().locator('.tl-name'), 0), badge: 'r' },
    { label: 'Part rows: each part’s own poses', box: await box(row('Torso').locator('.tl-name'), 0), badge: 'r' },
    { label: 'A pose (◆). Drag it to retime', point: await (async () => { const b = await box(mark, 0); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; })(), badge: 'b' },
    { label: 'The playhead: the frame on screen', box: await box($('.tl-playhead'), 1), badge: 'b' },
    { label: 'Properties show and record the pose on this frame', box: await box(page.getByTestId('properties'), -2), badge: 'l' },
    { label: 'Animate mode tools: Select, Pose, Pin and Hand', box: await box($('.toolbar'), 2), badge: 'r' },
  ]);

  // ---- 9. Retiming and easing -------------------------------------------------------------------------------------
  const markEl = row('Upper arm (front)').locator('.tl-mark[data-frame="22"]');
  await markEl.scrollIntoViewIfNeeded();
  await markEl.click();
  await settle(200);
  const timeline = await box($('.timeline'), 0);
  const props = await box(page.getByTestId('properties'), 0);
  const markBox = await box(markEl, 1);
  const zoom = await page.evaluate(() => window.__nyah.store.getState().timeline.zoom);
  await shot(
    'retime',
    [
      { label: 'The selected pose (blue)', point: { x: markBox.x + markBox.w / 2, y: markBox.y + markBox.h / 2 }, badge: 't' },
      { label: 'Drag it left to make the move faster, right to make it slower. Shift-drag moves everything after it too', point: { x: markBox.x + markBox.w / 2 - 4 * zoom, y: markBox.y + markBox.h / 2 }, badge: 'b' },
      { label: 'How the motion leaves this pose: Smooth, Ease in/out, Linear or Hold', box: await box(page.getByLabel('Pose easing')), badge: 'l' },
      { label: 'Delete the selected poses (or press Delete)', box: await box(page.locator('.properties button', { hasText: /^Delete pose/ })), badge: 'l' },
    ],
    { x: 0, y: timeline.y - 140, w: W, h: H - timeline.y + 140 },
  );
  // Keep the pose-marks section visible in the crop.
  void props;
  await page.keyboard.press('Escape');

  // ---- 10. Onion skin ----------------------------------------------------------------------------------------------------
  await $('.timeline-bar .check').nth(1).locator('input').check();
  await goToFrame(33);
  await settle(300);
  const handNow = await partPoint('Hand', { x: 0, y: 18 }, true);
  await shot(
    'onion',
    [
      { label: 'Onion skin is on', box: await box($('.timeline-bar .check').nth(1)), badge: 't' },
      { label: 'Earlier frames show in red, later frames in green, so you can see the arc of a movement', point: { x: handNow.x + 30, y: handNow.y - 20 }, badge: 'r' },
    ],
    { x: 250, y: 150, w: 800, h: 580 },
  );
  await $('.timeline-bar .check').nth(1).locator('input').uncheck();

  // ---- 11. Pins ---------------------------------------------------------------------------------------------------------------
  await goToFrame(5);
  await button('Pin').click();
  await zoomOn(await partPoint('Torso', { x: 0, y: 60 }, true), 1.7, 0);
  const foot = await partPoint('Leg (left)', { x: 0, y: 190 }, true);
  await page.mouse.click(foot.x, foot.y);
  await settle(300);
  await row('Leg (left)').scrollIntoViewIfNeeded();
  const pinBar = await box(row('Leg (left)').locator('.tl-pin'), 2);
  await shot('pins', [
    { label: 'Pin tool (P)', box: await box(button('Pin')), badge: 'r' },
    { label: 'The pinned foot. It stays put while the body moves; the leg bends to reach it', point: foot, badge: 'r' },
    { label: 'The yellow bar shows the frames where the part is pinned', box: { ...pinBar, w: Math.min(pinBar.w, 500) }, badge: 't' },
    { label: 'The status bar confirms what happened', box: await box($('.topbar .status')), badge: 'b' },
  ]);
  await menu('zoomFit');

  // ---- 12. Sound -----------------------------------------------------------------------------------------------------------------
  const wav = join(work, 'Hello there.wav');
  writeFileSync(wav, speechLikeWav(2.2));
  await button('Select').click();
  await goToFrame(2);
  await mockOpen([wav]);
  await menu('import');
  await page.getByTestId('audio-clip').waitFor();
  await settle(600); // let the waveform draw
  await page.getByTestId('timeline').evaluate((el) => (el.scrollTop = 0));
  await shot('sound', [
    { label: 'Import Art or Sound… (⌘I) adds a sound at the current frame', box: await box(button('Import…')), badge: 'b' },
    { label: 'The Sound row, with the sound’s waveform. Drag it to line it up', box: await box(page.getByTestId('audio-clip'), 1), badge: 'b' },
    { label: 'Sound while scrubbing: hear each frame as you step or drag the playhead', box: await box($('.timeline-bar .check').first()), badge: 't' },
    { label: 'Sound properties: name, start frame, volume and mute', box: await box($('.properties .section').first(), -2), badge: 'l' },
  ]);

  // ---- 13. Mouth drawings (Build mode) -------------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Build' }).click();
  await settle(200);
  await selectPart('Mouth');
  const drawings = page.locator('.properties .section').filter({ hasText: 'Drawing set' });
  await drawings.scrollIntoViewIfNeeded();
  const drawingsBox = await box(drawings, 0);
  await shot(
    'mouth-set',
    [
      { label: 'Which drawing set this switch layer uses. Swap sets to change a character’s mouth art', box: await box(page.getByLabel('Drawing set')), badge: 'l' },
      { label: 'Mouth (lip sync) or Other (eyes, hands…)', box: await box(page.getByLabel('Used for')), badge: 'l' },
      { label: 'Each drawing: click the picture to make it the resting mouth', box: await box($('.drawing-row button.icon').first()), badge: 'l' },
      { label: 'Its key: the letter you type. Rename it here', box: await box($('.drawing-row input').first()), badge: 'b' },
      { label: 'The sounds this mouth shape is for', box: await box($('.drawing-row .name').nth(2)), badge: 'b' },
      { label: 'Remove a drawing', box: await box($('.drawing-row button[aria-label^="Remove"]').first()), badge: 'r' },
    ],
    { x: drawingsBox.x - 10, y: drawingsBox.y - 10, w: drawingsBox.w + 20, h: Math.min(H - drawingsBox.y + 10, 440) },
  );

  // ---- 14. Lip sync (Animate mode) ------------------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Animate' }).click();
  await settle(200);
  await menu('zoomFit');
  await selectPart('Mouth');
  await goToFrame(17);
  const mouthRow = row('Mouth');
  // A taller timeline shows the Sound row and the Mouth row together.
  await growTimeline(200);
  await page.getByTestId('timeline').evaluate((el) => (el.scrollTop = 0));
  await zoomOn(await partPoint('Head', { x: 0, y: 0 }, true), 2.4, 0);
  const mouthOnFace = await partPoint('Mouth', { x: 0, y: 4 }, true);
  const block = mouthRow.locator('.tl-block.key-D').first();
  await shot('lipsync', [
    { label: 'The mouth palette appears when a switch layer is selected in Animate mode', box: await box($('.drawing-palette .label')), badge: 't' },
    { label: 'Type a letter (or click a picture) to show that mouth from this frame', box: await box($('.palette-item').first(), 1), badge: 'b' },
    { label: 'After each letter the playhead moves on 1 or 2 frames', box: await box(page.getByLabel('Frames per key')), badge: 't' },
    { label: 'The Mouth row: a coloured block for each mouth, from where it starts to the next change', box: await box(block, 1), badge: 'b' },
    { label: 'The dialogue on the Sound row, to line the mouths up with', box: await box(page.getByTestId('audio-clip'), 1), badge: 'r' },
    { label: 'The mouth on this frame', point: mouthOnFace, badge: 'r' },
  ]);

  // ---- 15. Export ------------------------------------------------------------------------------------------------------------------------
  await menu('export');
  const dialogBox = page.getByRole('dialog', { name: 'Export video' });
  await dialogBox.waitFor();
  const dlg = await box(dialogBox, 0);
  await shot(
    'export',
    [
      { label: 'MP4 video, or a PNG image sequence (optionally see-through)', box: await box(dialogBox.getByLabel('Export format')), badge: 'r' },
      { label: 'Size: the scene size, or 720p up to 4K', box: await box(dialogBox.getByLabel('Export size')), badge: 'r' },
      { label: 'The whole scene, or just the loop range', box: await box(dialogBox.getByLabel('Export range')), badge: 'r' },
      { label: 'Length and size, and whether the sound is included', box: union(await box(dialogBox.locator('.hint').first()), await box(page.getByTestId('export-sound'))), badge: 'r' },
      { label: 'Choose where to save and start. A progress bar and Cancel appear while it works', box: await box(dialogBox.getByRole('button', { name: 'Export…' })), badge: 'b' },
    ],
    { x: dlg.x - 150, y: dlg.y - 30, w: dlg.w + 300, h: dlg.h + 60 },
  );
  await dialogBox.getByRole('button', { name: 'Close' }).click();

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await app.close();
  writeFileSync(join(outDir, 'figures.json'), JSON.stringify(figures, null, 2));
  return figures;
}
