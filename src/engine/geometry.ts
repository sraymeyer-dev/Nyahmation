import type { PathPoint, ShapeStyle, Vec2, VectorPath } from './types';

// Primitive shapes are created as ordinary editable paths (docs/DESIGN.md D-13).

/** Handle length that makes a 4-point cubic Bézier circle (error < 0.03%). */
const KAPPA = 0.5522847498;

export function rectPath(x: number, y: number, width: number, height: number): VectorPath {
  return {
    closed: true,
    points: [
      { anchor: { x, y } },
      { anchor: { x: x + width, y } },
      { anchor: { x: x + width, y: y + height } },
      { anchor: { x, y: y + height } },
    ],
  };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): VectorPath {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    points: [
      { anchor: { x: cx, y: cy - ry }, handleIn: { x: -kx, y: 0 }, handleOut: { x: kx, y: 0 } },
      { anchor: { x: cx + rx, y: cy }, handleIn: { x: 0, y: -ky }, handleOut: { x: 0, y: ky } },
      { anchor: { x: cx, y: cy + ry }, handleIn: { x: kx, y: 0 }, handleOut: { x: -kx, y: 0 } },
      { anchor: { x: cx - rx, y: cy }, handleIn: { x: 0, y: ky }, handleOut: { x: 0, y: -ky } },
    ],
  };
}

export function polygonPath(points: Vec2[], closed = true): VectorPath {
  return { closed, points: points.map((anchor) => ({ anchor })) };
}

export function defaultStyle(overrides: Partial<ShapeStyle> = {}): ShapeStyle {
  return {
    fill: '#cccccc',
    stroke: '#222222',
    strokeWidth: 2,
    lineCap: 'round',
    lineJoin: 'round',
    fillRule: 'nonzero',
    ...overrides,
  };
}

export type PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { op: 'Z' };

function segment(from: PathPoint, to: PathPoint): PathCommand {
  if (!from.handleOut && !to.handleIn) return { op: 'L', x: to.anchor.x, y: to.anchor.y };
  const out = from.handleOut ?? { x: 0, y: 0 };
  const inn = to.handleIn ?? { x: 0, y: 0 };
  return {
    op: 'C',
    c1x: from.anchor.x + out.x,
    c1y: from.anchor.y + out.y,
    c2x: to.anchor.x + inn.x,
    c2y: to.anchor.y + inn.y,
    x: to.anchor.x,
    y: to.anchor.y,
  };
}

/** Converts a path to drawing commands (maps 1:1 onto Canvas Path2D and SVG path data). */
export function pathCommands(path: VectorPath): PathCommand[] {
  const pts = path.points;
  const first = pts[0];
  if (!first) return [];
  const cmds: PathCommand[] = [{ op: 'M', x: first.anchor.x, y: first.anchor.y }];
  for (let i = 1; i < pts.length; i++) cmds.push(segment(pts[i - 1]!, pts[i]!));
  if (path.closed && pts.length > 1) {
    cmds.push(segment(pts[pts.length - 1]!, first));
    cmds.push({ op: 'Z' });
  }
  return cmds;
}

/** SVG path data, e.g. for debugging and later SVG export of a design. */
export function pathToSvgData(path: VectorPath): string {
  return pathCommands(path)
    .map((c) => {
      switch (c.op) {
        case 'M':
        case 'L':
          return `${c.op}${c.x} ${c.y}`;
        case 'C':
          return `C${c.c1x} ${c.c1y} ${c.c2x} ${c.c2y} ${c.x} ${c.y}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}
