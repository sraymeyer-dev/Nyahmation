import { locatePart, restParentMatrix, restWorldMatrix, updateLayer, updatePart, walkParts } from './edit';
import { solveIk, wrapDegrees, type IkLink } from './ik';
import { applyToPoint, DEG_TO_RAD, invert, localMatrix } from './math';
import type { Part, Project, Vec2 } from './types';

// Rigging in Build mode (docs/DESIGN.md §6): joints, chain roots and
// drag-to-pose. These edit the rest pose; Animate mode (phase 3) will reuse
// the same solver but write poses on the timeline instead.

/**
 * Moves a part's joint without moving its artwork: the joint point changes in
 * the drawing, and the part's position shifts to compensate.
 */
export function setPivot(project: Project, id: string, pivot: Vec2): Project {
  return updatePart(project, id, (p) => {
    const m = localMatrix(p.rest, p.joint.pivot);
    const moved = applyToPoint(m, pivot); // where the new joint sits in the parent
    return { ...p, rest: { ...p.rest, x: moved.x, y: moved.y }, joint: { ...p.joint, pivot } };
  });
}

/** Moves a part's joint to a scene position (artwork stays put). */
export function setPivotAtScene(project: Project, id: string, scene: Vec2): Project {
  const loc = locatePart(project, id);
  if (!loc) return project;
  return setPivot(project, id, applyToPoint(invert(restWorldMatrix(loc)), scene));
}

/**
 * Marks the joints where limbs branch off as chain roots: any part whose
 * parent has more than one child (upper arms and the head off the torso,
 * legs off the hips). Existing chain roots are kept.
 */
export function autoChainRoots(project: Project, layerId: string): Project {
  return updateLayer(project, layerId, (layer) => {
    const mark = (p: Part, parent: Part | null): Part => {
      const branch = parent !== null && parent !== layer.root && parent.children.length > 1;
      const children = p.children.map((c) => mark(c, p));
      const joint = branch && !p.joint.chainRoot ? { ...p.joint, chainRoot: true } : p.joint;
      return joint === p.joint && children.every((c, i) => c === p.children[i]) ? p : { ...p, joint, children };
    };
    return { ...layer, root: mark(layer.root, null) };
  });
}

/**
 * The joints that turn when `id` is dragged, nearest first: its ancestors up
 * to and including the first chain root. A layer's root never turns. Empty
 * when the part is itself a chain root or has no parent that can turn.
 */
export function ikChainIds(project: Project, id: string): string[] {
  const loc = locatePart(project, id);
  if (!loc?.parent || loc.part.joint.chainRoot) return [];
  const ids: string[] = [];
  for (let i = loc.ancestors.length - 1; i >= 1; i--) {
    const a = loc.ancestors[i]!;
    ids.push(a.id);
    if (a.joint.chainRoot) break;
  }
  return ids;
}

function link(p: Part): IkLink {
  const l: IkLink = { transform: p.rest, pivot: p.joint.pivot };
  if (p.joint.minAngle !== undefined) l.minAngle = p.joint.minAngle;
  if (p.joint.maxAngle !== undefined) l.maxAngle = p.joint.maxAngle;
  if (p.joint.bendDirection !== undefined) l.bendDirection = p.joint.bendDirection;
  return l;
}

function setRotations(project: Project, ids: string[], rotations: number[]): Project {
  let next = project;
  ids.forEach((id, i) => {
    next = updatePart(next, id, (p) => ({ ...p, rest: { ...p.rest, rotation: rotations[i]! } }));
  });
  return next;
}

/**
 * Drag-to-pose: the point `grab` (in the dragged part's drawing space) is
 * pulled toward `target` (scene) by turning the part's IK chain. If the part
 * has no chain, it turns at its own joint instead.
 */
export function dragPose(project: Project, id: string, grab: Vec2, target: Vec2): Project {
  const chain = ikChainIds(project, id);
  if (chain.length === 0) return aimPart(project, id, grab, target);
  const loc = locatePart(project, id)!;
  const top = locatePart(project, chain[chain.length - 1]!)!;
  const links = [...chain].reverse().map((cid) => link(locatePart(project, cid)!.part));
  // The grabbed point, expressed in the drawing space of the joint nearest to it.
  const effector = applyToPoint(localMatrix(loc.part.rest, loc.part.joint.pivot), grab);
  const rotations = solveIk(restParentMatrix(top), links, effector, target);
  return setRotations(project, [...chain].reverse(), rotations);
}

/** Turns a part at its own joint so the grabbed point points at `target` (respecting limits). */
export function aimPart(project: Project, id: string, grab: Vec2, target: Vec2): Project {
  const loc = locatePart(project, id);
  if (!loc?.parent) return project;
  const [rotation] = solveIk(restParentMatrix(loc), [link(loc.part)], grab, target);
  return setRotations(project, [id], [rotation!]);
}

/** Rotates a part at its own joint by the angle the mouse swept around the joint. */
export function rotateAtJoint(project: Project, id: string, from: Vec2, to: Vec2): Project {
  const loc = locatePart(project, id);
  if (!loc?.parent) return project;
  const joint = applyToPoint(restWorldMatrix(loc), loc.part.joint.pivot);
  const angle = (v: Vec2) => Math.atan2(v.y - joint.y, v.x - joint.x) / DEG_TO_RAD;
  const parent = restParentMatrix(loc);
  const sign = parent[0] * parent[3] - parent[1] * parent[2] < 0 ? -1 : 1;
  const rotation = loc.part.rest.rotation + wrapDegrees(angle(to) - angle(from)) * sign;
  return setRotations(project, [id], [rotation]);
}

/** Every part that has a joint worth showing (everything except layer roots). */
export function jointedParts(project: Project): { part: Part; layerId: string }[] {
  const out: { part: Part; layerId: string }[] = [];
  for (const layer of project.scene.layers) for (const p of walkParts(layer.root)) if (p !== layer.root) out.push({ part: p, layerId: layer.id });
  return out;
}
