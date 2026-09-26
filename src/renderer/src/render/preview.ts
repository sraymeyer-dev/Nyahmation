import { evaluateScene, type ResolvedScene } from '../../../engine/evaluate';
import { IDENTITY, multiply, type Mat2D } from '../../../engine/math';
import type { EditorState } from '../editor/store';
import { renderScene, type ImageLookup } from './canvasRenderer';

// The scene as the editor's canvas shows it: onion skins, then the frame,
// drawn at the preview quality (docs/DESIGN.md N9). At Half or Quarter the
// scene is drawn into a smaller canvas and scaled up, which is much less work
// for a slow graphics chip. Handles and outlines are drawn afterwards at full
// sharpness by the viewport. Export never comes through here.

type PreviewState = Pick<EditorState, 'project' | 'frame' | 'view' | 'mode' | 'onion' | 'playing' | 'previewQuality' | 'viewOnOnes' | 'cameraView'>;

let onionCanvas: OffscreenCanvas | null = null;
let lowCanvas: OffscreenCanvas | null = null;

function reuse(canvas: OffscreenCanvas | null, width: number, height: number): OffscreenCanvas {
  if (canvas && canvas.width === width && canvas.height === height) return canvas;
  return new OffscreenCanvas(width, height);
}

const context2d = (c: OffscreenCanvas) => c.getContext('2d') as unknown as CanvasRenderingContext2D;

/**
 * Onion skinning (docs/DESIGN.md A8): earlier frames tinted red, later frames
 * tinted green, fading with distance.
 */
function drawOnionSkins(ctx: CanvasRenderingContext2D, s: PreviewState, screen: Mat2D, images: ImageLookup): void {
  const { width, height } = ctx.canvas;
  onionCanvas = reuse(onionCanvas, width, height);
  const off = context2d(onionCanvas);
  const n = s.project.scene.durationFrames;
  const { before, after, step } = s.onion;
  const skins: { frame: number; color: string; alpha: number }[] = [];
  for (let k = before; k >= 1; k--) skins.push({ frame: s.frame - k * step, color: '#e5484d', alpha: 0.35 / k });
  for (let k = after; k >= 1; k--) skins.push({ frame: s.frame + k * step, color: '#30a46c', alpha: 0.35 / k });
  for (const skin of skins) {
    if (skin.frame < 0 || skin.frame >= n) continue;
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.globalCompositeOperation = 'source-over';
    off.clearRect(0, 0, width, height);
    // Through the camera, each skin is shown as that frame's picture showed it.
    const resolved = evaluateScene(s.project, skin.frame, { onOnes: s.viewOnOnes });
    renderScene(off, s.project, resolved, multiply(screen, lens(s, resolved)), images, { clip: false, background: false, effects: false });
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.globalCompositeOperation = 'source-in';
    off.fillStyle = skin.color;
    off.fillRect(0, 0, width, height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = skin.alpha;
    ctx.drawImage(onionCanvas, 0, 0);
    ctx.restore();
  }
}

/** The camera, when the canvas looks through it (see editor/screen.ts). */
const lens = (s: PreviewState, resolved: ResolvedScene): Mat2D => (s.mode === 'animate' && s.cameraView ? resolved.cameraMatrix : IDENTITY);

/**
 * Draws the scene into `ctx` (a full-size canvas, already cleared to the
 * workspace colour). `dpr` is the screen's pixel density.
 */
export function renderPreview(ctx: CanvasRenderingContext2D, s: PreviewState, resolved: ResolvedScene, dpr: number, images: ImageLookup): void {
  const q = s.previewQuality;
  const k = dpr * q;
  const { zoom, panX, panY } = s.view;
  const screen: Mat2D = [zoom * k, 0, 0, zoom * k, panX * k, panY * k];
  const view = multiply(screen, lens(s, resolved));

  let target = ctx;
  let low: OffscreenCanvas | null = null;
  if (q < 1) {
    low = lowCanvas = reuse(lowCanvas, Math.max(1, Math.ceil(ctx.canvas.width * q)), Math.max(1, Math.ceil(ctx.canvas.height * q)));
    target = context2d(low);
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, low.width, low.height);
  }

  const onion = s.mode === 'animate' && s.onion.enabled && !s.playing;
  if (onion) {
    // Scene background, then faint tinted copies of nearby frames, then this frame on top.
    renderScene(target, s.project, { ...resolved, parts: [] }, view, images, { clip: false });
    drawOnionSkins(target, s, screen, images);
  }
  renderScene(target, s.project, resolved, view, images, { clip: false, background: !onion });

  if (low) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(low, 0, 0, low.width / q, low.height / q);
    ctx.restore();
  }
}
