import {
  addLayer,
  arrangeParts,
  combineShapes,
  duplicateParts,
  groupParts,
  insertPartAtScene,
  isLayerRoot,
  locatePart,
  movePartsBy,
  referencedAssetIds,
  removeLayer,
  removeParts,
  restWorldMatrix,
  topLevelSelection,
  ungroupPart,
  updatePart,
  walkParts,
  type ArrangeHow,
} from '../../../engine/edit';
import { evaluateRestPose, evaluateScene, type ResolvedScene } from '../../../engine/evaluate';
import { invert } from '../../../engine/math';
import { deletePoints, movePoints } from '../../../engine/pathEdit';
import { createId, createPart, createProject } from '../../../engine/project';
import type { AudioClip, Layer, LayerKind, Project, Vec2 } from '../../../engine/types';
import { decodeAudio } from '../audio/audioEngine';
import { readImageInfo } from '../../../io/imageInfo';
import { packProject, unpackProject } from '../../../io/projectFile';
import { importSvg } from '../../../io/svg/importSvg';
import type { OpenedFile } from '../../../preload/api';
import { createDemoProject } from '../demo';
import { store, type EditorState, type ToolId } from './store';
import { fitView, zoomAt } from './view';

// Editor commands, shared by the menu, keyboard shortcuts and panels.

const get = () => store.getState();

// ---- Derived data ----------------------------------------------------------

const restCache = new WeakMap<Project, ResolvedScene>();
/** What the canvas shows: the rest pose in Build mode, the animation in Animate mode. */
export function resolvedScene(s: EditorState): ResolvedScene {
  if (s.mode === 'animate') return evaluateScene(s.project, s.frame);
  let r = restCache.get(s.project);
  if (!r) restCache.set(s.project, (r = evaluateRestPose(s.project)));
  return r;
}

export function activeLayer(s: EditorState): Layer | undefined {
  const layers = s.project.scene.layers;
  const fromSelection = s.selection[0] ? locatePart(s.project, s.selection[0])?.layer : undefined;
  return fromSelection ?? layers.find((l) => l.id === s.activeLayerId) ?? layers.at(-1);
}

/**
 * Where a new part should go: a selected group, otherwise the active layer.
 * Creates a background layer first if the scene has none. Returns null (and
 * explains in the status bar) if the active layer is locked or hidden.
 */
export function containerForNewPart(s: EditorState): { project: Project; containerId: string; layerId: string } | null {
  const sel = s.selection.length === 1 ? locatePart(s.project, s.selection[0]!) : undefined;
  if (sel && sel.part.kind === 'group' && !sel.part.locked && sel.part.visible) return { project: s.project, containerId: sel.part.id, layerId: sel.layer.id };
  const layer = activeLayer(s);
  if (layer && (layer.root.locked || !layer.root.visible)) {
    store.set({ status: `The layer "${layer.name}" is ${layer.root.locked ? 'locked' : 'hidden'}. Unlock or show it to draw on it.` });
    return null;
  }
  if (layer) return { project: s.project, containerId: layer.root.id, layerId: layer.id };
  const created = addLayer(s.project, 'background', 'Background');
  return { project: created.project, containerId: created.layer.root.id, layerId: created.layer.id };
}

export function nextName(project: Project, base: string): string {
  let n = 0;
  const re = new RegExp(`^${base} (\\d+)$`);
  for (const layer of project.scene.layers) {
    for (const p of walkParts(layer.root)) {
      const m = re.exec(p.name);
      if (m) n = Math.max(n, Number(m[1]));
    }
  }
  return `${base} ${n + 1}`;
}

// ---- Selection ---------------------------------------------------------------

export function select(ids: readonly string[], additive = false): void {
  const s = get();
  let selection = ids.slice();
  if (additive) {
    const set = new Set(s.selection);
    for (const id of ids) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    selection = [...set];
  }
  const layerId = selection[0] ? locatePart(s.project, selection[0])?.layer.id : undefined;
  store.set({ selection, points: [], selectedClip: ids.length ? null : s.selectedClip, activeLayerId: layerId ?? s.activeLayerId });
}

export function deselect(): void {
  store.set({ selection: [], points: [] });
}

export function selectAll(): void {
  const s = get();
  const layer = activeLayer(s);
  if (!layer) return;
  select(layer.root.children.filter((p) => !p.locked).map((p) => p.id));
}

