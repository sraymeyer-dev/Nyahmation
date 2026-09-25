import type { Transform, Vec2 } from './types';

/**
 * A 2D affine matrix in the same layout as CanvasRenderingContext2D.setTransform:
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 */
export type Mat2D = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export const DEG_TO_RAD = Math.PI / 180;

export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyToPoint(m: Mat2D, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/**
 * The matrix taking a part's drawing coordinates into its parent's space:
 * translate(x, y) · rotate(rotation) · scale(scaleX, scaleY) · translate(-pivot).
 * The pivot therefore lands exactly on (x, y) and rotation/scale happen around it.
 */
export function localMatrix(t: Transform, pivot: Vec2): Mat2D {
  const r = t.rotation * DEG_TO_RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const a = cos * t.scaleX;
  const b = sin * t.scaleX;
  const c = -sin * t.scaleY;
  const d = cos * t.scaleY;
  return [a, b, c, d, t.x - (a * pivot.x + c * pivot.y), t.y - (b * pivot.x + d * pivot.y)];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function invert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/**
 * The Transform that reproduces `m` as localMatrix(transform, pivot).
 * Exact unless `m` contains skew (possible after non-uniform scaling a
 * rotated parent), in which case the skew is dropped.
 */
export function decompose(m: Mat2D, pivot: Vec2): Transform {
  const scaleX = Math.hypot(m[0], m[1]);
  const rotation = Math.atan2(m[1], m[0]) / DEG_TO_RAD;
  const det = m[0] * m[3] - m[1] * m[2];
  const scaleY = scaleX === 0 ? Math.hypot(m[2], m[3]) : det / scaleX;
  const joint = applyToPoint(m, pivot);
  return { x: joint.x, y: joint.y, rotation, scaleX, scaleY };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
