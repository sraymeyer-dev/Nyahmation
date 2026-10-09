import { evaluateDiscreteFrom } from './interpolate';
import { findTrack, setPartPose } from './tracks';
import type { Layer, Pose, Project, Stepping } from './types';

/**
 * Animating on twos/threes (docs/DESIGN.md §9.1b).
 *
 * `anchors` are the frames where any part of the character has a pose on a
 * continuous channel, sorted and unique. Steps restart at every anchor, so
 * every pose is shown exactly on its frame, and the whole character changes
 * picture on the same frames, the way a hand-drawn drawing does.
 *
 * Returns the frame whose motion should be shown at `frame`.
 */
export function steppedFrame(frame: number, stepping: Stepping, anchors: readonly number[]): number {
  if (stepping === 1 || anchors.length === 0) return frame;
  let lo = 0;
  let hi = anchors.length - 1;
  let anchor: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid]! <= frame) {
      anchor = anchors[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Before the first pose nothing moves, so any frame shows the same thing.
  if (anchor === undefined) return frame;
  return anchor + Math.floor((frame - anchor) / stepping) * stepping;
}

export function collectAnchors(frameLists: Iterable<readonly { frame: number }[]>): number[] {
  const set = new Set<number>();
  for (const poses of frameLists) for (const p of poses) set.add(p.frame);
  return [...set].sort((a, b) => a - b);
}

/** The stepping a layer uses on `frame`: its changes over time (ST7), or its setting, or the scene's. */
export function layerSteppingAt(project: Project, layer: Layer, frame: number): Stepping {
  const base = layer.stepping ?? project.scene.stepping;
  const track = findTrack(project.scene.tracks, layer.root.id, 'stepping');
  return track ? evaluateDiscreteFrom(track.poses as Pose<Stepping>[], frame, base) : base;
}

/**
 * Changes a layer's stepping from `frame` on (ST7), as a pose on its root.
 * The first change after frame 0 also records the earlier stepping on frame 0.
 */
export function recordStepping(project: Project, layer: Layer, frame: number, stepping: Stepping): Project {
  const track = findTrack(project.scene.tracks, layer.root.id, 'stepping');
  let next = project;
  if ((!track || track.poses.length === 0) && frame > 0) next = setPartPose(next, layer.root.id, 'stepping', 0, layer.stepping ?? project.scene.stepping);
  return setPartPose(next, layer.root.id, 'stepping', frame, stepping);
}
