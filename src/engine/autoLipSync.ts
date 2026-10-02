import { locatePart } from './edit';
import { removePose, setPartPose, findTrack } from './tracks';
import type { AudioClip, Project, Track } from './types';

// Turns automatic lip sync results (docs/DESIGN.md LS7) into mouth poses: a
// drawing change on the frame where each shape starts, replacing whatever
// lip sync was there for the length of the sound.

export interface MouthCue {
  /** Seconds from the start of the sound. */
  start: number;
  end: number;
  /** A–H or X. */
  shape: string;
}

/**
 * If the mouth set has no drawing for a shape, the nearest one it does have
 * (so an 8-shape set still moves). The first that exists wins.
 */
const STAND_INS: Record<string, readonly string[]> = {
  A: ['X', 'B'],
  B: ['C', 'E', 'A'],
  C: ['B', 'E', 'D'],
  D: ['C', 'E'],
  E: ['C', 'F', 'B'],
  F: ['E', 'B'],
  G: ['B', 'A'],
  H: ['C', 'B'],
  X: ['A', 'B'],
};

export function standIn(shape: string, keys: ReadonlySet<string>): string {
  if (keys.has(shape)) return shape;
  return STAND_INS[shape]?.find((k) => keys.has(k)) ?? shape;
}

/** Which of Rhubarb's extra shapes (G, H, X) the mouth set has drawings for. */
export function extendedShapesFor(keys: ReadonlySet<string>): string {
  return ['G', 'H', 'X'].filter((k) => keys.has(k)).join('');
}

/**
 * Applies cues from a sound clip to a mouth (a switch layer). Mouth poses
 * inside the clip are replaced; poses before and after it are kept, and the
 * mouth goes back to what it showed after the clip when the clip ends.
 */
export function applyMouthCues(project: Project, mouthId: string, clip: AudioClip, cues: readonly MouthCue[]): { project: Project; changes: number } {
  const mouth = locatePart(project, mouthId)?.part;
  if (!mouth) return { project, changes: 0 };
  const set = project.drawingSets.find((d) => d.id === mouth.drawingSetId);
  const keys = new Set((set?.drawings ?? []).map((d) => d.key));
  const fps = project.scene.fps;
  const first = Math.max(0, clip.startFrame);
  const end = clip.startFrame + Math.ceil(clip.duration * fps); // first frame after the sound

  // What the mouth shows on the frame after the clip, before we change anything.
  const track = findTrack(project.scene.tracks, mouthId, 'drawing') as Track<'drawing'> | undefined;
  const oldPoses = track?.poses ?? [];
  const after = [...oldPoses].reverse().find((p) => p.frame <= end)?.value ?? mouth.restDrawing;

  let next = project;
  for (const pose of oldPoses) if (pose.frame >= first && pose.frame < end) next = removeDrawingPose(next, mouthId, pose.frame);

  // One pose where each shape starts; a later cue landing on the same frame wins.
  const byFrame = new Map<number, string>();
  for (const cue of cues) {
    const frame = clip.startFrame + Math.round(cue.start * fps);
    if (frame < first || frame >= end) continue;
    byFrame.set(frame, standIn(cue.shape, keys));
  }
  let changes = 0;
  let previous: string | undefined;
  for (const [frame, key] of [...byFrame].sort((a, b) => a[0] - b[0])) {
    if (key === previous) continue;
    next = setPartPose(next, mouthId, 'drawing', frame, key);
    previous = key;
    changes++;
  }
  // Put back what came after the sound, if the last shape would otherwise hold past it.
  const nextTrack = findTrack(next.scene.tracks, mouthId, 'drawing');
  const hasPoseAtEnd = nextTrack?.poses.some((p) => p.frame === end);
  if (!hasPoseAtEnd && after !== undefined && previous !== undefined && previous !== after && end < next.scene.durationFrames) {
    next = setPartPose(next, mouthId, 'drawing', end, after);
  }
  return { project: next, changes };
}

function removeDrawingPose(project: Project, id: string, frame: number): Project {
  const tracks = project.scene.tracks.flatMap((t) => {
    if (t.partId !== id || t.channel !== 'drawing') return [t];
    const poses = removePose(t.poses, frame);
    return poses.length ? [{ ...t, poses } as Track] : [];
  });
  return { ...project, scene: { ...project.scene, tracks } };
}
