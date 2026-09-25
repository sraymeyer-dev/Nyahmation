import { defaultStyle, ellipsePath, polygonPath, rectPath } from '../../engine/geometry';
import { createPart, createProject } from '../../engine/project';
import { setPartPose } from '../../engine/tracks';
import type { Channel, ChannelValue, DrawingSet, Ease, Part, Project } from '../../engine/types';

// A small built-in puppet that waves and says "Hi!", so the engine can be
// seen working before the editing tools exist (phase 0 test harness).

const SKIN = defaultStyle({ fill: '#f2c9a0', stroke: '#3b2a20', strokeWidth: 4 });
const SHIRT = defaultStyle({ fill: '#5b8def', stroke: '#23386b', strokeWidth: 4 });
const TROUSERS = defaultStyle({ fill: '#3d3f52', stroke: '#1d1e29', strokeWidth: 4 });
const DARK = defaultStyle({ fill: '#2b1d17', stroke: null, strokeWidth: 0 });
const LIP = defaultStyle({ fill: '#7a2b2b', stroke: '#3b1515', strokeWidth: 3 });
const LINE = defaultStyle({ fill: null, stroke: '#3b1515', strokeWidth: 4 });

const at = (x: number, y: number, rotation = 0) => ({ x, y, rotation, scaleX: 1, scaleY: 1 });

function limb(name: string, x: number, y: number, length: number, width: number, style = SHIRT, children: Part[] = [], drawOrder = 0): Part {
  return createPart({
    name,
    kind: 'shape',
    rest: at(x, y),
    drawOrder,
    paths: [rectPath(-width / 2, -width / 2, width, length + width / 2)],
    style,
    children,
  });
}

const MOUTHS: DrawingSet = {
  id: 'pip-mouths',
  name: 'Pip mouths',
  vocabulary: 'mouth',
  drawings: [
    { key: 'X', name: 'Rest', offset: { x: 0, y: 0 }, content: { kind: 'vector', style: LINE, paths: [
      { closed: false, points: [
        { anchor: { x: -22, y: 0 }, handleOut: { x: 10, y: 8 } },
        { anchor: { x: 22, y: 0 }, handleIn: { x: -10, y: 8 } },
      ] },
    ] } },
    { key: 'A', name: 'Closed (M, B, P)', offset: { x: 0, y: 0 }, content: { kind: 'vector', style: LINE, paths: [
      polygonPath([{ x: -20, y: 0 }, { x: 20, y: 0 }], false),
    ] } },
    { key: 'B', name: 'Teeth together', offset: { x: 0, y: 0 }, content: { kind: 'vector', style: LIP, paths: [ellipsePath(0, 0, 22, 7)] } },
    { key: 'C', name: 'Open', offset: { x: 0, y: 0 }, content: { kind: 'vector', style: LIP, paths: [ellipsePath(0, 2, 20, 14)] } },
    { key: 'D', name: 'Wide open', offset: { x: 0, y: 0 }, content: { kind: 'vector', style: LIP, paths: [ellipsePath(0, 6, 24, 22)] } },
  ],
};

export function createDemoProject(): Project {
  const hand = createPart({ name: 'Hand', kind: 'shape', rest: at(0, 95), drawOrder: 6, paths: [ellipsePath(0, 18, 20, 22)], style: SKIN });
  const forearm = limb('Forearm (front)', 0, 100, 95, 30, SHIRT, [hand], 6);
  const upperArm = limb('Upper arm (front)', 62, -228, 100, 34, SHIRT, [forearm], 6);

  const backForearm = limb('Forearm (back)', 0, 100, 95, 30, SHIRT, [
    createPart({ name: 'Hand (back)', kind: 'shape', rest: at(0, 95), paths: [ellipsePath(0, 18, 20, 22)], style: SKIN }),
  ]);
  const backArm = limb('Upper arm (back)', -62, -228, 100, 34, SHIRT, [backForearm]);

  const mouth = createPart({ name: 'Mouth', kind: 'switch', rest: at(0, -48), drawOrder: 5, drawingSetId: MOUTHS.id, restDrawing: 'X' });
  const eyes = createPart({
    name: 'Eyes',
    kind: 'shape',
    rest: at(0, -110),
    drawOrder: 5,
    paths: [ellipsePath(-32, 0, 9, 13), ellipsePath(32, 0, 9, 13)],
    style: DARK,
  });
  const head = createPart({
    name: 'Head',
    kind: 'shape',
    rest: at(0, -262),
    drawOrder: 4,
    paths: [ellipsePath(0, -95, 92, 95)],
    style: SKIN,
    children: [eyes, mouth],
  });
  const torso = createPart({
    name: 'Torso',
    kind: 'shape',
    rest: at(0, 0),
    drawOrder: 3,
    paths: [ellipsePath(0, -135, 82, 140)],
    style: SHIRT,
    children: [backArm, head, upperArm],
  });
  const legs = [-38, 38].map((x) => limb(x < 0 ? 'Leg (left)' : 'Leg (right)', x, 0, 210, 44, TROUSERS, [], 1));
  const root = createPart({ name: 'Pip', kind: 'group', rest: at(960, 700), children: [...legs, torso] });

  let project = createProject({
    width: 1920,
    height: 1080,
    fps: 24,
    durationFrames: 72,
    background: '#fdf6e3',
    characters: [{ id: 'pip', name: 'Pip', root }],
  });
  project = { ...project, drawingSets: [MOUTHS] };

  const pose = <C extends Channel>(part: Part, channel: C, keys: [number, ChannelValue<C>, Ease?][]) => {
    for (const [frame, value, ease] of keys) project = setPartPose(project, part.id, channel, frame, value, ease);
  };

  // Raise the arm, wave three times, lower it.
  pose(upperArm, 'rotation', [[0, -8], [14, -155], [22, -135], [30, -155], [38, -135], [46, -155], [62, -8]]);
  pose(forearm, 'rotation', [[0, 0], [14, -25], [22, 35], [30, -25], [38, 35], [46, -25], [62, 0]]);
  pose(backArm, 'rotation', [[0, 8], [20, 14], [62, 8]]);
  pose(head, 'rotation', [[0, 0], [16, -7], [50, -7], [66, 0]]);
  pose(torso, 'rotation', [[0, 0], [16, -3], [50, -3], [66, 0]]);
  pose(root, 'y', [[0, 700], [10, 712], [18, 692], [62, 700]]);
  // "Hi!" — H (open), I (wide then teeth), back to rest.
  pose(mouth, 'drawing', [[0, 'X'], [16, 'C'], [18, 'D'], [22, 'B'], [26, 'X'], [44, 'A'], [46, 'X']]);
  pose(eyes, 'scaleY', [[0, 1, 'hold'], [52, 0.1, 'hold'], [54, 1]]);

  return project;
}
