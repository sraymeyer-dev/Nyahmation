import { describe, expect, it } from 'vitest';
import { applyMouthCues, extendedShapesFor, standIn } from './autoLipSync';
import { createPart, createProject } from './project';
import { findTrack, setPartPose } from './tracks';
import type { AudioClip, Project } from './types';

function scene(keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']) {
  const mouth = createPart({ name: 'Mouth', kind: 'switch', drawingSetId: 'm', restDrawing: 'X' });
  const root = createPart({ name: 'Pip', kind: 'group', children: [mouth] });
  const project: Project = {
    ...createProject({ layers: [{ id: 'pip', name: 'Pip', kind: 'character', root }], durationFrames: 100 }),
    drawingSets: [{ id: 'm', name: 'Mouths', vocabulary: 'mouth', drawings: keys.map((key) => ({ key, name: key, items: [] })) }],
  };
  const clip: AudioClip = { id: 'c', assetId: 'a', name: 'line', startFrame: 10, duration: 1, volume: 1 };
  return { project, mouth: mouth.id, clip };
}
const poses = (p: Project, id: string) => (findTrack(p.scene.tracks, id, 'drawing')?.poses ?? []).map((x) => [x.frame, x.value]);

describe('automatic lip sync results', () => {
  it('puts a mouth change where each shape starts, from the clip’s first frame', () => {
    const { project, mouth, clip } = scene();
    const r = applyMouthCues(project, mouth, clip, [
      { start: 0, end: 0.25, shape: 'X' },
      { start: 0.25, end: 0.5, shape: 'D' },
      { start: 0.5, end: 1, shape: 'A' },
    ]);
    expect(poses(r.project, mouth)).toEqual([
      [10, 'X'],
      [16, 'D'],
      [22, 'A'],
      [34, 'X'], // back to the rest shape after the sound
    ]);
    expect(r.changes).toBe(3);
  });

  it('replaces lip sync inside the sound, keeps it outside', () => {
    let { project, mouth, clip } = scene();
    project = setPartPose(project, mouth, 'drawing', 5, 'E');
    project = setPartPose(project, mouth, 'drawing', 20, 'F');
    project = setPartPose(project, mouth, 'drawing', 40, 'C');
    const r = applyMouthCues(project, mouth, clip, [{ start: 0, end: 1, shape: 'B' }]);
    expect(poses(r.project, mouth)).toEqual([
      [5, 'E'],
      [10, 'B'],
      [34, 'F'], // F was showing when the sound ended
      [40, 'C'],
    ]);
  });

  it('uses stand-ins for shapes the set has no drawing for, and skips repeats', () => {
    const { project, mouth, clip } = scene(['A', 'B', 'C', 'D', 'E', 'F']);
    const r = applyMouthCues(project, mouth, clip, [
      { start: 0, end: 0.1, shape: 'X' },
      { start: 0.1, end: 0.2, shape: 'A' },
      { start: 0.2, end: 0.3, shape: 'G' },
    ]);
    // X → A (then A again is no change), G → B.
    expect(poses(r.project, mouth).slice(0, 2)).toEqual([
      [10, 'A'],
      [15, 'B'],
    ]);
    expect(standIn('H', new Set(['C']))).toBe('C');
    expect(extendedShapesFor(new Set(['A', 'X', 'G']))).toBe('GX');
  });

  it('skips the part of a sound before frame 1', () => {
    const { project, mouth, clip } = scene();
    const r = applyMouthCues(project, mouth, { ...clip, startFrame: -12 }, [
      { start: 0, end: 0.4, shape: 'D' },
      { start: 0.75, end: 1, shape: 'A' },
    ]);
    expect(poses(r.project, mouth)[0]).toEqual([6, 'A']);
  });
});
