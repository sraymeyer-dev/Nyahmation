import { describe, expect, it } from 'vitest';
import { booleanShapes, flattenPath, shapeArea } from './boolean';
import { locatePart } from './edit';
import { defaultStyle, ellipsePath, rectPath } from './geometry';
import { createPart, createProject } from './project';
import type { Project, VectorPath } from './types';

const at = (x: number, y: number) => ({ x, y, rotation: 0, scaleX: 1, scaleY: 1 });

function scene(...shapes: { name: string; paths: VectorPath[]; x?: number; y?: number }[]) {
  const parts = shapes.map((s, i) => createPart({ name: s.name, kind: 'shape', rest: at(s.x ?? 0, s.y ?? 0), drawOrder: i, paths: s.paths, style: defaultStyle({ fill: '#f00' }) }));
  const root = createPart({ name: 'Layer', kind: 'group', children: parts });
  return { project: createProject({ layers: [{ id: 'l', name: 'Layer', kind: 'background', root }] }), ids: parts.map((p) => p.id) };
}

/** Filled area of a shape's result, measured the even-odd way. */
function area(p: Project, id: string): number {
  const part = locatePart(p, id)!.part;
  const polys = shapeArea(part.paths!, part.style!.fillRule);
  let a = 0;
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      let s = 0;
      for (let k = 0; k < ring.length; k++) {
        const [x1, y1] = ring[k]!;
        const [x2, y2] = ring[(k + 1) % ring.length]!;
        s += x1 * y2 - x2 * y1;
      }
      a += (i === 0 ? 1 : -1) * Math.abs(s / 2);
    });
  }
  return a;
}

const twoSquares = () => scene({ name: 'Back', paths: [rectPath(0, 0, 100, 100)] }, { name: 'Front', paths: [rectPath(0, 0, 100, 100)], x: 50 });

describe('boolean operations on shapes', () => {
  it('union: one shape covering both, with sharp corners and no handles', () => {
    const { project, ids } = twoSquares();
    const r = booleanShapes(project, ids, 'union');
    expect(r.shapeId).toBe(ids[0]);
    expect(locatePart(r.project, ids[1]!)).toBeUndefined();
    expect(area(r.project, r.shapeId!)).toBeCloseTo(15000, 0);
    const pts = locatePart(r.project, r.shapeId!)!.part.paths![0]!.points;
    expect(pts).toHaveLength(4);
    expect(pts.every((p) => !p.handleIn && !p.handleOut)).toBe(true);
  });

  it('subtract cuts the front shapes out of the back one', () => {
    const { project, ids } = twoSquares();
    const r = booleanShapes(project, [ids[1]!, ids[0]!], 'subtract'); // selection order doesn't matter
    expect(area(r.project, ids[0]!)).toBeCloseTo(5000, 0);
  });

  it('intersect keeps the overlap; exclude keeps the rest', () => {
    const { project, ids } = twoSquares();
    expect(area(booleanShapes(project, ids, 'intersect').project, ids[0]!)).toBeCloseTo(5000, 0);
    expect(area(booleanShapes(project, ids, 'exclude').project, ids[0]!)).toBeCloseTo(10000, 0);
  });

  it('curves come back as a few smooth points, following the true outline', () => {
    const { project, ids } = scene({ name: 'Square', paths: [rectPath(0, 0, 200, 200)] }, { name: 'Hole', paths: [ellipsePath(100, 100, 50, 50)] });
    const r = booleanShapes(project, ids, 'subtract');
    const part = locatePart(r.project, ids[0]!)!.part;
    expect(part.paths).toHaveLength(2); // the square and the hole
    expect(part.style!.fillRule).toBe('evenodd');
    const hole = part.paths!.find((p) => p.points.some((q) => q.handleOut))!;
    expect(hole.points.length).toBeLessThanOrEqual(12);
    const expected = 40000 - Math.PI * 2500;
    expect(Math.abs(area(r.project, ids[0]!) - expected) / expected).toBeLessThan(0.005);
    // Every point of the fitted hole lies on the circle.
    for (const [x, y] of flattenPath(hole)) expect(Math.abs(Math.hypot(x - 100, y - 100) - 50)).toBeLessThan(0.6);
  });

  it('works across shapes that are moved or turned', () => {
    const { project, ids } = scene({ name: 'A', paths: [rectPath(-50, -50, 100, 100)], x: 100, y: 100 }, { name: 'B', paths: [rectPath(-50, -50, 100, 100)], x: 150, y: 100 });
    const r = booleanShapes(project, ids, 'intersect');
    expect(area(r.project, ids[0]!)).toBeCloseTo(5000, 0);
  });

  it('nothing left: the shape is removed', () => {
    const { project, ids } = scene({ name: 'A', paths: [rectPath(0, 0, 10, 10)] }, { name: 'B', paths: [rectPath(0, 0, 10, 10)], x: 100 });
    const r = booleanShapes(project, ids, 'intersect');
    expect(r.empty).toBe(true);
    expect(locatePart(r.project, ids[0]!)).toBeUndefined();
  });

  it('a hole drawn the other way round in a non-zero shape stays a hole', () => {
    const outer = rectPath(0, 0, 100, 100);
    const inner: VectorPath = { closed: true, points: [...rectPath(25, 25, 50, 50).points].reverse() };
    const polys = shapeArea([outer, inner], 'nonzero');
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(2);
  });
});
