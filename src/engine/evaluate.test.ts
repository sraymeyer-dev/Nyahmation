import { describe, expect, it } from 'vitest';
import { evaluateScene, type ResolvedScene } from './evaluate';
import { applyToPoint } from './math';
import { createPart, createProject } from './project';
import { setPartPose } from './tracks';
import type { Layer, Part, Project } from './types';

/** body (group at 100,100) → arm (joint 10,0) → hand (joint 20,0 along the arm); body → mouth (switch). */
function rig(): { project: Project; body: Part; arm: Part; hand: Part; mouth: Part } {
  const hand = createPart({ name: 'hand', kind: 'shape', rest: { x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } });
  const arm = createPart({
    name: 'arm',
    kind: 'shape',
    rest: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    children: [hand],
  });
  const mouth = createPart({ name: 'mouth', kind: 'switch', drawingSetId: 'mouths', restDrawing: 'X' });
  const body = createPart({
    name: 'body',
    kind: 'group',
    rest: { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    children: [arm, mouth],
  });
  const layer: Layer = { id: 'c1', name: 'Test', kind: 'character', root: body };
  const project = createProject({ layers: [layer] });
  return { project, body, arm, hand, mouth };
}

const part = (scene: ResolvedScene, id: string) => {
  const found = scene.parts.find((p) => p.id === id);
  if (!found) throw new Error(`no part ${id}`);
  return found;
};
const jointInScene = (scene: ResolvedScene, id: string, pivot = { x: 0, y: 0 }) =>
  applyToPoint(part(scene, id).world, pivot);

describe('evaluateScene', () => {
  it('places parts from their rest pose when nothing is animated', () => {
    const { project, hand } = rig();
    const p = jointInScene(evaluateScene(project, 0), hand.id);
    expect(p.x).toBeCloseTo(130);
    expect(p.y).toBeCloseTo(100);
  });

  it('children follow their parent (forward kinematics)', () => {
    const { project, body, hand } = rig();
    const moved = setPartPose(project, body.id, 'x', 0, 300);
    const p = jointInScene(evaluateScene(moved, 0), hand.id);
    expect(p.x).toBeCloseTo(330);
    expect(p.y).toBeCloseTo(100);
  });

  it('rotating a joint swings everything below it around the joint', () => {
    const { project, arm, hand } = rig();
    const bent = setPartPose(project, arm.id, 'rotation', 0, 90);
    const scene = evaluateScene(bent, 0);
    // The arm's own joint stays put...
    const shoulder = jointInScene(scene, arm.id);
    expect(shoulder.x).toBeCloseTo(110);
    expect(shoulder.y).toBeCloseTo(100);
    // ...and the hand swings from pointing right to pointing down (screen y grows downward).
    const wrist = jointInScene(scene, hand.id);
    expect(wrist.x).toBeCloseTo(110);
    expect(wrist.y).toBeCloseTo(120);
  });

  it('rotates around a pivot that is not at the drawing origin', () => {
    const p = createPart({
      name: 'lid',
      kind: 'shape',
      rest: { x: 50, y: 50, rotation: 33, scaleX: 2, scaleY: 0.5 },
      joint: { pivot: { x: 5, y: 7 } },
    });
    const project = createProject({ layers: [{ id: 'c', name: 'c', kind: 'character', root: p }] });
    const joint = applyToPoint(evaluateScene(project, 0).parts[0]!.world, { x: 5, y: 7 });
    expect(joint.x).toBeCloseTo(50);
    expect(joint.y).toBeCloseTo(50);
  });

  it('interpolates between poses', () => {
    const { project, arm } = rig();
    let p = setPartPose(project, arm.id, 'rotation', 0, 0, 'linear');
    p = setPartPose(p, arm.id, 'rotation', 10, 90);
    expect(part(evaluateScene(p, 5), arm.id).local.rotation).toBeCloseTo(45);
  });

  it('multiplies opacity and inherits hiding down the tree', () => {
    const { project, body, arm, hand } = rig();
    let p = setPartPose(project, body.id, 'opacity', 0, 0.5);
    p = setPartPose(p, arm.id, 'opacity', 0, 0.5);
    p = setPartPose(p, arm.id, 'visible', 0, true);
    p = setPartPose(p, arm.id, 'visible', 10, false);
    expect(part(evaluateScene(p, 0), hand.id).opacity).toBeCloseTo(0.25);
    expect(part(evaluateScene(p, 9), hand.id).visible).toBe(true);
    expect(part(evaluateScene(p, 10), hand.id).visible).toBe(false);
    expect(part(evaluateScene(p, 10), body.id).visible).toBe(true);
  });

  it('paints in draw order, independent of the tree, keeping tree order for ties', () => {
    const { project, body, arm, hand, mouth } = rig();
    expect(evaluateScene(project, 0).parts.map((x) => x.id)).toEqual([body.id, arm.id, hand.id, mouth.id]);
    // Send the arm behind its own parent from frame 5 (a draw-order swap).
    const p = setPartPose(project, arm.id, 'drawOrder', 5, -1);
    expect(evaluateScene(p, 4).parts[0]!.id).toBe(arm.id);
    expect(evaluateScene(p, 5).parts.map((x) => x.id)).toEqual([arm.id, body.id, hand.id, mouth.id]);
  });

  it('switch layers show the drawing for the current frame', () => {
    const { project, mouth } = rig();
    expect(part(evaluateScene(project, 0), mouth.id).drawing).toBe('X');
    let p = setPartPose(project, mouth.id, 'drawing', 3, 'A');
    p = setPartPose(p, mouth.id, 'drawing', 5, 'D');
    expect(part(evaluateScene(p, 2), mouth.id).drawing).toBe('A');
    expect(part(evaluateScene(p, 4), mouth.id).drawing).toBe('A');
    expect(part(evaluateScene(p, 5), mouth.id).drawing).toBe('D');
    expect(part(evaluateScene(p, 5), mouth.id).drawingSetId).toBe('mouths');
  });

  describe('on twos', () => {
    function twos() {
      const r = rig();
      let p = setPartPose(r.project, r.arm.id, 'rotation', 1, 0, 'linear');
      p = setPartPose(p, r.arm.id, 'rotation', 8, 70);
      p = setPartPose(p, r.mouth.id, 'drawing', 2, 'A');
      p = setPartPose(p, r.mouth.id, 'drawing', 3, 'D');
      p = { ...p, scene: { ...p.scene, stepping: 2 as const } };
      return { ...r, project: p };
    }
    const rotationAt = (p: Project, id: string, f: number) => part(evaluateScene(p, f), id).local.rotation;

    it('motion changes every second frame and lands exactly on each pose', () => {
      const { project, arm } = twos();
      expect(rotationAt(project, arm.id, 2)).toBeCloseTo(rotationAt(project, arm.id, 1));
      expect(rotationAt(project, arm.id, 3)).toBeCloseTo(20);
      expect(rotationAt(project, arm.id, 4)).toBeCloseTo(20);
      expect(rotationAt(project, arm.id, 7)).toBeCloseTo(60);
      expect(rotationAt(project, arm.id, 8)).toBeCloseTo(70);
    });

    it('mouths stay on ones', () => {
      const { project, mouth } = twos();
      expect(part(evaluateScene(project, 2), mouth.id).drawing).toBe('A');
      expect(part(evaluateScene(project, 3), mouth.id).drawing).toBe('D');
    });

    it('steps restart at a pose on any part of the character, so the whole puppet changes together', () => {
      const { project, arm, body } = twos();
      const p = setPartPose(project, body.id, 'x', 4, 100);
      // Pose on frame 4 (body) becomes an anchor for the arm too: 4 shows 4, 5 shows 4, 6 shows 6.
      expect(rotationAt(p, arm.id, 4)).toBeCloseTo(30);
      expect(rotationAt(p, arm.id, 5)).toBeCloseTo(30);
      expect(rotationAt(p, arm.id, 6)).toBeCloseTo(50);
    });

    it('a character can override the scene stepping', () => {
      const { project, arm } = twos();
      const onOnes: Project = {
        ...project,
        scene: {
          ...project.scene,
          layers: project.scene.layers.map((c) => ({ ...c, stepping: 1 as const })),
        },
      };
      expect(rotationAt(onOnes, arm.id, 2)).toBeCloseTo(10);
    });

    it('"View on ones" shows every in-between, even for a character that overrides the scene', () => {
      const { project, arm } = twos();
      const onThrees: Project = { ...project, scene: { ...project.scene, layers: project.scene.layers.map((c) => ({ ...c, stepping: 3 as const })) } };
      const viewed = (p: Project, f: number) => part(evaluateScene(p, f, { onOnes: true }), arm.id).local.rotation;
      expect(viewed(project, 2)).toBeCloseTo(10);
      expect(viewed(onThrees, 2)).toBeCloseTo(10);
      // Without it, the stepping still applies (export never passes it).
      expect(rotationAt(onThrees, arm.id, 2)).toBeCloseTo(0);
    });
  });

  it('is deterministic', () => {
    const { project, arm } = rig();
    const p = setPartPose(setPartPose(project, arm.id, 'rotation', 0, 0), arm.id, 'rotation', 24, 180);
    expect(evaluateScene(p, 13)).toEqual(evaluateScene(p, 13));
  });
});
