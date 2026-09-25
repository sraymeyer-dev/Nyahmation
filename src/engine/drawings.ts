import { insertPart, locatePart, removeParts, restWorldMatrix, topLevelSelection, walkParts } from './edit';
import { drawingItemsBounds, findDrawing } from './drawingItems';
import { EMPTY_BOUNDS, isEmptyBounds, transformPath, translatePath, unionBounds } from './geometry';
import { evaluateDiscrete } from './interpolate';
import { applyToPoint, invert, multiply, type Mat2D } from './math';
import { createId, createPart } from './project';
import { findTrack, removePose, setPartPose } from './tracks';
import type { Drawing, DrawingItem, DrawingSet, Part, Pose, Project, Track } from './types';

// Switch layers and mouth sets (docs/DESIGN.md §8).

/** The default mouth set: 9 shapes, as used by classic cartoons and Rhubarb Lip Sync. */
export const MOUTH_SHAPES = [
  { key: 'A', name: 'Closed', sounds: 'M, B, P' },
  { key: 'B', name: 'Slightly open, teeth together', sounds: 'K, S, T, EE' },
  { key: 'C', name: 'Open', sounds: 'EH, AE' },
  { key: 'D', name: 'Wide open', sounds: 'AA' },
  { key: 'E', name: 'Slightly rounded', sounds: 'AO, ER' },
  { key: 'F', name: 'Puckered', sounds: 'OO, W' },
  { key: 'G', name: 'Teeth on lip', sounds: 'F, V' },
  { key: 'H', name: 'Tongue up', sounds: 'L' },
  { key: 'X', name: 'Rest', sounds: 'Silence' },
] as const;

export const MOUTH_KEYS: readonly string[] = MOUTH_SHAPES.map((m) => m.key);

const SYNONYMS: Record<string, string> = {
  rest: 'X',
  idle: 'X',
  silence: 'X',
  neutral: 'X',
  mbp: 'A',
  closed: 'A',
  fv: 'G',
  l: 'H',
  oo: 'F',
  w: 'F',
  u: 'F',
  uw: 'F',
  o: 'E',
  ao: 'E',
  er: 'E',
  aa: 'D',
  ai: 'D',
  ah: 'D',
  eh: 'C',
  ae: 'C',
};

/**
 * Finds the mouth key a drawing's name refers to: a single key letter as a
 * separate word ("A", "mouth_D", "X.png") or a sound name ("rest", "MBP", "FV").
 */
export function matchMouthKey(name: string): string | null {
  const tokens = name
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  for (const token of [...tokens].reverse()) {
    if (token.length === 1 && MOUTH_KEYS.includes(token.toUpperCase())) return token.toUpperCase();
    const syn = SYNONYMS[token.toLowerCase()];
    if (syn) return syn;
  }
  return null;
}

/** Moves drawing items through an affine matrix. Images stay upright (only their corner and size move). */
function transformItems(items: readonly DrawingItem[], m: Mat2D): DrawingItem[] {
  return items.map((item) => {
    if (item.kind === 'shape') {
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      return { kind: 'shape', paths: item.paths.map((p) => transformPath(p, m)), style: { ...item.style, strokeWidth: item.style.strokeWidth * k } };
    }
    const corner = applyToPoint(m, { x: item.x, y: item.y });
    return { ...item, x: corner.x, y: corner.y, width: item.width * Math.hypot(m[0], m[1]), height: item.height * Math.hypot(m[2], m[3]) };
  });
}

/** A part's own artwork as drawing items in its own drawing space. */
function ownItems(project: Project, part: Part): DrawingItem[] {
  if (part.kind === 'shape' && part.paths?.length && part.style) return [{ kind: 'shape', paths: part.paths, style: part.style }];
  if (part.kind === 'image' && part.image) return [{ kind: 'image', assetId: part.image.assetId, x: 0, y: 0, width: part.image.width, height: part.image.height }];
  if (part.kind === 'switch') return findDrawing(project, part.drawingSetId, part.restDrawing)?.items ?? [];
  return [];
}

export interface SwitchLayerResult {
  project: Project;
  partId: string;
  setId: string;
  /** Plain-language notes, e.g. about rotated images. */
  warnings: string[];
}

/**
 * Turns selected parts into one switch layer (docs/DESIGN.md S1–S5): each
 * selected part (with everything inside it) becomes one drawing, and the
 * layer shows one at a time. Names like "A", "mouth_D" or "rest" make it a
 * mouth set keyed by sound; otherwise drawings are keyed by name.
 */
