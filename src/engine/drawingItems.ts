import { boundsOfPoints, EMPTY_BOUNDS, pathsBounds, transformPath, unionBounds, type Bounds } from './geometry';
import { applyToPoint, type Mat2D } from './math';
import type { Drawing, DrawingItem, Project } from './types';

// Small helpers for switch-layer drawings (docs/DESIGN.md §8.1), kept free of
// other engine modules so anything can use them.

export function findDrawing(project: Project, setId: string | undefined, key: string | undefined): Drawing | undefined {
  if (!setId || key === undefined) return undefined;
  return project.drawingSets.find((s) => s.id === setId)?.drawings.find((d) => d.key === key);
}

/** Bounds of drawing items mapped through `m` (drawing space → wherever). */
export function drawingItemsBounds(items: readonly DrawingItem[], m: Mat2D): Bounds {
  let b = EMPTY_BOUNDS;
  for (const item of items) {
    if (item.kind === 'shape') b = unionBounds(b, pathsBounds(item.paths.map((p) => transformPath(p, m))));
    else {
      const { x, y, width: w, height: h } = item;
      b = unionBounds(b, boundsOfPoints([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map((p) => applyToPoint(m, p))));
    }
  }
  return b;
}
