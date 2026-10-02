import { describe, expect, it } from 'vitest';
import { channelValueAt } from './access';
import { counterpartName, mirrorPose, pairParts } from './mirror';
import { createPart, createProject } from './project';
import { setPartPose } from './tracks';
import type { Layer, Project } from './types';

const at = (x: number, y: number, rotation = 0) => ({ x, y, rotation, scaleX: 1, scaleY: 1 });

/** A front-facing figure: torso with left/right arms (each with a hand) and a head; legs "Leg L"/"Leg R". */
function rig() {
  const handL = createPart({ name: 'Hand', kind: 'shape', rest: at(0, 40) });
  const handR = createPart({ name: 'Hand (right)', kind: 'shape', rest: at(0, 40) });
  const armL = createPart({ name: 'Arm (left)', kind: 'shape', rest: at(-30, 0, 20), children: [handL] });
  const armR = createPart({ name: 'Arm (right)', kind: 'shape', rest: at(30, 0, -20), children: [handR] });
  const head = createPart({ name: 'Head', kind: 'shape', rest: at(0, -50) });
  const legL = createPart({ name: 'Leg L', kind: 'shape', rest: at(-10, 60) });
  const legR = createPart({ name: 'Leg R', kind: 'shape', rest: at(10, 60) });
  const torso = createPart({ name: 'Torso', kind: 'group', rest: at(500, 300), children: [armL, armR, head, legL, legR] });
  const layer: Layer = { id: 'pip', name: 'Pip', kind: 'character', root: torso };
  return { project: createProject({ layers: [layer] }), torso, armL, armR, handL, handR, head, legL, legR };
}

const rot = (p: Project, id: string, f = 10) => channelValueAt(p, id, 'rotation', f)!;

describe('pairing parts by name', () => {
  it('finds the other side from words and single letters, keeping the capitals', () => {
    expect(counterpartName('Arm (left)')).toBe('Arm (right)');
    expect(counterpartName('Upper arm (front)')).toBe('Upper arm (back)');
    expect(counterpartName('LEFT LEG')).toBe('RIGHT LEG');
    expect(counterpartName('Leg L')).toBe('Leg R');
    expect(counterpartName('leg_r')).toBe('leg_l');
    expect(counterpartName('Lips')).toBeNull();
    expect(counterpartName('Torso')).toBeNull();
  });

  it('pairs children of paired parts in order, even when their names don’t say', () => {
    const { torso, handL, handR, legL, legR, head } = rig();
    const pairs = pairParts(torso);
    expect(pairs.get(handL.id)).toBe(handR.id);
    expect(pairs.get(legR.id)).toBe(legL.id);
    expect(pairs.has(head.id)).toBe(false);
  });
});

describe('mirroring a pose', () => {
  it('each side takes the other’s pose turned the other way; unpaired parts turn the other way', () => {
    let { project, torso, armL, armR, head } = rig();
    project = setPartPose(project, armL.id, 'rotation', 10, 80); // left arm raised 60° from rest
    project = setPartPose(project, head.id, 'rotation', 10, 15);
    const r = mirrorPose(project, [torso.id], 10, 'mirror');
    expect(rot(r.project, armR.id)).toBeCloseTo(-80); // rest -20, raised 60° the other way
    expect(rot(r.project, armL.id)).toBeCloseTo(20); // the right arm was at rest
    expect(rot(r.project, head.id)).toBeCloseTo(-15);
    // The character stays where it is.
    expect(channelValueAt(r.project, torso.id, 'x', 10)).toBe(500);
    expect(r.pairs).toBe(3);
  });

  it('swapping sides exchanges poses as they are and leaves unpaired parts alone', () => {
    let { project, torso, legL, legR, head } = rig();
    project = setPartPose(project, legL.id, 'rotation', 10, 25);
    project = setPartPose(project, legR.id, 'rotation', 10, -25);
    project = setPartPose(project, head.id, 'rotation', 10, 5);
    const r = mirrorPose(project, [torso.id], 10, 'swap');
    expect(rot(r.project, legL.id)).toBeCloseTo(-25);
    expect(rot(r.project, legR.id)).toBeCloseTo(25);
    expect(rot(r.project, head.id)).toBeCloseTo(5);
  });

  it('mirroring twice gives the pose back', () => {
    let { project, torso, armL, handR } = rig();
    project = setPartPose(project, armL.id, 'rotation', 10, 70);
    project = setPartPose(project, handR.id, 'rotation', 10, 30);
    const twice = mirrorPose(mirrorPose(project, [torso.id], 10, 'mirror').project, [torso.id], 10, 'mirror').project;
    expect(rot(twice, armL.id)).toBeCloseTo(70);
    expect(rot(twice, handR.id)).toBeCloseTo(30);
  });

  it('records the pose where it changes, keeping earlier frames (first-pose rule)', () => {
    let { project, torso, armL, armR } = rig();
    project = setPartPose(project, armL.id, 'rotation', 10, 80);
    const r = mirrorPose(project, [torso.id], 10, 'mirror').project;
    expect(rot(r, armR.id, 0)).toBeCloseTo(-20);
  });
});
