import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { insertPartAtScene, locatePart, referencedAssetIds, restWorldMatrix, topLevelSelection, walkParts } from '../engine/edit';
import type { Mat2D } from '../engine/math';
import { createId, createLayer, createProject, ProjectFormatError, validateProject } from '../engine/project';
import type { AssetRef, DrawingSet, Layer, LayerKind, LayerSource, Part, Project } from '../engine/types';

// Library items (docs/DESIGN.md §7): reusable characters, backgrounds and
// shapes saved as files in the library folder. A `.nyahitem` file is a zip:
//   item.json        the item
//   thumbnail.png    a small preview for the library panel (optional)
//   assets/<id>      images the item uses
//
// When an item is used, the project gets its own copy with fresh ids (L5), so
// the same item can be added many times and later library edits never break
// a project.

export const LIBRARY_EXTENSION = 'nyahitem';
const FORMAT = 'nyahmation-library-item';
const VERSION = 1;

export type LibraryItemKind = LayerKind | 'parts';

export interface LibraryItemDoc {
  format: typeof FORMAT;
  version: number;
  kind: LibraryItemKind;
  name: string;
  tags: string[];
  /** For characters and backgrounds: the whole layer. */
  layer?: Layer;
  /** For shapes/parts: each part with the matrix that placed its drawing in the scene. */
  parts?: { part: Part; sceneMatrix: number[] }[];
  drawingSets: DrawingSet[];
  assets: AssetRef[];
}

export interface LibraryItem {
  doc: LibraryItemDoc;
  assets: Map<string, Uint8Array>;
}

export interface LibraryItemMeta {
  kind: LibraryItemKind;
  name: string;
  tags: string[];
  thumbnail: Uint8Array | null;
}

// ---- Creating items ----------------------------------------------------------

function usedSetsAndAssets(project: Project, roots: Part[], projectAssets: ReadonlyMap<string, Uint8Array>) {
  const setIds = new Set<string>();
  for (const root of roots) for (const p of walkParts(root)) if (p.drawingSetId) setIds.add(p.drawingSetId);
  const drawingSets = project.drawingSets.filter((s) => setIds.has(s.id));
  const temp = createProject({ layers: [createLayer('background', 'temp', roots)] });
  const assetIds = referencedAssetIds({ ...temp, drawingSets });
  const assets = new Map([...assetIds].filter((id) => projectAssets.has(id)).map((id) => [id, projectAssets.get(id)!]));
  return { drawingSets, assetRefs: project.assets.filter((a) => assetIds.has(a.id)), assets };
}

/** A character or background item from one of the project's layers. */
export function itemFromLayer(
  project: Project,
  projectAssets: ReadonlyMap<string, Uint8Array>,
  layerId: string,
  name: string,
  tags: string[] = [],
): LibraryItem {
  const layer = project.scene.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error('That layer no longer exists.');
  const { drawingSets, assetRefs, assets } = usedSetsAndAssets(project, [layer.root], projectAssets);
  return {
    doc: { format: FORMAT, version: VERSION, kind: layer.kind, name, tags, layer, drawingSets, assets: assetRefs },
    assets,
  };
}

/** A shape item from selected parts, remembering where they sat in the scene. */
export function itemFromParts(
  project: Project,
  projectAssets: ReadonlyMap<string, Uint8Array>,
  ids: Iterable<string>,
  name: string,
  tags: string[] = [],
): LibraryItem {
  const parts = topLevelSelection(project, ids)
    .map((id) => locatePart(project, id)!)
    .filter((loc) => loc.parent)
    .map((loc) => ({ part: loc.part, sceneMatrix: [...restWorldMatrix(loc)] }));
  if (parts.length === 0) throw new Error('Select one or more parts to save.');
  const { drawingSets, assetRefs, assets } = usedSetsAndAssets(project, parts.map((p) => p.part), projectAssets);
  return { doc: { format: FORMAT, version: VERSION, kind: 'parts', name, tags, parts, drawingSets, assets: assetRefs }, assets };
}

// ---- Files ---------------------------------------------------------------------

