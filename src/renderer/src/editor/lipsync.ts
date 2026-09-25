import { locatePart, updatePart, walkParts } from '../../../engine/edit';
import {
  centreItems,
  clearDrawingAt,
  makeSwitchLayer,
  matchMouthKey,
  partTreeItems,
  putDrawing,
  removeDrawing,
  renameDrawingKey,
  setDrawingAt,
} from '../../../engine/drawings';
import { createId } from '../../../engine/project';
import type { DrawingSet, Part, Project } from '../../../engine/types';
import { readImageInfo } from '../../../io/imageInfo';
import { importSvg } from '../../../io/svg/importSvg';
import { select } from './actions';
import { setFrame } from './animate';
import { store, type EditorState } from './store';

// Switch layers and lip sync (docs/DESIGN.md §8).

const get = () => store.getState();

/** The selected switch layer and its drawing set, if exactly one is selected. */
export function activeSwitch(s: EditorState): { part: Part; set: DrawingSet } | null {
  if (s.selection.length !== 1) return null;
  const part = locatePart(s.project, s.selection[0]!)?.part;
  if (part?.kind !== 'switch') return null;
  const set = s.project.drawingSets.find((d) => d.id === part.drawingSetId);
  return set ? { part, set } : null;
}

/**
 * Shows a drawing on the current frame (LS3). For mouth sets the playhead then
 * moves on (LS3a), so you can type along with the dialogue.
 */
export function enterDrawing(key: string, advance = true): void {
  const s = get();
  const active = activeSwitch(s);
  if (!active || !active.set.drawings.some((d) => d.key === key)) return;
  const project = setDrawingAt(s.project, active.part.id, s.frame, key);
  if (project !== s.project) store.commit(project);
  if (advance && active.set.vocabulary === 'mouth') setFrame(s.frame + s.lipSyncStep);
}

/** Backspace while lip syncing: step back and undo the entry there. */
export function lipSyncBackspace(): void {
  const s = get();
  const active = activeSwitch(s);
  if (!active) return;
  const frame = Math.max(0, s.frame - s.lipSyncStep);
  setFrame(frame);
  const project = clearDrawingAt(s.project, active.part.id, frame);
  if (project !== s.project) store.commit(project);
}

/** Object → Make Switch Layer: the selected parts become one switch layer. */
export function makeSwitchLayerFromSelection(): void {
  const s = get();
  if (s.selection.length < 2) {
    store.set({ status: 'Select two or more drawings (for example the mouth shapes) to make a switch layer.' });
    return;
  }
  const names = s.selection.map((id) => locatePart(s.project, id)?.part.name ?? '');
  const isMouth = names.filter((n) => matchMouthKey(n)).length >= 2;
  const result = makeSwitchLayer(s.project, s.selection, isMouth ? 'Mouth' : 'Switch');
  if (!result) return;
  const set = result.project.drawingSets.find((d) => d.id === result.setId)!;
  store.commit(result.project, {
    status:
      set.vocabulary === 'mouth'
        ? `Made a mouth with ${set.drawings.length} shapes (${set.drawings.map((d) => d.key).join(', ')}).`
        : `Made a switch layer with ${set.drawings.length} drawings. Name drawings A–H or X to make a mouth.`,
    notice: result.warnings.length ? { title: 'Switch layer made, with some changes', lines: result.warnings } : null,
  });
  select([result.partId]);
}

