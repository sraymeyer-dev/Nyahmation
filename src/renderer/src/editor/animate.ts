import { frameAccess, restAccess, type TransformAccess } from '../../../engine/access';
import { locatePart, topLevelSelection, walkParts } from '../../../engine/edit';
import { cycleFrameOf } from '../../../engine/evaluate';
import { mirrorPose, type MirrorMode } from '../../../engine/mirror';
import { deletePoses, poseEaseAt, poseFrames, retimePoses, setPoseEase, stretchPoses, type RetimeTarget } from '../../../engine/retime';
import { CAMERA_ID, type Ease, type EasePreset, type Project, type Track } from '../../../engine/types';
import { store, type EditorState, type MarkRef } from './store';

// Animate-mode helpers: how tools read and write transforms, and what the
// timeline's pose marks stand for.

const get = () => store.getState();

/** How edits are applied right now: the rest pose (Build) or poses on the current frame (Animate). */
export function editAccess(s: EditorState, project: Project = s.project): TransformAccess {
  return s.mode === 'animate' ? frameAccess(project, s.frame) : restAccess(project);
}

/**
 * Animate mode: whether poses for these parts can be recorded on this frame.
 * After a layer's cycle ends its earlier frames repeat (docs/DESIGN.md CY1),
 * so a pose there would never show; the status bar says why instead.
 */
export function canPoseOnFrame(ids: Iterable<string>, s: EditorState = get()): boolean {
  if (s.mode !== 'animate') return true;
  for (const id of ids) {
    const layer = id === CAMERA_ID ? undefined : locatePart(s.project, id)?.layer;
    const cycle = layer?.cycle;
    if (!layer || !cycle) continue;
    const shown = cycleFrameOf(layer, s.frame);
    if (shown.laps === 0) continue;
    store.set({
      status: `Frame ${s.frame + 1} repeats frame ${shown.frame + 1} of ${layer.name}'s cycle (frames ${cycle.from + 1}–${cycle.to + 1}), so a pose here wouldn't show. Pose within the cycle, or change it in the layer's Properties.`,
    });
    return false;
  }
  return true;
}

/** The frame whose animation a part shows on `frame`: earlier, past its layer's cycle (CY1). */
export function shownFrame(project: Project, partId: string, frame: number): number {
  const layer = locatePart(project, partId)?.layer;
  return layer ? cycleFrameOf(layer, frame).frame : frame;
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

export function setSelectedMarksEase(ease: Ease, coalesce = 'ease'): void {
  const s = get();
  store.commit(setPoseEase(s.project, markTargets(s.project, s.timeline.marks), ease), {}, coalesce);
}

export function setFrame(frame: number): void {
  const n = get().project.scene.durationFrames;
  store.set({ frame: Math.max(0, Math.min(n - 1, Math.round(frame))), playing: false });
}

/** Jumps to the previous or next frame with a pose (on the selected parts and what's inside them, or anywhere). */
export function jumpToPose(direction: 1 | -1): void {
  const s = get();
  const ids = s.selection.length ? selectedSubtrees(s.project, s.selection) : rowParts(s.project, 'scene', '');
  const frames = poseFrames(s.project, ids);
  const target = direction > 0 ? frames.find((f) => f > s.frame) : [...frames].reverse().find((f) => f < s.frame);
  if (target !== undefined) setFrame(target);
}

/** The selected parts and everything inside them (a group's poses are mostly on its children). */
function selectedSubtrees(project: Project, selection: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const id of selection) {
    const loc = locatePart(project, id);
    if (loc) for (const p of walkParts(loc.part)) ids.add(p.id);
  }
  return ids;
}

/**
 * Stretches or squashes the loop range to `length` frames (docs/DESIGN.md A6).
 * With parts selected, only their animation (and their children's); with
 * nothing selected, the whole scene and the camera. Lip sync only changes
 * when the mouth itself is selected, so it stays matched to the dialogue.
 */
export function stretchLoop(length: number): void {
  const s = get();
  if (!s.loop) return;
  const parts = selectedSubtrees(s.project, s.selection);
  const selectedMouth = new Set(s.selection);
  const isLipSync = lipSyncTrack(s.project);
  const inScope = (t: Track) => (parts.size === 0 || parts.has(t.partId)) && (!isLipSync(t) || selectedMouth.has(t.partId));
  const { project, moved } = stretchPoses(s.project, s.loop.in, s.loop.out, length, inScope);
  const n = Math.max(1, Math.round(length));
  const loop = { in: s.loop.in, out: s.loop.in + n - 1 };
  const scope = parts.size ? 'the selected parts' : 'the scene';
  store.commit(project, {
    loop,
    status: moved
      ? `Retimed frames ${s.loop.in + 1}–${s.loop.out + 1} of ${scope} to ${n} frames (${loop.in + 1}–${loop.out + 1}); later poses moved along.`
      : `No poses of ${scope} to retime in that range.`,
  });
}