export function packLibraryItem(item: LibraryItem, thumbnail?: Uint8Array): Uint8Array {
  const files: Zippable = { 'item.json': strToU8(JSON.stringify(item.doc)) };
  if (thumbnail) files['thumbnail.png'] = [thumbnail, { level: 0 }];
  for (const ref of item.doc.assets) {
    const bytes = item.assets.get(ref.id);
    if (!bytes) throw new Error(`The image "${ref.name}" is missing its data.`);
    files[`assets/${ref.id}`] = [bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

function parseDoc(json: Uint8Array | undefined): LibraryItemDoc {
  if (!json) throw new ProjectFormatError("This isn't a Nyahmation library item.");
  let doc: LibraryItemDoc;
  try {
    doc = JSON.parse(strFromU8(json)) as LibraryItemDoc;
  } catch {
    throw new ProjectFormatError('This library item is damaged.');
  }
  if (doc?.format !== FORMAT) throw new ProjectFormatError("This isn't a Nyahmation library item.");
  if (typeof doc.version !== 'number' || doc.version > VERSION) {
    throw new ProjectFormatError('This library item was saved by a newer version of Nyahmation.');
  }
  return doc;
}

/** Reads just the name, kind, tags and thumbnail (for listing the library). */
export function readLibraryMeta(bytes: Uint8Array): LibraryItemMeta {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (f) => f.name === 'item.json' || f.name === 'thumbnail.png' });
  } catch {
    throw new ProjectFormatError('This library item is damaged.');
  }
  const doc = parseDoc(entries['item.json']);
  return { kind: doc.kind, name: String(doc.name), tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [], thumbnail: entries['thumbnail.png'] ?? null };
}

export function unpackLibraryItem(bytes: Uint8Array): LibraryItem {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ProjectFormatError('This library item is damaged.');
  }
  const doc = parseDoc(entries['item.json']);
  // Check the contents the same way a project is checked.
  const roots = doc.layer ? [doc.layer] : [createLayer('background', 'check', (doc.parts ?? []).map((p) => p.part))];
  if (!doc.layer && !doc.parts?.length) throw new ProjectFormatError('This library item is empty.');
  if (doc.parts?.some((p) => !Array.isArray(p.sceneMatrix) || p.sceneMatrix.length !== 6)) throw new ProjectFormatError('This library item is damaged.');
  validateProject({ ...createProject({ layers: roots }), drawingSets: doc.drawingSets ?? [], assets: doc.assets ?? [] });
  const assets = new Map<string, Uint8Array>();
  for (const ref of doc.assets ?? []) {
    const data = entries[`assets/${ref.id}`];
    if (!data) throw new ProjectFormatError(`This library item is missing the image "${ref.name}".`);
    assets.set(ref.id, data);
  }
  return { doc: { ...doc, drawingSets: doc.drawingSets ?? [], assets: doc.assets ?? [], tags: doc.tags ?? [] }, assets };
}

// ---- Updating from the library (L5) -------------------------------------------------

/**
 * For saving a new version of a library item over the old one: the layer's
 * parts and drawing sets get back the ids they have in the library, so every
 * project linked to the item can still update and keep its animation. Parts
 * and sets added since keep this project's ids.
 */
export function withLibraryIds(item: LibraryItem, source: LayerSource): LibraryItem {
  const layer = item.doc.layer;
  if (!layer) return item;
  const partBack = new Map(Object.entries(source.parts).map(([lib, here]) => [here, lib]));
  const setBack = new Map(Object.entries(source.sets).map(([lib, here]) => [here, lib]));
  const back = (p: Part): Part => {
    const next: Part = { ...p, id: partBack.get(p.id) ?? p.id, children: p.children.map(back) };
    if (p.drawingSetId) next.drawingSetId = setBack.get(p.drawingSetId) ?? p.drawingSetId;
    return next;
  };
  const { source: _link, ...plain } = layer;
  return {
    ...item,
    doc: {
      ...item.doc,
      layer: { ...plain, root: back(layer.root) },
      drawingSets: item.doc.drawingSets.map((s) => ({ ...s, id: setBack.get(s.id) ?? s.id })),
    },
  };
}

/**
 * Replaces a layer's drawings and rig with a newer version of the library
 * item it came from, keeping its animation: parts that were in the old
 * version keep their ids (so their poses still apply), new parts are added,
 * and parts the new version no longer has are removed with their poses. The
 * layer keeps its name, place in the scene and settings.
 */
