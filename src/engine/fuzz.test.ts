import { describe, expect, it } from 'vitest';
import { recordValue, type PartChannel } from './access';
import { booleanShapes, type BooleanOp } from './boolean';
import { recordCamera } from './camera';
import { arrangeOnFrame } from './drawOrder';
import { makeSwitchLayer, setDrawingAt } from './drawings';
import {
  addLayer,
  arrangeParts,
  combineShapes,
  duplicateParts,
  groupParts,
  insertShapeFromScene,
  locatePart,
  movePartsBy,
  removeLayer,
  removeParts,
  reparentPart,
  restWorldMatrix,
  ungroupPart,
  updateLayer,
  walkParts,
  type ArrangeHow,
} from './edit';
import { addEffect, recordEffectValue, removeEffect } from './effects';
import { evaluateScene } from './evaluate';
import { defaultStyle, ellipsePath, rectPath } from './geometry';
import type { Mat2D } from './math';
import { mirrorPose } from './mirror';
import { pinPart, unpinPart } from './pins';
import { createProject, parseProject } from './project';
import { changeFrameRate, deletePoses, retimePoses, stretchPoses } from './retime';
import { resizeScene } from './stage';
import { setPivot } from './rig';
import { recordStepping } from './stepping';
import { EFFECT_SETTINGS, type Part, type Project, type Stepping } from './types';
import { insertLibraryItem, itemFromLayer, itemFromParts, linkAfterSaving, packLibraryItem, unpackLibraryItem, updateLayerFromLibrary, withLibraryIds } from '../io/libraryItem';

// Random sequences of edits, checking after every one that the project is
// still valid (it saves and opens again) and that every frame can be worked
// out. Each run is seeded, so a failure names the seed and step to replay.
// For a longer search: NYAH_FUZZ_SEEDS=2000 NYAH_FUZZ_STEPS=100 npx vitest run fuzz

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(env.NYAH_FUZZ_SEEDS) || 60;
const FIRST = Number(env.NYAH_FUZZ_FROM) || 1;
const STEPS = Number(env.NYAH_FUZZ_STEPS) || 50;

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(items: readonly T[]): T | undefined => (items.length ? items[int(0, items.length - 1)] : undefined);
  const some = <T,>(items: readonly T[], max = 3): T[] => {
    const out = new Set<T>();
    const n = int(1, Math.min(max, items.length));
    while (out.size < n && items.length) out.add(pick(items)!);
    return [...out];
  };
  return { next, int, pick, some };
}

type Rng = ReturnType<typeof rng>;

const parts = (p: Project): Part[] => p.scene.layers.flatMap((l) => [...walkParts(l.root)].filter((x) => x !== l.root));
const ids = (p: Project) => parts(p).map((x) => x.id);
const shapes = (p: Project) => parts(p).filter((x) => x.kind === 'shape').map((x) => x.id);
const groups = (p: Project) => parts(p).filter((x) => x.kind === 'group').map((x) => x.id);
const roots = (p: Project) => p.scene.layers.map((l) => l.root.id);
/** A frame with a pose on it (usually), or any frame. */
function frame(r: Rng, p: Project, partIds?: ReadonlySet<string>): number {
  const posed = p.scene.tracks.filter((t) => !partIds || partIds.has(t.partId)).flatMap((t) => t.poses.map((x) => x.frame));
  return posed.length && r.next() < 0.8 ? r.pick(posed)! : r.int(0, p.scene.durationFrames + 5);
}
/** Names that pair up for mirroring, and plain ones. */
const NAMES = ['Arm (left)', 'Arm (right)', 'Leg L', 'Leg R', 'Hand (front)', 'Hand (back)', 'A', 'D', 'X', 'Torso', 'Head'];

