import { translatePath } from './geometry';
import { isContinuousChannel } from './tracks';
import type { Layer, LayerKind, Part, PartKind, Project, Scene, Stepping, Track } from './types';

/** Bump when the saved format changes, and add a migration from the old version. */
export const PROJECT_VERSION = 3;

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
    for (const d of set.drawings ?? []) if (!Array.isArray(d.items)) fail(`drawing ${d.key} in ${set.name} is damaged`);
  }

  const partIds = new Set<string>();
  const checkPart = (part: Part) => {
    if (!isObject(part) || typeof part.id !== 'string') fail('a part has no id');
    if (partIds.has(part.id)) fail(`part id ${part.id} is used twice`);
    partIds.add(part.id);
    if (!Array.isArray(part.children)) fail(`part ${part.name} has no children list`);
    part.children.forEach(checkPart);
  };
  scene.layers.forEach((layer: Layer) => {
    if (layer.kind !== 'character' && layer.kind !== 'background') fail(`layer ${layer.name} has an unknown kind`);
    if (layer.stepping !== undefined && !isStepping(layer.stepping)) fail(`layer ${layer.name} has invalid stepping`);
    checkPart(layer.root);
  });

  const seen = new Set<string>();
  scene.tracks.forEach((track: Track) => {
    const key = `${track.partId}/${track.channel}`;
    if (seen.has(key)) fail(`two tracks for ${key}`);
    seen.add(key);
    if (!partIds.has(track.partId)) fail(`track for unknown part ${track.partId}`);
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

function isStepping(v: unknown): v is Stepping {
  return v === 1 || v === 2 || v === 3;
}

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
