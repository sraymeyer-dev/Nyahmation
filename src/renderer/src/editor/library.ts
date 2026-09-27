import { locatePart } from '../../../engine/edit';
import { decompose, type Mat2D } from '../../../engine/math';
import { createLayer, createProject } from '../../../engine/project';
import { autoChainRoots } from '../../../engine/rig';
import type { Project } from '../../../engine/types';
import type { LibraryEntry } from '../../../preload/api';
import {
  insertLibraryItem,
  itemFromLayer,
  itemFromParts,
  packLibraryItem,
  unpackLibraryItem,
  updateLayerFromLibrary,
  type LibraryItem,
} from '../../../io/libraryItem';
import { getImage } from '../render/images';
import { renderThumbnail } from '../render/thumbnail';
import { activeLayer, assetMimeType, containerForNewPart } from './actions';
import { store, type EditorState } from './store';

// Library actions (docs/DESIGN.md §7).

const get = () => store.getState();

/** What "Save to library" would save right now, if anything. */
export function libraryCandidate(s: EditorState): { label: string; defaultName: string } | null {
  if (s.selection.length === 0) return null;
  const layer = s.project.scene.layers.find((l) => l.root.id === s.selection[0]);
  if (s.selection.length === 1 && layer) {
    return { label: `${layer.kind === 'character' ? 'Character' : 'Background'} “${layer.name}”`, defaultName: layer.name };
  }
  if (s.selection.length === 1) {
    const part = locatePart(s.project, s.selection[0]!)?.part;
    return { label: `The part “${part?.name ?? ''}”`, defaultName: part?.name ?? 'Shape' };
  }
  return { label: `${s.selection.length} selected parts`, defaultName: 'Shape' };
}

export async function refreshLibrary(): Promise<void> {
  const api = window.nyah;
  if (!api) return;
  try {
    const { dir, items } = await api.library.list();
    store.set({ library: { dir, items, loaded: true } });
  } catch (err) {
    store.set({ notice: { title: "Couldn't read the library folder", lines: [(err as Error).message] } });
  }
}

/** A small project holding just the item, for drawing its thumbnail. */
function previewProject(item: LibraryItem): Project {
  const base = { ...createProject(), drawingSets: item.doc.drawingSets, assets: item.doc.assets };
  if (item.doc.layer) return { ...base, scene: { ...base.scene, layers: [item.doc.layer] } };
  const parts = (item.doc.parts ?? []).map(({ part, sceneMatrix }) => ({ ...part, rest: decompose(sceneMatrix as unknown as Mat2D, part.joint.pivot) }));
  return { ...base, scene: { ...base.scene, layers: [createLayer('background', 'preview', parts)] } };
}

export async function saveSelectionToLibrary(name: string, tags: string[]): Promise<boolean> {
  const api = window.nyah;
  const s = get();
  if (!api || s.selection.length === 0) return false;
  try {
    const layer = s.project.scene.layers.find((l) => l.root.id === s.selection[0]);
    const item =
      s.selection.length === 1 && layer
        ? itemFromLayer(s.project, s.assets, layer.id, name, tags)
        : itemFromParts(s.project, s.assets, s.selection, name, tags);
    const thumbnail = await renderThumbnail(previewProject(item), (id) => getImage(id, s.assets.get(id), assetMimeType(s, id)));
    const relPath = await api.library.save(name, packLibraryItem(item, thumbnail ?? undefined));
    store.set({ status: `Saved “${name}” to the library (${relPath}).` });
    await refreshLibrary();
    return true;
  } catch (err) {
    store.set({ notice: { title: "Couldn't save to the library", lines: [(err as Error).message] } });
    return false;
  }
}

/** Adds a copy of a library item: characters/backgrounds as a new layer above the active one, shapes into the active layer. */
export async function addFromLibrary(entry: LibraryEntry): Promise<void> {
  const api = window.nyah;
  if (!api) return;
  try {
    const item = unpackLibraryItem(await api.library.read(entry.relPath));
    const s = get();
    if (item.doc.layer) {
      const active = activeLayer(s);
      const index = active ? s.project.scene.layers.indexOf(active) + 1 : undefined;
      const result = insertLibraryItem(s.project, s.assets, item, { layerIndex: index, source: { relPath: entry.relPath, savedAt: entry.modified } });
      store.commit(result.project, { assets: result.assets, selection: result.partIds, points: [], activeLayerId: result.layerId, status: `Added “${entry.name}”.` });
    } else {
      const target = containerForNewPart(s);
      if (!target) return;
      const result = insertLibraryItem(target.project, s.assets, item, { containerId: target.containerId });
      store.commit(result.project, { assets: result.assets, selection: result.partIds, points: [], activeLayerId: target.layerId, status: `Added “${entry.name}”.` });
    }
  } catch (err) {
    store.set({ notice: { title: `Couldn't add “${entry.name}”`, lines: [(err as Error).message] } });
  }
}

/**
 * Replaces a layer's drawings and rig with the library's current version of
 * the item it came from, keeping its animation (docs/DESIGN.md L5).
 */
export async function updateFromLibrary(layerId: string): Promise<void> {
  const api = window.nyah;
  const s = get();
  const layer = s.project.scene.layers.find((l) => l.id === layerId);
  if (!api || !layer?.source) return;
  if (!window.confirm(`Replace “${layer.name}”'s drawings and rig with the version in the library? Its animation is kept. You can undo this.`)) return;
  try {
    const list = await api.library.list();
    const entry = list.items.find((e) => e.relPath === layer.source!.relPath);
    if (!entry) throw new Error(`“${layer.source.relPath}” isn't in the library any more (was it renamed or moved?).`);
    const item = unpackLibraryItem(await api.library.read(entry.relPath));
    const r = updateLayerFromLibrary(get().project, get().assets, layerId, item, entry.modified);
    store.commit(r.project, {
      assets: r.assets,
      status: `Updated “${layer.name}” from the library: ${r.kept} parts kept their animation, ${r.added} new, ${r.removed} removed.`,
    });
  } catch (err) {
    store.set({ notice: { title: `Couldn't update “${layer.name}”`, lines: [(err as Error).message] } });
  }
}

export async function removeFromLibrary(entry: LibraryEntry): Promise<void> {
  const api = window.nyah;
  if (!api || !window.confirm(`Move “${entry.name}” to the Trash?`)) return;
  await api.library.remove(entry.relPath);
  await refreshLibrary();
}

export function revealLibrary(): void {
  void window.nyah?.library.reveal();
}

/** Marks the active layer's branch joints (shoulders, hips, neck) as chain roots. */
export function autoChainRootsForActiveLayer(): void {
  const s = get();
  const layer = activeLayer(s);
  if (!layer) return;
  store.commit(autoChainRoots(s.project, layer.id), { status: `Chain roots set on “${layer.name}”: shoulders, hips and neck now stop IK.` });
}
