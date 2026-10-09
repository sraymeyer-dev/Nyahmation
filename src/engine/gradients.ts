import { DEG_TO_RAD } from './math';
import type { Bounds } from './geometry';
import type { Gradient } from './types';

// Gradient fills (docs/DESIGN.md D10) placed from a shape's size: a linear
// gradient runs across the shape at an angle (0° left to right, 90° top to
// bottom); a radial one spreads from the middle to the furthest side.

export function gradientForBounds(kind: Gradient['kind'], b: Bounds, stops: Gradient['stops'], angle = 90): Gradient {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (kind === 'radial') return { kind, from: { x: cx, y: cy }, to: { x: cx + Math.max(w, h) / 2, y: cy }, stops };
  const dx = Math.cos(angle * DEG_TO_RAD);
  const dy = Math.sin(angle * DEG_TO_RAD);
  // Far enough each way that the first and last colours reach the corners.
  const half = (w * Math.abs(dx) + h * Math.abs(dy)) / 2;
  return { kind, from: { x: cx - dx * half, y: cy - dy * half }, to: { x: cx + dx * half, y: cy + dy * half }, stops };
}

/** The direction of a linear gradient, in degrees (0 = left to right, 90 = top to bottom). */
export function gradientAngle(g: Gradient): number {
  const a = Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x) / DEG_TO_RAD;
  return Math.round(a * 10) / 10;
}