export function makeSwitchLayer(project: Project, ids: Iterable<string>, name: string): SwitchLayerResult | null {
  const tops = topLevelSelection(project, ids)
    .map((id) => locatePart(project, id)!)
    .filter((l) => l.parent);
  const first = tops[0];
  if (!first) return null;
  const containerLoc = locatePart(project, first.parent!.id)!;
  const toContainer = invert(restWorldMatrix(containerLoc));
  const warnings = new Set<string>();

  // Every drawing's items, in the container's space.
  const raw = tops.map((loc) => {
    const parts = [...walkParts(loc.part)].sort((a, b) => a.drawOrder - b.drawOrder);
    const items: DrawingItem[] = [];
    for (const p of parts) {
      const m = multiply(toContainer, restWorldMatrix(locatePart(project, p.id)!));
      if (p.kind === 'image' && (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6)) warnings.add('Rotated images were straightened.');
      items.push(...transformItems(ownItems(project, p), m));
    }
    return { loc, items };
  });

  let bounds = EMPTY_BOUNDS;
  for (const d of raw) bounds = unionBounds(bounds, drawingItemsBounds(d.items, [1, 0, 0, 1, 0, 0]));
  const c = isEmptyBounds(bounds) ? { x: 0, y: 0 } : { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

  const matched = raw.map((d) => matchMouthKey(d.loc.part.name));
  const isMouth = matched.filter(Boolean).length >= 2 && new Set(matched.filter(Boolean)).size === matched.filter(Boolean).length;
  const used = new Set<string>();
  const drawings: Drawing[] = raw.map((d, i) => {
    let key = (isMouth ? matched[i] : null) ?? d.loc.part.name;
    for (let n = 2; used.has(key); n++) key = `${d.loc.part.name} ${n}`;
    used.add(key);
    const items = d.items.map((item): DrawingItem =>
      item.kind === 'shape'
        ? { ...item, paths: item.paths.map((p) => translatePath(p, -c.x, -c.y)) }
        : { ...item, x: item.x - c.x, y: item.y - c.y },
    );
    return { key, name: d.loc.part.name, items };
  });

  const set: DrawingSet = { id: createId(), name: `${name} drawings`, vocabulary: isMouth ? 'mouth' : 'custom', drawings };
  const rest = isMouth && used.has('X') ? 'X' : drawings[0]!.key;
  const part = createPart({
    name,
    kind: 'switch',
    rest: { x: c.x, y: c.y, rotation: 0, scaleX: 1, scaleY: 1 },
    drawOrder: Math.min(...tops.map((t) => t.part.drawOrder)),
    drawingSetId: set.id,
    restDrawing: rest,
  });
  let next = insertPart(project, first.parent!.id, part, first.index);
  next = removeParts(next, tops.map((t) => t.part.id));
  next = { ...next, drawingSets: [...next.drawingSets, set] };
  return { project: next, partId: part.id, setId: set.id, warnings: [...warnings] };
}

// ---- Setting drawings on frames (lip sync) ------------------------------------------

/** The drawing key a switch layer shows on a frame. */
export function drawingAt(project: Project, partId: string, frame: number): string | undefined {
  const part = locatePart(project, partId)?.part;
  const track = findTrack(project.scene.tracks, partId, 'drawing');
  return track ? evaluateDiscrete(track.poses as Pose<string>[], frame, part?.restDrawing ?? '') : part?.restDrawing;
}

/**
 * Shows `key` from `frame` on (LS3). It holds until the next change, so
 * setting the shape that's already showing changes nothing. The first entry
 * after frame 0 also keeps the rest shape on frame 0 (A2a), so earlier frames
 * don't take on the new shape.
 */
export function setDrawingAt(project: Project, partId: string, frame: number, key: string): Project {
  const part = locatePart(project, partId)?.part;
  if (!part || part.kind !== 'switch') return project;
  const track = findTrack(project.scene.tracks, partId, 'drawing');
  const hasPoseHere = track?.poses.some((p) => p.frame === frame) ?? false;
  if (!hasPoseHere && drawingAt(project, partId, frame) === key) return project;
  let next = project;
  if ((!track || track.poses.length === 0) && frame > 0 && part.restDrawing !== undefined) {
    next = setPartPose(next, partId, 'drawing', 0, part.restDrawing);
  }
  return setPartPose(next, partId, 'drawing', frame, key);
}

/** Removes a drawing change on this frame, if there is one (Backspace while lip syncing). */
export function clearDrawingAt(project: Project, partId: string, frame: number): Project {
  const track = findTrack(project.scene.tracks, partId, 'drawing');
  if (!track?.poses.some((p) => p.frame === frame)) return project;
  const poses = removePose(track.poses, frame);
  const tracks = project.scene.tracks.flatMap((t): Track[] => (t === track ? (poses.length ? [{ ...t, poses }] : []) : [t]));
  return { ...project, scene: { ...project.scene, tracks } };
}

/** Blocks for a switch layer's timeline row: which drawing shows from which frame to which. */
export function drawingBlocks(project: Project, partId: string): { key: string; start: number; end: number }[] {
  const track = findTrack(project.scene.tracks, partId, 'drawing');
  if (!track) return [];
  const poses = track.poses as Pose<string>[];
  return poses.map((p, i) => ({ key: p.value, start: p.frame, end: poses[i + 1]?.frame ?? project.scene.durationFrames }));
}

// ---- Managing drawing sets ---------------------------------------------------------

function updateSet(project: Project, setId: string, fn: (s: DrawingSet) => DrawingSet): Project {
  return { ...project, drawingSets: project.drawingSets.map((s) => (s.id === setId ? fn(s) : s)) };
}

/** Switch layers that use a drawing set. */
function partsUsingSet(project: Project, setId: string): Part[] {
  const out: Part[] = [];
  for (const layer of project.scene.layers) for (const p of walkParts(layer.root)) if (p.drawingSetId === setId) out.push(p);
  return out;
}

/**
 * Renames a drawing's key, updating the lip sync (and rest drawing) of every
 * switch layer using the set, so nothing that was set before changes.
 */
export function renameDrawingKey(project: Project, setId: string, from: string, to: string): Project {
  const set = project.drawingSets.find((s) => s.id === setId);
  if (!set || from === to || !to || set.drawings.some((d) => d.key === to)) return project;
  let next = updateSet(project, setId, (s) => ({ ...s, drawings: s.drawings.map((d) => (d.key === from ? { ...d, key: to } : d)) }));
  const users = new Set(partsUsingSet(project, setId).map((p) => p.id));
  next = {
    ...next,
    scene: {
      ...next.scene,
      tracks: next.scene.tracks.map((t) =>
        t.channel === 'drawing' && users.has(t.partId)
          ? ({ ...t, poses: (t.poses as Pose<string>[]).map((p) => (p.value === from ? { ...p, value: to } : p)) } as Track)
          : t,
      ),
      layers: next.scene.layers.map((l) => ({ ...l, root: renameRest(l.root, users, from, to) })),
    },
  };
  return next;
}

function renameRest(p: Part, users: ReadonlySet<string>, from: string, to: string): Part {
  const children = p.children.map((c) => renameRest(c, users, from, to));
  const rest = users.has(p.id) && p.restDrawing === from ? to : p.restDrawing;
  const changed = rest !== p.restDrawing || children.some((c, i) => c !== p.children[i]);
  if (!changed) return p;
  const next: Part = { ...p, children };
  if (rest !== undefined) next.restDrawing = rest;
  return next;
}

export function removeDrawing(project: Project, setId: string, key: string): Project {
  return updateSet(project, setId, (s) => ({ ...s, drawings: s.drawings.filter((d) => d.key !== key) }));
}

/** Adds a drawing to a set, replacing one with the same key. */
export function putDrawing(project: Project, setId: string, drawing: Drawing): Project {
  return updateSet(project, setId, (s) => {
    const i = s.drawings.findIndex((d) => d.key === drawing.key);
    const drawings = s.drawings.slice();
    if (i >= 0) drawings[i] = drawing;
    else drawings.push(drawing);
    return { ...s, drawings };
  });
}

/** A drawing's items centred on the switch layer's origin. */
export function centreItems(items: readonly DrawingItem[]): DrawingItem[] {
  const b = drawingItemsBounds(items, [1, 0, 0, 1, 0, 0]);
  if (isEmptyBounds(b)) return items.slice();
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return transformItems(items, [1, 0, 0, 1, -cx, -cy]);
}

/** Flattens a stand-alone part tree (e.g. an imported SVG) into drawing items in the root's space. */
export function partTreeItems(project: Project, root: Part): DrawingItem[] {
  const items: { order: number; item: DrawingItem }[] = [];
  const visit = (p: Part, m: Mat2D) => {
    for (const item of transformItems(ownItems(project, p), m)) items.push({ order: p.drawOrder, item });
    for (const c of p.children) visit(c, multiply(m, localMatrixOf(c)));
  };
  visit(root, [1, 0, 0, 1, 0, 0]);
  return items.sort((a, b) => a.order - b.order).map((x) => x.item);
}

function localMatrixOf(p: Part): Mat2D {
  const r = (p.rest.rotation * Math.PI) / 180;
  const a = Math.cos(r) * p.rest.scaleX;
  const b = Math.sin(r) * p.rest.scaleX;
  const c = -Math.sin(r) * p.rest.scaleY;
  const d = Math.cos(r) * p.rest.scaleY;
  return [a, b, c, d, p.rest.x - (a * p.joint.pivot.x + c * p.joint.pivot.y), p.rest.y - (b * p.joint.pivot.x + d * p.joint.pivot.y)];
}