export function updateLayerFromLibrary(
  project: Project,
  projectAssets: ReadonlyMap<string, Uint8Array>,
  layerId: string,
  item: LibraryItem,
  savedAt: number,
): { project: Project; assets: Map<string, Uint8Array>; kept: number; added: number; removed: number } {
  const layer = project.scene.layers.find((l) => l.id === layerId);
  const src = layer?.source;
  const libLayer = item.doc.layer;
  if (!layer || !src || !libLayer) throw new Error('This layer didn’t come from a character or background in the library.');

  const here = new Set([...walkParts(layer.root)].map((p) => p.id));
  const maps: IdMaps = { parts: new Map(), sets: new Map(), assets: new Map() };
  const presetParts = new Map(Object.entries(src.parts).filter(([, id]) => here.has(id)));
  const presetSets = new Map(Object.entries(src.sets).filter(([, id]) => project.drawingSets.some((s) => s.id === id)));
  for (const a of item.doc.assets) maps.assets.set(a.id, createId());
  for (const s of item.doc.drawingSets) maps.sets.set(s.id, presetSets.get(s.id) ?? createId());

  const remap = (p: Part): Part => {
    const id = presetParts.get(p.id) ?? createId();
    maps.parts.set(p.id, id);
    const next: Part = { ...p, id, children: p.children.map(remap) };
    if (p.drawingSetId) next.drawingSetId = maps.sets.get(p.drawingSetId) ?? p.drawingSetId;
    if (p.image) next.image = { ...p.image, assetId: maps.assets.get(p.image.assetId) ?? p.image.assetId };
    return next;
  };
  const fresh = remap(libLayer.root);
  // The layer stays where it is, with its own name.
  const root: Part = { ...fresh, id: layer.root.id, name: layer.root.name, rest: layer.root.rest, visible: layer.root.visible, ...(layer.root.locked ? { locked: true } : {}) };
  maps.parts.set(libLayer.root.id, layer.root.id);

  const now = new Set([...walkParts(root)].map((p) => p.id));
  const removed = [...here].filter((id) => !now.has(id));
  const kept = [...now].filter((id) => here.has(id)).length;

  const assets = new Map(projectAssets);
  for (const [oldId, newId] of maps.assets) assets.set(newId, item.assets.get(oldId)!);
  const setsById = new Map(
    item.doc.drawingSets.map((s) => [
      maps.sets.get(s.id)!,
      { ...s, id: maps.sets.get(s.id)!, drawings: s.drawings.map((d) => ({ ...d, items: d.items.map((i) => (i.kind === 'image' ? { ...i, assetId: maps.assets.get(i.assetId) ?? i.assetId } : i)) })) },
    ]),
  );
  const drawingSets = [...project.drawingSets.map((s) => setsById.get(s.id) ?? s), ...[...setsById.values()].filter((s) => !project.drawingSets.some((p) => p.id === s.id))];
  const gone = new Set(removed);
  const newLayer: Layer = { ...layer, root, source: { ...src, savedAt, parts: Object.fromEntries(maps.parts), sets: Object.fromEntries(maps.sets) } };
  return {
    project: {
      ...project,
      drawingSets,
      assets: [...project.assets, ...item.doc.assets.map((a) => ({ ...a, id: maps.assets.get(a.id)! }))],
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((l) => (l.id === layerId ? newLayer : l)),
        tracks: project.scene.tracks.filter((t) => !gone.has(t.partId)),
      },
    },
    assets,
    kept,
    added: now.size - kept,
    removed: removed.length,
  };
}

// ---- Using items -----------------------------------------------------------------

interface IdMaps {
  parts: Map<string, string>;
  sets: Map<string, string>;
  assets: Map<string, string>;
}

function remapPart(p: Part, maps: IdMaps): Part {
  const id = createId();
  maps.parts.set(p.id, id);
  const next: Part = { ...p, id, children: p.children.map((c) => remapPart(c, maps)) };
  if (p.drawingSetId) next.drawingSetId = maps.sets.get(p.drawingSetId) ?? p.drawingSetId;
  if (p.image) next.image = { ...p.image, assetId: maps.assets.get(p.image.assetId) ?? p.image.assetId };
  return next;
}

