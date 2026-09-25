import { describe, expect, it } from 'vitest';
import { cubicAt, ellipsePath, getSegment, pathBounds, polygonPath, rectPath } from './geometry';
import { bendSegment, deletePoints, insertPoint, isSmooth, movePoints, nearestOnPath, setHandle, setPointSmooth } from './pathEdit';
import type { VectorPath } from './types';

const curve: VectorPath = {
  closed: false,
  points: [
    { anchor: { x: 0, y: 0 }, handleOut: { x: 30, y: -40 } },
    { anchor: { x: 100, y: 0 }, handleIn: { x: -20, y: -60 } },
  ],
};

describe('nearestOnPath', () => {
  it('finds the closest spot on a straight edge', () => {
    const hit = nearestOnPath(rectPath(0, 0, 100, 50), { x: 40, y: -7 })!;
    expect(hit.segment).toBe(0);
    expect(hit.point.x).toBeCloseTo(40, 3);
    expect(hit.point.y).toBeCloseTo(0, 3);
    expect(hit.distance).toBeCloseTo(7, 3);
  });

  it('finds a point on a curve', () => {
    const target = cubicAt(getSegment(curve, 0), 0.3);
    const hit = nearestOnPath(curve, target)!;
    expect(hit.distance).toBeLessThan(1e-3);
    expect(hit.t).toBeCloseTo(0.3, 2);
  });
});

describe('insertPoint', () => {
  it('splits a curve without changing its shape', () => {
    const { path, index } = insertPoint(curve, 0, 0.4);
    expect(index).toBe(1);
    expect(path.points).toHaveLength(3);
    for (const t of [0.1, 0.25, 0.6, 0.9]) {
      const original = cubicAt(getSegment(curve, 0), t);
      const hit = nearestOnPath(path, original)!;
      expect(hit.distance).toBeLessThan(1e-3);
    }
    expect(isSmooth(path.points[1]!)).toBe(true);
  });

  it('adds a corner point on a straight edge, including the closing edge', () => {
    const { path, index } = insertPoint(rectPath(0, 0, 100, 50), 3, 0.5);
    expect(index).toBe(4);
    expect(path.points[4]).toEqual({ anchor: { x: 0, y: 25 } });
  });
});

describe('deletePoints', () => {
  it('removes points and gives up below two', () => {
    const r = rectPath(0, 0, 10, 10);
    expect(deletePoints(r, [0])!.points).toHaveLength(3);
    expect(deletePoints(r, [0, 1])!.closed).toBe(false);
    expect(deletePoints(r, [0, 1, 2])).toBeNull();
  });
});

describe('movePoints', () => {
  it('moves only the chosen anchors, with their handles', () => {
    const moved = movePoints(curve, [1], { x: 5, y: 5 });
    expect(moved.points[1]!.anchor).toEqual({ x: 105, y: 5 });
    expect(moved.points[1]!.handleIn).toEqual({ x: -20, y: -60 });
    expect(moved.points[0]).toBe(curve.points[0]);
  });
});

describe('smooth and corner points', () => {
  it('toggles between smooth and corner', () => {
    const tri = polygonPath([{ x: 0, y: 0 }, { x: 50, y: -50 }, { x: 100, y: 0 }], false);
    const smooth = setPointSmooth(tri, 1, true);
    expect(isSmooth(smooth.points[1]!)).toBe(true);
    // Handles run parallel to the line between the neighbours.
    expect(smooth.points[1]!.handleOut!.y).toBeCloseTo(0);
    const corner = setPointSmooth(smooth, 1, false);
    expect(corner.points[1]).toEqual({ anchor: { x: 50, y: -50 } });
  });

  it('turning one handle of a smooth point turns the other, unless broken', () => {
    const e = ellipsePath(0, 0, 10, 10);
    const turned = setHandle(e, 0, 'handleOut', { x: 0, y: 8 });
    expect(turned.points[0]!.handleIn!.x).toBeCloseTo(0);
    expect(turned.points[0]!.handleIn!.y).toBeCloseTo(-5.5228, 3);
    const broken = setHandle(e, 0, 'handleOut', { x: 0, y: 8 }, true);
    expect(broken.points[0]!.handleIn).toEqual(e.points[0]!.handleIn);
  });
});

describe('bendSegment', () => {
  it('moves the grabbed spot by the drag distance', () => {
    for (const t of [0.3, 0.5, 0.7]) {
      const before = cubicAt(getSegment(curve, 0), t);
      const bent = bendSegment(curve, 0, t, { x: 0, y: 20 });
      const after = cubicAt(getSegment(bent, 0), t);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y + 20, 6);
    }
  });

  it('turns a straight edge into a curve, keeping its ends', () => {
    const r = rectPath(0, 0, 100, 50);
    const bent = bendSegment(r, 0, 0.5, { x: 0, y: -30 });
    expect(bent.points[0]!.anchor).toEqual({ x: 0, y: 0 });
    expect(bent.points[1]!.anchor).toEqual({ x: 100, y: 0 });
    expect(pathBounds(bent).minY).toBeCloseTo(-30, 6);
  });
});
