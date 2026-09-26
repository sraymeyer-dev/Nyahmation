import type { TransformAccess } from '../../../../engine/access';
import { locatePart } from '../../../../engine/edit';
import { applyToPoint, invert } from '../../../../engine/math';
import { dragPoseChanges, ikChainIds, moveChanges, rotateChanges } from '../../../../engine/rig';
import type { Project, Vec2 } from '../../../../engine/types';
import { resolvedScene, select } from '../actions';
import { editAccess } from '../animate';
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
// In Build mode this sets the rest pose; in Animate mode it records poses on
// the current frame.

type Mode = 'ik' | 'rotate' | 'move' | 'moveLayer';

let drag: { mode: Mode; id: string; base: Project; access: TransformAccess; grab: Vec2; start: Vec2; layerRootId: string } | null = null;
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
    const access = editAccess(s);
    store.beginGesture();
    drag = {
      mode: modeFor(p),
      id: hit.id,
      base: s.project,
      access,
      grab: applyToPoint(invert(access.world(hit.id)), p.scene),
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
    let changes;
    switch (d.mode) {
      case 'ik':
        changes = dragPoseChanges(d.base, d.access, d.id, d.grab, p.scene);
        break;
      case 'rotate':
        changes = rotateChanges(d.base, d.access, d.id, d.start, p.scene);
        break;
      case 'move':
        changes = moveChanges(d.base, d.access, [d.id], delta);
        break;
      case 'moveLayer': {
        // The layer root sits in its layer's space: the stage, unless the camera moves the layer differently.
        const local = d.access.local(d.layerRootId)!;
        const inv = invert(d.access.parentWorld(d.layerRootId));
        changes = new Map([[d.layerRootId, { x: local.x + inv[0] * delta.x + inv[2] * delta.y, y: local.y + inv[1] * delta.x + inv[3] * delta.y }]]);
        break;
      }
    }
    store.preview(d.access.write(d.base, changes));
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
      const part = o.resolved.parts.find((x) => x.id === drag!.id);
      if (!part) return;
      const grabbed = o.toScreen(applyToPoint(part.world, drag.grab));
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
