import { describe, expect, it } from 'vitest';
import { ellipsePath, pathCommands, pathToSvgData, polygonPath, rectPath } from './geometry';

describe('primitives', () => {
  it('a rectangle is a closed path of four corners', () => {
    const r = rectPath(0, 0, 10, 20);
    expect(r.closed).toBe(true);
    expect(r.points.map((p) => p.anchor)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]);
    expect(pathToSvgData(r)).toBe('M0 0 L10 0 L10 20 L0 20 L0 0 Z');
  });

  it('an ellipse is four smooth points whose curves stay on the ellipse', () => {
    const e = ellipsePath(0, 0, 10, 5);
    const cmds = pathCommands(e);
    expect(cmds.filter((c) => c.op === 'C')).toHaveLength(4);
    // Midpoint of the first quarter-curve (t = 0.5) should lie on the ellipse.
    const c = cmds[1]!;
    if (c.op !== 'C') throw new Error('expected a curve');
    const start = e.points[0]!.anchor;
    const mid = {
      x: (start.x + 3 * c.c1x + 3 * c.c2x + c.x) / 8,
      y: (start.y + 3 * c.c1y + 3 * c.c2y + c.y) / 8,
    };
    expect((mid.x / 10) ** 2 + (mid.y / 5) ** 2).toBeCloseTo(1, 3);
  });

  it('open paths do not close', () => {
    const cmds = pathCommands(polygonPath([{ x: 0, y: 0 }, { x: 5, y: 5 }], false));
    expect(cmds.map((c) => c.op)).toEqual(['M', 'L']);
  });

  it('a one-sided handle still makes a curve', () => {
    const cmds = pathCommands({
      closed: false,
      points: [{ anchor: { x: 0, y: 0 }, handleOut: { x: 5, y: 0 } }, { anchor: { x: 10, y: 10 } }],
    });
    expect(cmds[1]).toEqual({ op: 'C', c1x: 5, c1y: 0, c2x: 10, c2y: 10, x: 10, y: 10 });
  });

  it('an empty path draws nothing', () => {
    expect(pathCommands({ closed: true, points: [] })).toEqual([]);
  });
});
