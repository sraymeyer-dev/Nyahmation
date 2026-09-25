import {
  boundsOfPoints,
  EMPTY_BOUNDS,
  isEmptyBounds,
  pathsBounds,
  transformPath,
  translatePath,
  unionBounds,
  type Bounds,
} from './geometry';
import { applyToPoint, decompose, IDENTITY, invert, localMatrix, multiply, type Mat2D } from './math';
import { drawingItemsBounds, findDrawing } from './drawingItems';
import { createId, createLayer, createPart } from './project';
import type { Layer, LayerKind, Part, Project, ShapeStyle, Track, Vec2, VectorPath } from './types';

// Pure, immutable edits to a project's layers and parts. Build mode (docs/
// DESIGN.md §9.0) edits the rest pose, so everything here works with rest
// transforms. Each function returns a new Project and leaves the input alone.

export function* walkParts(part: Part): Generator<Part> {
  yield part;
  for (const child of part.children) yield* walkParts(child);
}

export interface PartLocation {
  layer: Layer;
  layerIndex: number;
  part: Part;
  /** Null for a layer's root. */
  parent: Part | null;
  /** Index in the parent's children, -1 for a root. */
  index: number;
  /** From the layer root down to the parent. */
  ancestors: Part[];
}

export function locatePart(project: Project, id: string): PartLocation | undefined {
  const layers = project.scene.layers;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex]!;
    const search = (part: Part, ancestors: Part[], parent: Part | null, index: number): PartLocation | undefined => {
      if (part.id === id) return { layer, layerIndex, part, parent, index, ancestors };
      const path = [...ancestors, part];
      for (let i = 0; i < part.children.length; i++) {
        const found = search(part.children[i]!, path, part, i);
        if (found) return found;
      }
      return undefined;
    };
    const found = search(layer.root, [], null, -1);
    if (found) return found;
  }
  return undefined;
}

export function isLayerRoot(project: Project, id: string): boolean {
  return project.scene.layers.some((l) => l.root.id === id);
}

/** Rest-pose matrix from the part's drawing coordinates to scene coordinates. */
export function restWorldMatrix(loc: PartLocation): Mat2D {
  let m = IDENTITY;
  for (const p of [...loc.ancestors, loc.part]) m = multiply(m, localMatrix(p.rest, p.joint.pivot));
  return m;
}

/** Rest-pose matrix of the space a part's rest transform lives in (its parent's drawing space). */
export function restParentMatrix(loc: PartLocation): Mat2D {
  let m = IDENTITY;
  for (const p of loc.ancestors) m = multiply(m, localMatrix(p.rest, p.joint.pivot));
  return m;
}

/** Bounds of a part's own artwork (not its children), mapped through `m`. */
export function ownBounds(project: Project, part: Part, m: Mat2D): Bounds {
  if (part.kind === 'shape' && part.paths?.length) {
    return pathsBounds(part.paths.map((p) => transformPath(p, m)));
  }
  if (part.kind === 'image' && part.image) {
    const { width: w, height: h } = part.image;
    return boundsOfPoints([
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ].map((p) => applyToPoint(m, p)));
  }
  if (part.kind === 'switch') {
    const drawing = findDrawing(project, part.drawingSetId, part.restDrawing);
    if (drawing) return drawingItemsBounds(drawing.items, m);
  }
  return EMPTY_BOUNDS;
}

/** Bounds of a part and all its children, mapped through `m` (m maps the part's drawing space). */
export function subtreeBounds(project: Project, part: Part, m: Mat2D): Bounds {
  let b = ownBounds(project, part, m);
  for (const child of part.children) {
    b = unionBounds(b, subtreeBounds(project, child, multiply(m, localMatrix(child.rest, child.joint.pivot))));
  }
  return b;
}

// ---- Tree plumbing -----------------------------------------------------------

