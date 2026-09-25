import type { ResolvedPart, ResolvedScene } from '../../../engine/evaluate';
import { boundsOfPoints, EMPTY_BOUNDS, isEmptyBounds, pathsBounds, transformPath, type Bounds } from '../../../engine/geometry';
import { applyToPoint, invert, multiply } from '../../../engine/math';
import type { Project, Vec2 } from '../../../engine/types';
import { compoundPath2D } from '../render/paths';

// Finds what's under the mouse. Canvas 2D does the geometry, so fill rules,
// curves and stroke widths behave exactly as they're drawn.

let ctx: CanvasRenderingContext2D | null = null;
function context(): CanvasRenderingContext2D {
  ctx ??= document.createElement('canvas').getContext('2d')!;
  return ctx;
}

/** Scale of a matrix (average), used to turn screen tolerances into drawing units. */
function matrixScale(m: readonly number[]): number {
  return Math.sqrt(Math.abs(m[0]! * m[3]! - m[1]! * m[2]!)) || 1;
}

export function hitsPart(project: Project, part: ResolvedPart, scene: Vec2, tolerance: number): boolean {
  const c = context();
  if (part.kind === 'image' && part.image) {
    const local = applyToPoint(invert(part.world), scene);
    return local.x >= 0 && local.y >= 0 && local.x <= part.image.width && local.y <= part.image.height;
  }
  let paths = part.paths;
  let style = part.style;
  let offset = { x: 0, y: 0 };
  if (part.kind === 'switch') {
    const drawing = project.drawingSets.find((s) => s.id === part.drawingSetId)?.drawings.find((d) => d.key === part.drawing);
    if (drawing?.content.kind !== 'vector') return false;
    paths = drawing.content.paths;
    style = drawing.content.style;
    offset = drawing.offset;
  }
  if (!paths?.length || !style) return false;
  const path = compoundPath2D(paths);
  const w = part.world;
  c.setTransform(w[0], w[1], w[2], w[3], w[4], w[5]);
  c.translate(offset.x, offset.y);
  const closed = paths.some((p) => p.closed);
  if (style.fill && closed && c.isPointInPath(path, scene.x, scene.y, style.fillRule)) return true;
  c.lineWidth = Math.max(style.stroke ? style.strokeWidth : 0, (tolerance * 2) / matrixScale(w));
  c.lineCap = 'round';
  c.lineJoin = 'round';
  return c.isPointInStroke(path, scene.x, scene.y);
}

/** The topmost visible, unlocked part with artwork under `scene`. */
export function hitTopPart(project: Project, resolved: ResolvedScene, scene: Vec2, tolerance: number): ResolvedPart | null {
  for (let i = resolved.parts.length - 1; i >= 0; i--) {
    const part = resolved.parts[i]!;
    if (!part.visible || part.locked || part.kind === 'group') continue;
    if (hitsPart(project, part, scene, tolerance)) return part;
  }
  return null;
}

/** A resolved part's own artwork bounds in scene coordinates. */
export function resolvedBounds(project: Project, part: ResolvedPart): Bounds {
  const w = part.world;
  if (part.kind === 'image' && part.image) {
    const { width, height } = part.image;
    return boundsOfPoints([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }].map((p) => applyToPoint(w, p)));
  }
  if (part.kind === 'switch') {
    const drawing = project.drawingSets.find((s) => s.id === part.drawingSetId)?.drawings.find((d) => d.key === part.drawing);
    if (drawing?.content.kind !== 'vector') return EMPTY_BOUNDS;
    const m = multiply(w, [1, 0, 0, 1, drawing.offset.x, drawing.offset.y]);
    return pathsBounds(drawing.content.paths.map((p) => transformPath(p, m)));
  }
  if (part.paths?.length) return pathsBounds(part.paths.map((p) => transformPath(p, w)));
  return EMPTY_BOUNDS;
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !isEmptyBounds(a) && !isEmptyBounds(b) && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
