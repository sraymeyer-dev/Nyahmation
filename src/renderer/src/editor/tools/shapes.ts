import { insertShapeFromScene } from '../../../../engine/edit';
import { ellipsePath, polygonPath, regularPolygonPath, roundedRectPath, starPath, transformPath } from '../../../../engine/geometry';
import type { Vec2, VectorPath } from '../../../../engine/types';
import { containerForNewPart, nextName } from '../actions';
import { toPath2D } from '../../render/paths';
import { store, type ToolId } from '../store';
import { ACCENT, invalidate, snap } from './common';
import type { OverlayContext, Tool, ToolPointer } from './types';

// Rectangle, ellipse, polygon, star and line tools: drag out a box.
// Shift keeps it square (or the line at 45° steps); Alt draws from the centre.

type ShapeKind = Extract<ToolId, 'rect' | 'ellipse' | 'polygon' | 'star' | 'line'>;

const NAMES: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line' };

function box(kind: ShapeKind, start: Vec2, end: Vec2, shift: boolean, alt: boolean): { a: Vec2; b: Vec2 } {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (shift) {
    if (kind === 'line') {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      dx = Math.cos(angle) * len;
      dy = Math.sin(angle) * len;
    } else {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * size;
      dy = Math.sign(dy || 1) * size;
    }
  }
  if (alt) return { a: { x: start.x - dx, y: start.y - dy }, b: { x: start.x + dx, y: start.y + dy } };
  return { a: start, b: { x: start.x + dx, y: start.y + dy } };
}

function buildPath(kind: ShapeKind, a: Vec2, b: Vec2): VectorPath {
  const { toolOptions: o } = store.getState();
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Fit a unit-radius polygon or star to the box.
  const fit = (p: VectorPath) => transformPath(p, [w / 2, 0, 0, h / 2, cx, cy]);
  switch (kind) {
    case 'rect':
      return roundedRectPath(x, y, w, h, o.cornerRadius);
    case 'ellipse':
      return ellipsePath(cx, cy, w / 2, h / 2);
    case 'polygon':
      return fit(regularPolygonPath(0, 0, 1, o.polygonSides));
    case 'star':
      return fit(starPath(0, 0, 1, o.starInner, o.starPoints));
    case 'line':
      return polygonPath([a, b], false);
  }
}

export function createShapeTool(kind: ShapeKind): Tool {
  let start: Vec2 | null = null;
  let current: { a: Vec2; b: Vec2 } | null = null;

  return {
    cursor: () => 'crosshair',

    down(p: ToolPointer) {
      start = snap(p.scene);
      current = null;
    },

    move(p, dragging) {
      if (!dragging || !start) return;
      current = box(kind, start, snap(p.scene), p.shift, p.alt);
      invalidate();
    },

    up() {
      const c = current;
      start = null;
      current = null;
      invalidate();
      if (!c) return;
      const s = store.getState();
      const minSize = 2 / s.view.zoom;
      if (Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) < minSize) return;
      if (kind !== 'line' && (Math.abs(c.b.x - c.a.x) < minSize || Math.abs(c.b.y - c.a.y) < minSize)) return;
      const target = containerForNewPart(s);
      if (!target) return;
      const { project, containerId, layerId } = target;
      const style = kind === 'line' ? { ...s.style, fill: null, stroke: s.style.stroke ?? '#222222' } : s.style;
      const result = insertShapeFromScene(project, containerId, [buildPath(kind, c.a, c.b)], style, nextName(project, NAMES[kind]));
      if (result.partId) store.commit(result.project, { selection: [result.partId], points: [], activeLayerId: layerId });
    },

    finish() {
      start = null;
      current = null;
    },

    drawOverlay(o: OverlayContext) {
      if (!current) return;
      const { ctx } = o;
      ctx.save();
      const m = o.toScreenMatrix([1, 0, 0, 1, 0, 0]);
      ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([...m])));
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5 / o.s.view.zoom;
      ctx.stroke(toPath2D(buildPath(kind, current.a, current.b)));
      ctx.restore();
    },
  };
}