/** Rebuilds a tree with `fn` applied to the part `id` (return null to remove it). */
function mapTree(part: Part, id: string, fn: (p: Part) => Part | null): Part | null {
  if (part.id === id) return fn(part);
  let changed = false;
  const children: Part[] = [];
  for (const child of part.children) {
    const next = mapTree(child, id, fn);
    if (next !== child) changed = true;
    if (next) children.push(next);
  }
  return changed ? { ...part, children } : part;
}

function withLayers(project: Project, layers: Layer[]): Project {
  return { ...project, scene: { ...project.scene, layers } };
}

export function updateLayer(project: Project, layerId: string, fn: (l: Layer) => Layer): Project {
  return withLayers(project, project.scene.layers.map((l) => (l.id === layerId ? fn(l) : l)));
}

export function updatePart(project: Project, id: string, fn: (p: Part) => Part): Project {
  return withLayers(
    project,
    project.scene.layers.map((layer) => {
      const root = mapTree(layer.root, id, fn);
      return root === layer.root || !root ? layer : { ...layer, root };
    }),
  );
}

export function insertPart(project: Project, parentId: string, part: Part, index?: number): Project {
  return updatePart(project, parentId, (parent) => {
    const children = parent.children.slice();
    children.splice(index ?? children.length, 0, part);
    return { ...parent, children };
  });
}

/** Removes parts (with their children and animation). Layer roots are left alone. */
export function removeParts(project: Project, ids: Iterable<string>): Project {
  const removed = new Set<string>();
  let next = project;
  for (const id of ids) {
    if (isLayerRoot(next, id)) continue;
    const loc = locatePart(next, id);
    if (!loc) continue;
    for (const p of walkParts(loc.part)) removed.add(p.id);
    next = withLayers(
      next,
      next.scene.layers.map((layer) => (layer === loc.layer ? { ...layer, root: mapTree(layer.root, id, () => null)! } : layer)),
    );
  }
  if (removed.size === 0) return project;
  return { ...next, scene: { ...next.scene, tracks: next.scene.tracks.filter((t) => !removed.has(t.partId)) } };
}

/** The highest stacking number in a layer, plus one: new parts go on top. */
export function nextDrawOrder(layer: Layer): number {
  let max = -1;
  for (const p of walkParts(layer.root)) if (p !== layer.root) max = Math.max(max, p.drawOrder);
  return max + 1;
}

// ---- Structure edits -----------------------------------------------------------

/**
 * Moves a part under a new parent (possibly in another layer) without it
 * jumping on screen: its rest transform is recalculated for the new parent.
 */
export function reparentPart(project: Project, id: string, newParentId: string, index?: number): Project {
  const loc = locatePart(project, id);
  const target = locatePart(project, newParentId);
  if (!loc || !target || !loc.parent) return project;
  if ([...walkParts(loc.part)].some((p) => p.id === newParentId)) return project; // can't go inside itself

  const world = restWorldMatrix(loc);
  const newParentWorld = restWorldMatrix(target);
  const rest = decompose(multiply(invert(newParentWorld), world), loc.part.joint.pivot);
  const moved: Part = { ...loc.part, rest };

  let next = withLayers(
    project,
    project.scene.layers.map((l) => (l === loc.layer ? { ...l, root: mapTree(l.root, id, () => null)! } : l)),
  );
  // Removing the part may have shifted the target index within the same parent.
  let insertAt = index;
  if (insertAt !== undefined && loc.parent.id === newParentId && loc.index < insertAt) insertAt -= 1;
  next = insertPart(next, newParentId, moved, insertAt);
  return next;
}

/** Keeps only ids that aren't inside another selected part, in tree order. */
export function topLevelSelection(project: Project, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const result: string[] = [];
  for (const layer of project.scene.layers) {
    const visit = (p: Part, insideSelected: boolean) => {
      const selected = set.has(p.id) && p !== layer.root;
      if (selected && !insideSelected) result.push(p.id);
      for (const c of p.children) visit(c, insideSelected || selected);
    };
    visit(layer.root, false);
  }
  return result;
}

