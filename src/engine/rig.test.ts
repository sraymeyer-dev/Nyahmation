import { describe, expect, it } from 'vitest';
import { locatePart, restWorldMatrix, subtreeBounds, updatePart } from './edit';
import { rectPath } from './geometry';
import { applyToPoint } from './math';
import { createLayer, createPart, createProject } from './project';
import { aimPart, autoChainRoots, dragPose, ikChainIds, rotateAtJoint, setPivot, setPivotAtScene } from './rig';
import type { Part, Project } from './types';

const at = (x: number, y: number, rotation = 0) => ({ x, y, rotation, scaleX: 1, scaleY: 1 });
const limb = (name: string, x: number, y: number, children: Part[] = [], chainRoot = false) =>
  createPart({ name, kind: 'shape', rest: at(x, y), paths: [rectPath(-5, 0, 10, 100)], children, joint: { pivot: { x: 0, y: 0 }, chainRoot } });

/** body → torso → (head, upper arm → forearm → hand), plus a leg off the body. */
function puppet(chainRoots = true) {
  const hand = limb('hand', 0, 100);
  const forearm = limb('forearm', 0, 100, [hand]);
  const upper = limb('upper', 40, -80, [forearm], chainRoots);
  const head = limb('head', 0, -120, [], chainRoots);
  const torso = limb('torso', 0, 0, [head, upper]);
  const leg = limb('leg', 20, 0);
  const layer = createLayer('character', 'Pip', [torso, leg]);
  layer.root.rest = at(500, 500);
  const project = createProject({ layers: [layer] });
  return { project, layer, torso, upper, forearm, hand, head, leg };
}

const jointAt = (p: Project, id: string) => {
  const loc = locatePart(p, id)!;
  return applyToPoint(restWorldMatrix(loc), loc.part.joint.pivot);
};
const pointAt = (p: Project, id: string, local: { x: number; y: number }) => applyToPoint(restWorldMatrix(locatePart(p, id)!), local);

describe('setPivot', () => {
  it('moves the joint without moving the artwork', () => {
    const { project, upper } = puppet();
    const before = subtreeBounds(project, locatePart(project, upper.id)!.part, restWorldMatrix(locatePart(project, upper.id)!));
    const rotated = { ...project };
    const moved = setPivot(rotated, upper.id, { x: 0, y: 50 });
    const loc = locatePart(moved, upper.id)!;
    const after = subtreeBounds(moved, loc.part, restWorldMatrix(loc));
    expect(after).toEqual(before);
    expect(loc.part.joint.pivot).toEqual({ x: 0, y: 50 });
  });

  it('works on rotated parts, and can be set from a scene position', () => {
    const { project, upper } = puppet();
    const turned = rotateAtJoint(project, upper.id, pointAt(project, upper.id, { x: 0, y: 100 }), pointAt(project, upper.id, { x: 100, y: 0 }));
    const tip = pointAt(turned, upper.id, { x: 0, y: 100 });
    const moved = setPivotAtScene(turned, upper.id, tip);
    expect(jointAt(moved, upper.id).x).toBeCloseTo(tip.x);
    expect(jointAt(moved, upper.id).y).toBeCloseTo(tip.y);
    expect(pointAt(moved, upper.id, { x: 0, y: 0 }).x).toBeCloseTo(pointAt(turned, upper.id, { x: 0, y: 0 }).x);
  });
});

describe('ikChainIds', () => {
  it('stops at the first chain root, nearest first', () => {
    const { project, hand, forearm, upper } = puppet();
    expect(ikChainIds(project, hand.id)).toEqual([forearm.id, upper.id]);
    expect(ikChainIds(project, forearm.id)).toEqual([upper.id]);
  });

  it('is empty for chain roots and for parts right under the layer', () => {
    const { project, upper, torso, leg } = puppet();
    expect(ikChainIds(project, upper.id)).toEqual([]);
    expect(ikChainIds(project, torso.id)).toEqual([]);
    expect(ikChainIds(project, leg.id)).toEqual([]);
  });

  it('without chain roots, goes up to (but never includes) the layer root', () => {
    const { project, hand, forearm, upper, torso } = puppet(false);
    expect(ikChainIds(project, hand.id)).toEqual([forearm.id, upper.id, torso.id]);
  });
});

describe('autoChainRoots', () => {
  it('marks limbs that branch off a body part', () => {
    const { project, layer, upper, head, forearm, torso } = puppet(false);
    const p = autoChainRoots(project, layer.id);
    const flag = (id: string) => locatePart(p, id)!.part.joint.chainRoot === true;
    expect(flag(upper.id)).toBe(true);
    expect(flag(head.id)).toBe(true);
    expect(flag(forearm.id)).toBe(false);
    expect(flag(torso.id)).toBe(false); // directly under the layer: already never turns
  });
});

describe('dragPose', () => {
  it('pulls the hand to the mouse by bending the elbow and swinging the shoulder', () => {
    const { project, hand, torso } = puppet();
    const grab = { x: 0, y: 50 };
    const target = { x: 600, y: 480 };
    const p = dragPose(project, hand.id, grab, target);
    const reached = pointAt(p, hand.id, grab);
    expect(reached.x).toBeCloseTo(target.x, 3);
    expect(reached.y).toBeCloseTo(target.y, 3);
    // The torso (above the shoulder's chain root) didn't move.
    expect(locatePart(p, torso.id)!.part.rest).toEqual(locatePart(project, torso.id)!.part.rest);
    // The hand itself kept its own rotation; only its parents turned.
    expect(locatePart(p, hand.id)!.part.rest.rotation).toBe(0);
  });

  it('turns a chain root at its own joint', () => {
    const { project, upper } = puppet();
    const shoulder = jointAt(project, upper.id);
    const p = dragPose(project, upper.id, { x: 0, y: 100 }, { x: shoulder.x + 100, y: shoulder.y });
    expect(locatePart(p, upper.id)!.part.rest.rotation).toBeCloseTo(-90);
    expect(jointAt(p, upper.id)).toEqual(shoulder);
  });

  it('respects joint limits', () => {
    const { project, upper } = puppet();
    const limited = updatePart(project, upper.id, (p) => ({ ...p, joint: { ...p.joint, minAngle: -30, maxAngle: 30 } }));
    const shoulder = jointAt(limited, upper.id);
    // Try to swing the arm straight up (180°): it stops at the limit.
    const p = aimPart(limited, upper.id, { x: 0, y: 100 }, { x: shoulder.x, y: shoulder.y - 100 });
    const r = locatePart(p, upper.id)!.part.rest.rotation;
    expect(Math.abs(r)).toBeCloseTo(30);
  });
});

describe('rotateAtJoint', () => {
  it('turns by the angle swept around the joint', () => {
    const { project, upper } = puppet();
    const j = jointAt(project, upper.id);
    const p = rotateAtJoint(project, upper.id, { x: j.x + 10, y: j.y }, { x: j.x, y: j.y + 10 });
    expect(locatePart(p, upper.id)!.part.rest.rotation).toBeCloseTo(90);
  });
});
