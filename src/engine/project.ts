import { translatePath } from './geometry';
import { DISCRETE_CHANNELS, isContinuousChannel, parseEffectChannel } from './tracks';
import { CAMERA_ID, EFFECT_SETTINGS, type BlendMode, type Effect, type Layer, type LayerKind, type Part, type PartKind, type Project, type Scene, type Stepping, type Track } from './types';

/** Bump when the saved format changes, and add a migration from the old version. */
export const PROJECT_VERSION = 5;

export class ProjectFormatError extends Error {
  override name = 'ProjectFormatError';
}

export function createId(): string {
  return globalThis.crypto.randomUUID();
}

export function createPart(init: { name: string; kind: PartKind } & Partial<Omit<Part, 'name' | 'kind'>>): Part {
  return {
    id: createId(),
    rest: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    joint: { pivot: { x: 0, y: 0 } },
    opacity: 1,
    visible: true,
    drawOrder: 0,
    children: [],
    ...init,
  };
}

export function createLayer(kind: LayerKind, name: string, children: Part[] = []): Layer {
  return { id: createId(), name, kind, root: createPart({ name, kind: 'group', children }) };
}

export function createProject(scene: Partial<Scene> = {}): Project {
  return {
    format: 'nyahmation',
    version: PROJECT_VERSION,
    scene: {
      width: 1920,
      height: 1080,
      fps: 24,
      durationFrames: 240,
      background: '#ffffff',
      stepping: 1,
      layers: [],
      tracks: [],
      audio: [],
      ...scene,
    },
    drawingSets: [],
    assets: [],
  };
}

/**
 * Upgrades raw project JSON one version at a time. `migrations[n]` turns a
 * version-n document into a version-(n+1) document.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v2: the scene's `characters` became a stack of `layers` (characters and backgrounds).
  1: (raw) => {
    const scene = { ...(raw.scene as Record<string, unknown>) };
    const characters = Array.isArray(scene.characters) ? scene.characters : [];
    scene.layers = characters.map((c: Record<string, unknown>) => ({ ...c, kind: 'character' }));
    delete scene.characters;
    return { ...raw, scene };
  },
  // v3: scenes have audio clips; drawings are lists of items (shapes and
  // images) instead of one piece with an offset.
  2: (raw) => {
    const scene = { ...(raw.scene as Record<string, unknown>), audio: [] };
    const sets = Array.isArray(raw.drawingSets) ? raw.drawingSets : [];
    const drawingSets = sets.map((set: Record<string, any>) => ({
      ...set,
      drawings: (set.drawings ?? []).map((d: Record<string, any>) => {
        const off = d.offset ?? { x: 0, y: 0 };
        const c = d.content ?? {};
        const items =
          c.kind === 'image'
            ? [{ kind: 'image', assetId: c.assetId, x: off.x, y: off.y, width: c.width, height: c.height }]
            : [{ kind: 'shape', style: c.style, paths: (c.paths ?? []).map((p: any) => translatePath(p, off.x, off.y)) }];
        return { key: d.key, name: d.name, items };
      }),
    }));
    return { ...raw, scene, drawingSets };
  },
  // v4: a camera (tracks on CAMERA_ID), and layers with a parallax depth or
  // fixed to the camera. Nothing to convert; the number marks files that older
  // versions can't show correctly.
  3: (raw) => raw,
  // v5: effects (shadow, glow, blur, haze), blend modes and clipping on
  // parts, and effect animation tracks. Nothing to convert.
  4: (raw) => raw,
};

export function migrateProject(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  targetVersion = PROJECT_VERSION,
): Record<string, unknown> {
  let doc = raw;
  let version = doc.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError('This file has no valid version number.');
  }
  if (version > targetVersion) {
    throw new ProjectFormatError(
      `This project was saved by a newer version of Nyahmation (file version ${version}, this app reads up to ${targetVersion}).`,
    );
  }
  while (version < targetVersion) {
    const step = migrations[version];
    if (!step) throw new ProjectFormatError(`Don't know how to upgrade a version ${version} project.`);
    doc = { ...step(doc), version: version + 1 };
    version += 1;
  }
  return doc;
}

/** Parses and checks project JSON (already decoded from text). Throws ProjectFormatError. */
export function parseProject(json: unknown): Project {
  if (!isObject(json) || json.format !== 'nyahmation') {
    throw new ProjectFormatError("This isn't a Nyahmation project.");
  }
  const project = migrateProject(json) as unknown as Project;
  validateProject(project);
  return project;
}

