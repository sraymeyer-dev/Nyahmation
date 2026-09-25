import { describe, expect, it } from 'vitest';
import { locatePart, restWorldMatrix } from './edit';
import { centreItems, clearDrawingAt, drawingAt, drawingBlocks, makeSwitchLayer, matchMouthKey, partTreeItems, putDrawing, removeDrawing, renameDrawingKey, setDrawingAt } from './drawings';
import { drawingItemsBounds } from './drawingItems';
import { evaluateScene } from './evaluate';
import { ellipsePath, rectPath } from './geometry';
import { createLayer, createPart, createProject, parseProject } from './project';
import { findTrack } from './tracks';
import type { Project } from './types';

describe('matchMouthKey', () => {
  it('reads key letters and sound names from drawing names', () => {
    expect(matchMouthKey('A')).toBe('A');
    expect(matchMouthKey('mouth_D')).toBe('D');
    expect(matchMouthKey('Mouth X.png')).toBe('X');
    expect(matchMouthKey('rest')).toBe('X');
    expect(matchMouthKey('MBP')).toBe('A');
    expect(matchMouthKey('FV')).toBe('G');
    expect(matchMouthKey('Smile')).toBeNull();
    expect(matchMouthKey('Mouth Q')).toBeNull();
  });
});

/** A head with three mouth drawings (lips + teeth in one of them) and an eye. */
function head() {
  const shape = (name: string, x: number, drawOrder = 0) =>
    createPart({ name, kind: 'shape', rest: { x, y: 100, rotation: 0, scaleX: 1, scaleY: 1 }, paths: [ellipsePath(0, 0, 20, 10)], drawOrder, style: { fill: '#a33', stroke: null, strokeWidth: 0, lineCap: 'round', lineJoin: 'round', fillRule: 'nonzero' } });
  const teeth = createPart({ name: 'teeth', kind: 'shape', paths: [rectPath(-10, -3, 20, 6)], drawOrder: 5, style: { fill: '#fff', stroke: null, strokeWidth: 0, lineCap: 'round', lineJoin: 'round', fillRule: 'nonzero' } });
  const mouthD = shape('mouth_D', 100, 1);
  mouthD.children = [teeth];
  const parts = [shape('mouth_A', 100, 0), mouthD, shape('rest', 100, 2), shape('Eye', 50, 3)];
  const layer = createLayer('character', 'Pip', parts);
  const project = createProject({ layers: [layer], durationFrames: 48 });
  return { project, layer, ids: parts.slice(0, 3).map((p) => p.id), eye: parts[3]! };
}

describe('makeSwitchLayer', () => {
  it('turns named drawings into a mouth switch layer, keyed by sound', () => {
    const { project, ids } = head();
    const r = makeSwitchLayer(project, ids, 'Mouth')!;
    const loc = locatePart(r.project, r.partId)!;
    expect(loc.part.kind).toBe('switch');
    expect(loc.part.restDrawing).toBe('X');
    const set = r.project.drawingSets.find((s) => s.id === r.setId)!;
    expect(set.vocabulary).toBe('mouth');
    expect(set.drawings.map((d) => d.key)).toEqual(['A', 'D', 'X']);
    // The D mouth keeps both its lips and the teeth inside it, lips first.
    expect(set.drawings[1]!.items.map((i) => (i.kind === 'shape' ? i.style.fill : ''))).toEqual(['#a33', '#fff']);
    // The originals are gone; the eye stays.
    for (const id of ids) expect(locatePart(r.project, id)).toBeUndefined();
  });

  it('keeps the drawings where they were on screen', () => {
    const { project, ids } = head();
    const r = makeSwitchLayer(project, ids, 'Mouth')!;
    const loc = locatePart(r.project, r.partId)!;
    const set = r.project.drawingSets.find((s) => s.id === r.setId)!;
    const b = drawingItemsBounds(set.drawings[0]!.items, restWorldMatrix(loc));
    expect(b.minX).toBeCloseTo(80);
    expect(b.maxX).toBeCloseTo(120);
    expect(b.minY).toBeCloseTo(90);
  });

  it('uses names as keys when they are not mouth sounds', () => {
    const { project, eye } = head();
    const other = createPart({ name: 'Eye closed', kind: 'shape', paths: [rectPath(0, 0, 10, 2)] });
    const p: Project = { ...project, scene: { ...project.scene, layers: [{ ...project.scene.layers[0]!, root: { ...project.scene.layers[0]!.root, children: [...project.scene.layers[0]!.root.children, other] } }] } };
    const r = makeSwitchLayer(p, [eye.id, other.id], 'Eyes')!;
    const set = r.project.drawingSets.find((s) => s.id === r.setId)!;
    expect(set.vocabulary).toBe('custom');
    expect(set.drawings.map((d) => d.key)).toEqual(['Eye', 'Eye closed']);
  });
});

