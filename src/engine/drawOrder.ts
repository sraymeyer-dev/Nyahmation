import type { ArrangeHow } from './edit';
import { locatePart } from './edit';
import { evaluateScene } from './evaluate';
import { findTrack, setPartPose } from './tracks';
import type { Project } from './types';

// Draw-order swaps (docs/DESIGN.md R9): in Animate mode, Bring Forward, Send
// Backward and so on change the stacking from this frame on, as a pose on
// the part's discrete 'drawOrder' channel. Only the moved parts get poses:
// each takes a stacking number between its new neighbours'.

/** Stacking numbers for the given paint order: the moved parts slot between their unmoved neighbours. */
function slotValues(order: readonly { id: string; value: number }[], moved: ReadonlySet<string>): Map<string, number> | null {
  const out = new Map<string, number>();
  let i = 0;
  while (i < order.length) {
    if (!moved.has(order[i]!.id)) {
      i++;
      continue;
    }
    let j = i;
    while (j < order.length && moved.has(order[j]!.id)) j++;
    const prev = i > 0 ? order[i - 1]!.value : undefined;
    const next = j < order.length ? order[j]!.value : undefined;
    const count = j - i;
    if (prev !== undefined && next !== undefined && !(next > prev)) return null; // no room: equal neighbours
    for (let k = 0; k < count; k++) {
      let v: number;
      if (prev === undefined && next === undefined) v = k;
      else if (prev === undefined) v = next! - (count - k);
      else if (next === undefined) v = prev + k + 1;
      else v = prev + ((next - prev) * (k + 1)) / (count + 1);
      out.set(order[i + k]!.id, v);
    }
    i = j;
  }
  return out;
}

/**
 * Restacks parts on `frame` and records the result as draw-order poses. The
 * first draw-order pose after frame 0 also records the part's earlier value
 * on frame 0 (A2a), so the swap happens from this frame, not from the start.
 */
export function arrangeOnFrame(project: Project, frame: number, ids: Iterable<string>, how: ArrangeHow): { project: Project; moved: string[] } {
  const selected = new Set(ids);
  const scene = evaluateScene(project, frame);
  let next = project;
  const moved: string[] = [];
  for (const layer of project.scene.layers) {
    // Current paint order in this layer (the root draws nothing and is left alone).
    const order = scene.parts.filter((p) => p.layerId === layer.id && p.id !== layer.root.id).map((p) => ({ id: p.id, value: p.drawOrder }));
    if (!order.some((p) => selected.has(p.id))) continue;
    const isSel = (p: { id: string }) => selected.has(p.id);
    let result: typeof order;
    if (how === 'front') result = [...order.filter((p) => !isSel(p)), ...order.filter(isSel)];
    else if (how === 'back') result = [...order.filter(isSel), ...order.filter((p) => !isSel(p))];
    else {
      result = order.slice();
      const step = how === 'forward' ? 1 : -1;
      const indices = result.map((p, i) => (isSel(p) ? i : -1)).filter((i) => i >= 0);
      if (step === 1) indices.reverse();
      for (const i of indices) {
        const j = i + step;
        if (j < 0 || j >= result.length || isSel(result[j]!)) continue;
        [result[i], result[j]] = [result[j]!, result[i]!];
      }
    }
    const changedOrder = result.some((p, i) => p.id !== order[i]!.id);
    if (!changedOrder) continue;
    let values = slotValues(result, selected);
    if (!values) {
      // Neighbours share a number: renumber the whole layer in its new order.
      values = new Map(result.map((p, i) => [p.id, i]));
    }
    const current = new Map(order.map((p) => [p.id, p.value]));
    for (const [id, value] of values) {
      if (current.get(id) === value) continue;
      const part = locatePart(next, id)!.part;
      const track = findTrack(next.scene.tracks, id, 'drawOrder');
      if ((!track || track.poses.length === 0) && frame > 0) next = setPartPose(next, id, 'drawOrder', 0, part.drawOrder);
      next = setPartPose(next, id, 'drawOrder', frame, value);
      moved.push(id);
    }
  }
  return { project: next, moved };
}
