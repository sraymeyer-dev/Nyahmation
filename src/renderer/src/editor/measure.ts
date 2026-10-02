import { evaluateScene } from '../../../engine/evaluate';
import { getImage } from '../render/images';
import { renderPreview } from '../render/preview';
import { assetMimeType } from './actions';
import { qualityLabel, QUALITIES, sampleFrames, verdict, type Timing } from './previewSpeed';
import { store } from './store';
import { fitView } from './view';

// View → Measure Preview Speed (docs/DESIGN.md N2, N8, N9). Draws frames of
// the open scene as fast as it can, at each preview quality, and says which
// quality keeps up with the scene's frame rate on this computer. It is the
// quick way to check a scene on the reference machine.

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export async function measurePreviewSpeed(): Promise<void> {
  store.set({ playing: false, notice: null, status: 'Measuring preview speed…' });
  await nextPaint();
  const s = store.getState();
  const { project } = s;
  const { width: W, height: H, fps, durationFrames } = project.scene;
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = s.viewportSize;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const images = (id: string) => getImage(id, s.assets.get(id), assetMimeType(s, id));
  // Measure the scene as playback usually shows it: fitted to the view.
  const base = { ...s, view: fitView(W, H, width, height), mode: 'animate' as const, playing: true, viewOnOnes: false };
  const frames = sampleFrames(durationFrames, 72);

  const t0 = performance.now();
  const resolved = frames.map((f) => evaluateScene(project, f));
  const poseMs = (performance.now() - t0) / frames.length;

  const timings: Timing[] = [];
  for (const { quality } of QUALITIES) {
    const st = { ...base, previewQuality: quality };
    const drawOne = (r: (typeof resolved)[number]) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#26272b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      renderPreview(ctx, { ...st, frame: r.frame }, r, dpr, images);
      // Reading a pixel back waits for the graphics chip to finish the frame.
      ctx.getImageData(0, 0, 1, 1);
    };
    drawOne(resolved[0]!); // warm up
    const t = performance.now();
    for (const r of resolved) drawOne(r);
    timings.push({ quality, msPerFrame: (performance.now() - t) / resolved.length + poseMs });
    await nextPaint();
  }

  const { recommended, lines } = verdict(timings, fps);
  const current = store.getState().previewQuality;
  const advice =
    recommended === null
      ? 'Even Quarter can’t keep up, so playback will skip frames (the sound stays in time). Export is not affected.'
      : recommended === current
        ? `Your current preview quality (${qualityLabel(current)}) keeps up.`
        : `Recommended: ${qualityLabel(recommended)}. Choose it from “Preview” in the top bar.`;
  store.set({
    status: '',
    notice: {
      title: 'Preview speed on this computer',
      lines: [
        `Scene ${W}×${H} at ${fps} fps, ${frames.length} frames drawn in a ${canvas.width}×${canvas.height}-pixel view. Each frame must take ${(1000 / fps).toFixed(1)} ms or less.`,
        `Working out the poses (joints, pins): ${poseMs.toFixed(1)} ms a frame.`,
        ...lines,
        advice,
        'Export always renders every frame at full quality, however long it takes.',
      ],
    },
  });
}
