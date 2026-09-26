import { describe, expect, it } from 'vitest';
import { cameraAt, cameraMatrix, defaultCamera, maxZoomForDepth, recordCamera } from './camera';
import { removeParts } from './edit';
import { evaluateScene, type ResolvedScene } from './evaluate';
import { applyToPoint, multiply } from './math';
import { defaultStyle, rectPath } from './geometry';
import { createPart, createProject, parseProject, PROJECT_VERSION } from './project';
import { setPartPose } from './tracks';
import { CAMERA_ID, type Layer, type Project } from './types';

const W = 1000;
const H = 500;

/** A character (Pip, with a head) and a second layer holding one shape, placed with `extra`. */
function scene(extra: Partial<Layer> = {}): { project: Project; head: string; tag: string } {
  const head = createPart({ name: 'Head', kind: 'shape', rest: { x: 0, y: -100, rotation: 0, scaleX: 1, scaleY: 1 }, joint: { pivot: { x: 0, y: 0 } } });
  const body = createPart({ name: 'Pip', kind: 'group', rest: { x: 400, y: 300, rotation: 0, scaleX: 1, scaleY: 1 }, children: [head] });
  // A 40×20 tag whose middle is at (470, 160).
  const tag = createPart({ name: 'Tag', kind: 'shape', rest: { x: 450, y: 150, rotation: 0, scaleX: 1, scaleY: 1 }, paths: [rectPath(0, 0, 40, 20)], style: defaultStyle() });
  const layers: Layer[] = [
    { id: 'pip', name: 'Pip', kind: 'character', root: body },
    { id: 'other', name: 'Other', kind: 'background', root: createPart({ name: 'Other', kind: 'group', children: [tag] }), ...extra },
  ];
  return { project: createProject({ width: W, height: H, layers }), head: head.id, tag: tag.id };
}

/** Where a part's origin ends up in the picture. */
function onScreen(r: ResolvedScene, id: string) {
  const part = r.parts.find((p) => p.id === id)!;
  return applyToPoint(multiply(r.cameraMatrix, part.world), { x: 0, y: 0 });
}

describe('camera', () => {
  it('shows the whole scene until it is posed', () => {
    const { project } = scene();
    expect(cameraAt(project, 10)).toEqual(defaultCamera(project.scene));
    cameraMatrix(defaultCamera(project.scene), W, H).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][i]!));
  });

  it('zooms around the stage point it looks at, and turns the picture the other way', () => {
    const zoomed = cameraMatrix({ x: 500, y: 250, zoom: 2, rotation: 0 }, W, H);
    expect(applyToPoint(zoomed, { x: 510, y: 250 })).toEqual({ x: 520, y: 250 });
    const turned = cameraMatrix({ x: 500, y: 250, zoom: 1, rotation: 90 }, W, H);
    // Turning the camera clockwise turns the picture anticlockwise: a point to the right moves up.
    const p = applyToPoint(turned, { x: 510, y: 250 });
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(240);
  });

  it('is posed like a part: the first pose after frame 0 keeps where it started', () => {
    let { project } = scene();
    project = recordCamera(project, 24, { x: 700, zoom: 2 });
    expect(cameraAt(project, 0)).toEqual(defaultCamera(project.scene));
    expect(cameraAt(project, 24)).toMatchObject({ x: 700, zoom: 2, y: 250 });
    const mid = cameraAt(project, 12);
    expect(mid.x).toBeGreaterThan(500);
    expect(mid.x).toBeLessThan(700);
    // Unchanged channels get no poses.
    expect(project.scene.tracks.filter((t) => t.partId === CAMERA_ID).map((t) => t.channel).sort()).toEqual(['x', 'zoom']);
  });

  it('knows its closest zoom, for the enlarged-PNG warning', () => {
    let { project } = scene();
    expect(maxZoomForDepth(project, 1)).toBe(1);
    project = recordCamera(project, 10, { zoom: 3 });
    expect(maxZoomForDepth(project, 1)).toBe(3);
    expect(maxZoomForDepth(project, 0.5)).toBeCloseTo(Math.sqrt(3));
    expect(maxZoomForDepth(project, 0)).toBe(1);
  });

  it('stays on ones when the characters are on twos', () => {
    let { project } = scene();
    project = recordCamera(project, 10, { x: 600 });
    project = { ...project, scene: { ...project.scene, stepping: 2 } };
    expect(evaluateScene(project, 3).camera.x).not.toBe(evaluateScene(project, 2).camera.x);
  });

  it('leaves poses and pins in stage coordinates: a stage layer does not move on the stage', () => {
    let { project, head } = scene();
    const before = evaluateScene(project, 5).parts.find((p) => p.id === head)!.world;
    project = recordCamera(project, 5, { x: 800, zoom: 3, rotation: 20 });
    const r = evaluateScene(project, 5);
    expect(r.parts.find((p) => p.id === head)!.world).toEqual(before);
    expect(r.layerMatrices.size).toBe(0);
  });
});

