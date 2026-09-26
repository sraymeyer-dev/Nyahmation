import { locatePart, restWorldMatrix, updatePart, type PartLocation } from '../../../../engine/edit';
import { applyToPoint, invert, type Mat2D } from '../../../../engine/math';
import { bendSegment, insertPoint, isSmooth, movePoints, nearestOnPath, setHandle, setPointSmooth } from '../../../../engine/pathEdit';
import type { Project, Vec2, VectorPath } from '../../../../engine/types';
import { resolvedScene, select } from '../actions';
import { hitTopPart } from '../hitTest';
import { store, type EditorState, type PointRef } from '../store';
import { toScreen as stageToScreenPoint } from '../screen';
import { ACCENT, dist, drawHandle, drawMarquee, GRAB_PX, invalidate, pixel, snap } from './common';
import type { OverlayContext, Tool, ToolPointer } from './types';

// Points tool: edit a shape's anchor points, handles and curves.
//   drag a point → move it (Shift-click adds to the selection)
//   drag a handle → reshape the curve (Alt breaks a smooth point's handles)
//   drag a segment → bend it
//   double-click a segment → add a point; double-click a point → smooth ↔ corner
//   Delete → remove the selected points

type Which = 'handleIn' | 'handleOut';

interface Target {
  loc: PartLocation;
  paths: VectorPath[];
  world: Mat2D;
  toLocal: Mat2D;
}

function target(s: EditorState): Target | null {
  const id = s.selection[0];
  if (!id) return null;
  const loc = locatePart(s.project, id);
  if (!loc || loc.part.kind !== 'shape' || !loc.part.paths || loc.part.locked) return null;
  const world = restWorldMatrix(loc);
  return { loc, paths: loc.part.paths, world, toLocal: invert(world) };
}

const isSelected = (s: EditorState, path: number, index: number) => s.points.some((p) => p.path === path && p.index === index);

function screenOf(s: EditorState, t: Target, p: Vec2): Vec2 {
  return stageToScreenPoint(s, applyToPoint(t.world, p));
}

function hitAnchor(s: EditorState, t: Target, screen: Vec2): PointRef | null {
  for (let pi = t.paths.length - 1; pi >= 0; pi--) {
    const pts = t.paths[pi]!.points;
    for (let i = pts.length - 1; i >= 0; i--) if (dist(screenOf(s, t, pts[i]!.anchor), screen) <= GRAB_PX) return { path: pi, index: i };
  }
  return null;
}

function hitHandle(s: EditorState, t: Target, screen: Vec2): (PointRef & { which: Which }) | null {
  for (const ref of s.points) {
    const pt = t.paths[ref.path]?.points[ref.index];
    if (!pt) continue;
    for (const which of ['handleIn', 'handleOut'] as const) {
      const h = pt[which];
      if (h && dist(screenOf(s, t, { x: pt.anchor.x + h.x, y: pt.anchor.y + h.y }), screen) <= GRAB_PX) return { ...ref, which };
    }
  }
  return null;
}

function hitSegment(t: Target, scene: Vec2): { path: number; segment: number; t: number } | null {
  const local = applyToPoint(t.toLocal, scene);
  const scale = Math.sqrt(Math.abs(t.world[0] * t.world[3] - t.world[1] * t.world[2])) || 1;
  const tolerance = (GRAB_PX * pixel()) / scale;
  let best: { path: number; segment: number; t: number; d: number } | null = null;
  t.paths.forEach((path, pi) => {
    const hit = nearestOnPath(path, local);
    if (hit && hit.distance <= tolerance && (!best || hit.distance < best.d)) best = { path: pi, segment: hit.segment, t: hit.t, d: hit.distance };
  });
  return best;
}

function withPaths(project: Project, t: Target, paths: VectorPath[]): Project {
  return updatePart(project, t.loc.part.id, (p) => ({ ...p, paths }));
}

type Drag =
  | { kind: 'points'; base: Project; t: Target; startLocal: Vec2; anchorLocal: Vec2 }
  | { kind: 'handle'; base: Project; t: Target; ref: PointRef; which: Which }
  | { kind: 'bend'; base: Project; t: Target; path: number; segment: number; at: number; startLocal: Vec2 }
  | { kind: 'marquee'; start: Vec2; current: Vec2; additive: boolean; before: readonly PointRef[] };

let drag: Drag | null = null;

