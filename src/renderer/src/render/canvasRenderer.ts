import { multiply, type Mat2D } from '../../../engine/math';
import type { ResolvedScene } from '../../../engine/evaluate';
import { findDrawing } from '../../../engine/drawingItems';
import type { DrawingItem, Project, ShapeStyle, VectorPath } from '../../../engine/types';
import { compoundPath2D } from './paths';

// Draws a resolved scene with Canvas 2D. The same function serves the editor
// preview and (later) video export, so they always match (docs/DESIGN.md N3).

export type ImageLookup = (assetId: string) => CanvasImageSource | null;

function drawPaths(ctx: CanvasRenderingContext2D, paths: readonly VectorPath[], style: ShapeStyle): void {
  const path = compoundPath2D(paths);
  if (style.fill) {
    ctx.fillStyle = style.fill;
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

/** `view` maps scene coordinates to canvas pixels. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: ResolvedScene,
  view: Mat2D,
  images: ImageLookup,
  options: { clip?: boolean; background?: boolean } = {},
): void {
  ctx.save();
  ctx.setTransform(...view);
  if (options.background !== false) {
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }
  if (options.clip !== false) {
    ctx.beginPath();
    ctx.rect(0, 0, scene.width, scene.height);
    ctx.clip();
  }

  for (const part of scene.parts) {
    if (!part.visible || part.opacity <= 0) continue;
    ctx.globalAlpha = part.opacity;
    ctx.setTransform(...multiply(view, part.world));
    if (part.kind === 'shape' && part.paths && part.style) {
      drawPaths(ctx, part.paths, part.style);
    } else if (part.kind === 'image' && part.image) {
      const img = images(part.image.assetId);
      if (img) ctx.drawImage(img, 0, 0, part.image.width, part.image.height);
    } else if (part.kind === 'switch') {
      const drawing = findDrawing(project, part.drawingSetId, part.drawing);
      if (drawing) drawItems(ctx, drawing.items, images);
    }
  }
  ctx.restore();
}
