import { describe, expect, it } from 'vitest';
import { recordCamera } from './camera';
import { findDrawing } from './drawingItems';
import { insertPart, updateLayer, updatePart } from './edit';
import { addEffect, recordEffectValue } from './effects';
import { evaluateScene } from './evaluate';
import { defaultStyle, rectPath } from './geometry';
import { pinPart } from './pins';
import { createPart, createProject, parseProject, ProjectFormatError } from './project';
import { recordStepping } from './stepping';
import { setPartPose } from './tracks';
import type { Project } from './types';

// A project file damaged in one place (a value missing, or of the wrong
// kind) must either be refused with a "Damaged project" message or open as
// something that can be drawn: never crash later, or draw nothing because a
// number isn't a number.

/** A small project that uses every feature. */
function everything(): Project {
  const shape = createPart({ name: 'Arm (left)', kind: 'shape', rest: { x: 100, y: 50, rotation: 10, scaleX: 1, scaleY: 1 }, paths: [rectPath(0, 0, 20, 80)], style: { ...defaultStyle(), fillGradient: { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 0, y: 80 }, stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] } } });
  const hand = createPart({ name: 'Hand', kind: 'shape', rest: { x: 10, y: 80, rotation: 0, scaleX: 1, scaleY: 1 }, paths: [rectPath(-5, 0, 10, 10)], style: defaultStyle(), joint: { pivot: { x: 0, y: 0 }, minAngle: -90, maxAngle: 90, bendDirection: -1 } });
  const picture = createPart({ name: 'Photo', kind: 'image', image: { assetId: 'img', width: 4, height: 4 } });
  const mouth = createPart({ name: 'Mouth', kind: 'switch', drawingSetId: 'mouths', restDrawing: 'X' });
  let p: Project = {
    ...createProject({ durationFrames: 60, sky: { top: '#00f', bottom: '#fff' } }),
    swatches: ['#123456'],
    assets: [{ id: 'img', name: 'photo.png', mimeType: 'image/png' }, { id: 'snd', name: 'hi.wav', mimeType: 'audio/wav' }],
    drawingSets: [
      {
        id: 'mouths',
        name: 'Mouths',
        vocabulary: 'mouth',
        drawings: [
          { key: 'X', name: 'Rest', items: [{ kind: 'shape', paths: [rectPath(0, 0, 10, 2)], style: defaultStyle() }] },
          { key: 'A', name: 'Open', items: [{ kind: 'image', assetId: 'img', x: 0, y: 0, width: 4, height: 4 }] },
        ],
      },
    ],
  };
  const layer = { id: 'pip', name: 'Pip', kind: 'character' as const, root: createPart({ name: 'Pip', kind: 'group', children: [shape, picture, mouth] }), cycle: { from: 0, to: 24, travel: true }, depth: 0.8, scroll: { speed: 10, repeat: true } };
  p = { ...p, scene: { ...p.scene, layers: [layer], audio: [{ id: 'c', assetId: 'snd', name: 'Hi', startFrame: 2, duration: 1, volume: 1 }] } };
  p = insertPart(p, shape.id, hand);
  p = updatePart(p, shape.id, (x) => ({ ...x, blend: 'multiply', clipChildren: true }));
  p = addEffect(p, shape.id, 'shadow').project;
  p = recordEffectValue(p, shape.id, 'e1', 'distance', 10, 30);
  p = setPartPose(setPartPose(p, shape.id, 'rotation', 0, 0, { bezier: [0.4, 0, 0.6, 1] }), shape.id, 'rotation', 12, 45, 'easeIn');
  p = setPartPose(setPartPose(p, mouth.id, 'drawing', 0, 'X'), mouth.id, 'drawing', 6, 'A');
  p = setPartPose(p, picture.id, 'visible', 20, false);
  p = setPartPose(p, picture.id, 'drawOrder', 20, 5);
  p = pinPart(p, hand.id, 5, { x: 0, y: 5 }, { x: 120, y: 150 });
  p = recordCamera(p, 30, { x: 500, zoom: 1.5, rotation: 5 });
  p = recordStepping(p, p.scene.layers[0]!, 10, 2);
  p = updateLayer(p, 'pip', (l) => ({ ...l, source: { relPath: 'Pip.nyahitem', savedAt: 1, parts: {}, sets: {} } }));
  return p;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAMAGE = [undefined, null, NaN, 'x', -1, 0, 1e308, [], {}, true, 2.5];

/** What drawing a frame relies on. */
function drawable(p: Project, frame: number): void {
  const scene = evaluateScene(p, frame);
  if (!scene.cameraMatrix.every(Number.isFinite)) throw new Error('the camera is not finite');
  for (const part of scene.parts) {
    if (!part.world.every(Number.isFinite) || !Number.isFinite(part.opacity)) throw new Error(`${part.name} is not finite`);
    for (const path of part.paths ?? []) for (const pt of path.points) if (![pt.anchor.x, pt.anchor.y].every(Number.isFinite)) throw new Error(`${part.name} has a point that isn't finite`);
    for (const e of part.effects ?? []) for (const v of Object.values(e)) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${part.name} has an effect that isn't finite`);
    if (part.kind === 'switch' && part.drawing !== undefined) findDrawing(p, part.drawingSetId, part.drawing);
  }
}

describe('a damaged project file', () => {
  const base = JSON.stringify(everything());
  it('the undamaged one opens', () => {
    drawable(parseProject(JSON.parse(base)), 12);
  });

  it('is refused, or opens as something that can be drawn', () => {
    const problems = new Set<string>();
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rng(seed);
      const doc = JSON.parse(base);
      // Somewhere in the file, at random…
      const places: (string | number)[][] = [];
      const visit = (v: unknown, path: (string | number)[]) => {
        places.push(path);
        if (v && typeof v === 'object') for (const k of Object.keys(v)) visit((v as Record<string, unknown>)[k], [...path, Array.isArray(v) ? Number(k) : k]);
      };
      visit(doc, []);
      const path = places[1 + Math.floor(r() * (places.length - 1))]!;
      let holder = doc;
      for (const k of path.slice(0, -1)) holder = holder[k];
      // …a value goes missing or becomes the wrong kind of thing (as a saved file, so no gaps in lists).
      const bad = DAMAGE[Math.floor(r() * DAMAGE.length)];
      if (bad === undefined) delete holder[path.at(-1)!];
      else holder[path.at(-1)!] = bad;
      const where = `${path.join('.')} = ${JSON.stringify(bad)}`;
      let project: Project;
      try {
        project = parseProject(JSON.parse(JSON.stringify(doc)));
      } catch (err) {
        if (!(err instanceof ProjectFormatError)) problems.add(`crashed opening: ${(err as Error).message} (${where})`);
        continue;
      }
      try {
        for (const f of [0, 12, 40]) drawable(project, f);
      } catch (err) {
        problems.add(`opened but can't be drawn: ${(err as Error).message} (${where})`);
      }
    }
    expect([...problems]).toEqual([]);
  });
});