export const pointsTool: Tool = {
  cursor: () => 'default',

  down(p: ToolPointer) {
    const s = store.getState();
    const t = target(s);
    if (t) {
      const handle = hitHandle(s, t, p.screen);
      if (handle) {
        store.beginGesture();
        drag = { kind: 'handle', base: s.project, t, ref: handle, which: handle.which };
        return;
      }
      const anchor = hitAnchor(s, t, p.screen);
      if (anchor) {
        let points: PointRef[];
        if (p.shift) {
          points = isSelected(s, anchor.path, anchor.index)
            ? s.points.filter((x) => !(x.path === anchor.path && x.index === anchor.index))
            : [...s.points, anchor];
        } else {
          points = isSelected(s, anchor.path, anchor.index) ? s.points.slice() : [anchor];
        }
        store.set({ points });
        store.beginGesture();
        const a = t.paths[anchor.path]!.points[anchor.index]!.anchor;
        drag = { kind: 'points', base: s.project, t, startLocal: applyToPoint(t.toLocal, p.scene), anchorLocal: a };
        return;
      }
      const seg = hitSegment(t, p.scene);
      if (seg) {
        if (!p.shift) store.set({ points: [] });
        store.beginGesture();
        drag = { kind: 'bend', base: s.project, t, path: seg.path, segment: seg.segment, at: seg.t, startLocal: applyToPoint(t.toLocal, p.scene) };
        return;
      }
    }
    // Clicking another shape switches to editing it.
    const hit = hitTopPart(s.project, resolvedScene(s), p.scene, GRAB_PX * pixel());
    if (hit && hit.id !== t?.loc.part.id) {
      select([hit.id]);
      return;
    }
    drag = { kind: 'marquee', start: p.scene, current: p.scene, additive: p.shift, before: p.shift ? s.points : [] };
    if (!p.shift) store.set({ points: [] });
  },

  move(p, dragging) {
    if (!dragging || !drag) return;
    if (drag.kind === 'marquee') {
      drag.current = p.scene;
      const s = store.getState();
      const t = target(s);
      if (t) {
        const box = { x0: Math.min(drag.start.x, p.scene.x), y0: Math.min(drag.start.y, p.scene.y), x1: Math.max(drag.start.x, p.scene.x), y1: Math.max(drag.start.y, p.scene.y) };
        const inside: PointRef[] = [];
        t.paths.forEach((path, pi) =>
          path.points.forEach((pt, i) => {
            const q = applyToPoint(t.world, pt.anchor);
            if (q.x >= box.x0 && q.x <= box.x1 && q.y >= box.y0 && q.y <= box.y1) inside.push({ path: pi, index: i });
          }),
        );
        const before = drag.before;
        const added = inside.filter((r) => !before.some((b) => b.path === r.path && b.index === r.index));
        store.set({ points: [...before, ...added] });
      }
      invalidate();
      return;
    }
    const t = drag.t;
    const local = applyToPoint(t.toLocal, p.scene);
    if (drag.kind === 'points') {
      // Snap the grabbed point to the grid (in the scene), then move all selected points the same way.
      const grabbedScene = snap(applyToPoint(t.world, { x: drag.anchorLocal.x + local.x - drag.startLocal.x, y: drag.anchorLocal.y + local.y - drag.startLocal.y }));
      const grabbedLocal = applyToPoint(t.toLocal, grabbedScene);
      const delta = { x: grabbedLocal.x - drag.anchorLocal.x, y: grabbedLocal.y - drag.anchorLocal.y };
      const points = store.getState().points;
      const paths = t.paths.map((path, i) => movePoints(path, points.filter((r) => r.path === i).map((r) => r.index), delta));
      store.preview(withPaths(drag.base, t, paths));
    } else if (drag.kind === 'handle') {
      const pt = t.paths[drag.ref.path]!.points[drag.ref.index]!;
      const offset = { x: local.x - pt.anchor.x, y: local.y - pt.anchor.y };
      const paths = t.paths.slice();
      paths[drag.ref.path] = setHandle(paths[drag.ref.path]!, drag.ref.index, drag.which, offset, p.alt);
      store.preview(withPaths(drag.base, t, paths));
    } else {
      const delta = { x: local.x - drag.startLocal.x, y: local.y - drag.startLocal.y };
      const paths = t.paths.slice();
      paths[drag.path] = bendSegment(paths[drag.path]!, drag.segment, drag.at, delta);
      store.preview(withPaths(drag.base, t, paths));
    }
  },

  up() {
    if (drag && drag.kind !== 'marquee') store.endGesture();
    drag = null;
    invalidate();
  },

  doubleClick(p) {
    const s = store.getState();
    const t = target(s);
    if (!t) return;
    const anchor = hitAnchor(s, t, p.screen);
    const paths = t.paths.slice();
    if (anchor) {
      const pt = paths[anchor.path]!.points[anchor.index]!;
      paths[anchor.path] = setPointSmooth(paths[anchor.path]!, anchor.index, !isSmooth(pt));
      store.commit(withPaths(s.project, t, paths), { points: [anchor] });
      return;
    }
    const seg = hitSegment(t, p.scene);
    if (seg) {
      const { path, index } = insertPoint(paths[seg.path]!, seg.segment, seg.t);
      paths[seg.path] = path;
      store.commit(withPaths(s.project, t, paths), { points: [{ path: seg.path, index }] });
    }
  },

  finish() {
    drag = null;
  },

  drawOverlay(o: OverlayContext) {
    const { ctx, s } = o;
    if (drag?.kind === 'marquee') drawMarquee(ctx, o.toScreen(drag.start), o.toScreen(drag.current));
    const t = target(s);
    if (!t) return;
    ctx.save();
    t.paths.forEach((path, pi) =>
      path.points.forEach((pt, i) => {
        const a = screenOf(s, t, pt.anchor);
        if (isSelected(s, pi, i)) {
          for (const which of ['handleIn', 'handleOut'] as const) {
            const h = pt[which];
            if (!h) continue;
            const hp = screenOf(s, t, { x: pt.anchor.x + h.x, y: pt.anchor.y + h.y });
            ctx.strokeStyle = ACCENT;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(hp.x, hp.y);
            ctx.stroke();
            drawHandle(ctx, hp, true, 'circle');
          }
        }
        drawHandle(ctx, a, isSelected(s, pi, i), isSmooth(pt) ? 'circle' : 'square');
      }),
    );
    ctx.restore();
  },
};
