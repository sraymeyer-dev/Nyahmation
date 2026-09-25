import { locatePart, restParentMatrix, restWorldMatrix, updatePart, walkParts } from './edit';
import { evaluateScene, type ResolvedPart } from './evaluate';
import { IDENTITY, type Mat2D } from './math';
import { findTrack, setPartPose } from './tracks';
import type { ContinuousChannel, Project, Transform } from './types';

// Editing tools work the same way in both modes (docs/DESIGN.md §9.0): they
// read a part's current transform and write a new one. What "current" and
// "write" mean differs:
//   Build mode   → the rest pose, edited in place;
//   Animate mode → the pose shown on a frame, written as poses on that frame.

export type TransformChanges = ReadonlyMap<string, Partial<Transform>>;

export interface TransformAccess {
  /** The part's transform as currently shown. */
  local(id: string): Transform | undefined;
  /** Scene matrix of the space the part's transform lives in (its parent's drawing space). */
  parentWorld(id: string): Mat2D;
  /** Scene matrix of the part's own drawing space. */
  world(id: string): Mat2D;
  /** Applies new transform values (only the channels given). */
  write(project: Project, changes: TransformChanges): Project;
}

export function restAccess(project: Project): TransformAccess {
  return {
    local: (id) => locatePart(project, id)?.part.rest,
    parentWorld: (id) => {
      const loc = locatePart(project, id);
      return loc ? restParentMatrix(loc) : IDENTITY;
    },
    world: (id) => {
      const loc = locatePart(project, id);
      return loc ? restWorldMatrix(loc) : IDENTITY;
    },
    write: (target, changes) => {
      let next = target;
      for (const [id, change] of changes) next = updatePart(next, id, (p) => ({ ...p, rest: { ...p.rest, ...change } }));
      return next;
    },
  };
}

/** Access to the pose shown on `frame` (after stepping and pins), writing poses on that frame. */
export function frameAccess(project: Project, frame: number): TransformAccess {
  const resolved = new Map<string, ResolvedPart>(evaluateScene(project, frame).parts.map((p) => [p.id, p]));
  const parentOf = new Map<string, string>();
  for (const layer of project.scene.layers) {
    for (const p of walkParts(layer.root)) for (const c of p.children) parentOf.set(c.id, p.id);
  }
  return {
    local: (id) => resolved.get(id)?.local,
    parentWorld: (id) => {
      const parent = parentOf.get(id);
      return parent ? (resolved.get(parent)?.world ?? IDENTITY) : IDENTITY;
    },
    world: (id) => resolved.get(id)?.world ?? IDENTITY,
    write: (target, changes) => recordPoses(target, frame, changes, (id) => resolved.get(id)?.local),
  };
}

const CHANNELS: readonly (keyof Transform & ContinuousChannel)[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];

/**
 * Records poses on `frame` for every channel whose value changed
 * (docs/DESIGN.md A2). The first pose on a channel after frame 0 also records
 * the part's earlier value on frame 0 (A2a), so the change animates from
 * where the part was instead of applying to the whole scene.
 */
export function recordPoses(
  project: Project,
  frame: number,
  changes: TransformChanges,
  current: (id: string) => Transform | undefined,
): Project {
  let next = project;
  for (const [id, change] of changes) {
    const loc = locatePart(next, id);
    const now = current(id);
    if (!loc || !now) continue;
    for (const channel of CHANNELS) {
      const value = change[channel];
      if (value === undefined || Math.abs(value - now[channel]) < 1e-9) continue;
      const track = findTrack(next.scene.tracks, id, channel);
      if ((!track || track.poses.length === 0) && frame > 0) {
        next = setPartPose(next, id, channel, 0, loc.part.rest[channel]);
      }
      next = setPartPose(next, id, channel, frame, value);
    }
  }
  return next;
}
