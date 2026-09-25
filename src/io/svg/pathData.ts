import type { PathPoint, Vec2, VectorPath } from '../../engine/types';

// Parses SVG path data (the `d` attribute) into Nyahmation paths. Supports
// every command (M L H V C S Q T A Z, absolute and relative). Quadratic
// curves and arcs are converted to cubic Béziers exactly or (for arcs) to
// within a tiny fraction of a pixel.

class Scanner {
  private i = 0;
  constructor(private readonly s: string) {}

  private skipSeparators(): void {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i]!)) this.i++;
  }

  done(): boolean {
    this.skipSeparators();
    return this.i >= this.s.length;
  }

  peekCommand(): string | null {
    this.skipSeparators();
    const c = this.s[this.i];
    return c !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(c) ? c : null;
  }

  readCommand(): string {
    const c = this.peekCommand();
    if (!c) throw new Error(`Expected a path command at position ${this.i}`);
    this.i++;
    return c;
  }

  hasNumber(): boolean {
    this.skipSeparators();
    return this.i < this.s.length && /[-+.\d]/.test(this.s[this.i]!);
  }

  readNumber(): number {
    this.skipSeparators();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`Expected a number at position ${this.i}`);
    this.i += m[0].length;
    return Number(m[0]);
  }

  /** Arc flags are single digits and may be written without separators ("a1 1 0 01 5 5"). */
  readFlag(): boolean {
    this.skipSeparators();
    const c = this.s[this.i];
    if (c !== '0' && c !== '1') throw new Error(`Expected an arc flag at position ${this.i}`);
    this.i++;
    return c === '1';
  }
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const same = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** Splits an SVG arc into cubic segments: [control1, control2, end][] (SVG spec, appendix F.6). */
export function arcToCubics(
  from: Vec2,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Vec2,
): [Vec2, Vec2, Vec2][] {
  if (same(from, to)) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[from, to, to]];
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (from.x + to.x) / 2;
  const cy = sin * cxp + cos * cyp + (from.y + to.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const count = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9));
  const delta = dtheta / count;
  const k = (4 / 3) * Math.tan(delta / 4);
  const map = (px: number, py: number): Vec2 => ({
    x: cx + rx * cos * px - ry * sin * py,
    y: cy + rx * sin * px + ry * cos * py,
  });
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < count; i++) {
    const a = theta1 + i * delta;
    const b = a + delta;
    const c1 = map(Math.cos(a) - k * Math.sin(a), Math.sin(a) + k * Math.cos(a));
    const c2 = map(Math.cos(b) + k * Math.sin(b), Math.sin(b) - k * Math.cos(b));
    const end = i === count - 1 ? to : map(Math.cos(b), Math.sin(b));
    out.push([c1, c2, end]);
  }
  return out;
}

/** Parses path data. Throws on malformed data, returning nothing partial. */
export function parsePathData(d: string): VectorPath[] {
  const sc = new Scanner(d);
  const paths: VectorPath[] = [];
  let points: PathPoint[] = [];
  let current: Vec2 = { x: 0, y: 0 };
  let start: Vec2 = { x: 0, y: 0 };
  // Last control point, for the smooth S and T commands.
  let lastCubicCtrl: Vec2 | null = null;
  let lastQuadCtrl: Vec2 | null = null;

  const finish = (closed: boolean) => {
    if (points.length === 0) return;
    if (closed && points.length > 1) {
      const first = points[0]!;
      const last = points[points.length - 1]!;
      // A closing segment drawn explicitly back to the start merges into the first point.
      if (same(first.anchor, last.anchor)) {
        points.pop();
        const merged: PathPoint = { ...first };
        if (last.handleIn) merged.handleIn = last.handleIn;
        points[0] = merged;
      }
    }
    if (points.length > 1) paths.push({ closed, points });
    points = [];
  };

  const lineTo = (p: Vec2) => {
    if (points.length === 0) points.push({ anchor: current });
    points.push({ anchor: p });
    current = p;
  };

  const cubicTo = (c1: Vec2, c2: Vec2, p: Vec2) => {
    if (points.length === 0) points.push({ anchor: current });
    const last = points[points.length - 1]!;
    const out = sub(c1, current);
    if (out.x !== 0 || out.y !== 0) points[points.length - 1] = { ...last, handleOut: out };
    const inn = sub(c2, p);
    points.push(inn.x !== 0 || inn.y !== 0 ? { anchor: p, handleIn: inn } : { anchor: p });
    current = p;
  };

  let cmd = '';
  while (!sc.done()) {
    const next = sc.peekCommand();
    if (next) cmd = sc.readCommand();
    else if (!cmd) throw new Error('Path data must start with a command');
    else if (cmd === 'M') cmd = 'L'; // extra pairs after a moveto are linetos
    else if (cmd === 'm') cmd = 'l';

    const rel = cmd === cmd.toLowerCase();
    const pt = (): Vec2 => {
      const x = sc.readNumber();
      const y = sc.readNumber();
      return rel ? { x: current.x + x, y: current.y + y } : { x, y };
    };
    const upper = cmd.toUpperCase();
    let cubicCtrl: Vec2 | null = null;
    let quadCtrl: Vec2 | null = null;

    switch (upper) {
      case 'M': {
        finish(false);
        const p = pt();
        current = p;
        start = p;
        points = [{ anchor: p }];
        break;
      }
      case 'L':
        lineTo(pt());
        break;
      case 'H': {
        const x = sc.readNumber();
        lineTo({ x: rel ? current.x + x : x, y: current.y });
        break;
      }
      case 'V': {
        const y = sc.readNumber();
        lineTo({ x: current.x, y: rel ? current.y + y : y });
        break;
      }
      case 'C': {
        const c1 = pt();
        const c2 = pt();
        const p = pt();
        cubicTo(c1, c2, p);
        cubicCtrl = c2;
        break;
      }
      case 'S': {
        const c1 = lastCubicCtrl ? { x: 2 * current.x - lastCubicCtrl.x, y: 2 * current.y - lastCubicCtrl.y } : current;
        const c2 = pt();
        const p = pt();
        cubicTo(c1, c2, p);
        cubicCtrl = c2;
        break;
      }
      case 'Q':
      case 'T': {
        const q: Vec2 =
          upper === 'Q'
            ? pt()
            : lastQuadCtrl
              ? { x: 2 * current.x - lastQuadCtrl.x, y: 2 * current.y - lastQuadCtrl.y }
              : current;
        const p = pt();
        const p0 = current;
        cubicTo(
          { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
          { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
          p,
        );
        quadCtrl = q;
        break;
      }
      case 'A': {
        const rx = sc.readNumber();
        const ry = sc.readNumber();
        const rot = sc.readNumber();
        const large = sc.readFlag();
        const sweep = sc.readFlag();
        const p = pt();
        for (const [c1, c2, end] of arcToCubics(current, rx, ry, rot, large, sweep, p)) {
          if (same(c1, current) && same(c2, end)) lineTo(end);
          else cubicTo(c1, c2, end);
        }
        current = p;
        break;
      }
      case 'Z':
        finish(true);
        current = start;
        // A drawing command straight after Z starts a new subpath at the start point.
        points = [];
        cmd = rel ? 'z' : 'Z';
        break;
    }
    lastCubicCtrl = cubicCtrl;
    lastQuadCtrl = quadCtrl;
    // After Z the command letter must be repeated explicitly.
    if (upper === 'Z' && sc.hasNumber()) throw new Error('Numbers after Z need a new command');
  }
  finish(false);
  return paths;
}
