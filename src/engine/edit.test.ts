import { describe, expect, it } from 'vitest';
import {
  addLayer,
  arrangeParts,
  combineShapes,
  duplicateParts,
  groupParts,
  insertPart,
  insertPartAtScene,
  insertShapeFromScene,
  locatePart,
  moveLayer,
  removeLayer,
  removeParts,
  reparentPart,
  restackPart,
  restWorldMatrix,
  subtreeBounds,
  topLevelSelection,
  ungroupPart,
  updatePart,
  walkParts,
} from './edit';
import { defaultStyle, rectPath } from './geometry';
import { applyToPoint, IDENTITY, type Mat2D } from './math';
import { createPart, createProject } from './project';
import { setPartPose } from './tracks';
import type { Part, Project } from './types';

const at = (x: number, y: number, rotation = 0, s = 1) => ({ x, y, rotation, scaleX: s, scaleY: s });
const box = (name: string, x: number, y: number, extra: Partial<Part> = {}) =>
  createPart({ name, kind: 'shape', rest: at(x, y), paths: [rectPath(-5, -5, 10, 10)], ...extra });

function scene() {
  let project = createProject();
  const bg = addLayer(project, 'background', 'Sky');
  project = bg.project;
  const ch = addLayer(project, 'character', 'Pip');
  project = ch.project;
  const a = box('a', 100, 100, { drawOrder: 0 });
  const b = box('b', 200, 100, { drawOrder: 1 });
  const c = box('c', 300, 100, { drawOrder: 2 });
  const arm = createPart({ name: 'arm', kind: 'group', rest: at(50, 50, 90, 2), children: [] });
  project = insertPart(project, ch.layer.root.id, a);
  project = insertPart(project, ch.layer.root.id, b);
  project = insertPart(project, ch.layer.root.id, c);
  project = insertPart(project, ch.layer.root.id, arm);
  return { project, sky: bg.layer, pip: ch.layer, a, b, c, arm };
}

const worldOf = (p: Project, id: string, point = { x: 0, y: 0 }) => applyToPoint(restWorldMatrix(locatePart(p, id)!), point);
const names = (p: Project, layerIndex: number) => {
  const root = p.scene.layers[layerIndex]!.root;
  return [...walkParts(root)].filter((x) => x !== root).sort((x, y) => x.drawOrder - y.drawOrder).map((x) => x.name);
};

describe('locatePart', () => {
  it('finds a part with its layer, parent and position', () => {
    const { project, pip, b } = scene();
    const loc = locatePart(project, b.id)!;
    expect(loc.layer.id).toBe(pip.id);
    expect(loc.parent?.id).toBe(pip.root.id);
    expect(loc.index).toBe(1);
    expect(locatePart(project, 'nope')).toBeUndefined();
  });
});

describe('updatePart / insert / remove', () => {
  it('changes only the targeted part and shares the rest', () => {
    const { project, a, b } = scene();
    const next = updatePart(project, a.id, (p) => ({ ...p, name: 'renamed' }));
    expect(locatePart(next, a.id)!.part.name).toBe('renamed');
    expect(locatePart(next, b.id)!.part).toBe(locatePart(project, b.id)!.part);
    expect(next.scene.layers[0]).toBe(project.scene.layers[0]);
  });

  it('removing a part removes its children and animation, but never a layer root', () => {
    const { project, a, arm, pip } = scene();
    let p = insertPart(project, arm.id, box('hand', 10, 0));
    p = setPartPose(p, a.id, 'x', 0, 1);
    const hand = locatePart(p, arm.id)!.part.children[0]!;
    p = setPartPose(p, hand.id, 'rotation', 0, 1);
    p = removeParts(p, [a.id, arm.id, pip.root.id]);
    expect(locatePart(p, a.id)).toBeUndefined();
    expect(locatePart(p, hand.id)).toBeUndefined();
    expect(locatePart(p, pip.root.id)).toBeDefined();
    expect(p.scene.tracks).toEqual([]);
  });
});