describe('lip-sync entry', () => {
  function mouthProject() {
    const { project, ids } = head();
    const r = makeSwitchLayer(project, ids, 'Mouth')!;
    return { project: r.project, id: r.partId };
  }

  it('sets a sound that holds until the next one, keeping rest before it', () => {
    const { project, id } = mouthProject();
    let p = setDrawingAt(project, id, 10, 'D');
    p = setDrawingAt(p, id, 14, 'A');
    expect(drawingAt(p, id, 0)).toBe('X');
    expect(drawingAt(p, id, 9)).toBe('X');
    expect(drawingAt(p, id, 12)).toBe('D');
    expect(drawingAt(p, id, 30)).toBe('A');
    expect(drawingBlocks(p, id)).toEqual([
      { key: 'X', start: 0, end: 10 },
      { key: 'D', start: 10, end: 14 },
      { key: 'A', start: 14, end: 48 },
    ]);
    expect(evaluateScene(p, 12).parts.find((x) => x.id === id)!.drawing).toBe('D');
  });

  it('typing the same sound again just extends it', () => {
    const { project, id } = mouthProject();
    const p = setDrawingAt(project, id, 10, 'D');
    expect(setDrawingAt(p, id, 11, 'D')).toBe(p);
  });

  it('Backspace removes the entry on a frame', () => {
    const { project, id } = mouthProject();
    const p = clearDrawingAt(setDrawingAt(project, id, 10, 'D'), id, 10);
    expect(findTrack(p.scene.tracks, id, 'drawing')!.poses.map((x) => x.frame)).toEqual([0]);
  });
});

describe('version 2 files', () => {
  it('turn one-piece drawings with offsets into item lists, and get an audio list', () => {
    const root = createPart({ name: 'Pip', kind: 'group' });
    const v2 = {
      format: 'nyahmation',
      version: 2,
      scene: { width: 100, height: 100, fps: 24, durationFrames: 10, background: '#fff', stepping: 1, layers: [{ id: 'l', name: 'Pip', kind: 'character', root }], tracks: [] },
      drawingSets: [
        {
          id: 's',
          name: 'Mouths',
          vocabulary: 'mouth',
          drawings: [
            { key: 'A', name: 'A', offset: { x: 5, y: 0 }, content: { kind: 'vector', paths: [rectPath(0, 0, 10, 10)], style: { fill: '#000', stroke: null, strokeWidth: 0, lineCap: 'round', lineJoin: 'round', fillRule: 'nonzero' } } },
            { key: 'B', name: 'B', offset: { x: 1, y: 2 }, content: { kind: 'image', assetId: 'i', width: 3, height: 4 } },
          ],
        },
      ],
      assets: [],
    };
    const p = parseProject(JSON.parse(JSON.stringify(v2)));
    expect(p.scene.audio).toEqual([]);
    const [a, b] = p.drawingSets[0]!.drawings;
    expect(a!.items[0]!.kind === 'shape' && a!.items[0]!.paths[0]!.points[0]!.anchor).toEqual({ x: 5, y: 0 });
    expect(b!.items[0]).toEqual({ kind: 'image', assetId: 'i', x: 1, y: 2, width: 3, height: 4 });
  });
});

describe('managing drawing sets', () => {
  function mouth() {
    const { project, ids } = head();
    const r = makeSwitchLayer(project, ids, 'Mouth')!;
    return { project: setDrawingAt(r.project, r.partId, 10, 'D'), id: r.partId, setId: r.setId };
  }

  it('renaming a key keeps the lip sync and rest drawing pointing at the same drawing', () => {
    const { project, id, setId } = mouth();
    let p = renameDrawingKey(project, setId, 'D', 'C');
    expect(drawingAt(p, id, 12)).toBe('C');
    p = renameDrawingKey(p, setId, 'X', 'H');
    expect(locatePart(p, id)!.part.restDrawing).toBe('H');
    expect(drawingAt(p, id, 0)).toBe('H');
    // Can't rename onto an existing key.
    expect(renameDrawingKey(p, setId, 'A', 'C')).toBe(p);
  });

  it('adds, replaces and removes drawings', () => {
    const { project, setId } = mouth();
    const items = centreItems([{ kind: 'image', assetId: 'png', x: 100, y: 100, width: 40, height: 20 }]);
    expect(items[0]).toMatchObject({ x: -20, y: -10 });
    let p = putDrawing(project, setId, { key: 'E', name: 'E.png', items });
    expect(p.drawingSets.find((s) => s.id === setId)!.drawings.map((d) => d.key)).toEqual(['A', 'D', 'X', 'E']);
    p = putDrawing(p, setId, { key: 'E', name: 'E2.png', items });
    expect(p.drawingSets.find((s) => s.id === setId)!.drawings.at(-1)!.name).toBe('E2.png');
    p = removeDrawing(p, setId, 'E');
    expect(p.drawingSets.find((s) => s.id === setId)!.drawings.map((d) => d.key)).toEqual(['A', 'D', 'X']);
  });

  it('flattens an imported part tree into items', () => {
    const { project } = head();
    const inner = createPart({ name: 'dot', kind: 'shape', rest: { x: 10, y: 0, rotation: 0, scaleX: 2, scaleY: 2 }, paths: [rectPath(0, 0, 1, 1)], style: { fill: '#000', stroke: null, strokeWidth: 0, lineCap: 'round', lineJoin: 'round', fillRule: 'nonzero' } });
    const root = createPart({ name: 'svg', kind: 'group', children: [inner] });
    const items = partTreeItems(project, root);
    expect(items).toHaveLength(1);
    const b = drawingItemsBounds(items, [1, 0, 0, 1, 0, 0]);
    expect([b.minX, b.maxX]).toEqual([10, 12]);
  });
});
