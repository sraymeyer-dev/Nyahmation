import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import { findTrack, isContinuousChannel, removePose, setPartPose, setPose } from './tracks';
import type { Pose } from './types';

describe('setPose', () => {
  it('inserts in frame order', () => {
    let p: Pose<number>[] = [];
    p = setPose(p, 10, 1);
    p = setPose(p, 0, 0);
    p = setPose(p, 5, 0.5);
    expect(p.map((x) => x.frame)).toEqual([0, 5, 10]);
  });

  it('replaces the pose on the same frame and keeps its ease', () => {
    const p = setPose([{ frame: 5, value: 1, ease: 'linear' as const }], 5, 2);
    expect(p).toEqual([{ frame: 5, value: 2, ease: 'linear' }]);
    expect(setPose(p, 5, 3, 'hold')).toEqual([{ frame: 5, value: 3, ease: 'hold' }]);
  });

  it('does not modify the original', () => {
    const original: Pose<number>[] = [{ frame: 1, value: 1 }];
    setPose(original, 2, 2);
    expect(original).toHaveLength(1);
  });

  it('rejects fractional and negative frames', () => {
    expect(() => setPose([], 1.5, 0)).toThrow(RangeError);
    expect(() => setPose([], -1, 0)).toThrow(RangeError);
  });
});

describe('removePose', () => {
  it('removes only that frame', () => {
    expect(removePose([{ frame: 1, value: 1 }, { frame: 2, value: 2 }], 1)).toEqual([{ frame: 2, value: 2 }]);
  });
});

describe('setPartPose', () => {
  it('creates a track and then adds to it', () => {
    let project = createProject();
    project = setPartPose(project, 'arm', 'rotation', 0, 10);
    project = setPartPose(project, 'arm', 'rotation', 12, 90);
    project = setPartPose(project, 'mouth', 'drawing', 3, 'A');
    expect(project.scene.tracks).toHaveLength(2);
    expect(findTrack(project.scene.tracks, 'arm', 'rotation')?.poses).toEqual([
      { frame: 0, value: 10 },
      { frame: 12, value: 90 },
    ]);
    expect(findTrack(project.scene.tracks, 'mouth', 'drawing')?.poses).toEqual([{ frame: 3, value: 'A' }]);
  });
});

describe('isContinuousChannel', () => {
  it('separates blended from held channels', () => {
    expect(isContinuousChannel('rotation')).toBe(true);
    expect(isContinuousChannel('opacity')).toBe(true);
    expect(isContinuousChannel('drawing')).toBe(false);
    expect(isContinuousChannel('visible')).toBe(false);
    expect(isContinuousChannel('drawOrder')).toBe(false);
  });
});