/**
 * Mirrors the selected parts' pose on this frame, or swaps its sides
 * (docs/DESIGN.md MR1–MR4). With nothing selected, the active character.
 */
/** Object → Add Blinks…: for the one part selected (the eyes). Blinks are poses, so this is for Animate mode. */
export function openBlinks(): void {
  const s = get();
  if (s.mode !== 'animate') return void store.set({ status: 'Blinks are poses: switch to Animate mode, select the eyes, then Add Blinks.' });
  const parts = s.selection.filter((id) => locatePart(s.project, id)?.parent);
  if (parts.length !== 1) return void store.set({ status: 'Select the eyes (one part: a switch layer with a closed drawing, or a shape), then Add Blinks.' });
  store.set({ blinkDialogFor: parts[0]!, playing: false });
}

export function mirrorSelected(mode: MirrorMode): void {
  const s = get();
  if (s.mode !== 'animate') {
    store.set({ status: 'Mirroring works on a pose: switch to Animate mode.' });
    return;
  }
  let roots = topLevelSelection(s.project, s.selection, { includeLayerRoots: true });
  if (!roots.length) {
    const layer = s.project.scene.layers.find((l) => l.id === s.activeLayerId && l.kind === 'character') ?? s.project.scene.layers.find((l) => l.kind === 'character');
    if (layer) roots = [layer.root.id];
  }
  if (!roots.length) {
    store.set({ status: 'Select a character (or some of its parts) to mirror.' });
    return;
  }
  if (!canPoseOnFrame(roots)) return;
  const r = mirrorPose(s.project, roots, s.frame, mode);
  const what = mode === 'mirror' ? 'Mirrored' : 'Swapped the sides of';
  store.commit(r.project, {
    status: r.changed
      ? `${what} the pose on frame ${s.frame + 1} (${r.changed} part${r.changed === 1 ? '' : 's'} changed, ${r.pairs} left/right pair${r.pairs === 1 ? '' : 's'}).`
      : r.pairs || mode === 'mirror'
        ? 'The pose is already symmetrical.'
        : 'No left/right (or front/back) parts found. Name them like “Arm (left)” and “Arm (right)”, or “Leg L” and “Leg R”.',
  });
}

export function setLoopPoint(which: 'in' | 'out'): void {
  const s = get();
  const n = s.project.scene.durationFrames;
  const current = s.loop ?? { in: 0, out: n - 1 };
  const loop = which === 'in' ? { in: s.frame, out: Math.max(s.frame, current.out) } : { in: Math.min(current.in, s.frame), out: s.frame };
  store.set({ loop });
}

const EASE_CHOICES: [EasePreset, string][] = [
  ['smooth', 'Smooth (flows through)'],
  ['easeInOut', 'Ease in and out'],
  ['easeIn', 'Ease in (start slow)'],
  ['easeOut', 'Ease out (end slow)'],
  ['linear', 'Linear (steady)'],
  ['hold', 'Hold (jump at the next pose)'],
];

/** Right-click on a pose mark: its easing, a copy at the playhead (a hold), or delete it. */
export async function markContextMenu(mark: MarkRef): Promise<void> {
  const api = window.nyah;
  if (!api) return;
  let s = get();
  const sameMark = (m: MarkRef) => m.row === mark.row && m.id === mark.id && m.frame === mark.frame;
  if (!s.timeline.marks.some(sameMark)) store.set({ timeline: { ...s.timeline, marks: [mark] }, selectedClip: null });
  s = get();
  const marks = s.timeline.marks;
  const ease = poseEaseAt(s.project, markTargets(s.project, marks));
  const current = typeof ease === 'string' ? ease : ease ? 'custom' : null;
  const many = marks.length > 1;
  const chosen = await api.showContextMenu([
    ...(ease ? EASE_CHOICES.map(([id, label]) => ({ id: `ease:${id}`, label: `Motion out: ${label}`, checked: current === id })) : []),
    ...(ease ? [{ separator: true as const }] : []),
    ...(s.frame !== mark.frame && !many ? [{ id: 'copy', label: `Copy to frame ${s.frame + 1} (the playhead)` }] : []),
    { id: 'delete', label: many ? `Delete ${marks.length} poses` : 'Delete pose' },
  ]);
  if (!chosen) return;
  if (chosen.startsWith('ease:')) setSelectedMarksEase(chosen.slice(5) as EasePreset, `menu-${Date.now()}`);
  else if (chosen === 'delete') deleteSelectedMarks();
  else if (chosen === 'copy') {
    const now = get();
    const result = retimeMarks(now.project, [mark], now.frame - mark.frame, { ripple: false, copy: true });
    store.commit(result.project, {
      timeline: { ...now.timeline, marks: [{ ...mark, frame: mark.frame + result.delta }] },
      status: `Copied the pose from frame ${mark.frame + 1} to frame ${mark.frame + result.delta + 1}.`,
    });
  }
}
