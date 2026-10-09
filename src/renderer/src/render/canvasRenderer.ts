import { invert, multiply, type Mat2D } from '../../../engine/math';
import type { ResolvedScene } from '../../../engine/evaluate';
import type { Project } from '../../../engine/types';
import { drawLayerParts, type CachedUnit } from './groups';
import { canvasGradient, type ImageLookup } from './primitives';

export { canvasGradient, drawItems, type ImageLookup } from './primitives';

// Draws a resolved scene with Canvas 2D. The same function serves the editor
// preview and (later) video export, so they always match (docs/DESIGN.md N3).

const unitCaches = new WeakMap<object, Map<string, CachedUnit>>();

/**
 * `view` maps stage coordinates to canvas pixels. For export it includes the
 * camera (see pictureView); the editor may look at the stage without it. The
 * background fills, and `clip` clips to, what the camera sees. `effects`
 * false skips effects (clipping still applies), for onion skins.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: ResolvedScene,
  view: Mat2D,
  images: ImageLookup,
  options: { clip?: boolean; background?: boolean; effects?: boolean } = {},
): void {
  ctx.save();
  // The picture's rectangle, wherever the camera has put it on the stage.
  ctx.setTransform(...multiply(view, invert(scene.cameraMatrix)));
  if (options.background !== false) {
    const sky = project.scene.sky;
    ctx.fillStyle = sky
      ? canvasGradient(ctx, { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 0, y: scene.height }, stops: [{ offset: 0, color: sky.top }, { offset: 1, color: sky.bottom }] })
      : scene.background;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }
  if (options.clip !== false) {
    ctx.beginPath();
    ctx.rect(0, 0, scene.width, scene.height);
    ctx.clip();
  }

  // Finished groups with effects are reused while they look the same (FX6), per canvas.
  const effects = options.effects !== false;
  let cache: Map<string, CachedUnit> | null = null;
  if (effects) {
    cache = unitCaches.get(ctx.canvas) ?? null;
    if (!cache) unitCaches.set(ctx.canvas, (cache = new Map()));
  }
  // Parts come layer by layer; a repeating layer is drawn once per copy (BG5).
  const parts = scene.parts;
  for (let i = 0; i < parts.length; ) {
    let end = i;
    while (end < parts.length && parts[end]!.layerId === parts[i]!.layerId) end++;
    const layer = parts.slice(i, end);
    const copies = scene.repeats?.get(parts[i]!.layerId) ?? [];
    [null, ...copies].forEach((copy, n) => {
      const m = copy ? multiply(view, copy) : view;
      drawLayerParts(ctx, project, layer, m, images, { effects, cache, keyPrefix: String(n) });
    });
    i = end;
  }
  ctx.restore();
}

/** Stage → canvas pixels for a picture `scale` times the scene size, through the camera. */
export function pictureView(scene: ResolvedScene, scale: number): Mat2D {
  return multiply([scale, 0, 0, scale, 0, 0], scene.cameraMatrix);
}
