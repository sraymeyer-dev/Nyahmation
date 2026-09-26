import { translatePath } from './geometry';
import { isContinuousChannel, parseEffectChannel } from './tracks';
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
    for (const d of set.drawings ?? []) {
      if (!Array.isArray(d.items)) fail(`drawing ${d.key} in ${set.name} is damaged`);
      for (const item of d.items) if (item.kind === 'shape' && item.style?.fillGradient !== undefined && !validGradient(item.style.fillGradient)) fail(`drawing ${d.key} in ${set.name} has a damaged gradient`);
    }
  }
  if (scene.sky !== undefined && !(typeof scene.sky?.top === 'string' && typeof scene.sky?.bottom === 'string')) fail('the sky is damaged');

  const partIds = new Set<string>();
  const effectsOf = new Map<string, Effect[]>();
  const checkPart = (part: Part) => {
    if (!isObject(part) || typeof part.id !== 'string') fail('a part has no id');
    if (partIds.has(part.id)) fail(`part id ${part.id} is used twice`);
    partIds.add(part.id);
    if (!Array.isArray(part.children)) fail(`part ${part.name} has no children list`);
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
    if (layer.kind !== 'character' && layer.kind !== 'background') fail(`layer ${layer.name} has an unknown kind`);
    if (layer.stepping !== undefined && !isStepping(layer.stepping)) fail(`layer ${layer.name} has invalid stepping`);
    if (layer.depth !== undefined && !(Number.isFinite(layer.depth) && layer.depth >= 0)) fail(`layer ${layer.name} has an invalid depth`);
    if (layer.follow !== undefined && typeof layer.follow?.partId !== 'string') fail(`layer ${layer.name} follows nothing`);
    if (layer.scroll !== undefined && !(Number.isFinite(layer.scroll?.speed) && typeof layer.scroll?.repeat === 'boolean')) fail(`layer ${layer.name} has invalid scrolling`);
    checkPart(layer.root);
  });

  const seen = new Set<string>();
  scene.tracks.forEach((track: Track) => {
    const key = `${track.partId}/${track.channel}`;
    if (seen.has(key)) fail(`two tracks for ${key}`);
    seen.add(key);
    if (track.partId === CAMERA_ID) {
      if (!['x', 'y', 'zoom', 'rotation'].includes(track.channel)) fail(`the camera has no ${track.channel} channel`);
    } else if (!partIds.has(track.partId)) fail(`track for unknown part ${track.partId}`);
    if (track.partId !== CAMERA_ID && track.channel === 'zoom') fail(`only the camera zooms (${key})`);
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
      if (isContinuousChannel(track.channel) && !Number.isFinite(pose.value)) {
        fail(`pose on ${key} at frame ${pose.frame} is not a number`);
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

function validEffect(e: unknown): e is Effect {
  if (!isObject(e) || typeof e.id !== 'string' || !(e.kind in EFFECT_SETTINGS)) return false;
  const settings = EFFECT_SETTINGS[e.kind as Effect['kind']] as readonly string[];
  if (!settings.every((k) => Number.isFinite(e[k]))) return false;
  return e.kind === 'blur' || typeof e.color === 'string';
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