describe('reparentPart', () => {
  it('keeps the part in the same place on screen', () => {
    const { project, a, arm } = scene();
    const before = [worldOf(project, a.id), worldOf(project, a.id, { x: 5, y: 0 })];
    const p = reparentPart(project, a.id, arm.id);
    expect(locatePart(p, a.id)!.parent!.id).toBe(arm.id);
    const after = [worldOf(p, a.id), worldOf(p, a.id, { x: 5, y: 0 })];
    after.forEach((pt, i) => {
      expect(pt.x).toBeCloseTo(before[i]!.x);
      expect(pt.y).toBeCloseTo(before[i]!.y);
    });
  });

  it('refuses to put a part inside itself', () => {
    const { project, arm } = scene();
    const withChild = insertPart(project, arm.id, box('hand', 0, 0));
    const hand = locatePart(withChild, arm.id)!.part.children[0]!;
    expect(reparentPart(withChild, arm.id, hand.id)).toBe(withChild);
  });

  it('can move a part into another layer', () => {
    const { project, a, sky } = scene();
    const p = reparentPart(project, a.id, sky.root.id);
    expect(locatePart(p, a.id)!.layer.id).toBe(sky.id);
  });
});

describe('group and ungroup', () => {
  it('groups around the contents and ungroups back to the same positions', () => {
    const { project, a, b } = scene();
    const before = worldOf(project, b.id);
    const { project: grouped, groupId } = groupParts(project, [a.id, b.id], 'Pair');
    const group = locatePart(grouped, groupId!)!;
    expect(group.part.children.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(group.index).toBe(0);
    // Joint at the centre of both boxes: x from 95 to 205, y from 95 to 105.
    expect(group.part.joint.pivot.x).toBeCloseTo(150);
    expect(group.part.joint.pivot.y).toBeCloseTo(100);
    expect(worldOf(grouped, b.id).x).toBeCloseTo(before.x);

    const { project: ungrouped, childIds } = ungroupPart(grouped, groupId!);
    expect(childIds).toEqual([a.id, b.id]);
    expect(locatePart(ungrouped, groupId!)).toBeUndefined();
    expect(locatePart(ungrouped, a.id)!.index).toBe(0);
    expect(worldOf(ungrouped, b.id).x).toBeCloseTo(before.x);
  });

  it('ignores parts already inside another selected part', () => {
    const { project, arm } = scene();
    const p = insertPart(project, arm.id, box('hand', 0, 0));
    const hand = locatePart(p, arm.id)!.part.children[0]!;
    expect(topLevelSelection(p, [hand.id, arm.id])).toEqual([arm.id]);
  });
});

describe('combineShapes', () => {
  it('merges paths into the first shape at the same screen positions', () => {
    const { project, a, b } = scene();
    const { project: p, shapeId } = combineShapes(project, [a.id, b.id]);
    expect(shapeId).toBe(a.id);
    expect(locatePart(p, b.id)).toBeUndefined();
    const merged = locatePart(p, a.id)!;
    expect(merged.part.paths).toHaveLength(2);
    const bounds = subtreeBounds(p, merged.part, restWorldMatrix(merged));
    expect(bounds.minX).toBeCloseTo(95);
    expect(bounds.maxX).toBeCloseTo(205);
  });
});

describe('duplicateParts', () => {
  it('copies parts with new ids, on top, with their animation', () => {
    const { project, a } = scene();
    const animated = setPartPose(project, a.id, 'rotation', 5, 45);
    const { project: p, ids } = duplicateParts(animated, [a.id]);
    const copy = locatePart(p, ids[0]!)!;
    expect(copy.part.id).not.toBe(a.id);
    expect(copy.part.name).toBe('a copy');
    expect(copy.part.rest.x).toBe(120);
    expect(copy.index).toBe(1);
    expect(names(p, 1).at(-1)).toBe('a copy');
    expect(p.scene.tracks.filter((t) => t.partId === copy.part.id)).toHaveLength(1);
  });
});

describe('arrangeParts', () => {
  it('moves parts forward, backward, to the front and to the back', () => {
    const { project, a, c } = scene();
    expect(names(project, 1)).toEqual(['a', 'arm', 'b', 'c']);
    expect(names(arrangeParts(project, [a.id], 'front'), 1)).toEqual(['arm', 'b', 'c', 'a']);
    expect(names(arrangeParts(project, [c.id], 'back'), 1)).toEqual(['c', 'a', 'arm', 'b']);
    expect(names(arrangeParts(project, [a.id], 'forward'), 1)).toEqual(['arm', 'a', 'b', 'c']);
    expect(names(arrangeParts(project, [c.id], 'backward'), 1)).toEqual(['a', 'arm', 'c', 'b']);
    // Already at the front: nothing changes.
    expect(names(arrangeParts(project, [c.id], 'forward'), 1)).toEqual(['a', 'arm', 'b', 'c']);
  });
});

describe('layers', () => {
  it('adds, moves and removes layers', () => {
    const { project, sky, pip, a } = scene();
    expect(project.scene.layers.map((l) => l.name)).toEqual(['Sky', 'Pip']);
    const moved = moveLayer(project, sky.id, 5);
    expect(moved.scene.layers.map((l) => l.id)).toEqual([pip.id, sky.id]);
    const withTrack = setPartPose(project, a.id, 'x', 0, 1);
    const removed = removeLayer(withTrack, pip.id);
    expect(removed.scene.layers.map((l) => l.id)).toEqual([sky.id]);
    expect(removed.scene.tracks).toEqual([]);
  });
});

describe('subtreeBounds', () => {
  it('covers children through their transforms', () => {
    const { project, arm } = scene();
    const p = insertPart(project, arm.id, box('hand', 10, 0));
    const loc = locatePart(p, arm.id)!;
    const identity: Mat2D = IDENTITY;
    // Arm: at (50,50), rotated 90°, scaled 2. Hand box centred 10 along the arm → (50, 70), size 20.
    const b = subtreeBounds(p, loc.part, restWorldMatrix(loc));
    expect(b.minX).toBeCloseTo(40);
    expect(b.maxY).toBeCloseTo(80);
    expect(subtreeBounds(p, loc.part, identity).minX).toBeCloseTo(5); // in the arm's own space
  });
});

describe('restackPart', () => {
  it('places a part just above or below another', () => {
    const { project, a, c } = scene();
    expect(names(restackPart(project, a.id, c.id, 'above'), 1)).toEqual(['arm', 'b', 'c', 'a']);
    expect(names(restackPart(project, c.id, a.id, 'below'), 1)).toEqual(['c', 'a', 'arm', 'b']);
  });
});

describe('insertShapeFromScene', () => {
  it('converts scene outlines into the container and puts the joint at the centre', () => {
    const { project, arm } = scene();
    const { project: p, partId } = insertShapeFromScene(project, arm.id, [rectPath(40, 40, 20, 20)], defaultStyle(), 'Box');
    const loc = locatePart(p, partId!)!;
    expect(loc.parent!.id).toBe(arm.id);
    expect(loc.part.joint.pivot).toEqual({ x: 0, y: 0 });
    // The box still covers 40..60 in the scene, despite the arm's rotation and scale.
    const b = subtreeBounds(p, loc.part, restWorldMatrix(loc));
    expect(b.minX).toBeCloseTo(40);
    expect(b.maxY).toBeCloseTo(60);
    expect(names(p, 1).at(-1)).toBe('Box');
  });
});

describe('insertPartAtScene', () => {
  it('places a part so its drawing maps onto the scene as asked', () => {
    const { project, arm } = scene();
    const img = createPart({ name: 'Pic', kind: 'image', image: { assetId: 'x', width: 10, height: 10 }, joint: { pivot: { x: 5, y: 5 } } });
    const { project: p, partId } = insertPartAtScene(project, arm.id, img, [1, 0, 0, 1, 300, 200]);
    const corner = worldOf(p, partId!, { x: 0, y: 0 });
    expect(corner.x).toBeCloseTo(300);
    expect(corner.y).toBeCloseTo(200);
  });
});
