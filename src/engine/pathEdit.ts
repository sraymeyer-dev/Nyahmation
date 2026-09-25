import { cubicAt, getSegment, segmentCount, type Cubic } from './geometry';
import { lerp } from './math';
import type { PathPoint, Vec2, VectorPath } from './types';

// Point-level path editing (docs/DESIGN.md D4). All functions are pure and
// return new paths; point indices refer to VectorPath.points.

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec2) => Math.hypot(a.x, a.y);
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

function withPoint(path: VectorPath, i: number, point: PathPoint): VectorPath {
  const points = path.points.slice();
  points[i] = point;
  return { ...path, points };
}

function withoutHandle(p: PathPoint, which: 'handleIn' | 'handleOut'): PathPoint {
  const { [which]: _removed, ...rest } = p;
  return rest;
}

export interface NearestHit {
  segment: number;
  t: number;
  point: Vec2;
  distance: number;
}

/** The closest point on the path's outline to `p`. */
export function nearestOnPath(path: VectorPath, p: Vec2): NearestHit | null {
  let best: NearestHit | null = null;
  const dist = (c: Cubic, t: number) => len(sub(cubicAt(c, t), p));
  for (let s = 0; s < segmentCount(path); s++) {
    const c = getSegment(path, s);
    // Coarse sampling, then narrow down around the best sample.
    const steps = 24;
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 0; i <= steps; i++) {
      const d = dist(c, i / steps);
      if (d < bestD) [bestD, bestT] = [d, i / steps];
    }
    let lo = Math.max(0, bestT - 1 / steps);
    let hi = Math.min(1, bestT + 1 / steps);
    for (let i = 0; i < 30; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (dist(c, m1) < dist(c, m2)) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const d = dist(c, t);
    if (!best || d < best.distance) best = { segment: s, t, point: cubicAt(c, t), distance: d };
  }
  return best;
}

/** Adds a point on segment `segment` at parameter `t` without changing the path's shape. */
export function insertPoint(path: VectorPath, segment: number, t: number): { path: VectorPath; index: number } {
  const n = path.points.length;
  const i0 = segment;
  const i1 = (segment + 1) % n;
  const c = getSegment(path, segment);
  const points = path.points.slice();
  let inserted: PathPoint;
  if (c.straight) {
    inserted = { anchor: mix(c.p0, c.p3, t) };
  } else {
    // de Casteljau subdivision.
    const q0 = mix(c.p0, c.c1, t);
    const q1 = mix(c.c1, c.c2, t);
    const q2 = mix(c.c2, c.p3, t);
    const r0 = mix(q0, q1, t);
    const r1 = mix(q1, q2, t);
    const anchor = mix(r0, r1, t);
    inserted = { anchor, handleIn: sub(r0, anchor), handleOut: sub(r1, anchor) };
    points[i0] = { ...points[i0]!, handleOut: sub(q0, c.p0) };
    points[i1] = { ...points[i1]!, handleIn: sub(q2, c.p3) };
  }
  const index = i0 + 1;
  points.splice(index, 0, inserted);
  return { path: { ...path, points }, index };
}

/** Removes points. Returns null when fewer than two points would remain. */
export function deletePoints(path: VectorPath, indices: Iterable<number>): VectorPath | null {
  const drop = new Set(indices);
  const points = path.points.filter((_, i) => !drop.has(i));
  if (points.length < 2) return null;
  return { closed: path.closed && points.length > 2, points };
}

export function movePoints(path: VectorPath, indices: Iterable<number>, delta: Vec2): VectorPath {
  const move = new Set(indices);
  return { ...path, points: path.points.map((p, i) => (move.has(i) ? { ...p, anchor: add(p.anchor, delta) } : p)) };
}

