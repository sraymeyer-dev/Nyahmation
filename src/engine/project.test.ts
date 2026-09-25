import { describe, expect, it } from 'vitest';
import { createPart, createProject, migrateProject, parseProject, PROJECT_VERSION, ProjectFormatError } from './project';
import { setPartPose } from './tracks';
import type { Project } from './types';

const roundTrip = (p: Project) => parseProject(JSON.parse(JSON.stringify(p)));

function sample(): Project {
  const arm = createPart({ name: 'arm', kind: 'shape' });
  const root = createPart({ name: 'body', kind: 'group', children: [arm] });
  let project = createProject({ layers: [{ id: 'c', name: 'Pip', kind: 'character', root }] });
  project = setPartPose(project, arm.id, 'rotation', 0, 0);
  project = setPartPose(project, arm.id, 'rotation', 12, 45, 'easeOut');
  return project;
}

describe('createProject', () => {
  it('defaults to a 1080p, 24 fps scene on ones', () => {
    const p = createProject();
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.scene).toMatchObject({ width: 1920, height: 1080, fps: 24, stepping: 1 });
  });
});

describe('parseProject', () => {
  it('accepts what it saves', () => {
    const p = sample();
    expect(roundTrip(p)).toEqual(p);
  });

  it('rejects things that are not projects', () => {
    expect(() => parseProject(null)).toThrow(ProjectFormatError);
    expect(() => parseProject({ format: 'something-else' })).toThrow(ProjectFormatError);
  });

  it('refuses files from a newer version with a clear message', () => {
    const p = { ...sample(), version: PROJECT_VERSION + 1 };
    expect(() => roundTrip(p)).toThrow(/newer version of Nyahmation/);
  });

  it('catches damaged data', () => {
    const dupe = sample();
    dupe.scene.layers[0]!.root.children[0]!.id = dupe.scene.layers[0]!.root.id;
    expect(() => roundTrip(dupe)).toThrow(/used twice/);

    const unsorted = sample();
    unsorted.scene.tracks[0]!.poses.reverse();
    expect(() => roundTrip(unsorted)).toThrow(/increasing whole frames/);

    const orphan = sample();
    orphan.scene.tracks[0]!.partId = 'nobody';
    expect(() => roundTrip(orphan)).toThrow(/unknown part/);

    const badStep = sample();
    (badStep.scene as { stepping: number }).stepping = 4;
    expect(() => roundTrip(badStep)).toThrow(/stepping/);

    const nan = sample();
    (nan.scene.tracks[0]!.poses[0] as { value: unknown }).value = 'oops';
    expect(() => roundTrip(nan)).toThrow(/not a number/);
  });
});

describe('migrateProject', () => {
  it('upgrades one version at a time', () => {
    const migrations = {
      1: (raw: Record<string, unknown>) => ({ ...raw, renamed: raw.old, old: undefined }),
      2: (raw: Record<string, unknown>) => ({ ...raw, added: true }),
    };
    const out = migrateProject({ version: 1, old: 'x' }, migrations, 3);
    expect(out).toMatchObject({ version: 3, renamed: 'x', added: true });
  });

  it('fails clearly when a migration is missing', () => {
    expect(() => migrateProject({ version: 1 }, {}, 2)).toThrow(/upgrade a version 1/);
  });

  it('needs a version number', () => {
    expect(() => migrateProject({})).toThrow(/version/);
  });
});

describe('version 1 files', () => {
  it('turn their characters into character layers', () => {
    const root = createPart({ name: 'body', kind: 'group' });
    const v1 = {
      format: 'nyahmation',
      version: 1,
      scene: { width: 640, height: 480, fps: 24, durationFrames: 10, background: '#fff', stepping: 2, characters: [{ id: 'c', name: 'Pip', root }], tracks: [] },
      drawingSets: [],
      assets: [],
    };
    const p = parseProject(JSON.parse(JSON.stringify(v1)));
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.scene.layers).toEqual([{ id: 'c', name: 'Pip', kind: 'character', root }]);
    expect('characters' in p.scene).toBe(false);
  });
});
