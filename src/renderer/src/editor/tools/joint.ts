import { updatePart } from '../../../../engine/edit';
import { setPivotAtScene } from '../../../../engine/rig';
import type { Project } from '../../../../engine/types';
import { resolvedScene, select } from '../actions';
import { hitTopPart } from '../hitTest';
import { drawSkeleton, jointIndex, jointPositions } from '../overlay';
import { store } from '../store';
import { sceneToScreen } from '../view';
import { dist, GRAB_PX, invalidate, pixel, snap } from './common';
import type { OverlayContext, Tool, ToolPointer } from './types';

// Joints tool: shows the skeleton. Drag a joint to move it; the artwork stays
// where it is. Click a part to select it. Double-click a joint to make it a
// chain root (IK stops there) or back.

function hitJoint(p: ToolPointer): string | null {
  const s = store.getState();
  const joints = jointPositions({ s, resolved: resolvedScene(s) });
  // Prefer the selected part's joint, then the topmost part.
  for (const id of s.selection) {
    const pos = joints.get(id);
    if (pos && dist(sceneToScreen(s.view, pos), p.screen) <= GRAB_PX) return id;
  }
  const ids = [...joints.keys()].reverse();
  return ids.find((id) => dist(sceneToScreen(s.view, joints.get(id)!), p.screen) <= GRAB_PX) ?? null;
}

let drag: { id: string; base: Project } | null = null;

export const jointTool: Tool = {
  cursor: () => 'default',

  down(p) {
    const s = store.getState();
    const id = hitJoint(p);
    if (id) {
      select([id]);
      store.beginGesture();
      drag = { id, base: s.project };
      return;
    }
    const hit = hitTopPart(s.project, resolvedScene(s), p.scene, GRAB_PX * pixel());
    select(hit ? [hit.id] : [], p.shift);
  },

  move(p, dragging) {
    if (!dragging || !drag) return;
    store.preview(setPivotAtScene(drag.base, drag.id, snap(p.scene)));
  },

  up() {
    if (drag) store.endGesture();
    drag = null;
    invalidate();
  },

  doubleClick(p) {
    const id = hitJoint(p);
    if (!id) return;
    const s = store.getState();
    const isRoot = jointIndex(s.project).get(id)?.chainRoot === true;
    store.commit(updatePart(s.project, id, (part) => ({ ...part, joint: { ...part.joint, chainRoot: !isRoot } })), {
      status: isRoot ? 'Chain root removed.' : 'Chain root set: IK stops at this joint.',
    });
  },

  finish() {
    drag = null;
  },

  drawOverlay(o: OverlayContext) {
    drawSkeleton(o);
  },
};

