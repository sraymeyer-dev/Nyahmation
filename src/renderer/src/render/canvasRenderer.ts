import { multiply, type Mat2D } from '../../../engine/math';
import { pathCommands } from '../../../engine/geometry';
import type { ResolvedScene } from '../../../engine/evaluate';
import type { Drawing, Project, ShapeStyle, VectorPath } from '../../../engine/types';

// Draws a resolved scene with Canvas 2D. The same function will serve the
// editor preview and video export (docs/DESIGN.md N3).

// Paths are immutable data, so their Path2D can be built once and reused.
const pathCache = new WeakMap<VectorPath, Path2D>();

function toPath2D(path: VectorPath): Path2D {
  let p = pathCache.get(path);
  if (p) return p;
  p = new Path2D();
  for (const c of pathCommands(path)) {
    if (c.op === 'M') p.moveTo(c.x, c.y);
    else if (c.op === 'L') p.lineTo(c.x, c.y);
    else if (c.op === 'C') p.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.x, c.y);
    else p.closePath();
  }
  pathCache.set(path, p);
  return p;
}

function drawPaths(ctx: CanvasRenderingContext2D, paths: readonly VectorPath[], style: ShapeStyle): void {
  const compound = new Path2D();
  for (const path of paths) compound.addPath(toPath2D(path));
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill(compound, style.fillRule);
  }
  if (style.stroke && style.strokeWidth > 0) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth;
    ctx.lineCap = style.lineCap;
    ctx.lineJoin = style.lineJoin;
    ctx.stroke(compound);
  }
}

function findDrawing(project: Project, setId: string | undefined, key: string | undefined): Drawing | undefined {
  if (!setId || key === undefined) return undefined;
  return project.drawingSets.find((s) => s.id === setId)?.drawings.find((d) => d.key === key);
}

/** `view` maps scene coordinates to canvas pixels. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: ResolvedScene,
  view: Mat2D,
): void {
  ctx.save();
  ctx.setTransform(...view);
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.beginPath();
  ctx.rect(0, 0, scene.width, scene.height);
  ctx.clip();

  for (const part of scene.parts) {
    if (!part.visible || part.opacity <= 0) continue;
    ctx.globalAlpha = part.opacity;
    ctx.setTransform(...multiply(view, part.world));
    if (part.kind === 'shape' && part.paths && part.style) {
      drawPaths(ctx, part.paths, part.style);
    } else if (part.kind === 'switch') {
      const drawing = findDrawing(project, part.drawingSetId, part.drawing);
      // Image drawings arrive with lip sync (phase 4).
      if (drawing?.content.kind === 'vector') {
        ctx.translate(drawing.offset.x, drawing.offset.y);
        drawPaths(ctx, drawing.content.paths, drawing.content.style);
      }
    }
  }
  ctx.restore();
}
