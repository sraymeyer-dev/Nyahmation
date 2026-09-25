import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createPart, createProject, ProjectFormatError } from '../engine/project';
import { setPartPose } from '../engine/tracks';
import { packProject, unpackProject } from './projectFile';

function sample() {
  const root = createPart({ name: 'body', kind: 'group' });
  let project = createProject({ characters: [{ id: 'c', name: 'Pip', root }] });
  project = setPartPose(project, root.id, 'x', 0, 10);
  project = { ...project, assets: [{ id: 'voice', name: 'line1.wav', mimeType: 'audio/wav' }] };
  const assets = new Map([['voice', new Uint8Array([82, 73, 70, 70, 1, 2, 3])]]);
  return { project, assets };
}

describe('.nyah files', () => {
  it('round-trip the project and its assets', () => {
    const bundle = sample();
    const out = unpackProject(packProject(bundle));
    expect(out.project).toEqual(bundle.project);
    expect([...out.assets.get('voice')!]).toEqual([...bundle.assets.get('voice')!]);
  });

  it('refuses to save when an asset has no data', () => {
    const bundle = sample();
    bundle.assets.clear();
    expect(() => packProject(bundle)).toThrow(/missing its data/);
  });

  it('gives clear errors for files that are not projects', () => {
    expect(() => unpackProject(new Uint8Array([1, 2, 3]))).toThrow(ProjectFormatError);
    expect(() => unpackProject(zipSync({ 'other.txt': strToU8('hi') }))).toThrow(/project.json is missing/);
    expect(() => unpackProject(zipSync({ 'project.json': strToU8('{nope') }))).toThrow(/not valid JSON/);
  });

  it('notices a missing asset file', () => {
    const { project } = sample();
    const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(project)) });
    expect(() => unpackProject(bytes)).toThrow(/missing the file for "line1.wav"/);
  });
});