describe('parallax depth', () => {
  it('a layer at depth 0.5 pans half as far as the camera', () => {
    let { project, tag } = scene({ depth: 0.5 });
    const start = onScreen(evaluateScene(project, 0), tag);
    project = recordCamera(project, 10, { x: 600 });
    const moved = onScreen(evaluateScene(project, 10), tag);
    expect(moved.x).toBeCloseTo(start.x - 50);
  });

  it('a layer fixed to the camera (depth 0) stays put on screen, the same size', () => {
    let { project, tag } = scene({ depth: 0 });
    const start = onScreen(evaluateScene(project, 0), tag);
    project = recordCamera(project, 10, { x: 700, y: 100, zoom: 2.5, rotation: 30 });
    const r = evaluateScene(project, 10);
    const p = onScreen(r, tag);
    expect(p.x).toBeCloseTo(start.x);
    expect(p.y).toBeCloseTo(start.y);
    const m = multiply(r.cameraMatrix, r.parts.find((x) => x.id === tag)!.world);
    expect(Math.hypot(m[0], m[1])).toBeCloseTo(1);
    expect(m[1]).toBeCloseTo(0);
  });
});

describe('fixed to camera, following a part', () => {
  it('rides along with the part on screen, keeping its size and angle; its distance grows with the zoom', () => {
    const base = scene({ depth: 0 });
    let project = base.project;
    project = { ...project, scene: { ...project.scene, layers: project.scene.layers.map((l) => (l.id === 'other' ? { ...l, follow: { partId: base.head } } : l)) } };
    const start = onScreen(evaluateScene(project, 0), base.tag);
    expect(start).toEqual({ x: 450, y: 150 }); // where it was drawn

    // Pip walks right 200 while the camera zooms in and turns.
    const pipRoot = project.scene.layers[0]!.root.id;
    project = setPartPose(setPartPose(project, pipRoot, 'x', 0, 400), pipRoot, 'x', 20, 600);
    project = recordCamera(project, 20, { zoom: 2, rotation: 15 });
    const r = evaluateScene(project, 20);
    const head = r.parts.find((p) => p.id === base.head)!;
    const headNow = applyToPoint(multiply(r.cameraMatrix, head.world), { x: 0, y: 0 });
    const headRest = { x: 400, y: 200 };
    // The tag's middle keeps its place relative to the head's joint, twice as far at 200%.
    const middle = { x: onScreen(r, base.tag).x + 20, y: onScreen(r, base.tag).y + 10 };
    expect(middle.x).toBeCloseTo(headNow.x + 2 * (470 - headRest.x));
    expect(middle.y).toBeCloseTo(headNow.y + 2 * (160 - headRest.y));
    const m = multiply(r.cameraMatrix, r.parts.find((x) => x.id === base.tag)!.world);
    expect(m[0]).toBeCloseTo(1);
    expect(m[1]).toBeCloseTo(0);
  });

  it('stops following a part that is deleted, and stays fixed to the camera', () => {
    const base = scene({ depth: 0 });
    let project = { ...base.project, scene: { ...base.project.scene, layers: base.project.scene.layers.map((l) => (l.id === 'other' ? { ...l, follow: { partId: base.head } } : l)) } };
    project = removeParts(project, [base.head]);
    const layer = project.scene.layers.find((l) => l.id === 'other')!;
    expect(layer.follow).toBeUndefined();
    expect(layer.depth).toBe(0);
  });
});

describe('saved camera data', () => {
  it('loads camera poses and layer depths, and upgrades older files', () => {
    let { project } = scene({ depth: 0.4 });
    project = recordCamera(project, 5, { zoom: 1.5 });
    const loaded = parseProject(JSON.parse(JSON.stringify(project)));
    expect(cameraAt(loaded, 5).zoom).toBe(1.5);
    const old = parseProject({ ...JSON.parse(JSON.stringify(scene().project)), version: 3 });
    expect(old.version).toBe(PROJECT_VERSION);
  });

  it('rejects zoom on a part and unknown camera channels', () => {
    const { project, head } = scene();
    const bad = setPartPose(project, head, 'zoom', 0, 2);
    expect(() => parseProject(JSON.parse(JSON.stringify(bad)))).toThrow(/only the camera zooms/);
    const bad2 = setPartPose(project, CAMERA_ID, 'opacity', 0, 1);
    expect(() => parseProject(JSON.parse(JSON.stringify(bad2)))).toThrow(/camera has no opacity/);
  });
});