export function validateProject(project: Project): void {
  const fail = (msg: string): never => {
    throw new ProjectFormatError(`Damaged project: ${msg}`);
  };
  const { scene } = project;
  if (!isObject(scene)) fail('missing scene');
  for (const key of ['width', 'height', 'fps', 'durationFrames'] as const) {
    const v = scene[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) fail(`scene ${key} must be a positive whole number`);
  }
  if (!isStepping(scene.stepping)) fail('scene stepping must be 1, 2 or 3');
  if (!Array.isArray(scene.layers) || !Array.isArray(scene.tracks)) fail('scene layers/tracks missing');
  if (!Array.isArray(project.drawingSets) || !Array.isArray(project.assets)) fail('drawing sets/assets missing');
  if (!Array.isArray(scene.audio)) fail('scene audio missing');
  for (const clip of scene.audio) {
    if (typeof clip?.assetId !== 'string' || !Number.isInteger(clip.startFrame) || !Number.isFinite(clip.volume) || !(clip.duration >= 0)) {
      fail('an audio clip is damaged');
    }
  }
  for (const set of project.drawingSets) {
    if (!isObject(set) || typeof set.id !== 'string' || !Array.isArray(set.drawings) || (set.vocabulary !== 'mouth' && set.vocabulary !== 'custom')) fail('a drawing set is damaged');
    for (const d of set.drawings) {
      if (!isObject(d) || typeof d.key !== 'string' || !Array.isArray(d.items)) fail(`a drawing in ${set.name} is damaged`);
      for (const item of d.items) {
        const ok =
          isObject(item) &&
          (item.kind === 'shape'
            ? Array.isArray(item.paths) && item.paths.every(validPath) && validStyle(item.style)
            : item.kind === 'image' && typeof item.assetId === 'string' && [item.x, item.y, item.width, item.height].every(Number.isFinite));
        if (!ok) fail(`drawing ${d.key} in ${set.name} is damaged`);
        if (item.kind === 'shape' && item.style.fillGradient !== undefined && !validGradient(item.style.fillGradient)) fail(`drawing ${d.key} in ${set.name} has a damaged gradient`);
      }
    }
  }
  for (const a of project.assets) if (!isObject(a) || typeof a.id !== 'string' || typeof a.mimeType !== 'string') fail('a file in the project is damaged');
  if (scene.sky !== undefined && !(typeof scene.sky?.top === 'string' && typeof scene.sky?.bottom === 'string')) fail('the sky is damaged');
  if (project.swatches !== undefined && !(Array.isArray(project.swatches) && project.swatches.every((c) => typeof c === 'string'))) fail('the colour swatches are damaged');

  const partIds = new Set<string>();
  const effectsOf = new Map<string, Effect[]>();
  const layerRoots = new Set<string>();
  const checkPart = (part: Part) => {
    if (!isObject(part) || typeof part.id !== 'string') fail('a part has no id');
    if (partIds.has(part.id)) fail(`part id ${part.id} is used twice`);
    partIds.add(part.id);
    if (typeof part.name !== 'string' || !PART_KINDS.includes(part.kind)) fail(`part ${part.id} has no name or an unknown kind`);
    if (!Array.isArray(part.children)) fail(`part ${part.name} has no children list`);
    const r = part.rest;
    if (!isObject(r) || ![r.x, r.y, r.rotation, r.scaleX, r.scaleY].every(sane)) fail(`part ${part.name} has a damaged position`);
    if (!isObject(part.joint) || !validPoint(part.joint.pivot)) fail(`part ${part.name} has a damaged joint`);
    const j = part.joint;
    if (![j.minAngle, j.maxAngle].every((a) => a === undefined || Number.isFinite(a)) || ![undefined, 1, -1].includes(j.bendDirection)) fail(`part ${part.name} has damaged joint limits`);
    if (!Number.isFinite(part.opacity) || typeof part.visible !== 'boolean' || !Number.isFinite(part.drawOrder)) fail(`part ${part.name} has damaged settings`);
    if (part.paths !== undefined && !(Array.isArray(part.paths) && part.paths.every(validPath))) fail(`part ${part.name} has a damaged outline`);
    if (part.style !== undefined && !validStyle(part.style)) fail(`part ${part.name} has a damaged fill or stroke`);
    if (part.image !== undefined && !validImage(part.image)) fail(`part ${part.name} has a damaged picture`);
    if (part.drawingSetId !== undefined && typeof part.drawingSetId !== 'string') fail(`part ${part.name} has a damaged drawing set`);
    if (part.restDrawing !== undefined && typeof part.restDrawing !== 'string') fail(`part ${part.name} has a damaged drawing`);
    const g = part.style?.fillGradient;
    if (g !== undefined && !validGradient(g)) fail(`part ${part.name} has a damaged gradient`);
    if (part.blend !== undefined && !BLEND_MODES.includes(part.blend)) fail(`part ${part.name} has an unknown blend mode`);
    if (part.effects !== undefined) {
      if (!Array.isArray(part.effects)) fail(`part ${part.name} has damaged effects`);
      const ids = new Set<string>();
      for (const e of part.effects) {
        if (!validEffect(e) || ids.has(e.id)) fail(`part ${part.name} has a damaged effect`);
        ids.add(e.id);
      }
      effectsOf.set(part.id, part.effects);
    }
    part.children.forEach(checkPart);
  };
  scene.layers.forEach((layer: Layer) => {
    if (!isObject(layer) || typeof layer.id !== 'string' || !isObject(layer.root)) fail('a layer is damaged');
    if (layer.kind !== 'character' && layer.kind !== 'background') fail(`layer ${layer.name} has an unknown kind`);
    if (layer.stepping !== undefined && !isStepping(layer.stepping)) fail(`layer ${layer.name} has invalid stepping`);
    if (layer.depth !== undefined && !(Number.isFinite(layer.depth) && layer.depth >= 0 && layer.depth <= 10)) fail(`layer ${layer.name} has an invalid depth`);
    if (layer.follow !== undefined && typeof layer.follow?.partId !== 'string') fail(`layer ${layer.name} follows nothing`);
    if (layer.scroll !== undefined && !(Number.isFinite(layer.scroll?.speed) && typeof layer.scroll?.repeat === 'boolean')) fail(`layer ${layer.name} has invalid scrolling`);
    const c = layer.cycle;
    if (c !== undefined && !(Number.isInteger(c?.from) && Number.isInteger(c?.to) && c.from >= 0 && c.to > c.from && typeof c.travel === 'boolean')) fail(`layer ${layer.name} has an invalid cycle`);
    layerRoots.add(layer.root.id);
    const src = layer.source;
    if (src !== undefined && !(typeof src?.relPath === 'string' && Number.isFinite(src.savedAt) && isObject(src.parts) && isObject(src.sets))) fail(`layer ${layer.name} has a damaged library link`);
    checkPart(layer.root);
  });

  const seen = new Set<string>();
  scene.tracks.forEach((track: Track) => {
    if (!isObject(track) || typeof track.partId !== 'string' || typeof track.channel !== 'string' || !Array.isArray(track.poses)) fail('an animation track is damaged');
    if (!isContinuousChannel(track.channel) && !(DISCRETE_CHANNELS as readonly string[]).includes(track.channel)) fail(`unknown animation channel ${track.channel}`);
    if (!track.poses.every(isObject)) fail(`a pose on ${track.partId}/${track.channel} is damaged`);
    const key = `${track.partId}/${track.channel}`;
    if (seen.has(key)) fail(`two tracks for ${key}`);
    seen.add(key);
    if (track.partId === CAMERA_ID) {
      if (!['x', 'y', 'zoom', 'rotation'].includes(track.channel)) fail(`the camera has no ${track.channel} channel`);
    } else if (!partIds.has(track.partId)) fail(`track for unknown part ${track.partId}`);
    if (track.partId !== CAMERA_ID && track.channel === 'zoom') fail(`only the camera zooms (${key})`);
    if (track.channel === 'stepping') {
      if (!layerRoots.has(track.partId)) fail(`stepping changes belong on a layer (${key})`);
      if (!track.poses.every((p) => isStepping(p.value))) fail(`stepping on ${key} must be 1, 2 or 3`);
    }
    const fx = parseEffectChannel(track.channel);
    if (track.channel.startsWith('fx:')) {
      const effect = fx && effectsOf.get(track.partId)?.find((e) => e.id === fx.effectId);
      if (!fx || !effect || !(EFFECT_SETTINGS[effect.kind] as readonly string[]).includes(fx.setting)) fail(`animation for a missing effect (${key})`);
    }
    let lastFrame = -1;
    for (const pose of track.poses) {
      if (!Number.isInteger(pose.frame) || pose.frame <= lastFrame) {
        fail(`poses on ${key} must be on increasing whole frames`);
      }
      lastFrame = pose.frame;
      if (pose.ease !== undefined && !validEase(pose.ease)) fail(`pose on ${key} at frame ${pose.frame} has an unknown easing`);
      if (isContinuousChannel(track.channel) && !sane(pose.value)) {
        fail(`pose on ${key} at frame ${pose.frame} is not a number`);
      }
      if (track.channel === 'zoom' && !((pose.value as number) > 0 && (pose.value as number) <= 1000)) fail(`the camera zoom at frame ${pose.frame} is out of range`);
      const v: unknown = pose.value;
      if (
        (track.channel === 'drawing' && typeof v !== 'string') ||
        (track.channel === 'visible' && typeof v !== 'boolean') ||
        (track.channel === 'drawOrder' && !Number.isFinite(v))
      ) {
        fail(`pose on ${key} at frame ${pose.frame} is damaged`);
      }
      if (track.channel === 'pin' && pose.value !== null) {
        const v = pose.value as { point?: { x?: unknown; y?: unknown }; at?: { x?: unknown; y?: unknown } };
        const ok = [v?.point?.x, v?.point?.y, v?.at?.x, v?.at?.y].every((n) => Number.isFinite(n));
        if (!ok) fail(`pin on ${key} at frame ${pose.frame} is damaged`);
      }
    }
  });
}

