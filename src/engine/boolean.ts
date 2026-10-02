import fitCurve from 'fit-curve';
import * as polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Polygon, Ring } from 'polygon-clipping';
import { locatePart, removeParts, restWorldMatrix, topLevelSelection, updatePart } from './edit';
import { cubicAt, getSegment, segmentCount, transformPath } from './geometry';
import { invert, multiply } from './math';
import type { PathPoint, Project, ShapeStyle, VectorPath } from './types';

// Boolean operations on shapes (docs/DESIGN.md D11, BO1–BO4):
//   union      one shape covering all of them
//   subtract   the back shape with the others cut out of it
//   intersect  only where all of them overlap
//   exclude    where an odd number of them overlap (overlaps become holes)
// The outlines are turned into fine polygons, combined, and smooth curves are
// fitted back through the result, so it stays easy to edit: corners stay
// sharp, curves come back as a few points with handles.

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

// The package's browser build has only a default export; Node's has named ones.
const clip = ((polygonClipping as unknown as { default?: typeof polygonClipping }).default ?? polygonClipping) as typeof polygonClipping;

/** How closely the result follows the true outline (stage pixels). */
const FLATNESS = 0.25;
/** Turns sharper than this (degrees) stay corners. */
const CORNER_DEGREES = 35;

/** A path as a closed ring of points, curves split finely enough to look smooth. */
export function flattenPath(path: VectorPath): Ring {
  const ring: Ring = [];
  const n = segmentCount(path);
  if (path.points.length === 0) return ring;
  const first = path.points[0]!.anchor;
  ring.push([first.x, first.y]);
  for (let i = 0; i < n; i++) {
    const c = getSegment(path, i);
    if (c.straight) {
      ring.push([c.p3.x, c.p3.y]);
      continue;
    }
    // Enough steps that each is within FLATNESS of the curve.
    const net = Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y) + Math.hypot(c.c2.x - c.c1.x, c.c2.y - c.c1.y) + Math.hypot(c.p3.x - c.c2.x, c.p3.y - c.c2.y);
    const steps = Math.min(200, Math.max(2, Math.ceil(Math.sqrt(net / FLATNESS) * 1.5)));
    for (let k = 1; k <= steps; k++) {
      const p = cubicAt(c, k / steps);
      ring.push([p.x, p.y]);
    }
  }
  return ring;
}

function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** The area a shape fills, following its fill rule. */
export function shapeArea(paths: readonly VectorPath[], fillRule: ShapeStyle['fillRule']): MultiPolygon {
  const rings = paths.map(flattenPath).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6);
  if (rings.length === 0) return [];
  const polys: Polygon[] = rings.map((r) => [r]);
  if (fillRule === 'evenodd') return clip.xor(polys[0]!, ...polys.slice(1));
  // Non-zero: rings turning the same way as the biggest add up; rings turning
  // the other way are holes where they sit inside it (the usual case).
  const biggest = rings.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const sign = Math.sign(signedArea(biggest));
  const same = polys.filter((_, i) => Math.sign(signedArea(rings[i]!)) === sign);
  const other = polys.filter((_, i) => Math.sign(signedArea(rings[i]!)) !== sign);
  const filled = clip.union(same[0]!, ...same.slice(1));
  return other.length ? clip.xor(filled, clip.union(other[0]!, ...other.slice(1))) : filled;
}

export function combineAreas(op: BooleanOp, areas: readonly MultiPolygon[]): MultiPolygon {
  const [first, ...rest] = areas;
  if (!first) return [];
  if (!rest.length) return first;
  switch (op) {
    case 'union':
      return clip.union(first, ...rest);
    case 'subtract':
      return clip.difference(first, ...rest);
    case 'intersect':
      return clip.intersection(first, ...rest);
    case 'exclude':
      return clip.xor(first, ...rest);
  }
}

