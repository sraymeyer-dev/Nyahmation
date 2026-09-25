import { describe, expect, it } from 'vitest';
import { evaluateContinuous, evaluateDiscrete, poseIndexAtOrBefore, smoothTangent } from './interpolate';
import type { Ease, Pose } from './types';

const poses = (...list: [number, number, Ease?][]): Pose<number>[] =>
  list.map(([frame, value, ease]) => (ease ? { frame, value, ease } : { frame, value }));

describe('poseIndexAtOrBefore', () => {
  const p = poses([0, 0], [10, 1], [20, 2]);
  it('finds the segment start', () => {
    expect(poseIndexAtOrBefore(p, -1)).toBe(-1);
    expect(poseIndexAtOrBefore(p, 0)).toBe(0);
    expect(poseIndexAtOrBefore(p, 9)).toBe(0);
    expect(poseIndexAtOrBefore(p, 10)).toBe(1);
    expect(poseIndexAtOrBefore(p, 25)).toBe(2);
  });
});

describe('evaluateContinuous', () => {
  it('uses the rest value with no poses', () => {
    expect(evaluateContinuous([], 5, 42)).toBe(42);
  });

  it('holds the first and last pose outside the posed range', () => {
    const p = poses([10, 1], [20, 5]);
    expect(evaluateContinuous(p, 0, 99)).toBe(1);
    expect(evaluateContinuous(p, 30, 99)).toBe(5);
  });

  it('a single pose holds forever', () => {
    expect(evaluateContinuous(poses([7, 3]), 0, 0)).toBe(3);
    expect(evaluateContinuous(poses([7, 3]), 100, 0)).toBe(3);
  });

  it('hits every pose exactly, whatever the ease', () => {
    for (const ease of ['smooth', 'linear', 'hold', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      const p = poses([0, 0, ease], [10, 50, ease], [15, -20, ease], [30, 90, ease]);
      for (const pose of p) expect(evaluateContinuous(p, pose.frame, 0)).toBeCloseTo(pose.value, 9);
    }
  });

  it('linear goes in a straight line', () => {
    const p = poses([0, 0, 'linear'], [10, 100]);
    expect(evaluateContinuous(p, 2.5, 0)).toBeCloseTo(25);
    expect(evaluateContinuous(p, 5, 0)).toBeCloseTo(50);
  });

  it('hold jumps at the next pose', () => {
    const p = poses([0, 0, 'hold'], [10, 100]);
    expect(evaluateContinuous(p, 9.99, 0)).toBe(0);
    expect(evaluateContinuous(p, 10, 0)).toBe(100);
  });

  it('the ease belongs to the segment leaving a pose', () => {
    const p = poses([0, 0, 'linear'], [10, 100, 'hold'], [20, 200]);
    expect(evaluateContinuous(p, 5, 0)).toBeCloseTo(50);
    expect(evaluateContinuous(p, 15, 0)).toBe(100);
  });

  it('presets and custom curves shape the timing', () => {
    expect(evaluateContinuous(poses([0, 0, 'easeIn'], [10, 100]), 5, 0)).toBeCloseTo(31.53, 1);
    expect(evaluateContinuous(poses([0, 0, { bezier: [0, 0, 1, 1] }], [10, 100]), 5, 0)).toBeCloseTo(50, 4);
  });

  describe('smooth (default)', () => {
    it('two poses ease in and out like smoothstep', () => {
      const p = poses([0, 0], [10, 100]);
      for (const u of [0.1, 0.25, 0.5, 0.75]) {
        expect(evaluateContinuous(p, u * 10, 0)).toBeCloseTo(100 * (3 * u * u - 2 * u * u * u), 9);
      }
    });

    it('flows through a pose in the middle of a steady motion without stopping', () => {
      const p = poses([0, 0], [10, 50], [20, 100]);
      // Speed just before and after the middle pose is equal and not zero.
      const before = evaluateContinuous(p, 10, 0) - evaluateContinuous(p, 9.999, 0);
      const after = evaluateContinuous(p, 10.001, 0) - evaluateContinuous(p, 10, 0);
      expect(before).toBeGreaterThan(0);
      expect(before / 0.001).toBeCloseTo(after / 0.001, 2);
    });

    it('comes to rest at a turning point', () => {
      const p = poses([0, 0], [10, 100], [20, 0]);
      expect(smoothTangent(p, 1)).toBe(0);
      expect(evaluateContinuous(p, 9, 0)).toBeLessThan(100);
      expect(evaluateContinuous(p, 11, 0)).toBeLessThan(100);
    });

    it('never overshoots the posed values, even with uneven spacing', () => {
      const p = poses([0, 0], [2, 90], [30, 100], [31, -40], [60, -35], [61, 200]);
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i]!;
        const b = p[i + 1]!;
        const lo = Math.min(a.value, b.value);
        const hi = Math.max(a.value, b.value);
        for (let f = a.frame; f <= b.frame; f += 0.05) {
          const v = evaluateContinuous(p, f, 0);
          expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(v).toBeLessThanOrEqual(hi + 1e-9);
        }
      }
    });

    it('stays monotonic between poses of a one-way motion', () => {
      const p = poses([0, 0], [3, 80], [20, 90], [24, 400]);
      let prev = -Infinity;
      for (let f = 0; f <= 24; f += 0.1) {
        const v = evaluateContinuous(p, f, 0);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    });

    it('supports multi-turn rotation (no angle wrapping)', () => {
      const p = poses([0, 0, 'linear'], [10, 720]);
      expect(evaluateContinuous(p, 5, 0)).toBeCloseTo(360);
    });
  });
});

describe('evaluateDiscrete', () => {
  const p: Pose<string>[] = [
    { frame: 4, value: 'A' },
    { frame: 6, value: 'D' },
    { frame: 9, value: 'X' },
  ];
  it('holds each value until the next pose', () => {
    expect(evaluateDiscrete(p, 4, 'rest')).toBe('A');
    expect(evaluateDiscrete(p, 5, 'rest')).toBe('A');
    expect(evaluateDiscrete(p, 6, 'rest')).toBe('D');
    expect(evaluateDiscrete(p, 8, 'rest')).toBe('D');
    expect(evaluateDiscrete(p, 100, 'rest')).toBe('X');
  });
  it('uses the first pose before it, and rest when empty', () => {
    expect(evaluateDiscrete(p, 0, 'rest')).toBe('A');
    expect(evaluateDiscrete([], 0, 'rest')).toBe('rest');
  });
});
