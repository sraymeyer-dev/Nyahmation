import { locatePart, movePartsBy, restWorldMatrix, updatePart } from '../../../../engine/edit';
import { applyToPoint, invert } from '../../../../engine/math';
import { dragPose, ikChainIds, rotateAtJoint } from '../../../../engine/rig';
import type { Project, Vec2 } from '../../../../engine/types';
import { resolvedScene, select } from '../actions';
import { hitTopPart } from '../hitTest';
import { drawSkeleton } from '../overlay';
import { store } from '../store';
import { ACCENT, GRAB_PX, invalidate, pixel } from './common';
import type { OverlayContext, Tool, ToolPointer } from './types';

// Pose tool (docs/DESIGN.md R3, R7): drag a part and its parents turn at
// their joints so it follows the mouse (inverse kinematics).
//   drag          pull the part; its IK chain bends (or it turns at its joint)
//   Shift-drag    turn the part at its own joint only
//   Alt-drag      move the part itself, away from its joint
//   Cmd/Ctrl-drag move the whole layer (e.g. the whole character)
// In Build mode this sets the rest pose. Posing on the timeline arrives with
// Animate mode editing (phase 3).

type Mode = 'ik' | 'rotate' | 'move' | 'moveLayer';

let drag: { mode: Mode; id: string; base: Project; grab: Vec2; start: Vec2; layerRootId: string } | null = null;
let hoverChain: ReadonlySet<string> = new Set();
let pointer: Vec2 | null = null;

function modeFor(p: ToolPointer): Mode {
  if (p.mod) return 'moveLayer';
  if (p.alt) return 'move';
  if (p.shift) return 'rotate';
  return 'ik';
}

/** The joints that would turn if this part were dragged (for the highlight). */
function chainFor(project: Project, id: string, mode: Mode): Set<string> {
  if (mode === 'rotate') return new Set([id]);
  if (mode !== 'ik') return new Set();
  const chain = ikChainIds(project, id);
  return new Set(chain.length ? chain : [id]);
}

export const poseTool: Tool = {
  cursor: () => 'default',

  down(p) {
    const s = store.getState();
    const hit = hitTopPart(s.project, resolvedScene(s), p.scene, GRAB_PX * pixel());
    if (!hit) {
      select([]);
      return;
    }
    select([hit.id]);
    const loc = locatePart(s.project, hit.id)!;
    store.beginGesture();
    drag = {
      mode: modeFor(p),
      id: hit.id,
      base: s.project,
      grab: applyToPoint(invert(restWorldMatrix(loc)), p.scene),
      start: p.scene,
      layerRootId: loc.layer.root.id,
    };
    hoverChain = chainFor(s.project, hit.id, drag.mode);
  },

  move(p, dragging) {
    pointer = p.scene;
    if (!dragging || !drag) {
      const s = store.getState();
      const hit = hitTopPart(s.project, resolvedScene(s), p.scene, GRAB_PX * pixel());
      hoverChain = hit ? chainFor(s.project, hit.id, modeFor(p)) : new Set();
      invalidate();
      return;
    }
    const d = drag;
    const delta = { x: p.scene.x - d.start.x, y: p.scene.y - d.start.y };
    switch (d.mode) {
      case 'ik':
        store.preview(dragPose(d.base, d.id, d.grab, p.scene));
        break;
      case 'rotate':
        store.preview(rotateAtJoint(d.base, d.id, d.start, p.scene));
        break;
      case 'move':
        store.preview(movePartsBy(d.base, [d.id], delta));
        break;
      case 'moveLayer':
        store.preview(updatePart(d.base, d.layerRootId, (r) => ({ ...r, rest: { ...r.rest, x: r.rest.x + delta.x, y: r.rest.y + delta.y } })));
        break;
    }
  },

  up() {
    if (drag) store.endGesture();
    drag = null;
    invalidate();
  },

  finish() {
    drag = null;
    hoverChain = new Set();
  },

  drawOverlay(o: OverlayContext) {
    drawSkeleton(o, { highlight: hoverChain, faint: true });
    if (drag?.mode === 'ik' && pointer) {
      // A line from the grabbed spot to the mouse shows how far off the reach is.
      const loc = locatePart(o.s.project, drag.id);
      if (!loc) return;
      const grabbed = o.toScreen(applyToPoint(restWorldMatrix(loc), drag.grab));
      const target = o.toScreen(pointer);
      const { ctx } = o;
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(grabbed.x, grabbed.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.restore();
    }
  },
};