const turn = (a: Pair, b: Pair, c: Pair) => {
  const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.abs(((d + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
};

/** A closed ring as an editable path: corners stay sharp, runs between them become fitted curves. */
export function ringToPath(input: Ring): VectorPath {
  // polygon-clipping repeats the first point at the end.
  const ring = input.length > 1 && input[0]![0] === input.at(-1)![0] && input[0]![1] === input.at(-1)![1] ? input.slice(0, -1) : input.slice();
  const n = ring.length;
  if (n < 3) return { closed: true, points: ring.map(([x, y]) => ({ anchor: { x, y } })) };
  const at = (i: number) => ring[((i % n) + n) % n]!;
  const corners: number[] = [];
  for (let i = 0; i < n; i++) if (turn(at(i - 1), at(i), at(i + 1)) > CORNER_DEGREES) corners.push(i);
  // A smooth loop (a circle): split it in four so the fit has somewhere to start.
  if (corners.length === 0) for (let k = 0; k < 4; k++) corners.push(Math.floor((k * n) / 4));

  // Every curve around the loop, in order: each ends where the next begins.
  const curves: [Pair, Pair, Pair, Pair][] = [];
  for (let c = 0; c < corners.length; c++) {
    const from = corners[c]!;
    const to = c + 1 < corners.length ? corners[c + 1]! : corners[0]! + n;
    const run: Pair[] = [];
    for (let i = from; i <= to; i++) run.push(at(i));
    if (run.length <= 2) curves.push([run[0]!, run[0]!, run[1]!, run[1]!]); // a straight edge
    else curves.push(...(fitCurve(run, FLATNESS * FLATNESS * 4) as [Pair, Pair, Pair, Pair][]));
  }
  const points: PathPoint[] = curves.map(([p0]) => ({ anchor: { x: p0[0], y: p0[1] } }));
  curves.forEach(([p0, c1, c2, p3], i) => {
    if (isStraight(p0, c1, c2, p3)) return;
    points[i]!.handleOut = { x: c1[0] - p0[0], y: c1[1] - p0[1] };
    points[(i + 1) % points.length]!.handleIn = { x: c2[0] - p3[0], y: c2[1] - p3[1] };
  });
  return { closed: true, points };
}

function isStraight(p0: Pair, c1: Pair, c2: Pair, p3: Pair): boolean {
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const off = (p: Pair) => Math.abs((p[0] - p0[0]) * dy - (p[1] - p0[1]) * dx) / len;
  return off(c1) < 0.05 && off(c2) < 0.05;
}

export function areaToPaths(area: MultiPolygon): VectorPath[] {
  return area.flatMap((polygon) => polygon.map(ringToPath));
}

/**
 * Combines the selected shapes into one. The result keeps the back shape's
 * name, style (with holes filled even-odd), effects and place; the other
 * shapes are removed.
 */
export function booleanShapes(project: Project, ids: readonly string[], op: BooleanOp): { project: Project; shapeId: string | null; empty: boolean } {
  const shapes = topLevelSelection(project, ids)
    .map((id) => locatePart(project, id)!)
    .filter((l) => l.part.kind === 'shape' && l.part.paths?.length);
  if (shapes.length < 2) return { project, shapeId: null, empty: false };
  // The back shape (lowest in the stacking order) is the one others cut into.
  shapes.sort((a, b) => a.part.drawOrder - b.part.drawOrder);
  const target = shapes[0]!;
  const toTarget = invert(restWorldMatrix(target));
  const areas = shapes.map((l) => {
    const m = multiply(toTarget, restWorldMatrix(l));
    return shapeArea(l.part.paths!.map((p) => transformPath(p, m)), l.part.style?.fillRule ?? 'nonzero');
  });
  const result = combineAreas(op, areas);
  const paths = areaToPaths(result);
  let next = removeParts(project, shapes.slice(1).map((l) => l.part.id));
  if (paths.length === 0) {
    next = removeParts(next, [target.part.id]);
    return { project: next, shapeId: null, empty: true };
  }
  next = updatePart(next, target.part.id, (p) => ({ ...p, paths, style: p.style ? { ...p.style, fillRule: 'evenodd' } : p.style }));
  return { project: next, shapeId: target.part.id, empty: false };
}