/** Adds drawings to a switch layer's set from SVG, PNG or JPEG files; names like "D.png" become sound keys. */
export async function addDrawingsFromFiles(): Promise<void> {
  const api = window.nyah;
  const s = get();
  const active = activeSwitch(s);
  if (!api || !active) return;
  const files = await api.importFiles();
  if (!files.length) return;
  let project: Project = get().project;
  const assets = new Map(get().assets);
  const problems: string[] = [];
  let added = 0;
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, '');
    const key = active.set.vocabulary === 'mouth' ? (matchMouthKey(file.name) ?? base) : base;
    try {
      let items;
      if (/\.svg$/i.test(file.name)) {
        const svg = importSvg(new TextDecoder().decode(file.bytes), file.name);
        for (const a of svg.assets) {
          assets.set(a.id, a.bytes);
          project = { ...project, assets: [...project.assets, { id: a.id, name: a.name, mimeType: a.mimeType }] };
        }
        items = partTreeItems(project, svg.root);
      } else {
        const info = readImageInfo(file.bytes);
        if (!info) throw new Error('not a PNG or JPEG image');
        const assetId = createId();
        assets.set(assetId, file.bytes);
        project = { ...project, assets: [...project.assets, { id: assetId, name: file.name, mimeType: info.mimeType }] };
        items = [{ kind: 'image' as const, assetId, x: 0, y: 0, width: info.width, height: info.height }];
      }
      project = putDrawing(project, active.set.id, { key, name: file.name, items: centreItems(items) });
      added++;
    } catch (err) {
      problems.push(`${file.name}: ${(err as Error).message}`);
    }
  }
  store.commit(project, {
    assets,
    status: `Added ${added} drawing${added === 1 ? '' : 's'} to “${active.set.name}”.`,
    notice: problems.length ? { title: "Some files couldn't be added", lines: problems } : null,
  });
}

export function setRestDrawing(partId: string, key: string): void {
  store.commit(updatePart(get().project, partId, (p) => ({ ...p, restDrawing: key })));
}

function updateSet(setId: string, fn: (set: DrawingSet) => DrawingSet, coalesce?: string): void {
  const project = get().project;
  store.commit({ ...project, drawingSets: project.drawingSets.map((d) => (d.id === setId ? fn(d) : d)) }, {}, coalesce);
}

export function renameSet(setId: string, name: string): void {
  updateSet(setId, (d) => ({ ...d, name }));
}

/** A mouth set gets lip sync typing and auto-advance; any other set just switches. */
export function setVocabulary(setId: string, vocabulary: DrawingSet['vocabulary']): void {
  updateSet(setId, (d) => ({ ...d, vocabulary }));
}

/** Gives a switch layer a different drawing set (for example a second character's mouths). */
export function useDrawingSet(partId: string, setId: string): void {
  const s = get();
  const set = s.project.drawingSets.find((d) => d.id === setId);
  if (!set) return;
  store.commit(
    updatePart(s.project, partId, (p) => ({
      ...p,
      drawingSetId: setId,
      restDrawing: set.drawings.some((d) => d.key === p.restDrawing) ? p.restDrawing : set.drawings[0]?.key,
    })),
    { status: `Now using the drawings in “${set.name}”. Frames keep their sound keys.` },
  );
}

export function renameKey(setId: string, from: string, to: string): void {
  const s = get();
  const key = to.trim();
  if (!key || key === from) return;
  const set = s.project.drawingSets.find((d) => d.id === setId);
  if (set?.drawings.some((d) => d.key === key)) {
    store.set({ status: `This set already has a drawing called “${key}”.` });
    return;
  }
  store.commit(renameDrawingKey(s.project, setId, from, key), { status: `Renamed ${from} to ${key}; frames that showed ${from} now show ${key}.` });
}

/**
 * Removes a drawing from its set. Frames that showed it keep their key and
 * show nothing until a drawing with that key is added again.
 */
export function removeDrawingFromSet(setId: string, key: string): void {
  const s = get();
  const users = new Set(s.project.scene.layers.flatMap((l) => [...walkParts(l.root)].filter((p) => p.drawingSetId === setId && p.kind === 'switch')));
  const used =
    [...users].some((p) => p.restDrawing === key) ||
    s.project.scene.tracks.some((t) => t.channel === 'drawing' && [...users].some((p) => p.id === t.partId) && t.poses.some((p) => p.value === key));
  store.commit(removeDrawing(s.project, setId, key), {
    status: used ? `Removed ${key}. Frames that showed it are empty until you add a drawing called ${key} again.` : `Removed ${key}.`,
  });
}