export function selectParent(): void {
  const s = get();
  const loc = s.selection[0] ? locatePart(s.project, s.selection[0]) : undefined;
  if (loc?.parent && !isLayerRoot(s.project, loc.parent.id)) select([loc.parent.id]);
}

export function setTool(tool: ToolId): void {
  store.set({ tool });
}

/** Switches mode, picking a tool that works in the new mode. */
export function setMode(mode: 'build' | 'animate'): void {
  const s = get();
  if (s.mode === mode) return;
  const buildOnly = ['points', 'joint', 'pen', 'rect', 'ellipse', 'polygon', 'star', 'line'];
  let tool = s.tool;
  if (mode === 'animate' && buildOnly.includes(tool)) tool = 'pose';
  if (mode === 'build' && tool === 'pin') tool = 'select';
  store.set({ mode, tool, playing: false, points: [] });
}

// ---- Editing -------------------------------------------------------------------

export function deleteSelection(): void {
  const s = get();
  const shapeId = s.selection[0];
  if (s.tool === 'points' && s.points.length && shapeId) {
    const byPath = new Map<number, number[]>();
    for (const p of s.points) byPath.set(p.path, [...(byPath.get(p.path) ?? []), p.index]);
    const loc = locatePart(s.project, shapeId);
    const paths = (loc?.part.paths ?? []).map((path, i) => (byPath.has(i) ? deletePoints(path, byPath.get(i)!) : path));
    const remaining = paths.filter((p): p is NonNullable<typeof p> => p !== null);
    const project = remaining.length
      ? updatePart(s.project, shapeId, (p) => ({ ...p, paths: remaining }))
      : removeParts(s.project, [shapeId]);
    store.commit(project, { points: [], selection: remaining.length ? s.selection : [] });
    return;
  }
  if (!s.selection.length) return;
  let project = s.project;
  for (const id of s.selection) {
    const layer = project.scene.layers.find((l) => l.root.id === id);
    if (layer) project = removeLayer(project, layer.id);
  }
  project = removeParts(project, s.selection);
  store.commit(project, { selection: [], points: [] });
}

export function duplicate(): void {
  const s = get();
  const { project, ids } = duplicateParts(s.project, s.selection);
  if (ids.length) store.commit(project, { selection: ids, points: [] });
}

export function group(): void {
  const s = get();
  const { project, groupId } = groupParts(s.project, s.selection, nextName(s.project, 'Group'));
  if (groupId) store.commit(project, { selection: [groupId], points: [] });
}

export function ungroup(): void {
  const s = get();
  let project = s.project;
  const selection: string[] = [];
  for (const id of s.selection) {
    const result = ungroupPart(project, id);
    project = result.project;
    selection.push(...(result.childIds.length ? result.childIds : [id]));
  }
  store.commit(project, { selection, points: [] });
}

export function combine(): void {
  const s = get();
  const { project, shapeId } = combineShapes(s.project, s.selection);
  if (shapeId) store.commit(project, { selection: [shapeId], points: [] });
  else store.set({ status: 'Select two or more shapes to combine.' });
}

export function arrange(how: ArrangeHow): void {
  const s = get();
  store.commit(arrangeParts(s.project, s.selection, how));
}

export function nudge(dx: number, dy: number): void {
  const s = get();
  if (s.tool === 'points' && s.points.length && s.selection[0]) {
    const loc = locatePart(s.project, s.selection[0]);
    if (!loc?.part.paths) return;
    // Nudges are in screen directions; convert into the shape's drawing space.
    const w = invert(restWorldMatrix(loc));
    const d: Vec2 = { x: w[0] * dx + w[2] * dy, y: w[1] * dx + w[3] * dy };
    const paths = loc.part.paths.map((path, i) =>
      movePoints(path, s.points.filter((p) => p.path === i).map((p) => p.index), d),
    );
    store.commit(updatePart(s.project, loc.part.id, (p) => ({ ...p, paths })));
    return;
  }
  if (s.selection.length) store.commit(movePartsBy(s.project, s.selection, { x: dx, y: dy }));
}

export function newLayer(kind: LayerKind): void {
  const s = get();
  const active = activeLayer(s);
  const index = active ? s.project.scene.layers.indexOf(active) + 1 : undefined;
  const base = kind === 'character' ? 'Character' : 'Background';
  const { project, layer } = addLayer(s.project, kind, nextLayerName(s.project, base), index);
  store.commit(project, { selection: [], points: [], activeLayerId: layer.id });
}

