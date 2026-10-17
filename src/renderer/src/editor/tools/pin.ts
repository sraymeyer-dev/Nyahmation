import { applyToPoint, invert } from '../../../../engine/math';
import { activePin, pinPart, unpinPart } from '../../../../engine/pins';
import { resolvedScene, select } from '../actions';
import { canPoseOnFrame } from '../animate';
import { hitTopPart } from '../hitTest';
import { store } from '../store';
import { GRAB_PX, pixel } from './common';
import type { OverlayContext, Tool } from './types';
import type { ResolvedPart } from '../../../../engine/evaluate';
import type { Vec2 } from '../../../../engine/types';

// Pin tool (Animate mode, docs/DESIGN.md §6.3): click a part to pin the spot
// you clicked to the stage from this frame on (a planted foot). Click a
// pinned part to release it from this frame. Pins are enforced on every
// frame, so the body can move while the foot stays put.

export const pinTool: Tool = {
  cursor: () => 'crosshair',

  down(p) {
    const s = store.getState();
    const resolved = resolvedScene(s);
    const hit = hitTopPart(s.project, resolved, p.scene, GRAB_PX * pixel());
    if (!hit) {
      select([]);
      return;
    }
    select([hit.id]);
    togglePin(hit, p.scene);
  },

  drawOverlay(o: OverlayContext) {
    drawPins(o);
  },
};

/** Pins the spot `scene` on `hit` from this frame, or releases the part if it's pinned now. */
export function togglePin(hit: ResolvedPart, scene: Vec2): void {
  const s = store.getState();
  if (!canPoseOnFrame([hit.id], s)) return;
  if (activePin(s.project, hit.id, s.frame)) {
    store.commit(unpinPart(s.project, hit.id, s.frame), { status: `Unpinned “${hit.name}” from frame ${s.frame + 1}.` });
    return;
  }
  const point = applyToPoint(invert(hit.world), scene);
  // Pins live in the layer's own space: the stage, unless the layer has a parallax depth.
  const layer = resolvedScene(s).layerMatrices.get(hit.layerId);
  const at = layer ? applyToPoint(invert(layer), scene) : scene;
  store.commit(pinPart(s.project, hit.id, s.frame, point, at), {
    status: `Pinned “${hit.name}” from frame ${s.frame + 1}. Click it again on a later frame to release it.`,
  });
}

/** Pin markers: a pushpin head where each pinned part is held; red when it can't reach. */
export function drawPins(o: OverlayContext): void {
  const { ctx } = o;
  for (const part of o.resolved.parts) {
    if (!part.pin || !part.visible) continue;
    const p = o.toScreen(part.pin.at);
    ctx.save();
    ctx.fillStyle = part.pin.reached ? '#f5b642' : '#e5484d';
    ctx.strokeStyle = '#1e1f22';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - 4, p.y - 10);
    ctx.lineTo(p.x + 4, p.y - 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y - 13, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
