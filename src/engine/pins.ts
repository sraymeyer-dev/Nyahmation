import { evaluateDiscreteFrom } from './interpolate';
import { findTrack, removePose, setPartPose } from './tracks';
import type { PinValue, Pose, Project, Track, Vec2 } from './types';

// Pins (docs/DESIGN.md §6.3) are stored as poses on a part's 'pin' channel:
// a PinValue starts (or moves) a pin, null ends it. Evaluation enforces them.

function pinTrack(project: Project, id: string): Track<'pin'> | undefined {
  return findTrack(project.scene.tracks, id, 'pin');
}

export function activePin(project: Project, id: string, frame: number): PinValue | null {
  const track = pinTrack(project, id);
  return track ? evaluateDiscreteFrom(track.poses as Pose<PinValue | null>[], frame, null) : null;
}

/** Pins `point` (in the part's drawing) at scene position `at` from `frame` on. */
export function pinPart(project: Project, id: string, frame: number, point: Vec2, at: Vec2): Project {
  return setPartPose(project, id, 'pin', frame, { point, at });
}

/** Ends the part's pin on `frame` (a pin started on this very frame is simply removed). */
export function unpinPart(project: Project, id: string, frame: number): Project {
  const track = pinTrack(project, id);
  if (!track) return project;
  if (track.poses.some((p) => p.frame === frame && p.value !== null)) {
    const poses = removePose(track.poses, frame);
    const tracks = project.scene.tracks.flatMap((t) => (t === track ? (poses.length ? [{ ...t, poses }] : []) : [t]));
    return { ...project, scene: { ...project.scene, tracks: tracks as Track[] } };
  }
  return setPartPose(project, id, 'pin', frame, null);
}

/** Where a part is pinned, as frame ranges (end is exclusive), for drawing bars on the timeline. */
export function pinIntervals(project: Project, id: string): { start: number; end: number }[] {
  const track = pinTrack(project, id);
  if (!track) return [];
  const out: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const pose of track.poses) {
    if (pose.value && start === null) start = pose.frame;
    else if (!pose.value && start !== null) {
      out.push({ start, end: pose.frame });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: project.scene.durationFrames });
  return out;
}