/**
 * Puts parts into a new group, created where the first part was. The group's
 * joint sits at the centre of its contents so it rotates around its middle.
 */
export function groupParts(project: Project, ids: Iterable<string>, name = 'Group'): { project: Project; groupId: string | null } {
  const top = topLevelSelection(project, ids);
  const first = top[0] ? locatePart(project, top[0]) : undefined;
  if (!first?.parent) return { project, groupId: null };
  const parentLoc = locatePart(project, first.parent.id)!;
  const parentWorld = restWorldMatrix(parentLoc);

  let bounds = EMPTY_BOUNDS;
  let drawOrder = Infinity;
  for (const id of top) {
    const loc = locatePart(project, id)!;
    bounds = unionBounds(bounds, subtreeBounds(project, loc.part, multiply(invert(parentWorld), restWorldMatrix(loc))));
    drawOrder = Math.min(drawOrder, loc.part.drawOrder);
  }
  const center: Vec2 = isEmptyBounds(bounds)
    ? { x: 0, y: 0 }
    : { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const groupId = createId();
  const group: Part = {
    id: groupId,
    name,
    kind: 'group',
    rest: { x: center.x, y: center.y, rotation: 0, scaleX: 1, scaleY: 1 },
    joint: { pivot: center },
    opacity: 1,
    visible: true,
    drawOrder: Number.isFinite(drawOrder) ? drawOrder : 0,
    children: [],
  };
  let next = insertPart(project, first.parent.id, group, first.index);
  for (const id of top) next = reparentPart(next, id, groupId);
  return { project: next, groupId };
}

/** Moves a group's children up to the group's parent and removes the group. */
export function ungroupPart(project: Project, groupId: string): { project: Project; childIds: string[] } {
  const loc = locatePart(project, groupId);
  if (!loc?.parent || loc.part.kind !== 'group') return { project, childIds: [] };
  const childIds = loc.part.children.map((c) => c.id);
  let next = project;
  childIds.forEach((id, i) => {
    next = reparentPart(next, id, loc.parent!.id, loc.index + 1 + i);
  });
  next = removeParts(next, [groupId]);
  return { project: next, childIds };
}

/** Merges shapes into the first one as a compound shape (keeping the first one's style). */
export function combineShapes(project: Project, ids: readonly string[]): { project: Project; shapeId: string | null } {
  const shapes = topLevelSelection(project, ids)
    .map((id) => locatePart(project, id)!)
    .filter((l) => l.part.kind === 'shape');
  const target = shapes[0];
  if (!target || shapes.length < 2) return { project, shapeId: null };
  const toTarget = invert(restWorldMatrix(target));
  const paths = [...(target.part.paths ?? [])];
  for (const other of shapes.slice(1)) {
    const m = multiply(toTarget, restWorldMatrix(other));
    for (const p of other.part.paths ?? []) paths.push(transformPath(p, m));
  }
  let next = updatePart(project, target.part.id, (p) => ({ ...p, paths }));
  next = removeParts(next, shapes.slice(1).map((l) => l.part.id));
  return { project: next, shapeId: target.part.id };
}

function cloneTree(part: Part, idMap: Map<string, string>): Part {
  const id = createId();
  idMap.set(part.id, id);
  return { ...part, id, children: part.children.map((c) => cloneTree(c, idMap)) };
}

/** Copies parts (with their animation), placing each copy just above its original. */
export function duplicateParts(project: Project, ids: Iterable<string>, offset: Vec2 = { x: 20, y: 20 }): { project: Project; ids: string[] } {
  let next = project;
  const newIds: string[] = [];
  const idMap = new Map<string, string>();
  for (const id of topLevelSelection(project, ids)) {
    const loc = locatePart(next, id);
    if (!loc?.parent) continue;
    const copy = cloneTree(loc.part, idMap);
    copy.name = `${loc.part.name} copy`;
    copy.rest = { ...copy.rest, x: copy.rest.x + offset.x, y: copy.rest.y + offset.y };
    const bump = nextDrawOrder(loc.layer) - loc.part.drawOrder;
    const raise = (p: Part): Part => ({ ...p, drawOrder: p.drawOrder + bump, children: p.children.map(raise) });
    next = insertPart(next, loc.parent.id, raise(copy), loc.index + 1);
    newIds.push(copy.id);
  }
  const copiedTracks: Track[] = next.scene.tracks
    .filter((t) => idMap.has(t.partId))
    .map((t) => ({ ...t, partId: idMap.get(t.partId)! }));
  if (copiedTracks.length) next = { ...next, scene: { ...next.scene, tracks: [...next.scene.tracks, ...copiedTracks] } };
  return { project: next, ids: newIds };
}

export type ArrangeHow = 'forward' | 'backward' | 'front' | 'back';

/**
 * Changes stacking order within each layer (docs/DESIGN.md R10), then
 * renumbers the layer's parts 0, 1, 2… in their new order.
 */
export function arrangeParts(project: Project, ids: Iterable<string>, how: ArrangeHow): Project {
  const selected = new Set(ids);
  return withLayers(
    project,
    project.scene.layers.map((layer) => {
      const parts = [...walkParts(layer.root)].filter((p) => p !== layer.root);
      if (!parts.some((p) => selected.has(p.id))) return layer;
      // Current paint order: by drawOrder, ties in tree order (Array.sort is stable).
      const order = parts.slice().sort((a, b) => a.drawOrder - b.drawOrder);
      const isSel = (p: Part) => selected.has(p.id);
      let result: Part[];
      if (how === 'front') result = [...order.filter((p) => !isSel(p)), ...order.filter(isSel)];
      else if (how === 'back') result = [...order.filter(isSel), ...order.filter((p) => !isSel(p))];
      else {
        result = order.slice();
        const step = how === 'forward' ? 1 : -1;
        const indices = result.map((p, i) => (isSel(p) ? i : -1)).filter((i) => i >= 0);
        if (step === 1) indices.reverse();
        for (const i of indices) {
          const j = i + step;
          if (j < 0 || j >= result.length || isSel(result[j]!)) continue;
          [result[i], result[j]] = [result[j]!, result[i]!];
        }
      }
      const rank = new Map(result.map((p, i) => [p.id, i]));
      const renumber = (p: Part): Part => ({
        ...p,
        drawOrder: p === layer.root ? p.drawOrder : rank.get(p.id)!,
        children: p.children.map(renumber),
      });
      return { ...layer, root: renumber(layer.root) };
    }),
  );
}

// ---- Layers --------------------------------------------------------------------

export function addLayer(project: Project, kind: LayerKind, name: string, index?: number): { project: Project; layer: Layer } {
  const layer = createLayer(kind, name);
  const layers = project.scene.layers.slice();
  layers.splice(index ?? layers.length, 0, layer);
  return { project: withLayers(project, layers), layer };
}

export function removeLayer(project: Project, layerId: string): Project {
  const layer = project.scene.layers.find((l) => l.id === layerId);
  if (!layer) return project;
  const removed = new Set([...walkParts(layer.root)].map((p) => p.id));
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.filter((l) => l.id !== layerId),
      tracks: project.scene.tracks.filter((t) => !removed.has(t.partId)),
    },
  };
}

