import { describe, expect, it } from 'vitest';
import { solveIk, wrapDegrees, type IkLink } from './ik';
import { applyToPoint, IDENTITY, localMatrix, multiply, type Mat2D } from './math';
import type { Vec2 } from './types';

// An arm pointing right: shoulder at the origin, each bone 100 long along +x.
const bone = (x: number, rotation = 0, extra: Partial<IkLink> = {}): IkLink => ({
  transform: { x, y: 0, rotation, scaleX: 1, scaleY: 1 },
  pivot: { x: 0, y: 0 },
  ...extra,
});

function endPoint(base: Mat2D, links: IkLink[], rotations: number[], effector: Vec2): Vec2 {
  let m = base;
  links.forEach((l, i) => (m = multiply(m, localMatrix({ ...l.transform, rotation: rotations[i]! }, l.pivot))));
  return applyToPoint(m, effector);
}

const reach = (base: Mat2D, links: IkLink[], effector: Vec2, target: Vec2) => {
  const r = solveIk(base, links, effector, target);
  return { r, end: endPoint(base, links, r, effector) };
};

describe('wrapDegrees', () => {
  it('wraps into -180..180', () => {
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(540)).toBe(180);
  });
});

describe('solveIk', () => {
  it('aims a single part at the target', () => {
    const { r } = reach(IDENTITY, [bone(0)], { x: 100, y: 0 }, { x: 0, y: 50 });
    expect(r[0]).toBeCloseTo(90);
  });

  it('two-part limb reaches a reachable target exactly', () => {
    const links = [bone(0, 0), bone(100, 30)];
    for (const target of [{ x: 120, y: 60 }, { x: -50, y: 100 }, { x: 10, y: -150 }]) {
      const { end } = reach(IDENTITY, links, { x: 100, y: 0 }, target);
      expect(end.x).toBeCloseTo(target.x, 6);
      expect(end.y).toBeCloseTo(target.y, 6);
    }
  });

  it('keeps the elbow bending the way it already bends', () => {
    const effector = { x: 100, y: 0 };
    for (const elbow of [30, -30]) {
      const links = [bone(0, 0), bone(100, elbow)];
      const { r } = reach(IDENTITY, links, effector, { x: 150, y: 0 });
      expect(Math.sign(r[1]!)).toBe(Math.sign(elbow));
    }
  });

  it('uses the bend direction when the limb starts straight', () => {
    for (const dir of [1, -1] as const) {
      const links = [bone(0, 0), bone(100, 0, { bendDirection: dir })];
      const { r } = reach(IDENTITY, links, { x: 100, y: 0 }, { x: 150, y: 0 });
      expect(Math.sign(r[1]!)).toBe(dir);
    }
  });

  it('stretches straight toward a target that is too far away', () => {
    const { r, end } = reach(IDENTITY, [bone(0, 10), bone(100, 40)], { x: 100, y: 0 }, { x: 0, y: 1000 });
    expect(end.x).toBeCloseTo(0, 3);
    expect(end.y).toBeCloseTo(200, 3);
    expect(wrapDegrees(r[1]!)).toBeCloseTo(0, 3);
  });

  it('works inside a moved, rotated and mirrored parent', () => {
    for (const base of [
      localMatrix({ x: 300, y: 200, rotation: 70, scaleX: 2, scaleY: 2 }, { x: 0, y: 0 }),
      localMatrix({ x: 300, y: 200, rotation: 0, scaleX: -1, scaleY: 1 }, { x: 0, y: 0 }),
    ]) {
      const target = { x: 280, y: 330 };
      const { end } = reach(base, [bone(0, 0), bone(100, 20)], { x: 100, y: 0 }, target);
      expect(end.x).toBeCloseTo(target.x, 4);
      expect(end.y).toBeCloseTo(target.y, 4);
    }
  });

  it('longer chains (a tail) reach the target', () => {
    const links = [bone(0, 0), bone(60, 10), bone(60, 10), bone(60, 10)];
    const target = { x: 120, y: 120 };
    const { end } = reach(IDENTITY, links, { x: 60, y: 0 }, target);
    expect(Math.hypot(end.x - target.x, end.y - target.y)).toBeLessThan(0.01);
  });

  it('respects joint limits', () => {
    const links = [bone(0, 0, { minAngle: -20, maxAngle: 20 }), bone(100, 10, { minAngle: 0, maxAngle: 90 })];
    const { r } = reach(IDENTITY, links, { x: 100, y: 0 }, { x: -150, y: 20 });
    expect(r[0]).toBeGreaterThanOrEqual(-20);
    expect(r[0]).toBeLessThanOrEqual(20);
    expect(r[1]).toBeGreaterThanOrEqual(0);
    expect(r[1]).toBeLessThanOrEqual(90);
  });

  it('is deterministic', () => {
    const links = [bone(0, 5), bone(100, 25), bone(100, 25)];
    const a = solveIk(IDENTITY, links, { x: 100, y: 0 }, { x: 50, y: 140 });
    const b = solveIk(IDENTITY, links, { x: 100, y: 0 }, { x: 50, y: 140 });
    expect(a).toEqual(b);
  });
});
