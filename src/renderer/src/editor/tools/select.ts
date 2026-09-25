import type { TransformAccess } from '../../../../engine/access';
import { locatePart, topLevelSelection, walkParts } from '../../../../engine/edit';
import { boundsOfPoints, EMPTY_BOUNDS, isEmptyBounds, unionBounds, type Bounds } from '../../../../engine/geometry';
import { applyToPoint, invert, localMatrix, multiply, type Mat2D } from '../../../../engine/math';
import { moveChanges } from '../../../../engine/rig';
import type { Project, Transform, Vec2 } from '../../../../engine/types';
import { resolvedScene, select } from '../actions';
import { editAccess } from '../animate';
import { boundsIntersect, hitTopPart, resolvedBounds } from '../hitTest';
import { store, type EditorState } from '../store';
import { sceneToScreen } from '../view';
import { ACCENT, dist, drawHandle, drawMarquee, GRAB_PX, invalidate, pixel, snap } from './common';
import type { OverlayContext, Tool } from './types';

// Select tool: click to select, drag to move, handles to rotate and scale,
// drag on empty canvas to select with a rectangle. In Build mode it edits the
// rest pose; in Animate mode every change is a pose on the current frame.

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface Frame {
  partId: string;
  world: Mat2D;
  box: Bounds;
  handles: { id: HandleId; point: Vec2 }[];
  jointScene: Vec2;
}

const ROTATE_OFFSET_PX = 26;

/** The transform box for a single selected part, in its own drawing space, as shown now. */
export function selectionFrame(s: EditorState): Frame | null {
  if (s.selection.length !== 1) return null;
  const loc = locatePart(s.project, s.selection[0]!);
  if (!loc?.parent || loc.part.locked) return null;
  const resolved = resolvedScene(s);
  const self = resolved.parts.find((p) => p.id === loc.part.id);
  if (!self) return null;
  const world = self.world;
  const toLocal = invert(world);
  // Everything in the part's subtree, mapped into the part's own drawing space.
  const ids = new Set([...walkParts(loc.part)].map((p) => p.id));
  let box = EMPTY_BOUNDS;
  for (const p of resolved.parts) {
    if (!ids.has(p.id)) continue;
    const b = resolvedBounds(s.project, p);
    if (isEmptyBounds(b)) continue;
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    box = unionBounds(box, boundsOfPoints(corners.map((c) => applyToPoint(toLocal, c))));
  }
  if (isEmptyBounds(box)) return null;
  const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = box;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  return {
    partId: loc.part.id,
    world,
    box,
    jointScene: applyToPoint(world, loc.part.joint.pivot),
    handles: [
      { id: 'nw', point: { x: x0, y: y0 } },
      { id: 'n', point: { x: xm, y: y0 } },
      { id: 'ne', point: { x: x1, y: y0 } },
      { id: 'e', point: { x: x1, y: ym } },
      { id: 'se', point: { x: x1, y: y1 } },
      { id: 's', point: { x: xm, y: y1 } },
      { id: 'sw', point: { x: x0, y: y1 } },
      { id: 'w', point: { x: x0, y: ym } },
    ],
  };
}

function rotateHandleScreen(s: EditorState, f: Frame): Vec2 {
  const toScreen = (p: Vec2) => sceneToScreen(s.view, applyToPoint(f.world, p));
  const top = toScreen({ x: (f.box.minX + f.box.maxX) / 2, y: f.box.minY });
  const center = toScreen({ x: (f.box.minX + f.box.maxX) / 2, y: (f.box.minY + f.box.maxY) / 2 });
  const d = dist(top, center) || 1;
  return { x: top.x + ((top.x - center.x) / d) * ROTATE_OFFSET_PX, y: top.y + ((top.y - center.y) / d) * ROTATE_OFFSET_PX };
}

const OPPOSITE: Record<HandleId, HandleId> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

