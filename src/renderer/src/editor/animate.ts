import { frameAccess, restAccess, type TransformAccess } from '../../../engine/access';
import { locatePart, walkParts } from '../../../engine/edit';
import { deletePoses, poseFrames, retimePoses, setPoseEase, type RetimeTarget } from '../../../engine/retime';
import { CAMERA_ID, type Ease, type Project, type Track } from '../../../engine/types';
import { store, type EditorState, type MarkRef } from './store';

// Animate-mode helpers: how tools read and write transforms, and what the
// timeline's pose marks stand for.

const get = () => store.getState();

/** How edits are applied right now: the rest pose (Build) or poses on the current frame (Animate). */
export function editAccess(s: EditorState, project: Project = s.project): TransformAccess {
  return s.mode === 'animate' ? frameAccess(project, s.frame) : restAccess(project);
}

/** The parts a timeline row stands for. The scene row includes the camera (CAMERA_ID); the Camera row is a part row. */
export function rowParts(project: Project, row: MarkRef['row'], id: string): Set<string> {
  if (row === 'part') return new Set([id]);
  const layers = row === 'scene' ? project.scene.layers : project.scene.layers.filter((l) => l.id === id);
  const ids = new Set<string>(row === 'scene' ? [CAMERA_ID] : []);
  for (const layer of layers) for (const p of walkParts(layer.root)) ids.add(p.id);
  return ids;
}

/**
 * Lip sync stays locked to the dialogue: the mouth sounds (the drawing channel
 * of a switch layer using a mouth set) aren't moved by scene or layer rows,
 * only from their own part row.
 */
export function lipSyncTrack(project: Project): (t: Track) => boolean {
  const mouthSets = new Set(project.drawingSets.filter((d) => d.vocabulary === 'mouth').map((d) => d.id));
  return (t) => {
    if (t.channel !== 'drawing') return false;
    const part = locatePart(project, t.partId)?.part;
    return !!part?.drawingSetId && mouthSets.has(part.drawingSetId);
  };
}

export function markTargets(project: Project, marks: readonly MarkRef[]): RetimeTarget[] {
  return marks.map((m) => ({ frame: m.frame, partIds: rowParts(project, m.row, m.id) }));
}

export function markExclude(project: Project, marks: readonly MarkRef[]): ((t: Track) => boolean) | undefined {
  return marks.every((m) => m.row === 'part') ? undefined : lipSyncTrack(project);
}

/** Frames with pose marks on a row. */
export function rowFrames(project: Project, row: MarkRef['row'], id: string): number[] {
  return poseFrames(project, rowParts(project, row, id), row === 'part' ? undefined : lipSyncTrack(project));
}

export function retimeMarks(base: Project, marks: readonly MarkRef[], delta: number, options: { ripple: boolean; copy: boolean }) {
  return retimePoses(base, markTargets(base, marks), delta, { ...options, exclude: markExclude(base, marks) });
}

export function deleteSelectedMarks(): void {
  const s = get();
  if (!s.timeline.marks.length) return;
  const project = deletePoses(s.project, markTargets(s.project, s.timeline.marks), markExclude(s.project, s.timeline.marks));
  store.commit(project, { timeline: { ...s.timeline, marks: [] } });
}

export function setSelectedMarksEase(ease: Ease): void {
  const s = get();
  store.commit(setPoseEase(s.project, markTargets(s.project, s.timeline.marks), ease), {}, 'ease');
}

export function setFrame(frame: number): void {
  const n = get().project.scene.durationFrames;
  store.set({ frame: Math.max(0, Math.min(n - 1, Math.round(frame))), playing: false });
}

/** Jumps to the previous or next frame with a pose (on the selected parts, or anywhere). */
export function jumpToPose(direction: 1 | -1): void {
  const s = get();
  const ids = s.selection.length ? new Set(s.selection) : rowParts(s.project, 'scene', '');
  const frames = poseFrames(s.project, ids);
  const target = direction > 0 ? frames.find((f) => f > s.frame) : [...frames].reverse().find((f) => f < s.frame);
  if (target !== undefined) setFrame(target);
}

export function setLoopPoint(which: 'in' | 'out'): void {
  const s = get();
  const n = s.project.scene.durationFrames;
  const current = s.loop ?? { in: 0, out: n - 1 };
  const loop = which === 'in' ? { in: s.frame, out: Math.max(s.frame, current.out) } : { in: Math.min(current.in, s.frame), out: s.frame };
  store.set({ loop });
}
