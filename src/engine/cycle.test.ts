import { describe, expect, it } from 'vitest';
import { evaluateScene } from './evaluate';
import { pinPart } from './pins';
import { createPart, createProject, parseProject } from './project';
import { setPartPose } from './tracks';
import type { Layer, Project } from './types';

const at = (x: number, y: number) => ({ x, y, rotation: 0, scaleX: 1, scaleY: 1 });

function walker(cycle?: Layer['cycle']) {
  const leg = createPart({ name: 'Leg', kind: 'shape', rest: at(0, 50) });
  const mouth = createPart({ name: 'Mouth', kind: 'switch', drawingSetId: 'm', restDrawing: 'X' });
  const root = createPart({ name: 'Pip', kind: 'group', rest: at(100, 300), children: [leg, mouth] });
  const layer: Layer = { id: 'pip', name: 'Pip', kind: 'character', root, ...(cycle ? { cycle } : {}) };
  let p: Project = { ...createProject({ layers: [layer], durationFrames: 100 }), drawingSets: [{ id: 'm', name: 'Mouths', vocabulary: 'mouth', drawings: [] }] };
  // One step: the leg swings 0 → 30 → 0 over 24 frames while Pip moves 120 px.
  p = setPartPose(setPartPose(setPartPose(p, leg.id, 'rotation', 0, 0), leg.id, 'rotation', 12, 30), leg.id, 'rotation', 24, 0);
  p = setPartPose(setPartPose(p, root.id, 'x', 0, 100, 'linear'), root.id, 'x', 24, 220);
  p = setPartPose(setPartPose(p, mouth.id, 'drawing', 0, 'X'), mouth.id, 'drawing', 30, 'A');
  return { p, leg: leg.id, root: root.id, mouth: mouth.id };
}

const part = (p: Project, id: string, f: number) => evaluateScene(p, f).parts.find((x) => x.id === id)!;

describe('animation cycles', () => {
  it('without a cycle, the animation holds after its last pose', () => {
    const { p, leg } = walker();
    expect(part(p, leg, 36).local.rotation).toBe(0);
  });

  it('repeats the cycle after its last frame', () => {
    const { p, leg } = walker({ from: 0, to: 24, travel: false });
    expect(part(p, leg, 36).local.rotation).toBeCloseTo(part(p, leg, 12).local.rotation);
    expect(part(p, leg, 60).local.rotation).toBeCloseTo(part(p, leg, 12).local.rotation);
  });

  it('in place, the character jumps back each time; travelling, it keeps walking', () => {
    const inPlace = walker({ from: 0, to: 24, travel: false });
    expect(part(inPlace.p, inPlace.root, 30).local.x).toBeCloseTo(part(inPlace.p, inPlace.root, 6).local.x);
    const travelling = walker({ from: 0, to: 24, travel: true });
    expect(part(travelling.p, travelling.root, 30).local.x).toBeCloseTo(part(travelling.p, travelling.root, 6).local.x + 120);
    expect(part(travelling.p, travelling.root, 72).local.x).toBeCloseTo(100 + 3 * 120);
  });

  it('lip sync follows the dialogue, not the cycle', () => {
    const { p, mouth } = walker({ from: 0, to: 24, travel: false });
    expect(part(p, mouth, 30).drawing).toBe('A');
    expect(part(p, mouth, 29).drawing).toBe('X');
  });

  it('pins move on with a travelling cycle, so a planted foot stays planted', () => {
    let { p, leg } = walker({ from: 0, to: 24, travel: true });
    p = pinPart(p, leg, 0, { x: 0, y: 0 }, { x: 100, y: 350 });
    expect(part(p, leg, 30).pin!.at).toEqual({ x: 220, y: 350 });
  });

  it('is saved and checked', () => {
    const { p } = walker({ from: 0, to: 24, travel: true });
    expect(parseProject(JSON.parse(JSON.stringify(p))).scene.layers[0]!.cycle).toEqual({ from: 0, to: 24, travel: true });
    const bad = { ...p, scene: { ...p.scene, layers: p.scene.layers.map((l) => ({ ...l, cycle: { from: 10, to: 5, travel: false } })) } };
    expect(() => parseProject(JSON.parse(JSON.stringify(bad)))).toThrow(/invalid cycle/);
  });
});

describe('stepping that changes over time (ST7)', () => {
  it('switches from ones to twos on a frame, restarting the steps there', () => {
    let { p, leg, root } = walker();
    p = setPartPose(p, leg, 'rotation', 0, 0, 'linear');
    p = setPartPose(p, leg, 'rotation', 12, 30, 'linear');
    p = setPartPose(p, root, 'stepping', 5, 2);
    const r = (f: number) => part(p, leg, f).local.rotation;
    expect(r(4)).toBeCloseTo(10); // on ones before frame 5
    expect(r(5)).toBeCloseTo(12.5); // a step starts on the change
    expect(r(6)).toBeCloseTo(12.5);
    expect(r(7)).toBeCloseTo(17.5);
    // "View on ones" still shows every frame.
    expect(evaluateScene(p, 6, { onOnes: true }).parts.find((x) => x.id === leg)!.local.rotation).toBeCloseTo(15);
  });

  it('only on a layer, and only 1, 2 or 3', () => {
    const { p, leg, root } = walker();
    expect(() => parseProject(JSON.parse(JSON.stringify(setPartPose(p, leg, 'stepping', 0, 2))))).toThrow(/belong on a layer/);
    expect(() => parseProject(JSON.parse(JSON.stringify(setPartPose(p, root, 'stepping', 0, 5))))).toThrow(/must be 1, 2 or 3/);
  });
});
