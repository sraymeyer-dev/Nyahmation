import { describe, expect, it } from 'vitest';
import { insertPart, locatePart, restWorldMatrix, walkParts } from '../engine/edit';
import { rectPath } from '../engine/geometry';
import { createLayer, createPart, createProject } from '../engine/project';
import type { Part, Project } from '../engine/types';
import { insertLibraryItem, itemFromLayer, itemFromParts, packLibraryItem, readLibraryMeta, unpackLibraryItem, updateLayerFromLibrary } from './libraryItem';

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
        drawings: [{ key: 'A', name: 'A', items: [{ kind: 'image', assetId: 'img2', x: 0, y: 0, width: 5, height: 5 }] }],
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
  it('pasting within a project shares its drawing sets and images instead of copying them', () => {
    const { project, assets, arm } = sample();
    const mouth = project.scene.layers[1]!.root.children.find((p) => p.name === 'Mouth')!;
    const item = itemFromParts(project, assets, [mouth.id, arm.id], 'Copy');
    const container = project.scene.layers[1]!.root.id;
    const shared = insertLibraryItem(project, assets, item, { containerId: container, reuseExisting: true });
    expect(shared.project.drawingSets).toHaveLength(project.drawingSets.length);
    expect(shared.project.assets).toHaveLength(project.assets.length);
    const pasted = locatePart(shared.project, shared.partIds.find((id) => locatePart(shared.project, id)!.part.name === 'Mouth')!)!.part;
    expect(pasted.drawingSetId).toBe('set1');
    // From the library (not a paste), everything is copied.
    const copied = insertLibraryItem(project, assets, item, { containerId: container });
    expect(copied.project.drawingSets).toHaveLength(project.drawingSets.length + 1);
  });

  it('a background keeps its depth and scrolling, but not a link to a part in another project', () => {
    const { project, assets, other, arm } = sample();
    const styled: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((l) =>
          l.id === other.id ? { ...l, depth: 0, follow: { partId: arm.id }, scroll: { speed: -30, repeat: true }, root: { ...l.root, children: [createPart({ name: 'Cloud', kind: 'shape', paths: [rectPath(0, 0, 50, 20)] })] } } : l,
        ),
      },
    };
    const item = unpackLibraryItem(packLibraryItem(itemFromLayer(styled, assets, other.id, 'Clouds', []), new Uint8Array()));
    expect(item.doc.kind).toBe('background');
    const inserted = insertLibraryItem(createProject(), new Map(), item);
    const layer = inserted.project.scene.layers[0]!;
    expect(layer.depth).toBe(0);
    expect(layer.scroll).toEqual({ speed: -30, repeat: true });
    expect(layer.follow).toBeUndefined();
  });

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
    const mouthImage = set.drawings[0]!.items[0]!;
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

describe('updating a layer from the library (L5)', () => {
  function libraryVersion(extra: Part[] = []) {
    const hand = createPart({ name: 'Hand', kind: 'shape', paths: [rectPath(0, 0, 5, 5)] });
    const arm = createPart({ name: 'Arm', kind: 'shape', paths: [rectPath(0, 0, 10, 40)], children: [hand] });
    const layer = createLayer('character', 'Pip', [arm, ...extra]);
    const project = createProject({ layers: [layer] });
    return { item: itemFromLayer(project, new Map(), layer.id, 'Pip'), arm, hand };
  }

  it('remembers where a layer came from, and keeps that through copies', () => {
    const { item, arm } = libraryVersion();
    const r = insertLibraryItem(createProject(), new Map(), item, { source: { relPath: 'Pip.nyahitem', savedAt: 100 } });
    const layer = r.project.scene.layers[0]!;
    expect(layer.source?.relPath).toBe('Pip.nyahitem');
    const armHere = layer.source!.parts[arm.id]!;
    expect(locatePart(r.project, armHere)?.part.name).toBe('Arm');
    // A copy of the layer (copy and paste) still links to the library, through its own ids.
    const copied = insertLibraryItem(r.project, new Map(), itemFromLayer(r.project, new Map(), layer.id, 'Pip'));
    const copy = copied.project.scene.layers[1]!;
    expect(copy.source?.relPath).toBe('Pip.nyahitem');
    expect(copy.source!.parts[arm.id]).not.toBe(armHere);
    expect(locatePart(copied.project, copy.source!.parts[arm.id]!)?.layer.id).toBe(copy.id);
  });

  it('brings in the new drawings and parts, keeping the animation of parts that are still there', () => {
    const v1 = libraryVersion();
    let r = insertLibraryItem(createProject(), new Map(), v1.item, { source: { relPath: 'Pip.nyahitem', savedAt: 100 } });
    let project = r.project;
    const layer = project.scene.layers[0]!;
    const armId = layer.source!.parts[v1.arm.id]!;
    const handId = layer.source!.parts[v1.hand.id]!;
    project = { ...project, scene: { ...project.scene, tracks: [{ partId: armId, channel: 'rotation', poses: [{ frame: 0, value: 0 }, { frame: 10, value: 45 }] }, { partId: handId, channel: 'rotation', poses: [{ frame: 0, value: 5 }] }] } };
    // Move the character in this project: that stays.
    project = { ...project, scene: { ...project.scene, layers: project.scene.layers.map((l) => ({ ...l, root: { ...l.root, rest: { ...l.root.rest, x: 300 } } })) } };

    // Version 2 in the library: the arm is wider, the hand is gone, a hat is new. Same ids as version 1.
    const hat = createPart({ name: 'Hat', kind: 'shape', paths: [rectPath(0, 0, 30, 10)] });
    const v2doc = structuredClone(v1.item.doc);
    const arm2 = v2doc.layer!.root.children[0]!;
    arm2.paths = [rectPath(0, 0, 20, 40)];
    arm2.children = [];
    v2doc.layer!.root.children.push(hat);
    const u = updateLayerFromLibrary(project, new Map(), layer.id, { doc: v2doc, assets: new Map() }, 200);
    expect(u).toMatchObject({ kept: 2, added: 1, removed: 1 }); // root and arm kept, hat added, hand removed
    const after = u.project.scene.layers[0]!;
    const armAfter = locatePart(u.project, armId)!.part;
    expect(armAfter.paths![0]!.points[1]!.anchor.x).toBe(20);
    expect(u.project.scene.tracks.map((t) => t.partId)).toEqual([armId]); // the arm's poses stay; the hand's go
    expect(after.root.rest.x).toBe(300);
    expect(after.root.children.map((c) => c.name)).toEqual(['Arm', 'Hat']);
    expect(after.source!.savedAt).toBe(200);
    // Updating again keeps the same ids.
    const again = updateLayerFromLibrary(u.project, new Map(), layer.id, { doc: v2doc, assets: new Map() }, 300);
    expect(again).toMatchObject({ kept: 3, added: 0, removed: 0 });
  });
});