type Drag =
  | { kind: 'move'; start: Vec2; base: Project; access: TransformAccess; ids: string[]; joint: Vec2 }
  | { kind: 'rotate'; base: Project; access: TransformAccess; id: string; center: Vec2; startAngle: number; local: Transform; sign: number }
  | {
      kind: 'scale';
      base: Project;
      access: TransformAccess;
      id: string;
      handle: HandleId;
      world: Mat2D;
      parent: Mat2D;
      local: Transform;
      pivot: Vec2;
      handlePoint: Vec2;
      anchor: Vec2;
      center: Vec2;
    }
  | { kind: 'marquee'; start: Vec2; current: Vec2; additive: boolean; before: readonly string[] };

let drag: Drag | null = null;

function angleDeg(from: Vec2, to: Vec2): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

export const selectTool: Tool = {
  cursor: () => 'default',

  down(p) {
    const s = store.getState();
    const frame = selectionFrame(s);
    if (frame) {
      const access = editAccess(s);
      const local = access.local(frame.partId);
      const loc = locatePart(s.project, frame.partId)!;
      if (local && dist(p.screen, rotateHandleScreen(s, frame)) <= GRAB_PX) {
        const parent = access.parentWorld(frame.partId);
        store.beginGesture();
        drag = {
          kind: 'rotate',
          base: s.project,
          access,
          id: frame.partId,
          center: frame.jointScene,
          startAngle: angleDeg(frame.jointScene, p.scene),
          local,
          sign: parent[0] * parent[3] - parent[1] * parent[2] < 0 ? -1 : 1,
        };
        return;
      }
      for (const h of frame.handles) {
        if (local && dist(p.screen, sceneToScreen(s.view, applyToPoint(frame.world, h.point))) <= GRAB_PX) {
          const anchor = frame.handles.find((x) => x.id === OPPOSITE[h.id])!.point;
          store.beginGesture();
          drag = {
            kind: 'scale',
            base: s.project,
            access,
            id: frame.partId,
            handle: h.id,
            world: frame.world,
            parent: access.parentWorld(frame.partId),
            local,
            pivot: loc.part.joint.pivot,
            handlePoint: h.point,
            anchor,
            center: { x: (frame.box.minX + frame.box.maxX) / 2, y: (frame.box.minY + frame.box.maxY) / 2 },
          };
          return;
        }
      }
    }

    const hit = hitTopPart(s.project, resolvedScene(s), p.scene, GRAB_PX * pixel());
    if (hit) {
      if (p.shift) {
        select([hit.id], true);
        return;
      }
      if (!s.selection.includes(hit.id)) select([hit.id]);
      const ids = topLevelSelection(s.project, store.getState().selection);
      const access = editAccess(s);
      const first = ids[0] ?? hit.id;
      const joint = applyToPoint(access.world(first), locatePart(s.project, first)!.part.joint.pivot);
      store.beginGesture();
      drag = { kind: 'move', start: p.scene, base: s.project, access, ids, joint };
      return;
    }
    if (!p.shift) select([]);
    drag = { kind: 'marquee', start: p.scene, current: p.scene, additive: p.shift, before: store.getState().selection };
  },

  move(p, dragging) {
    if (!dragging || !drag) return;
    if (drag.kind === 'move') {
      let delta = { x: p.scene.x - drag.start.x, y: p.scene.y - drag.start.y };
      if (store.getState().grid.snap) {
        // Snap the (first) part's joint to the grid, and move everything by the same amount.
        const target = snap({ x: drag.joint.x + delta.x, y: drag.joint.y + delta.y });
        delta = { x: target.x - drag.joint.x, y: target.y - drag.joint.y };
      }
      store.preview(drag.access.write(drag.base, moveChanges(drag.base, drag.access, drag.ids, delta)));
    } else if (drag.kind === 'rotate') {
      let angle = drag.local.rotation + (angleDeg(drag.center, p.scene) - drag.startAngle) * drag.sign;
      if (p.shift) angle = Math.round(angle / 15) * 15;
      store.preview(drag.access.write(drag.base, new Map([[drag.id, { rotation: angle }]])));
    } else if (drag.kind === 'scale') {
      const d = drag;
      const anchor = p.alt ? d.center : d.anchor;
      const m = applyToPoint(invert(d.world), p.scene);
      const hx = d.handlePoint.x - anchor.x;
      const hy = d.handlePoint.y - anchor.y;
      const affectsX = d.handle !== 'n' && d.handle !== 's';
      const affectsY = d.handle !== 'e' && d.handle !== 'w';
      let rx = affectsX && Math.abs(hx) > 1e-9 ? (m.x - anchor.x) / hx : 1;
      let ry = affectsY && Math.abs(hy) > 1e-9 ? (m.y - anchor.y) / hy : 1;
      if (p.shift && affectsX && affectsY) {
        // Keep proportions: project the mouse onto the diagonal.
        const r = ((m.x - anchor.x) * hx + (m.y - anchor.y) * hy) / (hx * hx + hy * hy || 1);
        rx = ry = r;
      }
      const safe = (r: number) => (Math.abs(r) < 0.01 ? (r < 0 ? -0.01 : 0.01) : r);
      const next: Transform = { ...d.local, scaleX: d.local.scaleX * safe(rx), scaleY: d.local.scaleY * safe(ry) };
      // Keep the anchor point fixed on screen.
      const anchorBefore = applyToPoint(d.world, anchor);
      const anchorAfter = applyToPoint(multiply(d.parent, localMatrix(next, d.pivot)), anchor);
      const inv = invert(d.parent);
      const dx = anchorBefore.x - anchorAfter.x;
      const dy = anchorBefore.y - anchorAfter.y;
      next.x += inv[0] * dx + inv[2] * dy;
      next.y += inv[1] * dx + inv[3] * dy;
      store.preview(d.access.write(d.base, new Map([[d.id, next]])));
    } else {
      drag.current = p.scene;
      const s = store.getState();
      const box = {
        minX: Math.min(drag.start.x, p.scene.x),
        minY: Math.min(drag.start.y, p.scene.y),
        maxX: Math.max(drag.start.x, p.scene.x),
        maxY: Math.max(drag.start.y, p.scene.y),
      };
      const inside = resolvedScene(s)
        .parts.filter((part) => part.visible && !part.locked && part.kind !== 'group' && boundsIntersect(resolvedBounds(s.project, part), box))
        .map((part) => part.id);
      const ids = drag.additive ? [...new Set([...drag.before, ...inside])] : inside;
      store.set({ selection: ids, points: [] });
      invalidate();
    }
  },

  up() {
    if (drag && drag.kind !== 'marquee') store.endGesture();
    drag = null;
    invalidate();
  },

  doubleClick(p) {
    const s = store.getState();
    if (s.mode !== 'build') return;
    const hit = hitTopPart(s.project, resolvedScene(s), p.scene, GRAB_PX * pixel());
    if (hit?.kind === 'shape') {
      select([hit.id]);
      store.set({ tool: 'points' });
    }
  },

  finish() {
    drag = null;
  },

  drawOverlay(o: OverlayContext) {
    const { ctx, s } = o;
    if (drag?.kind === 'marquee') drawMarquee(ctx, o.toScreen(drag.start), o.toScreen(drag.current));
    const frame = selectionFrame(s);
    if (!frame) return;
    const pts = ['nw', 'ne', 'se', 'sw'].map((id) => o.toScreen(applyToPoint(frame.world, frame.handles.find((h) => h.id === id)!.point)));
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    ctx.stroke();
    // Rotate handle on a short stem above the top edge.
    const top = o.toScreen(applyToPoint(frame.world, frame.handles.find((h) => h.id === 'n')!.point));
    const rot = rotateHandleScreen(s, frame);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rot.x, rot.y);
    ctx.stroke();
    drawHandle(ctx, rot, false, 'circle');
    for (const h of frame.handles) drawHandle(ctx, o.toScreen(applyToPoint(frame.world, h.point)), false);
    ctx.restore();
  },
};