function nextLayerName(project: Project, base: string): string {
  const used = new Set(project.scene.layers.map((l) => l.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// ---- View ------------------------------------------------------------------------

export function zoomToFit(): void {
  const s = get();
  const { width, height } = s.viewportSize;
  store.set({ view: fitView(s.project.scene.width, s.project.scene.height, width, height) });
}

export function zoomBy(factor: number): void {
  const s = get();
  store.set({ view: zoomAt(s.view, factor, { x: s.viewportSize.width / 2, y: s.viewportSize.height / 2 }) });
}

export function zoomActualSize(): void {
  const s = get();
  zoomBy(1 / s.view.zoom);
}

export function toggleGrid(): void {
  store.set((s) => ({ grid: { ...s.grid, show: !s.grid.show } }));
}

export function toggleSnap(): void {
  store.set((s) => ({ grid: { ...s.grid, snap: !s.grid.snap } }));
}

// ---- Files ---------------------------------------------------------------------------

function confirmDiscard(): boolean {
  return !get().dirty || window.confirm('You have unsaved changes. Discard them?');
}

function loadProject(project: Project, assets: ReadonlyMap<string, Uint8Array>, file: EditorState['file']): void {
  store.load(project, assets, file);
  store.set({ status: file ? `Opened ${file.name}` : '' });
  zoomToFit();
}

export function newProject(): void {
  if (!confirmDiscard()) return;
  const project = createProject();
  const bg = addLayer(project, 'background', 'Background');
  loadProject(bg.project, new Map(), null);
}

export function openDemo(): void {
  if (!confirmDiscard()) return;
  loadProject(createDemoProject(), new Map(), null);
}

export async function openProject(): Promise<void> {
  const api = window.nyah;
  if (!api || !confirmDiscard()) return;
  try {
    const opened = await api.openProject();
    if (opened) openProjectFile(opened, false);
  } catch (err) {
    store.set({ notice: { title: "Couldn't open the project", lines: [(err as Error).message] } });
  }
}

/** Opens a project's bytes, e.g. a .nyah file double-clicked in Finder. */
export function openProjectFile(opened: OpenedFile, confirm = true): void {
  if (confirm) {
    if (get().file?.path === opened.path) return; // already open: the window just comes to the front
    if (!confirmDiscard()) return;
  }
  try {
    const bundle = unpackProject(opened.bytes);
    loadProject(bundle.project, bundle.assets, { path: opened.path, name: opened.name });
  } catch (err) {
    store.set({ notice: { title: `Couldn't open ${opened.name}`, lines: [(err as Error).message] } });
  }
}

export async function save(saveAs = false): Promise<void> {
  const api = window.nyah;
  if (!api) return;
  const s = get();
  try {
    // Only keep the files the project still uses.
    const used = referencedAssetIds(s.project);
    const project = { ...s.project, assets: s.project.assets.filter((a) => used.has(a.id)) };
    const assets = new Map([...s.assets].filter(([id]) => used.has(id)));
    const saved = await api.saveProject(packProject({ project, assets }), saveAs ? undefined : s.file?.path);
    if (!saved) return;
    store.set({ file: saved, dirty: false, status: `Saved ${saved.name}` });
  } catch (err) {
    store.set({ notice: { title: "Couldn't save", lines: [(err as Error).message] } });
  }
}

/** Imports an SVG or PNG/JPEG file into the active layer, centred in the scene. */
export async function importFile(): Promise<void> {
  const api = window.nyah;
  if (!api) return;
  const file = await api.importFile();
  if (file) importBytes(file.name, file.bytes);
}

const AUDIO_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
};

/**
 * Adds a sound file as an audio clip starting on the current frame (Animate
 * mode) or frame 1. The scene gets longer if the sound runs past its end.
 */
export async function importAudio(name: string, bytes: Uint8Array): Promise<void> {
  const ext = name.split('.').pop()!.toLowerCase();
  let duration: number;
  try {
    duration = (await decodeAudio(bytes)).duration;
  } catch {
    store.set({ notice: { title: `Couldn't import ${name}`, lines: ["The sound file couldn't be read. WAV, MP3, M4A/AAC, OGG and FLAC are supported."] } });
    return;
  }
  const s = get();
  const { fps, durationFrames } = s.project.scene;
  const assetId = createId();
  const clip: AudioClip = {
    id: createId(),
    assetId,
    name: name.replace(/\.[^.]+$/, ''),
    startFrame: s.mode === 'animate' ? s.frame : 0,
    duration,
    volume: 1,
  };
  const end = clip.startFrame + Math.ceil(duration * fps);
  const longer = end > durationFrames;
  const project: Project = {
    ...s.project,
    assets: [...s.project.assets, { id: assetId, name, mimeType: AUDIO_TYPES[ext] ?? 'audio/wav' }],
    scene: { ...s.project.scene, audio: [...s.project.scene.audio, clip], durationFrames: Math.max(durationFrames, end) },
  };
  store.commit(project, {
    assets: new Map(s.assets).set(assetId, bytes),
    selectedClip: clip.id,
    status: `Imported ${name} (${duration.toFixed(1)} s)${longer ? `; the scene is now ${end} frames long to fit it` : ''}.`,
  });
}

/** Changes one audio clip (name, start, volume, mute). */
export function updateClip(id: string, change: Partial<Omit<AudioClip, 'id' | 'assetId'>>, coalesce?: string): void {
  const s = get();
  const audio = s.project.scene.audio.map((c) => (c.id === id ? { ...c, ...change } : c));
  store.commit({ ...s.project, scene: { ...s.project.scene, audio } }, {}, coalesce);
}

export function removeClip(id: string): void {
  const s = get();
  const clip = s.project.scene.audio.find((c) => c.id === id);
  if (!clip) return;
  store.commit(
    { ...s.project, scene: { ...s.project.scene, audio: s.project.scene.audio.filter((c) => c.id !== id) } },
    { selectedClip: null, status: `Removed the sound “${clip.name}”.` },
  );
}

export function importBytes(name: string, bytes: Uint8Array): void {
  if (AUDIO_TYPES[name.split('.').pop()!.toLowerCase()]) {
    void importAudio(name, bytes);
    return;
  }
  const s = get();
  const target = containerForNewPart(s);
  if (!target) return;
  const { project: base, containerId, layerId } = target;
  const { width: W, height: H } = s.project.scene;
  try {
    if (/\.svg$/i.test(name)) {
      const result = importSvg(new TextDecoder().decode(bytes), name);
      const at: [number, number, number, number, number, number] = [1, 0, 0, 1, (W - result.width) / 2, (H - result.height) / 2];
      const { project, partId } = insertPartAtScene(base, containerId, result.root, at);
      const assets = new Map(s.assets);
      for (const a of result.assets) assets.set(a.id, a.bytes);
      const withAssets: Project = {
        ...project,
        assets: [...project.assets, ...result.assets.map(({ id, name: n, mimeType }) => ({ id, name: n, mimeType }))],
      };
      store.commit(withAssets, {
        assets,
        selection: partId ? [partId] : [],
        points: [],
        activeLayerId: layerId,
        notice: result.warnings.length ? { title: `Imported ${name}, with some changes`, lines: result.warnings } : null,
        status: `Imported ${name}`,
      });
      return;
    }
    const info = readImageInfo(bytes);
    if (!info) throw new Error(`"${name}" isn't a PNG or JPEG image Nyahmation can read.`);
    const assetId = createId();
    const part = createPart({
      name: name.replace(/\.[^.]+$/, ''),
      kind: 'image',
      joint: { pivot: { x: info.width / 2, y: info.height / 2 } },
      image: { assetId, width: info.width, height: info.height },
    });
    const at: [number, number, number, number, number, number] = [1, 0, 0, 1, (W - info.width) / 2, (H - info.height) / 2];
    const { project, partId } = insertPartAtScene(base, containerId, part, at);
    const assets = new Map(s.assets).set(assetId, bytes);
    store.commit(
      { ...project, assets: [...project.assets, { id: assetId, name, mimeType: info.mimeType }] },
      { assets, selection: partId ? [partId] : [], points: [], activeLayerId: layerId, status: `Imported ${name}` },
    );
  } catch (err) {
    store.set({ notice: { title: `Couldn't import ${name}`, lines: [(err as Error).message] } });
  }
}

/** Assets referenced by the project, with their types, for the image cache. */
export function assetMimeType(s: EditorState, id: string): string {
  return s.project.assets.find((a) => a.id === id)?.mimeType ?? 'image/png';
}

export function topSelection(s: EditorState): string[] {
  return topLevelSelection(s.project, s.selection);
}
