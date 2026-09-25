import type { Ease } from './types';

type Bezier = readonly [number, number, number, number];

/** CSS-standard curves for the named presets. */
export const EASE_PRESET_CURVES = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
} as const satisfies Record<string, Bezier>;

/**
 * Evaluates a CSS-style cubic-bezier timing curve at progress `u` (0..1).
 * The curve runs from (0,0) to (1,1) with control points (x1,y1) and (x2,y2);
 * we find the curve parameter whose x equals `u` and return its y.
 * y may leave 0..1 (overshoot) when y1/y2 do; x1/x2 are clamped to 0..1 so x
 * stays monotonic and the solve is well defined.
 */
export function cubicBezierEase(curve: Bezier, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const x1 = Math.min(Math.max(curve[0], 0), 1);
  const x2 = Math.min(Math.max(curve[2], 0), 1);
  const [, y1, , y2] = curve;

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  // Newton's method converges in a few steps for typical curves...
  let t = u;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - u;
    if (Math.abs(err) < 1e-7) return sampleY(t);
    const slope = slopeX(t);
    if (Math.abs(slope) < 1e-6) break;
    t -= err / slope;
  }
  // ...and bisection handles the flat spots where it doesn't.
  let lo = 0;
  let hi = 1;
  t = u;
  for (let i = 0; i < 60; i++) {
    const x = sampleX(t);
    if (Math.abs(x - u) < 1e-7) break;
    if (x < u) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

/** The timing curve behind an ease, or null for eases that aren't a simple curve. */
export function easeCurve(ease: Ease): Bezier | null {
  if (typeof ease === 'object') return ease.bezier;
  switch (ease) {
    case 'easeIn':
    case 'easeOut':
    case 'easeInOut':
      return EASE_PRESET_CURVES[ease];
    default:
      return null;
  }
}
