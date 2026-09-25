import { describe, expect, it } from 'vitest';
import { insertPart, locatePart, restWorldMatrix, walkParts } from '../engine/edit';
import { rectPath } from '../engine/geometry';
import { createLayer, createPart, createProject } from '../engine/project';
import type { Project } from '../engine/types';
import { insertLibraryItem, itemFromLayer, itemFromParts, packLibraryItem, readLibraryMeta, unpackLibraryItem } from './libraryItem';

function sample() {
  const photo = createPart({ name: 'Photo', kind: 'image', image: { assetId: 'img1', width: 10, height: 10 } });
  const mouth = createPart({ name: 'Mouth', kind: 'switch', drawingSetId: 'set1', restDrawing: 'A' });
  const arm = createPart({ name: 'Arm', kind: 'shape', paths: [rectPath(0, 0, 10, 40)], rest: { x: 100, y: 50, rotation: 30, scaleX: 1, scaleY: 1 } });
  const layer = createLayer('character', 'Pip', [arm, mouth, photo]);
  const other = createLayer('background', 'Sky', []);
  let project: Project = createProject({ layers: [other, layer] });
  project = {
    ...project,
    drawingSets: [
      {
        id: 'set1',
        name: 'Mouths',
        vocabulary: 'mouth',
        drawings: [{ key: 'A', name: 'A', offset: { x: 0, y: 0 }, content: { kind: 'image', assetId: 'img2', width: 5, height: 5 } }],
      },
      { id: 'unused', name: 'Unused', vocabulary: 'custom', drawings: [] },
    ],
    assets: [
      { id: 'img1', name: 'photo.png', mimeType: 'image/png' },
      { id: 'img2', name: 'mouth.png', mimeType: 'image/png' },
      { id: 'img3', name: 'other.png', mimeType: 'image/png' },
    ],
  };
  const assets = new Map([
    ['img1', new Uint8Array([1])],
    ['img2', new Uint8Array([2])],
    ['img3', new Uint8Array([3])],
  ]);
  return { project, assets, layer, other, arm };
}

describe('library items', () => {
  it('a character keeps only the drawing sets and images it uses', () => {
    const { project, assets, layer } = sample();
    const item = itemFromLayer(project, assets, layer.id, 'Pip', ['kid']);
    expect(item.doc.kind).toBe('character');
    expect(item.doc.drawingSets.map((s) => s.id)).toEqual(['set1']);
    expect(item.doc.assets.map((a) => a.id).sort()).toEqual(['img1', 'img2']);
    expect([...item.assets.keys()].sort()).toEqual(['img1', 'img2']);
  });

  it('round-trips through a file, with a readable name, tags and thumbnail', () => {
    const { project, assets, layer } = sample();
    const bytes = packLibraryItem(itemFromLayer(project, assets, layer.id, 'Pip', ['kid']), new Uint8Array([9, 9]));
    const meta = readLibraryMeta(bytes);
    expect(meta).toMatchObject({ kind: 'character', name: 'Pip', tags: ['kid'] });
    expect([...meta.thumbnail!]).toEqual([9, 9]);
    const back = unpackLibraryItem(bytes);
    expect(back.doc.layer).toEqual(layer);
    expect([...back.assets.get('img2')!]).toEqual([2]);
  });

  it('adding an item twice makes two independent copies with fresh ids', () => {
    const { project, assets, layer } = sample();
    const item = unpackLibraryItem(packLibraryItem(itemFromLayer(project, assets, layer.id, 'Pip')));
    const once = insertLibraryItem(project, assets, item);
    const twice = insertLibraryItem(once.project, once.assets, item);
    const ids = twice.project.scene.layers.flatMap((l) => [...walkParts(l.root)].map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(twice.project.scene.layers.map((l) => l.name)).toEqual(['Sky', 'Pip', 'Pip', 'Pip']);
    // The copy points at its own drawing set and images.
    const copy = twice.project.scene.layers[3]!;
    const mouth = copy.root.children.find((p) => p.name === 'Mouth')!;
    const set = twice.project.drawingSets.find((s) => s.id === mouth.drawingSetId)!;
    expect(set.id).not.toBe('set1');
    const mouthImage = set.drawings[0]!.content;
    expect(mouthImage.kind === 'image' && twice.assets.get(mouthImage.assetId)).toEqual(new Uint8Array([2]));
    const photo = copy.root.children.find((p) => p.name === 'Photo')!;
    expect(twice.assets.get(photo.image!.assetId)).toEqual(new Uint8Array([1]));
  });

  it('shapes go back to the same place on screen, in any layer', () => {
    const { project, assets, arm, other } = sample();
    const before = restWorldMatrix(locatePart(project, arm.id)!);
    const item = unpackLibraryItem(packLibraryItem(itemFromParts(project, assets, [arm.id], 'Arm')));
    const moved = insertPart(project, other.root.id, createPart({ name: 'Frame', kind: 'group', rest: { x: 40, y: 0, rotation: 15, scaleX: 2, scaleY: 2 } }));
    const frame = locatePart(moved, other.root.id)!.part.children[0]!;
    const { project: p, partIds } = insertLibraryItem(moved, assets, item, { containerId: frame.id });
    const after = restWorldMatrix(locatePart(p, partIds[0]!)!);
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 6));
  });

  it('rejects files that are not library items', () => {
    expect(() => readLibraryMeta(new Uint8Array([1, 2, 3]))).toThrow(/damaged/);
    expect(() => unpackLibraryItem(new Uint8Array([1, 2, 3]))).toThrow(/damaged/);
  });
});