/** Moves a layer to a new position in the stack (0 = back). */
export function moveLayer(project: Project, layerId: string, toIndex: number): Project {
  const layers = project.scene.layers.slice();
  const from = layers.findIndex((l) => l.id === layerId);
  if (from < 0) return project;
  const [layer] = layers.splice(from, 1);
  layers.splice(Math.max(0, Math.min(toIndex, layers.length)), 0, layer!);
  return withLayers(project, layers);
}

/** Moves a part directly above or below another part of the same layer in the stacking order. */
export function restackPart(project: Project, id: string, targetId: string, position: 'above' | 'below'): Project {
  const loc = locatePart(project, id);
  const target = locatePart(project, targetId);
  if (!loc || !target || id === targetId || loc.layer.id !== target.layer.id || !loc.parent || !target.parent) return project;
  const layer = loc.layer;
  const order = [...walkParts(layer.root)]
    .filter((p) => p !== layer.root && p.id !== id)
    .sort((a, b) => a.drawOrder - b.drawOrder);
  const at = order.findIndex((p) => p.id === targetId);
  order.splice(position === 'above' ? at + 1 : at, 0, loc.part);
  const rank = new Map(order.map((p, i) => [p.id, i]));
  const renumber = (p: Part): Part => ({
    ...p,
    drawOrder: p === layer.root ? p.drawOrder : rank.get(p.id)!,
    children: p.children.map(renumber),
  });
  return updateLayer(project, layer.id, (l) => ({ ...l, root: renumber(l.root) }));
}