const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'screen', 'add', 'overlay'];
const PART_KINDS: readonly PartKind[] = ['group', 'shape', 'switch', 'image'];

/** A finite number of a sensible size: far bigger ones overflow when multiplied together. */
function sane(n: unknown): boolean {
  return Number.isFinite(n) && Math.abs(n as number) < 1e9;
}

function validPoint(p: unknown): boolean {
  return isObject(p) && sane(p.x) && sane(p.y);
}

function validPath(path: unknown): boolean {
  if (!isObject(path) || typeof path.closed !== 'boolean' || !Array.isArray(path.points)) return false;
  return path.points.every(
    (pt: unknown) => isObject(pt) && validPoint(pt.anchor) && (pt.handleIn === undefined || validPoint(pt.handleIn)) && (pt.handleOut === undefined || validPoint(pt.handleOut)),
  );
}

function validStyle(s: unknown): boolean {
  const paint = (c: unknown) => c === null || typeof c === 'string';
  return (
    isObject(s) &&
    paint(s.fill) &&
    paint(s.stroke) &&
    Number.isFinite(s.strokeWidth) &&
    ['butt', 'round', 'square'].includes(s.lineCap) &&
    ['miter', 'round', 'bevel'].includes(s.lineJoin) &&
    ['nonzero', 'evenodd'].includes(s.fillRule)
  );
}

