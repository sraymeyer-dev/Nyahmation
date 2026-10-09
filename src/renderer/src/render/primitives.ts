import type { ResolvedPart } from '../../../engine/evaluate';
import { findDrawing } from '../../../engine/drawingItems';
import { multiply, type Mat2D } from '../../../engine/math';
import type { BlendMode, DrawingItem, Gradient, Project, ShapeStyle, VectorPath } from '../../../engine/types';
import { compoundPath2D } from './paths';

// Drawing single parts with Canvas 2D. groups.ts builds effects and clipping
// on top of these; canvasRenderer.ts draws whole scenes.

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

const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  add: 'lighter',
  overlay: 'overlay',
};

export const compositeFor = (blend: BlendMode | undefined): GlobalCompositeOperation => COMPOSITE[blend ?? 'normal'];

/**
 * Draws one part's own artwork. `m` maps stage coordinates to the canvas.
 * `options.blend` false draws it normally (a group's root inside its own
 * off-screen picture); `opacity` and `composite` override the part's (for
 * masks).
 */
export function drawPart(
  ctx: CanvasRenderingContext2D,
  project: Project,
  part: ResolvedPart,
  m: Mat2D,
  images: ImageLookup,
  options: { blend?: boolean; opacity?: number; composite?: GlobalCompositeOperation } = {},
): void {
  if (!part.visible || part.opacity <= 0 || part.kind === 'group') return;
  ctx.globalAlpha = options.opacity ?? part.opacity;
  ctx.globalCompositeOperation = options.composite ?? (options.blend === false ? 'source-over' : compositeFor(part.blend));
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
  ctx.globalCompositeOperation = 'source-over';
}
