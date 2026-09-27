import { channelValueAt, recordValue, type PartChannel } from '../../../engine/access';
import { isLayerRoot, locatePart, topLevelSelection } from '../../../engine/edit';
import type { Layer, Part, Project } from '../../../engine/types';
import { insertLibraryItem, itemFromLayer, itemFromParts, type LibraryItem } from '../../../io/libraryItem';
import { activeLayer, containerForNewPart, deleteSelection } from './actions';
import { store } from './store';

// Cut, copy and paste (docs/DESIGN.md A13, ED1–ED3).
//   Build mode    parts: shapes, groups, images, switch layers, or a whole
//                 layer, with their drawing sets, images and effects.
//   Animate mode  a pose: the selected parts' values on this frame, pasted
//                 onto another frame or onto another character with the
//                 same part names.
// The clipboard lives in the app, so it survives opening another project.

const get = () => store.getState();

/** Stage pixels each paste moves along, so copies don't hide the original. */
const PASTE_OFFSET = 20;

let partsClip: { item: LibraryItem; sourceIds: string[]; pastes: number } | null = null;

const POSE_CHANNELS: readonly PartChannel[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'];

interface PoseEntry {
  /** Which copied root this part belongs to, and the names from that root down to it. */
  root: number;
  path: string[];
  id: string;
  values: Record<PartChannel, number>;
}

let poseClip: { roots: { id: string; name: string }[]; entries: PoseEntry[]; frame: number } | null = null;

/** For tests and the menu: what the clipboard holds. */
export function clipboardContents(): { parts: number; pose: number } {
  return { parts: partsClip ? (partsClip.item.doc.layer ? 1 : (partsClip.item.doc.parts?.length ?? 0)) : 0, pose: poseClip?.entries.length ?? 0 };
}

export function copy(): boolean {
  return get().mode === 'animate' ? copyPose() : copyParts();
}

export function cut(): void {
  const s = get();
  if (s.mode === 'animate') {
    store.set({ status: 'Cut works in Build mode. In Animate mode, Copy copies the pose.' });
    return;
  }
  if (copyParts()) {
    deleteSelection();
    store.set({ status: `Cut ${describe()}.` });
  }
}

export function paste(): void {
  if (get().mode === 'animate') pastePose();
  else pasteParts();
}

// ---- Parts ---------------------------------------------------------------------------

function describe(): string {
  if (!partsClip) return 'nothing';
  const { doc } = partsClip.item;
  if (doc.layer) return `the layer “${doc.name}”`;
  const n = doc.parts?.length ?? 0;
  return n === 1 ? `“${doc.parts![0]!.part.name}”` : `${n} parts`;
}

function copyParts(): boolean {
  const s = get();
  if (!s.selection.length) {
    store.set({ status: 'Select something to copy.' });
    return false;
  }
  try {
    const layer = s.selection.length === 1 ? s.project.scene.layers.find((l) => l.root.id === s.selection[0]) : undefined;
    const ids = topLevelSelection(s.project, s.selection).filter((id) => !isLayerRoot(s.project, id));
    const item = layer ? itemFromLayer(s.project, s.assets, layer.id, layer.name) : itemFromParts(s.project, s.assets, ids, 'Copy');
    partsClip = { item, sourceIds: layer ? [layer.root.id] : ids, pastes: 0 };
    store.set({ status: `Copied ${describe()}.` });
    return true;
  } catch (err) {
    store.set({ status: (err as Error).message });
    return false;
  }
}

/** Moves a copy by (d, d) stage pixels. */
function offsetItem(item: LibraryItem, d: number): LibraryItem {
  if (d === 0) return item;
  const { doc } = item;
  if (doc.layer) {
    const root = doc.layer.root;
    const layer: Layer = { ...doc.layer, root: { ...root, rest: { ...root.rest, x: root.rest.x + d, y: root.rest.y + d } } };
    return { ...item, doc: { ...doc, layer } };
  }
  const parts = (doc.parts ?? []).map((p) => {
    const m = p.sceneMatrix;
    return { ...p, sceneMatrix: [m[0]!, m[1]!, m[2]!, m[3]!, m[4]! + d, m[5]! + d] };
  });
  return { ...item, doc: { ...doc, parts } };
}

function pasteParts(): void {
  const clip = partsClip;
  if (!clip) {
    store.set({ status: 'Nothing to paste. Select parts and choose Copy first.' });
    return;
  }
  const s = get();
  // Offset each paste while the originals are still here, so copies don't sit on top of them.
  const originalsHere = clip.sourceIds.some((id) => locatePart(s.project, id));
  const d = originalsHere ? PASTE_OFFSET * (clip.pastes + 1) : PASTE_OFFSET * clip.pastes;
  const item = offsetItem(clip.item, d);
  try {
    if (item.doc.layer) {
      const active = activeLayer(s);
      const index = active ? s.project.scene.layers.indexOf(active) + 1 : undefined;
      const r = insertLibraryItem(s.project, s.assets, item, { layerIndex: index, reuseExisting: true });
      store.commit(r.project, { assets: r.assets, selection: r.partIds, points: [], activeLayerId: r.layerId, status: `Pasted ${describe()}.` });
    } else {
      const target = containerForNewPart(s);
      if (!target) return;
      const r = insertLibraryItem(target.project, s.assets, item, { containerId: target.containerId, reuseExisting: true });
      store.commit(r.project, { assets: r.assets, selection: r.partIds, points: [], activeLayerId: target.layerId, status: `Pasted ${describe()}.` });
    }
    clip.pastes++;
  } catch (err) {
    store.set({ notice: { title: "Couldn't paste", lines: [(err as Error).message] } });
  }
}

// ---- Poses -----------------------------------------------------------------------------

function copyPose(): boolean {
  const s = get();
  const roots = topLevelSelection(s.project, s.selection, { includeLayerRoots: true });
  if (!roots.length) {
    store.set({ status: 'Select the parts (or the character) whose pose to copy.' });
    return false;
  }
  const entries: PoseEntry[] = [];
  roots.forEach((rootId, root) => {
    const loc = locatePart(s.project, rootId)!;
    const visit = (p: Part, path: string[]) => {
      const values = Object.fromEntries(POSE_CHANNELS.map((c) => [c, channelValueAt(s.project, p.id, c, s.frame)!])) as Record<PartChannel, number>;
      entries.push({ root, path, id: p.id, values });
      for (const c of p.children) visit(c, [...path, c.name]);
    };
    visit(loc.part, []);
  });
  poseClip = { roots: roots.map((id) => ({ id, name: locatePart(s.project, id)!.part.name })), entries, frame: s.frame };
  store.set({ status: `Copied the pose on frame ${s.frame + 1} (${entries.length} part${entries.length === 1 ? '' : 's'}). Go to another frame, or select another character, and Paste.` });
  return true;
}

/** Finds a part below `root` by the names on the way down. */
function byPath(root: Part, path: readonly string[]): Part | undefined {
  let p: Part | undefined = root;
  for (const name of path) p = p?.children.find((c) => c.name === name);
  return p;
}

/**
 * Where each copied part's pose goes: onto the same parts, or, if one other
 * part is selected, onto the parts below it with the same names.
 */
export function poseTargets(project: Project, clip: NonNullable<typeof poseClip>, selection: readonly string[]): Map<PoseEntry, string> {
  const out = new Map<PoseEntry, string>();
  const targets = topLevelSelection(project, selection, { includeLayerRoots: true });
  const same = targets.length === 0 || (targets.length === clip.roots.length && targets.every((id, i) => id === clip.roots[i]!.id));
  if (same || clip.roots.length !== 1 || targets.length !== 1) {
    for (const e of clip.entries) if (locatePart(project, e.id)) out.set(e, e.id);
    return out;
  }
  const target = locatePart(project, targets[0]!)!.part;
  for (const e of clip.entries) {
    const p = byPath(target, e.path);
    if (p) out.set(e, p.id);
  }
  return out;
}

function pastePose(): void {
  const clip = poseClip;
  if (!clip) {
    store.set({ status: 'Nothing to paste. In Animate mode, select parts and choose Copy to copy their pose.' });
    return;
  }
  const s = get();
  const targets = poseTargets(s.project, clip, s.selection);
  let project = s.project;
  let changed = 0;
  for (const [entry, id] of targets) {
    let touched = false;
    for (const c of POSE_CHANNELS) {
      const now = channelValueAt(project, id, c, s.frame);
      if (now === undefined || Math.abs(now - entry.values[c]) < 1e-9) continue;
      project = recordValue(project, id, c, s.frame, entry.values[c]);
      touched = true;
    }
    if (touched) changed++;
  }
  if (!targets.size) {
    store.set({ status: 'None of the copied parts are here. Select a character with the same part names to paste onto it.' });
    return;
  }
  store.commit(project, {
    status: changed ? `Pasted the pose from frame ${clip.frame + 1} onto ${changed} part${changed === 1 ? '' : 's'} on frame ${s.frame + 1}.` : 'Those parts already have this pose.',
  });
}