/**
 * Adds a new shape drawn in scene coordinates to a container part. The
 * outline is converted into the container's space, and the shape's joint is
 * placed at its centre. The new shape goes on top of its layer.
 */
export function insertShapeFromScene(
  project: Project,
  containerId: string,
  scenePaths: VectorPath[],
  style: ShapeStyle,
  name: string,
): { project: Project; partId: string | null } {
  const loc = locatePart(project, containerId);
  if (!loc || scenePaths.length === 0) return { project, partId: null };
  const toContainer = invert(restWorldMatrix(loc));
  const paths = scenePaths.map((p) => transformPath(p, toContainer));
  const b = pathsBounds(paths);
  if (isEmptyBounds(b)) return { project, partId: null };
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const part = createPart({
    name,
    kind: 'shape',
    rest: { x: c.x, y: c.y, rotation: 0, scaleX: 1, scaleY: 1 },
    drawOrder: nextDrawOrder(loc.layer),
    paths: paths.map((p) => translatePath(p, -c.x, -c.y)),
    style,
  });
  return { project: insertPart(project, containerId, part), partId: part.id };
}

/**
 * Adds a part whose drawing space should map onto the scene through `sceneMatrix`
 * (e.g. an imported SVG or image placed at a scene position). The part keeps
 * its own joint; its rest transform is computed for the container.
 */
export function insertPartAtScene(project: Project, containerId: string, part: Part, sceneMatrix: Mat2D): { project: Project; partId: string | null } {
  const loc = locatePart(project, containerId);
  if (!loc) return { project, partId: null };
  const local = multiply(invert(restWorldMatrix(loc)), sceneMatrix);
  const bump = nextDrawOrder(loc.layer);
  const raise = (p: Part): Part => ({ ...p, drawOrder: p.drawOrder + bump, children: p.children.map(raise) });
  const placed = { ...raise(part), rest: decompose(local, part.joint.pivot) };
  return { project: insertPart(project, containerId, placed), partId: placed.id };
}

/** Moves parts by a distance measured on screen (scene units), whatever their parents' rotation or scale. */
export function movePartsBy(project: Project, ids: Iterable<string>, delta: Vec2): Project {
  let next = project;
  for (const id of topLevelSelection(project, ids)) {
    const loc = locatePart(next, id);
    if (!loc?.parent) continue;
    const inv = invert(restParentMatrix(loc));
    const dx = inv[0] * delta.x + inv[2] * delta.y;
    const dy = inv[1] * delta.x + inv[3] * delta.y;
    next = updatePart(next, id, (p) => ({ ...p, rest: { ...p.rest, x: p.rest.x + dx, y: p.rest.y + dy } }));
  }
  return next;
}

/** All asset ids the project still uses (image parts, image drawings and audio clips). */
export function referencedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const layer of project.scene.layers) for (const p of walkParts(layer.root)) if (p.image) ids.add(p.image.assetId);
  for (const set of project.drawingSets) {
    for (const d of set.drawings) for (const item of d.items) if (item.kind === 'image') ids.add(item.assetId);
  }
  for (const clip of project.scene.audio ?? []) ids.add(clip.assetId);
  return ids;
}
