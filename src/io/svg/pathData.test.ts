import { describe, expect, it } from 'vitest';
import { cubicAt, getSegment, pathBounds } from '../../engine/geometry';
import { arcToCubics, parsePathData } from './pathData';

describe('parsePathData', () => {
  it('reads lines, closing and relative commands', () => {
    const [p] = parsePathData('M10 10 h 20 v20 H10 z');
    expect(p!.closed).toBe(true);
    expect(p!.points.map((x) => x.anchor)).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ]);
  });

  it('treats extra coordinate pairs after a moveto as linetos', () => {
    const [p] = parsePathData('m0 0 10 0 0 10');
    expect(p!.points.map((x) => x.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });

  it('reads compact number formats', () => {
    const [p] = parsePathData('M.5.5L-1-2e1');
    expect(p!.points[0]!.anchor).toEqual({ x: 0.5, y: 0.5 });
    expect(p!.points[1]!.anchor).toEqual({ x: -1, y: -20 });
  });

  it('turns C into handles, and S mirrors the previous handle', () => {
    const [p] = parsePathData('M0 0 C 0 -10 20 -10 20 0 S 40 10 40 0');
    expect(p!.points[0]!.handleOut).toEqual({ x: 0, y: -10 });
    expect(p!.points[1]!.handleIn).toEqual({ x: 0, y: -10 });
    expect(p!.points[1]!.handleOut).toEqual({ x: 0, y: 10 });
    expect(p!.points[2]!.handleIn).toEqual({ x: 0, y: 10 });
  });

  it('converts quadratic curves exactly', () => {
    const [p] = parsePathData('M0 0 Q 50 100 100 0');
    // The quadratic's midpoint is at (50, 50).
    const mid = cubicAt(getSegment(p!, 0), 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(50);
  });

  it('merges an explicit return to the start into the first point when closing', () => {
    const [p] = parsePathData('M0 0 L10 0 L10 10 L0 0 Z');
    expect(p!.points).toHaveLength(3);
    expect(p!.closed).toBe(true);
  });

  it('splits subpaths (for compound shapes like a donut)', () => {
    const paths = parsePathData('M0 0h10v10h-10z M3 3h4v4h-4z');
    expect(paths).toHaveLength(2);
    expect(paths[1]!.points[0]!.anchor).toEqual({ x: 3, y: 3 });
  });

  it('starts a new subpath at the start point after Z', () => {
    const paths = parsePathData('M5 5 l10 0 l0 10 z l -5 0 l 0 -5');
    expect(paths).toHaveLength(2);
    expect(paths[1]!.points[0]!.anchor).toEqual({ x: 5, y: 5 });
  });

  it('reads arcs, including flags written without spaces', () => {
    // A half circle of radius 10 from (0,0) to (20,0), bulging upward (sweep 1).
    const [p] = parsePathData('M0 0 A10 10 0 0120 0');
    const b = pathBounds(p!);
    expect(b.minY).toBeCloseTo(-10, 3);
    expect(b.maxX).toBeCloseTo(20, 6);
  });

  it('rejects damaged data', () => {
    expect(() => parsePathData('10 10')).toThrow();
    expect(() => parsePathData('M 10')).toThrow();
  });
});

describe('arcToCubics', () => {
  it('keeps every point on the circle', () => {
    const segs = arcToCubics({ x: 10, y: 0 }, 10, 10, 0, true, true, { x: -10, y: 0.0001 });
    let from = { x: 10, y: 0 };
    for (const [c1, c2, end] of segs) {
      for (const t of [0.25, 0.5, 0.75]) {
        const p = cubicAt({ p0: from, c1, c2, p3: end, straight: false }, t);
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 2);
      }
      from = end;
    }
  });

  it('grows radii that are too small to reach, as the SVG spec says', () => {
    const segs = arcToCubics({ x: 0, y: 0 }, 1, 1, 0, false, true, { x: 100, y: 0 });
    expect(segs.at(-1)![2]).toEqual({ x: 100, y: 0 });
  });
});
