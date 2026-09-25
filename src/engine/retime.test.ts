import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import { deletePoses, poseEaseAt, poseFrames, retimePoses, setPoseEase, type RetimeTarget } from './retime';
import { findTrack, setPartPose } from './tracks';
import type { Project } from './types';

/** Arm rotation posed on 0, 10, 20, 30; head posed on 0 and 10; mouth sound on 10. */
function scene(): Project {
  let p = createProject({ durationFrames: 40 });
  for (const [f, v] of [[0, 0], [10, 90], [20, 0], [30, 90]] as const) p = setPartPose(p, 'arm', 'rotation', f, v);
  p = setPartPose(p, 'arm', 'x', 10, 5);
  for (const [f, v] of [[0, 0], [10, 20]] as const) p = setPartPose(p, 'head', 'rotation', f, v);
  p = setPartPose(p, 'mouth', 'drawing', 10, 'A');
  return p;
}

const frames = (p: Project, id: string, channel: 'rotation' | 'x' | 'drawing' = 'rotation') =>
  findTrack(p.scene.tracks, id, channel)?.poses.map((x) => x.frame);
const target = (frame: number, ...ids: string[]): RetimeTarget => ({ frame, partIds: new Set(ids) });

describe('retimePoses', () => {
  it('moves a pose to speed up the motion into it (10 → 5)', () => {
    const { project, delta } = retimePoses(scene(), [target(10, 'arm')], -5);
    expect(delta).toBe(-5);
    expect(frames(project, 'arm')).toEqual([0, 5, 20, 30]);
    // Every channel of the part on that frame moves together.
    expect(frames(project, 'arm', 'x')).toEqual([5]);
    // Other parts are untouched.
    expect(frames(project, 'head')).toEqual([0, 10]);
  });

  it('ripple: moving frame 10 to 8 shifts every later pose by the same amount', () => {
    const { project } = retimePoses(scene(), [target(10, 'arm')], -2, { ripple: true });
    expect(frames(project, 'arm')).toEqual([0, 8, 18, 28]);
  });

  it('ripple on a layer or scene row moves all its parts, except excluded tracks', () => {
    const all = target(10, 'arm', 'head', 'mouth');
    const { project } = retimePoses(scene(), [all], 3, { ripple: true, exclude: (t) => t.channel === 'drawing' });
    expect(frames(project, 'arm')).toEqual([0, 13, 23, 33]);
    expect(frames(project, 'head')).toEqual([0, 13]);
    expect(frames(project, 'mouth', 'drawing')).toEqual([10]);
  });

  it('a plain move cannot pass a neighbouring pose', () => {
    const { project, delta } = retimePoses(scene(), [target(10, 'arm')], 50);
    expect(delta).toBe(9);
    expect(frames(project, 'arm')).toEqual([0, 19, 20, 30]);
  });

  it('a ripple cannot move before the previous pose or frame 0', () => {
    expect(retimePoses(scene(), [target(10, 'arm')], -50, { ripple: true }).delta).toBe(-9);
    expect(retimePoses(scene(), [target(0, 'arm')], -5, { ripple: true }).delta).toBe(0);
  });

  it('copy duplicates a pose (a hold) and replaces any pose already there', () => {
    const { project } = retimePoses(scene(), [target(10, 'arm')], 5, { copy: true });
    expect(frames(project, 'arm')).toEqual([0, 10, 15, 20, 30]);
    const onTop = retimePoses(scene(), [target(10, 'arm')], 10, { copy: true }).project;
    const poses = findTrack(onTop.scene.tracks, 'arm', 'rotation')!.poses;
    expect(poses.find((x) => x.frame === 20)!.value).toBe(90);
  });

  it('lengthens the scene when poses move past its end', () => {
    const { project, extended } = retimePoses(scene(), [target(10, 'arm')], 15, { ripple: true });
    expect(extended).toBe(true);
    expect(project.scene.durationFrames).toBe(46);
  });

  it('moves several marks together', () => {
    const { project } = retimePoses(scene(), [target(10, 'arm'), target(20, 'arm')], 2);
    expect(frames(project, 'arm')).toEqual([0, 12, 22, 30]);
  });
});

describe('deletePoses', () => {
  it('removes poses on the marked frames and drops empty tracks', () => {
    const p = deletePoses(scene(), [target(10, 'arm', 'mouth')]);
    expect(frames(p, 'arm')).toEqual([0, 20, 30]);
    expect(findTrack(p.scene.tracks, 'arm', 'x')).toBeUndefined();
    expect(findTrack(p.scene.tracks, 'mouth', 'drawing')).toBeUndefined();
  });
});

describe('easing', () => {
  it('sets and reads the ease of the motion leaving a pose', () => {
    const p = setPoseEase(scene(), [target(10, 'arm')], 'linear');
    expect(poseEaseAt(p, [target(10, 'arm')])).toBe('linear');
    expect(poseEaseAt(p, [target(20, 'arm')])).toBe('smooth');
  });
});

describe('poseFrames', () => {
  it('lists the frames with poses for a set of parts', () => {
    expect(poseFrames(scene(), new Set(['arm', 'head']))).toEqual([0, 10, 20, 30]);
  });
});
