import { describe, expect, it } from 'vitest';
import { recordCamera } from './camera';
import { evaluateScene } from './evaluate';
import { defaultStyle, rectPath } from './geometry';
import { applyToPoint, multiply } from './math';
import { pinPart } from './pins';
import { createPart, createProject, parseProject } from './project';
import { moveStage, resizeScene } from './stage';
import { setPartPose } from './tracks';
import type { Layer, Project } from './types';

const W = 1000;
const H = 500;
const box = () => ({ paths: [rectPath(0, 0, 40, 20)], style: defaultStyle() });

/** Pip (posed, with a pinned hand), distant scrolling hills, and a name tag fixed to the camera that follows Pip's head. */
function busyScene(): Project {
  const hand = createPart({ name: 'Hand', kind: 'shape', rest: { x: 60, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, ...box() });
  const arm = createPart({ name: 'Arm', kind: 'shape', rest: { x: 20, y: -40, rotation: 0, scaleX: 1, scaleY: 1 }, children: [hand], ...box() });
  const head = createPart({ name: 'Head', kind: 'shape', rest: { x: 0, y: -100, rotation: 0, scaleX: 1, scaleY: 1 }, ...box() });
  const pip = createPart({ name: 'Pip', kind: 'group', rest: { x: 400, y: 300, rotation: 0, scaleX: 1, scaleY: 1 }, children: [head, arm] });
  const hill = createPart({ name: 'Hill', kind: 'shape', rest: { x: 100, y: 400, rotation: 0, scaleX: 1, scaleY: 1 }, ...box() });
  const tag = createPart({ name: 'Tag', kind: 'shape', rest: { x: 450, y: 150, rotation: 0, scaleX: 1, scaleY: 1 }, ...box() });
  const layers: Layer[] = [
    { id: 'hills', name: 'Hills', kind: 'background', root: createPart({ name: 'Hills', kind: 'group', children: [hill] }), depth: 0.5, scroll: { speed: -30, repeat: true } },
    { id: 'pip', name: 'Pip', kind: 'character', root: pip, cycle: { from: 0, to: 12, travel: true } },
    { id: 'tag', name: 'Tag', kind: 'background', root: createPart({ name: 'Tag layer', kind: 'group', children: [tag] }), depth: 0, follow: { partId: head.id } },
  ];
  let project = createProject({ width: W, height: H, layers });
  project = setPartPose(project, pip.id, 'x', 0, 400);
  project = setPartPose(project, pip.id, 'x', 12, 480);
  project = setPartPose(project, arm.id, 'rotation', 6, 40);
  project = pinPart(project, hand.id, 8, { x: 20, y: 10 }, { x: 520, y: 290 });
  project = recordCamera(project, 20, { x: 600, y: 200, zoom: 1.5, rotation: 10 });
  return project;
}

/** Where each part's corner and far corner are in the picture, measured from the picture's middle. */
function fromMiddle(project: Project, frame: number): number[] {
  const r = evaluateScene(project, frame);
  const out: number[] = [];
  for (const part of r.parts) {
    const m = multiply(r.cameraMatrix, part.world);
    for (const p of [applyToPoint(m, { x: 0, y: 0 }), applyToPoint(m, { x: 40, y: 20 })]) out.push(p.x - r.width / 2, p.y - r.height / 2);
  }
  return out;
}

describe('changing the scene size', () => {
  it('keeps what was in the middle of the picture there, on every frame', () => {
    const before = busyScene();
    for (const [w, h] of [
      [500, 1000],
      [1600, 900],
      [999, 333],
    ] as const) {
      const after = resizeScene(before, w, h);
      expect(after.scene).toMatchObject({ width: w, height: h });
      for (const frame of [0, 5, 9, 14, 20, 30]) {
        const a = fromMiddle(before, frame);
        const b = fromMiddle(after, frame);
        expect(b.length).toBe(a.length);
        b.forEach((v, i) => expect(v).toBeCloseTo(a[i]!, 6));
      }
    }
  });

  it('moves everything on the stage together, leaving the file valid', () => {
    const project = busyScene();
    const moved = moveStage(project, 30, -20);
    expect(() => parseProject(JSON.parse(JSON.stringify(moved)))).not.toThrow();
    const r0 = evaluateScene(project, 9);
    const r1 = evaluateScene(moved, 9);
    // On the stage, a stage layer's part is 30 across and 20 up from before.
    const hand0 = r0.parts.find((p) => p.name === 'Hand')!.world;
    const hand1 = r1.parts.find((p) => p.name === 'Hand')!.world;
    expect(hand1[4] - hand0[4]).toBeCloseTo(30);
    expect(hand1[5] - hand0[5]).toBeCloseTo(-20);
    expect(r1.camera.x - r0.camera.x).toBeCloseTo(30);
  });

  it('is nothing at all when the size is the same', () => {
    const project = busyScene();
    expect(resizeScene(project, W, H)).toBe(project);
  });
});
