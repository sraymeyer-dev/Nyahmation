import { invert, multiply, type Mat2D } from '../../../engine/math';
import type { ResolvedPart, ResolvedScene } from '../../../engine/evaluate';
import { findDrawing } from '../../../engine/drawingItems';
import type { DrawingItem, Gradient, Project, ShapeStyle, VectorPath } from '../../../engine/types';
import { compoundPath2D } from './paths';

// Draws a resolved scene with Canvas 2D. The same function serves the editor
// preview and (later) video export, so they always match (docs/DESIGN.md N3).

export type ImageLookup = (assetId: string) => CanvasImageSource | null;

/** A canvas gradient in the current transform's coordinates (docs/DESIGN.md D10). */
export function canvasGradient(ctx: CanvasRenderingContext2D, g: Gradient): CanvasGradient {
  const grad =
    g.kind === 'linear'
      ? ctx.createLinearGradient(g.from.x, g.from.y, g.to.x, g.to.y)
      : ctx.createRadialGradient(g.from.x, g.from.y, 0, g.from.x, g.from.y, Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y));
  for (const stop of g.stops) {
    try {
      grad.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
    } catch {
      // An unreadable colour is skipped rather than stopping the drawing.
    }
  }
  return grad;
}

function drawPaths(ctx: CanvasRenderingContext2D, paths: readonly VectorPath[], style: ShapeStyle): void {
  const path = compoundPath2D(paths);
  if (style.fill) {
    ctx.fillStyle = style.fillGradient && style.fillGradient.stops.length ? canvasGradient(ctx, style.fillGradient) : style.fill;
    ctx.fill(path, style.fillRule);
  }
  if (style.stroke && style.strokeWidth > 0) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth;
    ctx.lineCap = style.lineCap;
    ctx.lineJoin = style.lineJoin;
    ctx.stroke(path);
  }
}

/** Paints a switch-layer drawing's items in order. */
export function drawItems(ctx: CanvasRenderingContext2D, items: readonly DrawingItem[], images: ImageLookup): void {
  for (const item of items) {
    if (item.kind === 'shape') drawPaths(ctx, item.paths, item.style);
    else {
      const img = images(item.assetId);
      if (img) ctx.drawImage(img, item.x, item.y, item.width, item.height);
    }
  }
}

/**
 * `view` maps stage coordinates to canvas pixels. For export it includes the
 * camera (see pictureView); the editor may look at the stage without it. The
 * background fills, and `clip` clips to, what the camera sees.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: ResolvedScene,
  view: Mat2D,
  images: ImageLookup,
  options: { clip?: boolean; background?: boolean } = {},
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

  const drawPart = (part: ResolvedPart, m: Mat2D) => {
    if (!part.visible || part.opacity <= 0) return;
    ctx.globalAlpha = part.opacity;
    ctx.setTransform(...multiply(m, part.world));
    if (part.kind === 'shape' && part.paths && part.style) {
      drawPaths(ctx, part.paths, part.style);
    } else if (part.kind === 'image' && part.image) {
      const img = images(part.image.assetId);
      if (img) ctx.drawImage(img, 0, 0, part.image.width, part.image.height);
    } else if (part.kind === 'switch') {
      const drawing = findDrawing(project, part.drawingSetId, part.drawing);
      if (drawing) drawItems(ctx, drawing.items, images);
    }
  };
  // Parts come layer by layer; a repeating layer is drawn once per copy (BG5).
  const parts = scene.parts;
  for (let i = 0; i < parts.length; ) {
    let end = i;
    while (end < parts.length && parts[end]!.layerId === parts[i]!.layerId) end++;
    const copies = scene.repeats?.get(parts[i]!.layerId) ?? [];
    for (const copy of [null, ...copies]) {
      const m = copy ? multiply(view, copy) : view;
      for (let j = i; j < end; j++) drawPart(parts[j]!, m);
    }
    i = end;
  }
  ctx.restore();
}

/** Stage → canvas pixels for a picture `scale` times the scene size, through the camera. */
export function pictureView(scene: ResolvedScene, scale: number): Mat2D {
  return multiply([scale, 0, 0, scale, 0, 0], scene.cameraMatrix);
}
