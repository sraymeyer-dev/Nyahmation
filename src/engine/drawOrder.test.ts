import { describe, expect, it } from 'vitest';
import { arrangeOnFrame } from './drawOrder';
import { evaluateScene } from './evaluate';
import { createPart, createProject } from './project';
import type { Layer, Project } from './types';

/** Torso with a far arm (child, drawn behind) and a near arm; a leg beside the torso. */
function rig(): Project {
  const far = createPart({ name: 'Far arm', kind: 'shape', drawOrder: 0 });
  const near = createPart({ name: 'Near arm', kind: 'shape', drawOrder: 3 });
  const torso = createPart({ name: 'Torso', kind: 'shape', drawOrder: 2, children: [far, near] });
  const leg = createPart({ name: 'Leg', kind: 'shape', drawOrder: 1 });
  const root = createPart({ name: 'Pip', kind: 'group', children: [leg, torso] });
  const layer: Layer = { id: 'pip', name: 'Pip', kind: 'character', root };
  return createProject({ layers: [layer] });
}

const idOf = (p: Project, name: string) => {
  const find = (part: Project['scene']['layers'][0]['root']): string | undefined => (part.name === name ? part.id : part.children.map(find).find(Boolean));
  return find(p.scene.layers[0]!.root)!;
};
const orderAt = (p: Project, f: number) => evaluateScene(p, f).parts.filter((x) => x.kind !== 'group').map((x) => x.name);

describe('draw-order swaps on a frame', () => {
  it('moves the near arm behind the torso from frame 12, leaving earlier frames alone', () => {
    const p = rig();
    expect(orderAt(p, 0)).toEqual(['Far arm', 'Leg', 'Torso', 'Near arm']);
    const { project, moved } = arrangeOnFrame(p, 12, [idOf(p, 'Near arm')], 'backward');
    expect(moved).toEqual([idOf(p, 'Near arm')]);
    expect(orderAt(project, 11)).toEqual(['Far arm', 'Leg', 'Torso', 'Near arm']);
    expect(orderAt(project, 12)).toEqual(['Far arm', 'Leg', 'Near arm', 'Torso']);
    // Only the moved part gets poses: its old value on frame 0, the new one on 12.
    const tracks = project.scene.tracks.filter((t) => t.channel === 'drawOrder');
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.poses.map((x) => x.frame)).toEqual([0, 12]);
  });

  it('brings to front and sends to back', () => {
    const p = rig();
    const back = arrangeOnFrame(p, 5, [idOf(p, 'Near arm')], 'back').project;
    expect(orderAt(back, 5)[0]).toBe('Near arm');
    const front = arrangeOnFrame(p, 5, [idOf(p, 'Far arm')], 'front').project;
    expect(orderAt(front, 5).at(-1)).toBe('Far arm');
  });

  it('builds on earlier swaps', () => {
    const p = rig();
    let project = arrangeOnFrame(p, 10, [idOf(p, 'Near arm')], 'backward').project;
    project = arrangeOnFrame(project, 20, [idOf(p, 'Near arm')], 'forward').project;
    expect(orderAt(project, 15)).toEqual(['Far arm', 'Leg', 'Near arm', 'Torso']);
    expect(orderAt(project, 20)).toEqual(['Far arm', 'Leg', 'Torso', 'Near arm']);
  });

  it('does nothing when the part is already there', () => {
    const p = rig();
    const r = arrangeOnFrame(p, 3, [idOf(p, 'Near arm')], 'front');
    expect(r.project).toBe(p);
    expect(r.moved).toEqual([]);
  });

  it('renumbers when neighbours share a number', () => {
    const a = createPart({ name: 'A', kind: 'shape', drawOrder: 0 });
    const b = createPart({ name: 'B', kind: 'shape', drawOrder: 0 });
    const c = createPart({ name: 'C', kind: 'shape', drawOrder: 0 });
    const root = createPart({ name: 'R', kind: 'group', children: [a, b, c] });
    const p = createProject({ layers: [{ id: 'l', name: 'R', kind: 'background', root }] });
    const { project } = arrangeOnFrame(p, 0, [c.id], 'backward');
    expect(orderAt(project, 0)).toEqual(['A', 'C', 'B']);
  });
});
