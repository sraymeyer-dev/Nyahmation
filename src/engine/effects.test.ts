import { describe, expect, it } from 'vitest';
import { duplicateParts, locatePart } from './edit';
import { addEffect, effectValueAt, recordEffectValue, removeEffect, updateEffect } from './effects';
import { evaluateScene } from './evaluate';
import { createPart, createProject, parseProject, PROJECT_VERSION } from './project';
import { setPartPose } from './tracks';
import type { Effect, Layer, Project } from './types';

function scene(): { project: Project; body: string; eye: string } {
  const pupil = createPart({ name: 'Pupil', kind: 'shape' });
  const eye = createPart({ name: 'Eye', kind: 'shape', children: [pupil] });
  const body = createPart({ name: 'Body', kind: 'group', children: [eye] });
  const layer: Layer = { id: 'l', name: 'Pip', kind: 'character', root: body };
  return { project: createProject({ layers: [layer] }), body: body.id, eye: eye.id };
}

const effectsOf = (p: Project, id: string) => locatePart(p, id)!.part.effects ?? [];

describe('effects', () => {
  it('adds effects with their own ids and sensible settings', () => {
    let { project, body } = scene();
    let r = addEffect(project, body, 'shadow');
    project = r.project;
    expect(r.effectId).toBe('e1');
    r = addEffect(project, body, 'glow');
    project = r.project;
    expect(effectsOf(project, body).map((e) => [e.id, e.kind])).toEqual([
      ['e1', 'shadow'],
      ['e2', 'glow'],
    ]);
    const shadow = effectsOf(project, body)[0] as Extract<Effect, { kind: 'shadow' }>;
    expect(shadow.opacity).toBeGreaterThan(0);
  });

  it('a haze starts with the sky colour, or the background', () => {
    const { project, body } = scene();
    const withSky: Project = { ...project, scene: { ...project.scene, sky: { top: '#123456', bottom: '#abcdef' } } };
    const haze = effectsOf(addEffect(withSky, body, 'haze').project, body)[0] as Extract<Effect, { kind: 'haze' }>;
    expect(haze.color).toBe('#abcdef');
  });

  it('animates a setting like any other value, from its base setting (A2a)', () => {
    let { project, body } = scene();
    project = addEffect(project, body, 'glow').project;
    project = recordEffectValue(project, body, 'e1', 'size', 24, 40);
    const glow = effectsOf(project, body)[0]!;
    expect(effectValueAt(project, body, glow, 'size', 0)).toBe(18);
    expect(effectValueAt(project, body, glow, 'size', 24)).toBe(40);
    const mid = evaluateScene(project, 12).parts.find((p) => p.id === body)!.effects![0] as Extract<Effect, { kind: 'glow' }>;
    expect(mid.size).toBeGreaterThan(18);
    expect(mid.size).toBeLessThan(40);
    // Colours don't animate; unknown settings are ignored.
    expect(recordEffectValue(project, body, 'e1', 'color', 5, 1)).toBe(project);
  });

  it('removing an effect removes its animation', () => {
    let { project, body } = scene();
    project = addEffect(project, body, 'shadow').project;
    project = recordEffectValue(project, body, 'e1', 'distance', 10, 40);
    project = removeEffect(project, body, 'e1');
    expect(effectsOf(project, body)).toEqual([]);
    expect(project.scene.tracks).toEqual([]);
    expect(locatePart(project, body)!.part.effects).toBeUndefined();
  });

  it('changes base settings, keeping the id and kind', () => {
    let { project, body } = scene();
    project = addEffect(project, body, 'blur').project;
    project = updateEffect(project, body, 'e1', { amount: 12, kind: 'glow', id: 'x' } as never);
    expect(effectsOf(project, body)[0]).toEqual({ id: 'e1', kind: 'blur', amount: 12 });
  });

  it('resolves effects, blend mode, clipping and parents', () => {
    let { project, body, eye } = scene();
    project = addEffect(project, body, 'shadow').project;
    project = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((l) => ({
          ...l,
          root: { ...l.root, blend: 'multiply', children: l.root.children.map((c) => ({ ...c, clipChildren: true })) },
        })),
      },
    };
    const r = evaluateScene(project, 0);
    const b = r.parts.find((p) => p.id === body)!;
    const e = r.parts.find((p) => p.id === eye)!;
    expect(b.effects?.[0]?.kind).toBe('shadow');
    expect(b.blend).toBe('multiply');
    expect(e.clipChildren).toBe(true);
    expect(e.parentId).toBe(body);
    expect(b.parentId).toBeUndefined();
  });

  it('duplicating a part copies its effects and their animation', () => {
    let { project, eye } = scene();
    project = addEffect(project, eye, 'glow').project;
    project = recordEffectValue(project, eye, 'e1', 'opacity', 5, 0.2);
    const { project: next, ids } = duplicateParts(project, [eye]);
    const copy = ids[0]!;
    expect(effectsOf(next, copy)[0]?.kind).toBe('glow');
    expect(next.scene.tracks.some((t) => t.partId === copy && t.channel === 'fx:e1:opacity')).toBe(true);
  });

  it('saves and loads, and rejects damaged effects and stray effect animation', () => {
    let { project, body } = scene();
    project = addEffect(project, body, 'shadow').project;
    project = recordEffectValue(project, body, 'e1', 'angle', 4, 120);
    const loaded = parseProject(JSON.parse(JSON.stringify(project)));
    expect(loaded.version).toBe(PROJECT_VERSION);
    expect(effectsOf(loaded, body)[0]?.kind).toBe('shadow');

    const stray = setPartPose(project, body, 'fx:nope:size', 0, 3);
    expect(() => parseProject(JSON.parse(JSON.stringify(stray)))).toThrow(/missing effect/);
    const bad = updateEffect(project, body, 'e1', { distance: 'far' });
    expect(() => parseProject(JSON.parse(JSON.stringify(bad)))).toThrow(/damaged effect/);
    const old = { ...JSON.parse(JSON.stringify(scene().project)), version: 4 };
    expect(parseProject(old).version).toBe(PROJECT_VERSION);
  });
});