/** A point is smooth when it has both handles pointing in opposite directions. */
export function isSmooth(p: PathPoint): boolean {
  if (!p.handleIn || !p.handleOut) return false;
  const a = len(p.handleIn);
  const b = len(p.handleOut);
  if (a < 1e-9 || b < 1e-9) return false;
  const cross = p.handleIn.x * p.handleOut.y - p.handleIn.y * p.handleOut.x;
  const dot = p.handleIn.x * p.handleOut.x + p.handleIn.y * p.handleOut.y;
  return Math.abs(cross) / (a * b) < 1e-3 && dot < 0;
}

/**
 * Sets a handle's offset. On a smooth point the opposite handle turns to stay
 * in line (keeping its own length) unless `breakHandles` is set.
 */
export function setHandle(
  path: VectorPath,
  index: number,
  which: 'handleIn' | 'handleOut',
  offset: Vec2,
  breakHandles = false,
): VectorPath {
  const p = path.points[index]!;
  const other = which === 'handleIn' ? 'handleOut' : 'handleIn';
  const next: PathPoint = { ...p, [which]: offset };
  const otherHandle = p[other];
  if (!breakHandles && otherHandle && isSmooth(p) && len(offset) > 1e-9) {
    next[other] = scale(offset, -len(otherHandle) / len(offset));
  }
  return withPoint(path, index, next);
}

/** Makes a point smooth (handles along the neighbours' direction) or a sharp corner (no handles). */
export function setPointSmooth(path: VectorPath, index: number, smooth: boolean): VectorPath {
  const pts = path.points;
  const p = pts[index]!;
  if (!smooth) return withPoint(path, index, withoutHandle(withoutHandle(p, 'handleIn'), 'handleOut'));
  const n = pts.length;
  const prev = index > 0 ? pts[index - 1] : path.closed ? pts[n - 1] : undefined;
  const next = index < n - 1 ? pts[index + 1] : path.closed ? pts[0] : undefined;
  if (!prev && !next) return path;
  const from = prev?.anchor ?? p.anchor;
  const to = next?.anchor ?? p.anchor;
  const dir = sub(to, from);
  const d = len(dir);
  if (d < 1e-9) return path;
  const unit = scale(dir, 1 / d);
  const point: PathPoint = { anchor: p.anchor };
  if (prev) point.handleIn = scale(unit, -len(sub(p.anchor, prev.anchor)) / 3);
  if (next) point.handleOut = scale(unit, len(sub(next.anchor, p.anchor)) / 3);
  return withPoint(path, index, point);
}

/**
 * Drags the curve of `segment` at parameter `t` by `delta`, adjusting only the
 * segment's two handles, so the grabbed spot follows the mouse. Weights follow
 * Inkscape's segment-drag behaviour: grabbing near one end mostly moves that
 * end's handle.
 */
export function bendSegment(path: VectorPath, segment: number, t: number, delta: Vec2): VectorPath {
  const tt = Math.min(Math.max(t, 0.02), 0.98);
  const n = path.points.length;
  const i0 = segment;
  const i1 = (segment + 1) % n;
  const c = getSegment(path, segment);
  // Straight segments first get handles at thirds, so they start out unchanged.
  const h0 = c.straight ? scale(sub(c.p3, c.p0), 1 / 3) : sub(c.c1, c.p0);
  const h1 = c.straight ? scale(sub(c.p0, c.p3), 1 / 3) : sub(c.c2, c.p3);

  let w: number;
  if (tt <= 1 / 6) w = 0;
  else if (tt <= 0.5) w = Math.pow((6 * tt - 1) / 2, 3) / 2;
  else if (tt <= 5 / 6) w = (1 - Math.pow((6 * (1 - tt) - 1) / 2, 3)) / 2 + 0.5;
  else w = 1;
  const k0 = (1 - w) / (3 * tt * (1 - tt) * (1 - tt));
  const k1 = w / (3 * tt * tt * (1 - tt));

  // setHandle keeps smooth points smooth by turning their other handle too.
  const bent = setHandle(path, i0, 'handleOut', add(h0, scale(delta, k0)));
  return setHandle(bent, i1, 'handleIn', add(h1, scale(delta, k1)));
}
