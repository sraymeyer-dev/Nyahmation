import { applyToPoint, type Mat2D } from './math';
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

/**
 * A rectangle with round corners (clamped to fit). `ry` defaults to `rx`;
 * different values give elliptical corners, as SVG's <rect rx ry> does.
 */
export function roundedRectPath(x: number, y: number, width: number, height: number, rx: number, ry = rx): VectorPath {
  const w = Math.abs(width);
  const h = Math.abs(height);
  const rX = Math.max(0, Math.min(rx, w / 2));
  const rY = Math.max(0, Math.min(ry, h / 2));
  if (rX === 0 || rY === 0) return rectPath(x, y, width, height);
  const kx = rX * KAPPA;
  const ky = rY * KAPPA;
  const x2 = x + width;
  const y2 = y + height;
  return {
    closed: true,
    points: [
      { anchor: { x: x + rX, y }, handleIn: { x: -kx, y: 0 } },
      { anchor: { x: x2 - rX, y }, handleOut: { x: kx, y: 0 } },
      { anchor: { x: x2, y: y + rY }, handleIn: { x: 0, y: -ky } },
      { anchor: { x: x2, y: y2 - rY }, handleOut: { x: 0, y: ky } },
      { anchor: { x: x2 - rX, y: y2 }, handleIn: { x: kx, y: 0 } },
      { anchor: { x: x + rX, y: y2 }, handleOut: { x: -kx, y: 0 } },
      { anchor: { x, y: y2 - rY }, handleIn: { x: 0, y: ky } },
      { anchor: { x, y: y + rY }, handleOut: { x: 0, y: -ky } },
    ],
  };
}

/** A regular polygon with its first corner pointing straight up. */
export function regularPolygonPath(cx: number, cy: number, radius: number, sides: number): VectorPath {
  const n = Math.max(3, Math.round(sides));
  return polygonPath(
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
    }),
  );
}

/** A star with `points` tips, the first pointing straight up. */
export function starPath(cx: number, cy: number, outer: number, inner: number, points: number): VectorPath {
  const n = Math.max(3, Math.round(points));
  return polygonPath(
    Array.from({ length: n * 2 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const r = i % 2 === 0 ? outer : inner;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    }),
  );
}

// ---- Segments, bounds and transforms ----------------------------------------

/** A path segment as cubic Bézier control points (straight lines have c1 = p0, c2 = p3). */
export interface Cubic {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p3: Vec2;
  /** True when neither end has a handle. */
  straight: boolean;
}

/** Segment i runs from point i to point i+1 (the last wraps to 0 on closed paths). */
export function segmentCount(path: VectorPath): number {
  const n = path.points.length;
  if (n < 2) return 0;
  return path.closed ? n : n - 1;
}

export function getSegment(path: VectorPath, i: number): Cubic {
  const pts = path.points;
  const a = pts[i]!;
  const b = pts[(i + 1) % pts.length]!;
  const out = a.handleOut ?? { x: 0, y: 0 };
  const inn = b.handleIn ?? { x: 0, y: 0 };
  return {
    p0: a.anchor,
    c1: { x: a.anchor.x + out.x, y: a.anchor.y + out.y },
    c2: { x: b.anchor.x + inn.x, y: b.anchor.y + inn.y },
    p3: b.anchor,
    straight: !a.handleOut && !b.handleIn,
  };
}

export function cubicAt(c: Cubic, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y,
  };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const EMPTY_BOUNDS: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

export function isEmptyBounds(b: Bounds): boolean {
  return b.minX > b.maxX || b.minY > b.maxY;
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsOfPoints(points: Iterable<Vec2>): Bounds {
  let b = EMPTY_BOUNDS;
  for (const p of points) b = { minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) };
  return b;
}

/** Parameters in (0,1) where one coordinate of a cubic has a turning point. */
function extremaT(p0: number, c1: number, c2: number, p3: number): number[] {
  // Derivative is a quadratic a t² + b t + c.
  const a = -p0 + 3 * c1 - 3 * c2 + p3;
  const b = 2 * (p0 - 2 * c1 + c2);
  const c = c1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

/** The exact bounding box of a path (curves included, handles excluded). */
export function pathBounds(path: VectorPath): Bounds {
  const pts: Vec2[] = path.points.map((p) => p.anchor);
  for (let i = 0; i < segmentCount(path); i++) {
    const c = getSegment(path, i);
    if (c.straight) continue;
    for (const t of [...extremaT(c.p0.x, c.c1.x, c.c2.x, c.p3.x), ...extremaT(c.p0.y, c.c1.y, c.c2.y, c.p3.y)]) {
      pts.push(cubicAt(c, t));
    }
  }
  return boundsOfPoints(pts);
}

export function pathsBounds(paths: readonly VectorPath[]): Bounds {
  return paths.reduce((b, p) => unionBounds(b, pathBounds(p)), EMPTY_BOUNDS);
}

/**
 * Applies an affine matrix to a path. Exact: an affine transform of a Bézier
 * curve is the Bézier curve of the transformed control points.
 */
export function transformPath(path: VectorPath, m: Mat2D): VectorPath {
  const vec = (v: Vec2): Vec2 => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y });
  return {
    closed: path.closed,
    points: path.points.map((p) => {
      const q: PathPoint = { anchor: applyToPoint(m, p.anchor) };
      if (p.handleIn) q.handleIn = vec(p.handleIn);
      if (p.handleOut) q.handleOut = vec(p.handleOut);
      return q;
    }),
  };
}

export function translatePath(path: VectorPath, dx: number, dy: number): VectorPath {
  return transformPath(path, [1, 0, 0, 1, dx, dy]);
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
