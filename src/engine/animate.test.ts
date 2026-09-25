import { describe, expect, it } from 'vitest';
import { frameAccess, recordPoses } from './access';
import { locatePart } from './edit';
import { evaluateScene } from './evaluate';
import { rectPath } from './geometry';
import { applyToPoint } from './math';
import { activePin, pinIntervals, pinPart, unpinPart } from './pins';
import { createLayer, createPart, createProject } from './project';
import { dragPoseChanges, moveChanges } from './rig';
import { findTrack, setPartPose } from './tracks';
import type { Part, Project } from './types';

const at = (x: number, y: number, rotation = 0) => ({ x, y, rotation, scaleX: 1, scaleY: 1 });
const limb = (name: string, x: number, y: number, children: Part[] = [], chainRoot = false) =>
  createPart({ name, kind: 'shape', rest: at(x, y), paths: [rectPath(-5, 0, 10, 100)], children, joint: { pivot: { x: 0, y: 0 }, chainRoot } });

/** Hips (layer root) → thigh (chain root) → shin → foot. */
function legRig() {
  const foot = limb('foot', 0, 100);
  const shin = limb('shin', 0, 100, [foot]);
  const thigh = limb('thigh', 0, 0, [shin], true);
  shin.rest = at(0, 100, 20); // a slightly bent knee
  const layer = createLayer('character', 'Pip', [thigh]);
  layer.root.rest = at(500, 300);
  return { project: createProject({ layers: [layer], durationFrames: 48 }), layer, thigh, shin, foot };
}

const worldPoint = (p: Project, frame: number, id: string, local = { x: 0, y: 0 }) =>
  applyToPoint(evaluateScene(p, frame).parts.find((x) => x.id === id)!.world, local);

describe('posing on a frame', () => {
  it('records only what changed, plus the starting pose on frame 0 (A2a)', () => {
    const { project, thigh } = legRig();
    const access = frameAccess(project, 24);
    const p = access.write(project, new Map([[thigh.id, { rotation: 30, x: 0 }]]));
    expect(findTrack(p.scene.tracks, thigh.id, 'rotation')!.poses).toEqual([
      { frame: 0, value: 0 },
      { frame: 24, value: 30 },
    ]);
    expect(findTrack(p.scene.tracks, thigh.id, 'x')).toBeUndefined();
    // Frames before 24 in-between from the starting pose.
    expect(evaluateScene(p, 12).parts.find((x) => x.id === thigh.id)!.local.rotation).toBeGreaterThan(0);
    expect(evaluateScene(p, 12).parts.find((x) => x.id === thigh.id)!.local.rotation).toBeLessThan(30);
  });

  it('a later pose on a posed channel does not add another starting pose', () => {
    const { project, thigh } = legRig();
    let p = setPartPose(project, thigh.id, 'rotation', 10, 45);
    p = recordPoses(p, 20, new Map([[thigh.id, { rotation: 10 }]]), () => ({ ...at(0, 0), rotation: 45 }));
    expect(findTrack(p.scene.tracks, thigh.id, 'rotation')!.poses.map((x) => x.frame)).toEqual([10, 20]);
  });

  it('drag-to-pose on a frame writes poses for the chain', () => {
    const { project, foot, thigh, shin } = legRig();
    const access = frameAccess(project, 12);
    const target = { x: 560, y: 450 };
    const p = access.write(project, dragPoseChanges(project, access, foot.id, { x: 0, y: 0 }, target));
    const reached = worldPoint(p, 12, foot.id);
    expect(reached.x).toBeCloseTo(target.x, 3);
    expect(reached.y).toBeCloseTo(target.y, 3);
    expect(findTrack(p.scene.tracks, thigh.id, 'rotation')!.poses.map((x) => x.frame)).toEqual([0, 12]);
    expect(findTrack(p.scene.tracks, shin.id, 'rotation')!.poses.map((x) => x.frame)).toEqual([0, 12]);
    // Frame 0 still shows the original pose.
    const original = worldPoint(project, 0, foot.id);
    const start = worldPoint(p, 0, foot.id);
    expect(start.x).toBeCloseTo(original.x, 6);
    expect(start.y).toBeCloseTo(original.y, 6);
  });

  it('moving a part on a frame uses screen directions', () => {
    const { project, layer } = legRig();
    const thigh = layer.root.children[0]!;
    const access = frameAccess(project, 5);
    const p = access.write(project, moveChanges(project, access, [thigh.id], { x: 10, y: 0 }));
    expect(worldPoint(p, 5, thigh.id).x).toBeCloseTo(510);
  });
});

describe('pins', () => {
  it('keep a planted foot in place while the body moves', () => {
    const { project, layer, foot } = legRig();
    const planted = worldPoint(project, 0, foot.id);
    let p = pinPart(project, foot.id, 0, { x: 0, y: 0 }, planted);
    // Move the hips (layer root) right and down over 24 frames.
    p = setPartPose(p, layer.root.id, 'x', 0, 500);
    p = setPartPose(p, layer.root.id, 'x', 24, 540);
    p = setPartPose(p, layer.root.id, 'y', 0, 300);
    p = setPartPose(p, layer.root.id, 'y', 24, 330);
    for (const f of [0, 6, 12, 18, 24]) {
      const now = worldPoint(p, f, foot.id);
      expect(now.x).toBeCloseTo(planted.x, 2);
      expect(now.y).toBeCloseTo(planted.y, 2);
    }
    expect(evaluateScene(p, 12).parts.find((x) => x.id === foot.id)!.pin).toEqual({ at: planted, reached: true });
  });

  it('turn red (not reached) when the body moves too far away', () => {
    const { project, layer, foot } = legRig();
    let p = pinPart(project, foot.id, 0, { x: 0, y: 0 }, worldPoint(project, 0, foot.id));
    p = setPartPose(p, layer.root.id, 'y', 10, -500);
    expect(evaluateScene(p, 10).parts.find((x) => x.id === foot.id)!.pin!.reached).toBe(false);
  });

  it('can be released later, and are shown as frame ranges', () => {
    const { project, foot } = legRig();
    let p = pinPart(project, foot.id, 5, { x: 0, y: 0 }, { x: 1, y: 2 });
    p = unpinPart(p, foot.id, 20);
    expect(activePin(p, foot.id, 4)).toBeNull();
    expect(activePin(p, foot.id, 10)).toEqual({ point: { x: 0, y: 0 }, at: { x: 1, y: 2 } });
    expect(activePin(p, foot.id, 20)).toBeNull();
    expect(pinIntervals(p, foot.id)).toEqual([{ start: 5, end: 20 }]);
    // Unpinning on the frame the pin starts removes it.
    expect(pinIntervals(unpinPart(p, foot.id, 5), foot.id)).toEqual([]);
  });

  it('a pinned part without a chain turns at its own joint to stay pointed at the pin', () => {
    const leg = limb('leg', 0, 0);
    const layer = createLayer('character', 'Stick', [leg]);
    layer.root.rest = at(100, 100);
    let p = createProject({ layers: [layer] });
    const foot = { x: 0, y: 100 };
    const planted = worldPoint(p, 0, leg.id, foot);
    p = pinPart(p, leg.id, 0, foot, planted);
    p = setPartPose(p, layer.root.id, 'x', 10, 150);
    const now = worldPoint(p, 10, leg.id, foot);
    // It can't stretch, but it leans toward the pin.
    expect(now.x).toBeLessThan(150);
    expect(locatePart(p, leg.id)).toBeDefined();
  });
});