export interface InsertedItem {
  project: Project;
  assets: Map<string, Uint8Array>;
  /** Set for character and background items. */
  layerId: string | null;
  /** The new top-level part ids (the layer root, or each inserted part). */
  partIds: string[];
}

/**
 * Adds a copy of a library item to a project. Characters and backgrounds
 * become a new layer at `layerIndex` (default: on top); shapes go into
 * `containerId` at the scene position they were saved from.
 */
export function insertLibraryItem(
  project: Project,
  projectAssets: ReadonlyMap<string, Uint8Array>,
  item: LibraryItem,
  target: { layerIndex?: number; containerId?: string; reuseExisting?: boolean; source?: { relPath: string; savedAt: number } } = {},
): InsertedItem {
  const { doc } = item;
  const maps: IdMaps = { parts: new Map(), sets: new Map(), assets: new Map() };
  // Pasting within a project: drawing sets and images it already has are shared, not copied.
  const hasSet = (id: string) => target.reuseExisting && project.drawingSets.some((s) => s.id === id);
  const hasAsset = (id: string) => target.reuseExisting && project.assets.some((a) => a.id === id) && projectAssets.has(id);
  for (const a of doc.assets) maps.assets.set(a.id, hasAsset(a.id) ? a.id : createId());
  for (const s of doc.drawingSets) maps.sets.set(s.id, hasSet(s.id) ? s.id : createId());

  const assets = new Map(projectAssets);
  for (const [oldId, newId] of maps.assets) if (oldId !== newId) assets.set(newId, item.assets.get(oldId)!);
  const drawingSets = doc.drawingSets.filter((s) => maps.sets.get(s.id) !== s.id).map((s) => ({
    ...s,
    id: maps.sets.get(s.id)!,
    drawings: s.drawings.map((d) => ({
      ...d,
      items: d.items.map((item) => (item.kind === 'image' ? { ...item, assetId: maps.assets.get(item.assetId) ?? item.assetId } : item)),
    })),
  }));
  let next: Project = {
    ...project,
    drawingSets: [...project.drawingSets, ...drawingSets],
    assets: [...project.assets, ...doc.assets.filter((a) => maps.assets.get(a.id) !== a.id).map((a) => ({ ...a, id: maps.assets.get(a.id)! }))],
  };

  if (doc.layer) {
    // A layer that followed a part in another project follows nothing here (it stays fixed to the camera).
    const { follow: _follow, source: oldSource, ...saved } = doc.layer;
    const layer: Layer = { ...saved, id: createId(), name: doc.name, root: remapPart(doc.layer.root, maps) };
    layer.root = { ...layer.root, name: doc.name };
    // Remember the library item (L5): straight from the library, or, for a
    // copy of a layer that came from it, through the copy's new ids.
    if (target.source) {
      layer.source = { ...target.source, parts: Object.fromEntries(maps.parts), sets: Object.fromEntries(maps.sets) };
    } else if (oldSource) {
      const through = (m: Record<string, string>, ids: Map<string, string>) =>
        Object.fromEntries(Object.entries(m).flatMap(([lib, old]) => (ids.has(old) ? [[lib, ids.get(old)!]] : [])));
      layer.source = { ...oldSource, parts: through(oldSource.parts, maps.parts), sets: through(oldSource.sets, maps.sets) };
    }
    const layers = next.scene.layers.slice();
    layers.splice(target.layerIndex ?? layers.length, 0, layer);
    next = { ...next, scene: { ...next.scene, layers } };
    return { project: next, assets, layerId: layer.id, partIds: [layer.root.id] };
  }

  const containerId = target.containerId;
  if (!containerId) throw new Error('Choose a layer to add the shape to.');
  const partIds: string[] = [];
  for (const { part, sceneMatrix } of doc.parts ?? []) {
    const result = insertPartAtScene(next, containerId, remapPart(part, maps), sceneMatrix as unknown as Mat2D);
    next = result.project;
    if (result.partId) partIds.push(result.partId);
  }
  return { project: next, assets, layerId: null, partIds };
}
