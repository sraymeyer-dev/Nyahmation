import { cubicBezierEase, easeCurve } from './easing';
import { lerp } from './math';
import type { Pose } from './types';

/**
 * Index of the last pose at or before `frame`, or -1 if `frame` is before the
 * first pose. Poses must be sorted by frame.
 */
export function poseIndexAtOrBefore<T>(poses: readonly Pose<T>[], frame: number): number {
  let lo = 0;
  let hi = poses.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (poses[mid]!.frame <= frame) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Value of a discrete channel (drawing, visibility, draw order): the most
 * recent pose's value holds until the next pose. Never blended.
 */
export function evaluateDiscrete<T>(poses: readonly Pose<T>[], frame: number, rest: T): T {
  if (poses.length === 0) return rest;
  const i = poseIndexAtOrBefore(poses, frame);
  return i < 0 ? poses[0]!.value : poses[i]!.value;
}

/**
 * Value of a continuous channel at `frame` (may be fractional).
 * Before the first pose and after the last, the nearest pose's value holds.
 * Between two poses the first pose's ease decides how the value travels.
 * See docs/DESIGN.md §10.
 */
export function evaluateContinuous(poses: readonly Pose<number>[], frame: number, rest: number): number {
  const n = poses.length;
  if (n === 0) return rest;
  const first = poses[0]!;
  const last = poses[n - 1]!;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;

  const i = poseIndexAtOrBefore(poses, frame);
  const p0 = poses[i]!;
  const p1 = poses[i + 1]!;
  const span = p1.frame - p0.frame;
  const u = (frame - p0.frame) / span;
  const ease = p0.ease ?? 'smooth';

  if (ease === 'hold') return p0.value;
  if (ease === 'linear') return lerp(p0.value, p1.value, u);
  const curve = easeCurve(ease);
  if (curve) return lerp(p0.value, p1.value, cubicBezierEase(curve, u));

  // 'smooth': cubic Hermite through the poses (value units per frame tangents).
  const m0 = smoothTangent(poses, i);
  const m1 = smoothTangent(poses, i + 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * p0.value + h10 * span * m0 + h01 * p1.value + h11 * span * m1;
}

/**
 * Auto-clamped tangent (slope in value per frame) at pose `i` for 'smooth'.
 * - Zero at the first and last poses, and wherever the motion turns around
 *   (a peak or a dip) or pauses: those poses ease in and out.
 * - Elsewhere the Catmull-Rom slope through the neighbours, so motion flows
 *   through the pose without stopping.
 * - Clamped to 3× the smaller neighbouring slope, the Fritsch–Carlson bound
 *   that keeps each segment monotonic: the curve never overshoots a pose.
 */
export function smoothTangent(poses: readonly Pose<number>[], i: number): number {
  if (i <= 0 || i >= poses.length - 1) return 0;
  const prev = poses[i - 1]!;
  const cur = poses[i]!;
  const next = poses[i + 1]!;
  const d0 = (cur.value - prev.value) / (cur.frame - prev.frame);
  const d1 = (next.value - cur.value) / (next.frame - cur.frame);
  if (d0 === 0 || d1 === 0 || Math.sign(d0) !== Math.sign(d1)) return 0;
  const m = (next.value - prev.value) / (next.frame - prev.frame);
  const limit = 3 * Math.min(Math.abs(d0), Math.abs(d1));
  return Math.sign(m) * Math.min(Math.abs(m), limit);
}
