import { insertShapeFromScene } from '../../../../engine/edit';
import type { PathPoint, Vec2, VectorPath } from '../../../../engine/types';
import { containerForNewPart, nextName } from '../actions';
import { toPath2D } from '../../render/paths';
import { store } from '../store';
import { ACCENT, dist, drawHandle, GRAB_PX, invalidate, snap } from './common';
import type { OverlayContext, Tool, ToolPointer } from './types';

// Pen tool: click for sharp corners, click-and-drag for smooth curves.
// Click the first point to close the shape; Enter, Escape or double-click
// finishes an open line. Backspace removes the last point.

let points: PathPoint[] = []; // scene coordinates
let draggingHandle = false;
let hover: Vec2 | null = null;

function finish(closed: boolean): void {
  // A double-click adds the same point twice; drop exact repeats.
  const pts = points.filter((p, i) => i === 0 || dist(p.anchor, points[i - 1]!.anchor) > 1e-6);
  points = [];
  draggingHandle = false;
  invalidate();
  if (pts.length < 2) return;
  const s = store.getState();
  const target = containerForNewPart(s);
  if (!target) return;
  const { project, containerId, layerId } = target;
  const path: VectorPath = { closed: closed && pts.length > 2, points: pts };
  const style = path.closed ? s.style : { ...s.style, fill: null, stroke: s.style.stroke ?? '#222222' };
  const result = insertShapeFromScene(project, containerId, [path], style, nextName(project, 'Path'));
  if (result.partId) store.commit(result.project, { selection: [result.partId], points: [], activeLayerId: layerId });
}

export const penTool: Tool = {
  cursor: () => 'crosshair',

  down(p: ToolPointer) {
    const at = snap(p.scene);
    if (points.length >= 2 && dist(p.screen, toScreen(points[0]!.anchor)) <= GRAB_PX) {
      finish(true);
      return;
    }
    points.push({ anchor: at });
    draggingHandle = true;
    invalidate();
  },

  move(p, dragging) {
    hover = snap(p.scene);
    const last = points[points.length - 1];
    if (dragging && draggingHandle && last) {
      const out = { x: p.scene.x - last.anchor.x, y: p.scene.y - last.anchor.y };
      const tiny = Math.hypot(out.x, out.y) * store.getState().view.zoom < 3;
      points[points.length - 1] = tiny ? { anchor: last.anchor } : { anchor: last.anchor, handleIn: { x: -out.x, y: -out.y }, handleOut: out };
    }
    invalidate();
  },

  up() {
    draggingHandle = false;
  },

  doubleClick() {
    finish(false);
  },

  keyDown(e) {
    if (points.length === 0) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      finish(false);
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      points.pop();
      invalidate();
      return true;
    }
    return false;
  },

  finish() {
    finish(false);
  },

  drawOverlay(o: OverlayContext) {
    const { ctx } = o;
    if (points.length === 0) return;
    ctx.save();
    const path = toPath2D({ closed: false, points });
    const m = o.toScreenMatrix([1, 0, 0, 1, 0, 0]);
    ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([...m])));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / o.s.view.zoom;
    ctx.stroke(path);
    ctx.restore();

    ctx.save();
    const last = points[points.length - 1]!;
    if (hover && !draggingHandle) {
      // Rubber band from the last point to the mouse.
      const a = o.toScreen(last.anchor);
      const b = o.toScreen(hover);
      ctx.strokeStyle = ACCENT;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (last.handleOut && last.handleIn) {
      const a = o.toScreen(last.anchor);
      for (const h of [last.handleIn, last.handleOut]) {
        const hp = o.toScreen({ x: last.anchor.x + h.x, y: last.anchor.y + h.y });
        ctx.strokeStyle = ACCENT;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(hp.x, hp.y);
        ctx.stroke();
        drawHandle(ctx, hp, true, 'circle');
      }
    }
    points.forEach((pt, i) => drawHandle(ctx, o.toScreen(pt.anchor), i === 0 && points.length >= 2));
    ctx.restore();
  },
};

function toScreen(p: Vec2): Vec2 {
  const { view } = store.getState();
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY };
}