const CHANNELS: PartChannel[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'];
const HOWS: ArrangeHow[] = ['forward', 'backward', 'front', 'back'];
const OPS: BooleanOp[] = ['union', 'subtract', 'intersect', 'exclude'];

/** Each edit returns the new project (or the same one if it doesn't apply). */
const EDITS: Record<string, (p: Project, r: Rng) => Project> = {
  addShape(p, r) {
    const container = r.pick([...roots(p), ...groups(p)]);
    if (!container) return p;
    const x = r.int(0, 1800);
    const y = r.int(0, 1000);
    const path = r.next() < 0.5 ? rectPath(x, y, r.int(5, 300), r.int(5, 300)) : ellipsePath(x, y, r.int(5, 150), r.int(5, 150));
    return insertShapeFromScene(p, container, [path], defaultStyle(), r.pick(NAMES)!).project;
  },
  addLayer: (p, r) => addLayer(p, r.next() < 0.5 ? 'character' : 'background', `Layer ${r.int(1, 99)}`).project,
  removeLayer: (p, r) => (p.scene.layers.length > 2 && r.next() < 0.3 ? removeLayer(p, r.pick(p.scene.layers)!.id) : p),
  group: (p, r) => (ids(p).length ? groupParts(p, r.some(ids(p))).project : p),
  ungroup: (p, r) => (groups(p).length ? ungroupPart(p, r.pick(groups(p))!).project : p),
  reparent(p, r) {
    const id = r.pick(ids(p));
    const parent = r.pick([...roots(p), ...ids(p)]);
    return id && parent ? reparentPart(p, id, parent, r.next() < 0.5 ? 0 : undefined) : p;
  },
  duplicate: (p, r) => (ids(p).length ? duplicateParts(p, r.some(ids(p))).project : p),
  remove: (p, r) => (ids(p).length && r.next() < 0.5 ? removeParts(p, r.some(ids(p), 2)) : p),
  arrange: (p, r) => (ids(p).length ? arrangeParts(p, r.some(ids(p)), r.pick(HOWS)!) : p),
  arrangeOnFrame: (p, r) => (ids(p).length ? arrangeOnFrame(p, frame(r, p), r.some(ids(p)), r.pick(HOWS)!).project : p),
  move: (p, r) => (ids(p).length ? movePartsBy(p, r.some(ids(p)), { x: r.int(-50, 50), y: r.int(-50, 50) }) : p),
  pivot: (p, r) => (ids(p).length ? setPivot(p, r.pick(ids(p))!, { x: r.int(-100, 100), y: r.int(-100, 100) }) : p),
  pose(p, r) {
    const id = r.pick([...ids(p), ...roots(p)]);
    if (!id) return p;
    const channel = r.pick(CHANNELS)!;
    const value = channel === 'opacity' ? r.next() : channel.startsWith('scale') ? 0.2 + r.next() * 2 : r.int(-400, 400);
    return recordValue(p, id, channel, r.int(0, p.scene.durationFrames - 1), value);
  },
  camera: (p, r) => recordCamera(p, r.int(0, p.scene.durationFrames - 1), { x: r.int(0, 1920), zoom: 0.5 + r.next() * 2, rotation: r.int(-30, 30) }),
  retime(p, r) {
    const id = r.pick([...ids(p), ...roots(p)]);
    if (!id) return p;
    const targets = [{ frame: frame(r, p, new Set([id])), partIds: new Set([id]) }];
    const copy = r.next() < 0.3;
    const next = retimePoses(p, targets, r.int(-20, 20), { ripple: r.next() < 0.3, copy }).project;
    // Moving poses never loses or adds any; copying never loses any.
    const count = (q: Project) => q.scene.tracks.reduce((n, t) => n + t.poses.length, 0);
    if (copy ? count(next) < count(p) : count(next) !== count(p)) throw new Error(`retiming changed ${count(p)} poses to ${count(next)}`);
    return next;
  },
  deletePoses(p, r) {
    const chosen = new Set(r.some([...ids(p), ...roots(p)]));
    return deletePoses(p, [{ frame: frame(r, p, chosen), partIds: chosen }]);
  },
  stretch(p, r) {
    const from = r.int(0, p.scene.durationFrames - 1);
    return stretchPoses(p, from, from + r.int(0, 30), r.int(1, 60)).project;
  },
  frameRate: (p, r) => changeFrameRate(p, r.pick([12, 24, 25, 30, 60])!),
  resize: (p, r) => resizeScene(p, r.int(16, 4000), r.int(16, 4000)),
  mirror: (p, r) => (p.scene.layers.length ? mirrorPose(p, [r.pick(roots(p))!], r.int(0, p.scene.durationFrames - 1), r.next() < 0.5 ? 'mirror' : 'swap').project : p),
  pin(p, r) {
    const id = r.pick(ids(p));
    if (!id) return p;
    const f = r.int(0, p.scene.durationFrames - 1);
    return r.next() < 0.7 ? pinPart(p, id, f, { x: 0, y: 0 }, { x: r.int(0, 1900), y: r.int(0, 1000) }) : unpinPart(p, id, f);
  },
  effect(p, r) {
    const id = r.pick([...ids(p), ...roots(p)]);
    if (!id) return p;
    const part = [...parts(p), ...p.scene.layers.map((l) => l.root)].find((x) => x.id === id)!;
    const existing = r.pick(part.effects ?? []);
    if (existing && r.next() < 0.3) return removeEffect(p, id, existing.id);
    if (existing) {
      const setting = r.pick(EFFECT_SETTINGS[existing.kind])!;
      return recordEffectValue(p, id, existing.id, setting, r.int(0, p.scene.durationFrames - 1), r.next() * 20);
    }
    return addEffect(p, id, r.pick(['shadow', 'glow', 'contact', 'blur', 'haze'] as const)!).project;
  },
  switchLayer(p, r) {
    const chosen = r.some(shapes(p), 3);
    if (chosen.length < 2) return p;
    const result = makeSwitchLayer(p, chosen, r.pick(NAMES)!);
    if (!result) return p;
    const set = result.project.drawingSets.find((s) => s.id === result.setId)!;
    return setDrawingAt(result.project, result.partId, r.int(0, p.scene.durationFrames - 1), r.pick(set.drawings)!.key);
  },
  boolean: (p, r) => (shapes(p).length >= 2 ? booleanShapes(p, r.some(shapes(p), 3), r.pick(OPS)!).project : p),
  combine: (p, r) => (shapes(p).length >= 2 ? combineShapes(p, r.some(shapes(p), 3)).project : p),
  cycle(p, r) {
    const layer = r.pick(p.scene.layers);
    if (!layer) return p;
    const from = r.int(0, 20);
    return updateLayer(p, layer.id, (l) => ({ ...l, cycle: { from, to: from + r.int(1, 30), travel: r.next() < 0.5 } }));
  },
  // Saving to the library and adding it back, as a new layer or as parts
  // (also how copy and paste work), and updating a layer to a new version.
  libraryLayer(p, r) {
    const layer = r.pick(p.scene.layers);
    if (!layer) return p;
    const item = unpackLibraryItem(packLibraryItem(itemFromLayer(p, new Map(), layer.id, layer.name)));
    return insertLibraryItem(p, new Map(), item, { source: { relPath: `${layer.name}.nyahitem`, savedAt: 1 } }).project;
  },
  libraryParts(p, r) {
    const container = r.pick([...roots(p), ...groups(p)]);
    if (!ids(p).length || !container) return p;
    const item = unpackLibraryItem(packLibraryItem(itemFromParts(p, new Map(), r.some(ids(p)), 'Parts')));
    return insertLibraryItem(p, new Map(), item, { containerId: container, reuseExisting: r.next() < 0.5 }).project;
  },
  libraryUpdate(p, r) {
    const layer = r.pick(p.scene.layers.filter((l) => l.source));
    if (!layer?.source) return p;
    // A new version of the item: the layer as it is now, saved back with the
    // library's ids, after which the layer is linked to that version.
    const saved = withLibraryIds(itemFromLayer(p, new Map(), layer.id, layer.name), layer.source);
    const item = unpackLibraryItem(packLibraryItem(saved.item));
    const linked = updateLayer(p, layer.id, (l) => ({ ...l, source: linkAfterSaving(l, l.source!.savedAt + 1, saved.ids)! }));
    const r2 = updateLayerFromLibrary(linked, new Map(), layer.id, item, layer.source.savedAt + 2);
    // Updating to the version just saved from this very layer changes nothing.
    if (r2.added || r2.removed) throw new Error(`updating to its own new version added ${r2.added} and removed ${r2.removed} parts`);
    return r2.project;
  },
  stepping(p, r) {
    const layer = r.pick(p.scene.layers);
    return layer ? recordStepping(p, layer, r.int(0, p.scene.durationFrames - 1), r.int(1, 3) as Stepping) : p;
  },
};

/** Edits that rearrange things without moving any artwork in the rest pose. */
const KEEPS_ARTWORK = new Set(['group', 'ungroup', 'reparent', 'arrange', 'pivot']);

/** Where every part's drawing sits on the stage, in the rest pose. */
function placements(p: Project): Map<string, Mat2D> {
  const out = new Map<string, Mat2D>();
  for (const part of parts(p)) out.set(part.id, restWorldMatrix(locatePart(p, part.id)!));
  return out;
}

function checkArtworkKept(before: Project, after: Project): void {
  const was = placements(before);
  for (const [id, m] of placements(after)) {
    const old = was.get(id);
    if (old && m.some((v, i) => Math.abs(v - old[i]!) > 1e-6 * Math.max(1, Math.abs(v)))) {
      throw new Error(`${locatePart(after, id)!.part.name} moved: [${old.map((v) => v.toFixed(3))}] → [${m.map((v) => v.toFixed(3))}]`);
    }
  }
}

function check(p: Project): void {
  // It saves and opens again.
  const reopened = parseProject(JSON.parse(JSON.stringify(p)));
  expect(reopened.scene.durationFrames).toBeGreaterThan(0);
  // Every frame worked out has finite numbers.
  const n = p.scene.durationFrames;
  for (const f of [0, Math.floor(n / 2), n - 1, n + 10]) {
    const scene = evaluateScene(reopened, f);
    for (const part of scene.parts) {
      if (!part.world.every(Number.isFinite) || !Number.isFinite(part.opacity)) throw new Error(`frame ${f}: ${part.name} has a non-finite transform or opacity`);
    }
    if (!scene.cameraMatrix.every(Number.isFinite)) throw new Error(`frame ${f}: the camera is not finite`);
  }
}

function start(): Project {
  let p = createProject({ durationFrames: 48 });
  p = addLayer(p, 'background', 'Background').project;
  p = addLayer(p, 'character', 'Pip').project;
  return p;
}

describe('random edits keep the project valid', () => {
  // Making things is more common than taking them away, so scenes grow.
  const WEIGHTS: Record<string, number> = { addShape: 5, pose: 4, group: 2, duplicate: 2, removeLayer: 0.5, remove: 0.5 };
  const names = Object.keys(EDITS).flatMap((name) => Array<string>(Math.round((WEIGHTS[name] ?? 1) * 2)).fill(name));
  for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      let p = start();
      for (let step = 0; step < STEPS; step++) {
        const name = r.pick(names)!;
        try {
          const before = p;
          p = EDITS[name]!(p, r);
          check(p);
          if (KEEPS_ARTWORK.has(name)) checkArtworkKept(before, p);
        } catch (err) {
          throw new Error(`seed ${seed}, step ${step} (${name}): ${(err as Error).message}`);
        }
      }
    });
  }
});
