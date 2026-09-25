import { restAccess, type TransformAccess } from './access';
import { locatePart, restWorldMatrix, topLevelSelection, updateLayer, updatePart, walkParts } from './edit';
import { chainFromAncestors, solveIk, wrapDegrees, type IkLink } from './ik';
import { applyToPoint, DEG_TO_RAD, invert, localMatrix } from './math';
import type { Part, Project, Transform, Vec2 } from './types';

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
  if (!loc?.parent) return [];
  return chainFromAncestors(loc.part, loc.ancestors).map((p) => p.id);
}

function link(p: Part, transform: Transform): IkLink {
  const l: IkLink = { transform, pivot: p.joint.pivot };
  if (p.joint.minAngle !== undefined) l.minAngle = p.joint.minAngle;
  if (p.joint.maxAngle !== undefined) l.maxAngle = p.joint.maxAngle;
  if (p.joint.bendDirection !== undefined) l.bendDirection = p.joint.bendDirection;
  return l;
}

type Changes = Map<string, Partial<Transform>>;

/**
 * Drag-to-pose: the point `grab` (in the dragged part's drawing space) is
 * pulled toward `target` (scene) by turning the part's IK chain. If the part
 * has no chain, it turns at its own joint instead. Returns new rotations.
 */
export function dragPoseChanges(project: Project, access: TransformAccess, id: string, grab: Vec2, target: Vec2): Changes {
  const chain = ikChainIds(project, id);
  if (chain.length === 0) return aimChanges(project, access, id, grab, target);
  const loc = locatePart(project, id)!;
  const ordered = [...chain].reverse();
  const links = ordered.map((cid) => link(locatePart(project, cid)!.part, access.local(cid)!));
  // The grabbed point, expressed in the drawing space of the joint nearest to it.
  const effector = applyToPoint(localMatrix(access.local(id)!, loc.part.joint.pivot), grab);
  const rotations = solveIk(access.parentWorld(ordered[0]!), links, effector, target);
  return new Map(ordered.map((cid, i) => [cid, { rotation: rotations[i]! }]));
}

/** Turns a part at its own joint so the grabbed point points at `target` (respecting limits). */
export function aimChanges(project: Project, access: TransformAccess, id: string, grab: Vec2, target: Vec2): Changes {
  const loc = locatePart(project, id);
  if (!loc?.parent) return new Map();
  const [rotation] = solveIk(access.parentWorld(id), [link(loc.part, access.local(id)!)], grab, target);
  return new Map([[id, { rotation: rotation! }]]);
}

/** Rotates a part at its own joint by the angle the mouse swept around the joint. */
export function rotateChanges(project: Project, access: TransformAccess, id: string, from: Vec2, to: Vec2): Changes {
  const loc = locatePart(project, id);
  const local = access.local(id);
  if (!loc?.parent || !local) return new Map();
  const joint = applyToPoint(access.world(id), loc.part.joint.pivot);
  const angle = (v: Vec2) => Math.atan2(v.y - joint.y, v.x - joint.x) / DEG_TO_RAD;
  const parent = access.parentWorld(id);
  const sign = parent[0] * parent[3] - parent[1] * parent[2] < 0 ? -1 : 1;
  return new Map([[id, { rotation: local.rotation + wrapDegrees(angle(to) - angle(from)) * sign }]]);
}

/** Moves parts by a distance measured on screen, whatever their parents' rotation or scale. */
export function moveChanges(project: Project, access: TransformAccess, ids: Iterable<string>, delta: Vec2): Changes {
  const changes: Changes = new Map();
  for (const id of topLevelSelection(project, ids)) {
    const local = access.local(id);
    if (!local || !locatePart(project, id)?.parent) continue;
    const inv = invert(access.parentWorld(id));
    changes.set(id, { x: local.x + inv[0] * delta.x + inv[2] * delta.y, y: local.y + inv[1] * delta.x + inv[3] * delta.y });
  }
  return changes;
}

// Build-mode versions, editing the rest pose.

export function dragPose(project: Project, id: string, grab: Vec2, target: Vec2): Project {
  const access = restAccess(project);
  return access.write(project, dragPoseChanges(project, access, id, grab, target));
}

export function aimPart(project: Project, id: string, grab: Vec2, target: Vec2): Project {
  const access = restAccess(project);
  return access.write(project, aimChanges(project, access, id, grab, target));
}

export function rotateAtJoint(project: Project, id: string, from: Vec2, to: Vec2): Project {
  const access = restAccess(project);
  return access.write(project, rotateChanges(project, access, id, from, to));
}

/** Every part that has a joint worth showing (everything except layer roots). */
export function jointedParts(project: Project): { part: Part; layerId: string }[] {
  const out: { part: Part; layerId: string }[] = [];
  for (const layer of project.scene.layers) for (const p of walkParts(layer.root)) if (p !== layer.root) out.push({ part: p, layerId: layer.id });
  return out;
}
