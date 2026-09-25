import { poseIndexAtOrBefore } from './interpolate';
import type { Channel, ChannelValue, Ease, Pose, Project, Track } from './types';

// Immutable helpers for editing poses. They return new arrays/objects and keep
// the invariants the evaluator relies on: poses sorted by frame, one per frame.

export const CONTINUOUS_CHANNELS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'] as const;
export const DISCRETE_CHANNELS = ['drawing', 'visible', 'drawOrder'] as const;

export function isContinuousChannel(channel: Channel): channel is (typeof CONTINUOUS_CHANNELS)[number] {
  return (CONTINUOUS_CHANNELS as readonly Channel[]).includes(channel);
}

/** Adds a pose, replacing any pose already on that frame (keeping its ease unless a new one is given). */
export function setPose<T>(poses: readonly Pose<T>[], frame: number, value: T, ease?: Ease): Pose<T>[] {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new RangeError(`Pose frame must be a non-negative integer, got ${frame}`);
  }
  const i = poseIndexAtOrBefore(poses, frame);
  const next = poses.slice();
  const existing = i >= 0 ? poses[i] : undefined;
  if (existing && existing.frame === frame) {
    const keptEase = ease ?? existing.ease;
    next[i] = keptEase === undefined ? { frame, value } : { frame, value, ease: keptEase };
  } else {
    next.splice(i + 1, 0, ease === undefined ? { frame, value } : { frame, value, ease });
  }
  return next;
}

export function removePose<T>(poses: readonly Pose<T>[], frame: number): Pose<T>[] {
  return poses.filter((p) => p.frame !== frame);
}

export function findTrack<C extends Channel>(
  tracks: readonly Track[],
  partId: string,
  channel: C,
): Track<C> | undefined {
  return tracks.find((t) => t.partId === partId && t.channel === channel) as Track<C> | undefined;
}

/** Returns a project with a pose set on a part's channel, creating the track if needed. */
export function setPartPose<C extends Channel>(
  project: Project,
  partId: string,
  channel: C,
  frame: number,
  value: ChannelValue<C>,
  ease?: Ease,
): Project {
  const tracks = project.scene.tracks;
  const index = tracks.findIndex((t) => t.partId === partId && t.channel === channel);
  const oldPoses = (index >= 0 ? tracks[index]!.poses : []) as Pose<ChannelValue<C>>[];
  const track: Track<C> = { partId, channel, poses: setPose(oldPoses, frame, value, ease) };
  const newTracks = tracks.slice();
  if (index >= 0) newTracks[index] = track as Track;
  else newTracks.push(track as Track);
  return { ...project, scene: { ...project.scene, tracks: newTracks } };
}
