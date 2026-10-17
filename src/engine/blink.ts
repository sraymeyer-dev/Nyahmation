import { channelValueAt } from './access';
import { locatePart } from './edit';
import { evaluateDiscrete } from './interpolate';
import { findTrack, setPartPose } from './tracks';
import type { Pose, Project } from './types';

// Blinks (docs/DESIGN.md A14): a character who never blinks looks stuffed.
// Placing them by hand is slow, so Nyahmation scatters them over a stretch
// of frames at a natural, uneven rhythm, as ordinary poses that can be moved
// or deleted like any other.
//
// Eyes made as a switch layer show their closed drawing for a moment. Any
// other part is squashed flat for a moment (its height), which suits simple
// dot or oval eyes.

export interface BlinkOptions {
  /** First and last frame to blink in. */
  from: number;
  to: number;
  /** Seconds between blinks, on average. */
  every: number;
  /** A switch layer's closed-eyes drawing; without it, the part squashes. */
  closed?: string;
  /** Changes where the blinks fall. */
  seed?: number;
}

/** How a blink's frames are spread at a frame rate: closing, shut, opening. */
export function blinkTiming(fps: number): { closing: number; shut: number; opening: number } {
  // About 1/24 s closing, 1/24 s shut, 2/24 s opening: quick to close, softer to open.
  const k = fps / 24;
  return { closing: Math.max(1, Math.round(k)), shut: Math.max(1, Math.round(k)), opening: Math.max(1, Math.round(2 * k)) };
}

/** How flat a squashed eye gets, as a share of its height. */
const SHUT = 0.1;

function random(seed: number) {
  let s = (seed >>> 0) ^ 0x9e3779b9 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Adds blinks to a part. A blink is skipped where the part already has a
 * pose of the same kind nearby (the animator's own blinks and squints win),
 * and where its layer's cycle repeats (it would never show).
 */
export function addBlinks(project: Project, partId: string, options: BlinkOptions): { project: Project; blinks: number } {
  const loc = locatePart(project, partId);
  if (!loc) return { project, blinks: 0 };
  const { fps, durationFrames } = project.scene;
  const switchPart = loc.part.kind === 'switch' && options.closed !== undefined;
  const t = blinkTiming(fps);
  const length = t.closing + t.shut + t.opening;
  const cycle = loc.layer.cycle;
  const from = Math.max(0, Math.round(options.from));
  const to = Math.min(durationFrames - 1, cycle ? cycle.to : Infinity, Math.round(options.to));
  const gap = Math.max(0.5, options.every) * fps;
  const rand = random(options.seed ?? hash(partId));

  // When each blink starts: not straight away, then every `gap` give or take
  // 40%, sometimes twice in quick succession.
  const starts: number[] = [];
  let at = from + Math.round(gap * (0.3 + 0.5 * rand()));
  while (at + length <= to) {
    starts.push(at);
    if (rand() < 0.15) {
      const again = at + length + Math.max(1, Math.round(fps / 12));
      if (again + length <= to) starts.push(again);
      at = again;
    }
    at += Math.round(gap * (0.6 + 0.8 * rand()));
  }

  const channel = switchPart ? 'drawing' : 'scaleY';
  const posed = (frame: number, end: number) => {
    const track = findTrack(project.scene.tracks, partId, channel);
    return !!track?.poses.some((p) => p.frame >= frame - 1 && p.frame <= end + 1);
  };
  let out = project;
  let blinks = 0;
  for (const start of starts) {
    const end = start + length;
    if (posed(start, end)) continue;
    if (switchPart) {
      const track = findTrack(out.scene.tracks, partId, 'drawing');
      const poses = (track?.poses ?? []) as Pose<string>[];
      const rest = loc.part.restDrawing ?? '';
      const showing = evaluateDiscrete(poses, start, rest);
      if (showing === options.closed) continue;
      // Before the first drawing pose, the first pose's drawing shows: keep the start as it was.
      if (poses.length === 0 && start > 0) out = setPartPose(out, partId, 'drawing', 0, rest);
      out = setPartPose(out, partId, 'drawing', start + t.closing, options.closed!);
      out = setPartPose(out, partId, 'drawing', end, showing);
    } else {
      const open = channelValueAt(out, partId, 'scaleY', start) ?? 1;
      const after = channelValueAt(out, partId, 'scaleY', end) ?? open;
      out = setPartPose(out, partId, 'scaleY', start, open);
      out = setPartPose(out, partId, 'scaleY', start + t.closing, open * SHUT);
      out = setPartPose(out, partId, 'scaleY', start + t.closing + t.shut, open * SHUT);
      out = setPartPose(out, partId, 'scaleY', end, after);
    }
    blinks++;
  }
  return { project: out, blinks };
}

/** A switch layer's drawing that looks like closed eyes, judging by its key or name. */
export function closedDrawingOf(project: Project, partId: string): string | undefined {
  const part = locatePart(project, partId)?.part;
  const set = project.drawingSets.find((d) => d.id === part?.drawingSetId);
  return set?.drawings.find((d) => /clos|shut|blink|sleep/i.test(`${d.key} ${d.name}`))?.key;
}