function validImage(i: unknown): boolean {
  return isObject(i) && typeof i.assetId === 'string' && Number.isFinite(i.width) && Number.isFinite(i.height) && i.width > 0 && i.height > 0;
}

function validEffect(e: unknown): e is Effect {
  if (!isObject(e) || typeof e.id !== 'string' || !(e.kind in EFFECT_SETTINGS)) return false;
  const settings = EFFECT_SETTINGS[e.kind as Effect['kind']] as readonly string[];
  if (!settings.every((k) => Number.isFinite(e[k]))) return false;
  return e.kind === 'blur' || typeof e.color === 'string';
}

const EASE_PRESETS = ['smooth', 'linear', 'hold', 'easeIn', 'easeOut', 'easeInOut'];

function validEase(e: unknown): boolean {
  if (typeof e === 'string') return EASE_PRESETS.includes(e);
  return isObject(e) && Array.isArray(e.bezier) && e.bezier.length === 4 && e.bezier.every((n: unknown) => Number.isFinite(n));
}

function validGradient(g: unknown): boolean {
  if (!isObject(g) || (g.kind !== 'linear' && g.kind !== 'radial')) return false;
  const point = (p: unknown) => isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
  return point(g.from) && point(g.to) && Array.isArray(g.stops) && g.stops.every((s: unknown) => isObject(s) && Number.isFinite(s.offset) && typeof s.color === 'string');
}

function isStepping(v: unknown): v is Stepping {
  return v === 1 || v === 2 || v === 3;
}

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
