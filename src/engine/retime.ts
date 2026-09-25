import { isContinuousChannel } from './tracks';
import type { Ease, Pose, Project, Track } from './types';

// Timeline editing (docs/DESIGN.md A5, A6, A9): moving, copying and deleting
// pose marks, and setting their easing.
//
// A pose mark on the timeline stands for every pose of some parts on one
// frame: one part (a part row), a whole layer (a layer row) or the whole scene
// (the scene row). A RetimeTarget names that set of parts and the frame.

export interface RetimeTarget {
  partIds: ReadonlySet<string>;
  frame: number;
}

export interface RetimeOptions {
  /** Also move every later pose of the same parts by the same amount. */
  ripple?: boolean;
  /** Copy the poses to the new frame instead of moving them (a hold). */
  copy?: boolean;
  /** Tracks to leave alone (e.g. lip sync, which stays locked to the audio). */
  exclude?: (track: Track) => boolean;
}

export interface RetimeResult {
  project: Project;
  /** The shift actually applied, after keeping poses in order and on frame 0 or later. */
  delta: number;
  /** True if the scene was lengthened to fit poses moved past its end. */
  extended: boolean;
}

function tracksInScope(project: Project, targets: readonly RetimeTarget[], exclude?: (t: Track) => boolean): Track[] {
  const parts = new Set<string>();
  for (const t of targets) for (const id of t.partIds) parts.add(id);
  return project.scene.tracks.filter((t) => parts.has(t.partId) && !exclude?.(t));
}

function selectedFrames(track: Track, targets: readonly RetimeTarget[]): Set<number> {
  const frames = new Set<number>();
  for (const t of targets) if (t.partIds.has(track.partId) && track.poses.some((p) => p.frame === t.frame)) frames.add(t.frame);
  return frames;
}

function withTracks(project: Project, replaced: Map<Track, Track>): Project {
  if (replaced.size === 0) return project;
  const tracks = project.scene.tracks.map((t) => replaced.get(t) ?? t);
  let durationFrames = project.scene.durationFrames;
  for (const t of tracks) {
    const last = t.poses[t.poses.length - 1];
    if (last && last.frame >= durationFrames) durationFrames = last.frame + 1;
  }
  return { ...project, scene: { ...project.scene, tracks, durationFrames } };
}

/**
 * Moves (or copies) pose marks by `delta` frames.
 *   Plain move: the marks move; they can't pass a neighbouring pose.
 *   Ripple: the marks and everything after them move together, so all later
 *     timing is kept (drag frame 10 to 8 and frame 20 becomes 18).
 *   Copy: the poses are duplicated at the new frame, the classic way to hold.
 * Poses moved past the end of the scene lengthen it.
 */
export function retimePoses(project: Project, targets: readonly RetimeTarget[], delta: number, options: RetimeOptions = {}): RetimeResult {
  const tracks = tracksInScope(project, targets, options.exclude);
  const d0 = Math.round(delta);
  if (d0 === 0 || targets.length === 0) return { project, delta: 0, extended: false };

  let lo = -Infinity;
  let hi = Infinity;
  const plan = new Map<Track, Set<number>>(); // frames that move, per track

  if (options.ripple && !options.copy) {
    const from = Math.min(...targets.map((t) => t.frame));
    for (const track of tracks) {
      const moving = track.poses.filter((p) => p.frame >= from);
      if (moving.length === 0) continue;
      const staying = track.poses.filter((p) => p.frame < from);
      const first = moving[0]!.frame;
      lo = Math.max(lo, -first, staying.length ? staying[staying.length - 1]!.frame + 1 - first : -Infinity);
      plan.set(track, new Set(moving.map((p) => p.frame)));
    }
  } else {
    for (const track of tracks) {
      const sel = selectedFrames(track, targets);
      if (sel.size === 0) continue;
      plan.set(track, sel);
      for (const f of sel) {
        lo = Math.max(lo, -f);
        if (options.copy) continue;
        // Keep between the nearest poses that aren't moving.
        const others = track.poses.filter((p) => !sel.has(p.frame)).map((p) => p.frame);
        const before = others.filter((o) => o < f);
        const after = others.filter((o) => o > f);
        if (before.length) lo = Math.max(lo, Math.max(...before) + 1 - f);
        if (after.length) hi = Math.min(hi, Math.min(...after) - 1 - f);
      }
    }
  }
  if (plan.size === 0) return { project, delta: 0, extended: false };
  const d = Math.min(Math.max(d0, lo), hi);
  if (d === 0 || !Number.isFinite(d)) return { project, delta: 0, extended: false };

  const replaced = new Map<Track, Track>();
  for (const [track, frames] of plan) {
    let poses: Pose<unknown>[];
    if (options.copy) {
      const copies = track.poses.filter((p) => frames.has(p.frame)).map((p) => ({ ...p, frame: p.frame + d }));
      const newFrames = new Set(copies.map((c) => c.frame));
      poses = [...track.poses.filter((p) => !newFrames.has(p.frame)), ...copies];
    } else {
      poses = track.poses.map((p) => (frames.has(p.frame) ? { ...p, frame: p.frame + d } : p));
    }
    poses.sort((a, b) => a.frame - b.frame);
    replaced.set(track, { ...track, poses } as Track);
  }
  const next = withTracks(project, replaced);
  return { project: next, delta: d, extended: next.scene.durationFrames !== project.scene.durationFrames };
}

/** Removes the poses behind pose marks. Tracks left empty are removed. */
export function deletePoses(project: Project, targets: readonly RetimeTarget[], exclude?: (t: Track) => boolean): Project {
  const inScope = new Set(tracksInScope(project, targets, exclude));
  const tracks: Track[] = [];
  let changed = false;
  for (const track of project.scene.tracks) {
    if (!inScope.has(track)) {
      tracks.push(track);
      continue;
    }
    const sel = selectedFrames(track, targets);
    if (sel.size === 0) {
      tracks.push(track);
      continue;
    }
    changed = true;
    const poses = track.poses.filter((p) => !sel.has(p.frame));
    if (poses.length) tracks.push({ ...track, poses } as Track);
  }
  return changed ? { ...project, scene: { ...project.scene, tracks } } : project;
}

/** Sets the easing on the motion leaving these pose marks (A9). */
export function setPoseEase(project: Project, targets: readonly RetimeTarget[], ease: Ease): Project {
  const replaced = new Map<Track, Track>();
  for (const track of tracksInScope(project, targets)) {
    if (!isContinuousChannel(track.channel)) continue;
    const sel = selectedFrames(track, targets);
    if (sel.size === 0) continue;
    replaced.set(track, { ...track, poses: track.poses.map((p) => (sel.has(p.frame) ? { ...p, ease } : p)) } as Track);
  }
  return withTracks(project, replaced);
}

/** The ease of the first continuous pose found at these marks (for showing in the panel). */
export function poseEaseAt(project: Project, targets: readonly RetimeTarget[]): Ease | null {
  for (const track of tracksInScope(project, targets)) {
    if (!isContinuousChannel(track.channel)) continue;
    const sel = selectedFrames(track, targets);
    const pose = track.poses.find((p) => sel.has(p.frame));
    if (pose) return pose.ease ?? 'smooth';
  }
  return null;
}

/** Frames that have poses for any of these parts, sorted. */
export function poseFrames(project: Project, partIds: ReadonlySet<string>, exclude?: (t: Track) => boolean): number[] {
  const frames = new Set<number>();
  for (const t of project.scene.tracks) if (partIds.has(t.partId) && !exclude?.(t)) for (const p of t.poses) frames.add(p.frame);
  return [...frames].sort((a, b) => a - b);
}
