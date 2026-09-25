import { applyToPoint, DEG_TO_RAD, localMatrix, multiply, type Mat2D } from './math';
import type { Part, Transform, Vec2 } from './types';

// Inverse kinematics (docs/DESIGN.md §6.2): given a chain of jointed parts and
// a point that should reach a target, work out new joint rotations.
//
// The solver is pure and deterministic. It only returns rotations; callers
// decide where they go (the rest pose in Build mode, a pose in Animate mode).

export interface IkLink {
  /** The part's current transform (only rotation is changed). */
  transform: Transform;
  pivot: Vec2;
  minAngle?: number;
  maxAngle?: number;
  bendDirection?: 1 | -1;
}

const angleOf = (v: Vec2) => Math.atan2(v.y, v.x) / DEG_TO_RAD;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec2) => Math.hypot(v.x, v.y);

/** Wraps an angle difference into (-180, 180]. */
export function wrapDegrees(a: number): number {
  const r = ((a + 180) % 360 + 360) % 360 - 180;
  return r === -180 ? 180 : r;
}

function clampRotation(link: IkLink, rotation: number): number {
  let r = rotation;
  if (link.minAngle !== undefined) r = Math.max(link.minAngle, r);
  if (link.maxAngle !== undefined) r = Math.min(link.maxAngle, r);
  return r;
}

/** +1 normally, -1 when a matrix mirrors (then world rotations run backwards). */
function handedness(m: Mat2D): number {
  return m[0] * m[3] - m[1] * m[2] < 0 ? -1 : 1;
}

class Chain {
  rotations: number[];
  constructor(
    private readonly base: Mat2D,
    private readonly links: readonly IkLink[],
    private readonly effector: Vec2,
  ) {
    this.rotations = links.map((l) => l.transform.rotation);
  }

  /** World matrices of each link's drawing space, top first. */
  worlds(): Mat2D[] {
    const out: Mat2D[] = [];
    let m = this.base;
    this.links.forEach((link, i) => {
      m = multiply(m, localMatrix({ ...link.transform, rotation: this.rotations[i]! }, link.pivot));
      out.push(m);
    });
    return out;
  }

  /** Scene position of link i's joint. */
  joint(worlds: Mat2D[], i: number): Vec2 {
    const parent = i === 0 ? this.base : worlds[i - 1]!;
    const t = this.links[i]!.transform;
    return applyToPoint(parent, { x: t.x, y: t.y });
  }

  effectorPoint(worlds: Mat2D[]): Vec2 {
    return applyToPoint(worlds[worlds.length - 1]!, this.effector);
  }

  /** Turns link i by `worldDelta` degrees as seen on screen, respecting its limits. */
  turn(worlds: Mat2D[], i: number, worldDelta: number): void {
    const parent = i === 0 ? this.base : worlds[i - 1]!;
    const next = this.rotations[i]! + worldDelta * handedness(parent);
    this.rotations[i] = clampRotation(this.links[i]!, next);
  }
}

/**
 * Rotates the chain so `effector` (a point in the last link's drawing space)
 * reaches `target` (scene coordinates), or gets as close as it can.
 * `base` maps the first link's parent space to the scene. Returns the new
 * rotation of each link, first to last.
 */
export function solveIk(base: Mat2D, links: readonly IkLink[], effector: Vec2, target: Vec2): number[] {
  if (links.length === 0) return [];
  const chain = new Chain(base, links, effector);
  if (links.length === 2 && solveTwoBone(chain, links, target)) {
    // Limits can stop the exact answer; a few CCD passes find the best allowed pose.
    if (links.some((l) => l.minAngle !== undefined || l.maxAngle !== undefined)) ccd(chain, target, 20);
    return chain.rotations;
  }
  ccd(chain, target, links.length === 1 ? 1 : 40);
  return chain.rotations;
}

/**
 * Cyclic coordinate descent: from the joint nearest the end outwards, turn
 * each joint so the end points at the target. Simple and robust for any
 * chain length.
 */
function ccd(chain: Chain, target: Vec2, iterations: number): void {
  const n = chain.rotations.length;
  for (let it = 0; it < iterations; it++) {
    for (let i = n - 1; i >= 0; i--) {
      const worlds = chain.worlds();
      const j = chain.joint(worlds, i);
      const p = chain.effectorPoint(worlds);
      if (len(sub(p, j)) < 1e-9 || len(sub(target, j)) < 1e-9) continue;
      chain.turn(worlds, i, wrapDegrees(angleOf(sub(target, j)) - angleOf(sub(p, j))));
    }
    if (len(sub(chain.effectorPoint(chain.worlds()), target)) < 1e-3) return;
  }
}

/**
 * Exact two-part limb (upper arm + forearm) by the law of cosines. Keeps the
 * limb bending the way it already bends. Returns false for degenerate limbs.
 */
function solveTwoBone(chain: Chain, links: readonly IkLink[], target: Vec2): boolean {
  let worlds = chain.worlds();
  const s = chain.joint(worlds, 0);
  const e = chain.joint(worlds, 1);
  const p = chain.effectorPoint(worlds);
  const upper = sub(e, s);
  const lower = sub(p, e);
  const a = len(upper);
  const b = len(lower);
  if (a < 1e-9 || b < 1e-9) return false;

  const cross = upper.x * lower.y - upper.y * lower.x;
  const bend = Math.abs(cross) > 1e-6 * a * b ? Math.sign(cross) : (links[1]!.bendDirection ?? 1);
  const toTarget = sub(target, s);
  const d = Math.min(Math.max(len(toTarget), Math.abs(a - b) + 1e-9), a + b - 1e-9);
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const shoulderAngle = angleOf(toTarget) - bend * (Math.acos(cosA) / DEG_TO_RAD);

  chain.turn(worlds, 0, wrapDegrees(shoulderAngle - angleOf(upper)));
  worlds = chain.worlds();
  const e2 = chain.joint(worlds, 1);
  const p2 = chain.effectorPoint(worlds);
  chain.turn(worlds, 1, wrapDegrees(angleOf(sub(target, e2)) - angleOf(sub(p2, e2))));
  return true;
}

/**
 * The joints that turn when `part` is dragged (docs/DESIGN.md R7a), nearest
 * first: its ancestors up to and including the first chain root. `ancestors`
 * runs from the layer root down to the parent; the layer root never turns.
 * Empty when the part is itself a chain root or nothing above it can turn.
 */
export function chainFromAncestors(part: Part, ancestors: readonly Part[]): Part[] {
  if (ancestors.length === 0 || part.joint.chainRoot) return [];
  const chain: Part[] = [];
  for (let i = ancestors.length - 1; i >= 1; i--) {
    const a = ancestors[i]!;
    chain.push(a);
    if (a.joint.chainRoot) break;
  }
  return chain;
}
