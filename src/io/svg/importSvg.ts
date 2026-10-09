import {
  boundsOfPoints,
  ellipsePath,
  EMPTY_BOUNDS,
  isEmptyBounds,
  pathsBounds,
  polygonPath,
  rectPath,
  roundedRectPath,
  transformPath,
  translatePath,
  unionBounds,
  type Bounds,
} from '../../engine/geometry';
import { applyToPoint, decompose, IDENTITY, multiply, type Mat2D } from '../../engine/math';
import { createId, createPart } from '../../engine/project';
import type { Gradient, Part, ShapeStyle, Vec2, VectorPath } from '../../engine/types';
import { formatColor, parseColor, type RGBA } from './color';
import { parsePathData } from './pathData';
import { parseTransform } from './transform';

// SVG import (docs/DESIGN.md I1). The SVG's group structure becomes a tree of
// parts, ready to rig. Every transform is baked into the path coordinates
// (exact for Bézier curves), and each shape gets its joint at its centre.
// Things Nyahmation can't represent yet are skipped with a warning.

export interface ImportedAsset {
  id: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface SvgImportResult {
  /** A group containing the whole drawing, in SVG pixels. */
  root: Part;
  /** The SVG's own canvas size in pixels. */
  width: number;
  height: number;
  /** Plain-language notes about anything that was skipped or simplified. */
  warnings: string[];
  /** Embedded raster images, to be added to the project's assets. */
  assets: ImportedAsset[];
}

const INHERITED = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-rule',
  'fill-opacity',
  'stroke-opacity',
  'color',
  'visibility',
] as const;
const OWN = ['opacity', 'display'] as const;
type Prop = (typeof INHERITED)[number] | (typeof OWN)[number];
type Style = Partial<Record<Prop, string>>;

const SKIPPED_ELEMENTS = new Set([
  'defs',
  'style',
  'title',
  'desc',
  'metadata',
  'linearGradient',
  'radialGradient',
  'pattern',
  'symbol',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'script',
  'foreignObject',
]);

interface CssRule {
  selector: { tag: string | null; ids: string[]; classes: string[] };
  specificity: number;
  order: number;
  decls: Style;
}

function parseDeclarations(text: string): Style {
  const style: Style = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase() as Prop;
    const value = decl.slice(i + 1).replace(/!important/, '').trim();
    if ((INHERITED as readonly string[]).includes(prop) || (OWN as readonly string[]).includes(prop)) style[prop] = value;
  }
  return style;
}

function parseCss(text: string, startOrder: number): CssRule[] {
  const rules: CssRule[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  let order = startOrder;
  while ((m = re.exec(clean))) {
    const decls = parseDeclarations(m[2]!);
    for (const raw of m[1]!.split(',')) {
      const sel = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)$/.exec(raw.trim());
      if (!sel) continue; // descendant/attribute selectors etc. aren't supported
      const tag = sel[1] && sel[1] !== '*' ? sel[1] : null;
      const parts = sel[2]!.match(/[.#][\w-]+/g) ?? [];
      const ids = parts.filter((p) => p.startsWith('#')).map((p) => p.slice(1));
      const classes = parts.filter((p) => p.startsWith('.')).map((p) => p.slice(1));
      rules.push({ selector: { tag, ids, classes }, specificity: ids.length * 100 + classes.length * 10 + (tag ? 1 : 0), order: order++, decls });
    }
  }
  return rules;
}

function parseLength(value: string | null | undefined, reference = 0): number | null {
  if (value == null) return null;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|%)?\s*$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'pt':
      return (n * 4) / 3;
    case 'pc':
      return n * 16;
    case 'mm':
      return (n * 96) / 25.4;
    case 'cm':
      return (n * 96) / 2.54;
    case 'in':
      return n * 96;
    case 'em':
      return n * 16;
    case '%':
      return (n / 100) * reference;
    default:
      return n;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Parses SVG text. Throws an Error with a readable message if it isn't valid SVG. */
export function importSvg(text: string, name: string): SvgImportResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`"${name}" isn't a valid SVG file.`);
  }
  return new SvgImporter(doc, name).run(svg);
}

class SvgImporter {
  private readonly warnings = new Map<string, number>();
  private readonly assets: ImportedAsset[] = [];
  private readonly rules: CssRule[] = [];
  private readonly byId = new Map<string, Element>();
  private readonly counters = new Map<string, number>();
  private drawOrder = 0;
  private useDepth = 0;

  constructor(
    doc: Document,
    private readonly fileName: string,
  ) {
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i]!;
      const id = el.getAttribute('id');
      if (id) this.byId.set(id, el);
      if (el.localName === 'style') this.rules.push(...parseCss(el.textContent ?? '', this.rules.length));
    }
    this.rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  }

  run(svg: Element): SvgImportResult {
    const { matrix, width, height } = this.viewportMatrix(svg, IDENTITY);
    const root = createPart({ name: this.fileName.replace(/\.svg$/i, ''), kind: 'group' });
    const { children, bounds } = this.visitChildren(svg, this.styleOf(svg, {}), matrix);
    return {
      root: this.finishGroup(root, children, bounds),
      width,
      height,
      warnings: [...this.warnings].map(([msg, n]) => (n > 1 ? `${msg} (${n} times)` : msg)),
      assets: this.assets,
    };
  }

  private warn(message: string): void {
    this.warnings.set(message, (this.warnings.get(message) ?? 0) + 1);
  }

  /** Maps an <svg> element's viewBox onto its width/height (preserveAspectRatio: none or the default xMidYMid meet). */
  private viewportMatrix(svg: Element, parent: Mat2D): { matrix: Mat2D; width: number; height: number } {
    const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    const hasViewBox = vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0;
    const width = parseLength(svg.getAttribute('width'), hasViewBox ? vb[2] : 0) ?? (hasViewBox ? vb[2]! : 300);
    const height = parseLength(svg.getAttribute('height'), hasViewBox ? vb[3] : 0) ?? (hasViewBox ? vb[3]! : 150);
    const x = parseLength(svg.getAttribute('x')) ?? 0;
    const y = parseLength(svg.getAttribute('y')) ?? 0;
    let m = multiply(parent, [1, 0, 0, 1, x, y]);
    if (hasViewBox) {
      let sx = width / vb[2]!;
      let sy = height / vb[3]!;
      let tx = 0;
      let ty = 0;
      if (!/none/.test(svg.getAttribute('preserveAspectRatio') ?? '')) {
        const s = Math.min(sx, sy);
        tx = (width - vb[2]! * s) / 2;
        ty = (height - vb[3]! * s) / 2;
        sx = sy = s;
      }
      m = multiply(m, [sx, 0, 0, sy, tx - vb[0]! * sx, ty - vb[1]! * sy]);
    }
    return { matrix: m, width, height };
  }

  private styleOf(el: Element, inherited: Style): Style {
    const style: Style = {};
    for (const p of INHERITED) if (inherited[p] !== undefined) style[p] = inherited[p];
    for (const p of [...INHERITED, ...OWN]) {
      const v = el.getAttribute(p);
      if (v !== null) style[p] = v.trim();
    }
    const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const id = el.getAttribute('id');
    for (const rule of this.rules) {
      const s = rule.selector;
      if (s.tag && s.tag !== el.localName) continue;
      if (s.ids.some((x) => x !== id)) continue;
      if (s.classes.some((c) => !classes.includes(c))) continue;
      Object.assign(style, rule.decls);
    }
    const inline = el.getAttribute('style');
    if (inline) Object.assign(style, parseDeclarations(inline));
    for (const p of INHERITED) if (style[p] === 'inherit') style[p] = inherited[p];
    return style;
  }

  private nameOf(el: Element, fallback: string): string {
    const label = el.getAttribute('inkscape:label') ?? el.getAttribute('data-name') ?? el.getAttribute('id');
    if (label) return label;
    const n = (this.counters.get(fallback) ?? 0) + 1;
    this.counters.set(fallback, n);
    return `${fallback} ${n}`;
  }

  private visitChildren(el: Element, style: Style, matrix: Mat2D): { children: Part[]; bounds: Bounds } {
    const children: Part[] = [];
    let bounds = EMPTY_BOUNDS;
    for (let i = 0; i < el.children.length; i++) {
      const result = this.visit(el.children[i]!, style, matrix);
      if (result) {
        children.push(result.part);
        bounds = unionBounds(bounds, result.bounds);
      }
    }
    return { children, bounds };
  }

  /** Gives a group its joint at the centre of its contents (rest transform stays neutral). */
  private finishGroup(group: Part, children: Part[], bounds: Bounds): Part {
    const c = isEmptyBounds(bounds) ? { x: 0, y: 0 } : { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    return { ...group, children, rest: { ...group.rest, x: c.x, y: c.y }, joint: { pivot: c } };
  }

  private visit(el: Element, inherited: Style, parentMatrix: Mat2D): { part: Part; bounds: Bounds } | null {
    const tag = el.localName;
    if (SKIPPED_ELEMENTS.has(tag)) return null;
    const style = this.styleOf(el, inherited);
    if (style.display === 'none') return null;
    let matrix = multiply(parentMatrix, parseTransform(el.getAttribute('transform')));

    if (el.getAttribute('clip-path')) this.warn('Clipping paths were ignored. To clip parts to a shape, put them inside it and tick "Clip" in its Effects.');
    if (el.getAttribute('mask')) this.warn('Masks were ignored.');
    if (el.getAttribute('filter')) this.warn('Filters (such as blur or drop shadow) were ignored. Add them back with the Effects section in Properties.');

    let part: Part | null = null;
    let bounds: Bounds = EMPTY_BOUNDS;

    if (tag === 'g' || tag === 'a' || tag === 'switch' || tag === 'svg' || tag === 'use') {
      let content: { children: Part[]; bounds: Bounds };
      if (tag === 'use') {
        const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
        const target = href.startsWith('#') ? this.byId.get(href.slice(1)) : undefined;
        if (!target || this.useDepth > 8) {
          this.warn('Some <use> references could not be found and were skipped.');
          return null;
        }
        matrix = multiply(matrix, [1, 0, 0, 1, parseLength(el.getAttribute('x')) ?? 0, parseLength(el.getAttribute('y')) ?? 0]);
        this.useDepth++;
        content =
          target.localName === 'symbol'
            ? this.visitChildren(target, this.styleOf(target, style), matrix)
            : (() => {
                const r = this.visit(target, style, matrix);
                return r ? { children: [r.part], bounds: r.bounds } : { children: [], bounds: EMPTY_BOUNDS };
              })();
        this.useDepth--;
      } else {
        if (tag === 'svg') matrix = this.viewportMatrix(el, matrix).matrix;
        content = this.visitChildren(el, style, matrix);
      }
      if (content.children.length === 0) return null;
      const group = createPart({ name: this.nameOf(el, 'Group'), kind: 'group', drawOrder: this.drawOrder++ });
      part = this.finishGroup(group, content.children, content.bounds);
      bounds = content.bounds;
    } else if (tag === 'image') {
      const result = this.image(el, matrix);
      if (!result) return null;
      ({ part, bounds } = result);
    } else if (tag === 'text') {
      this.warn('Text was skipped. Convert text to outlines (paths) in your drawing app before exporting the SVG.');
      return null;
    } else {
      let paths: VectorPath[];
      try {
        paths = this.geometry(el);
      } catch {
        this.warn('Some shapes had damaged outline data and were skipped.');
        return null;
      }
      if (paths.length === 0) {
        if (!['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(tag)) this.warn(`Unsupported <${tag}> elements were skipped.`);
        return null;
      }
      const baked = paths.map((p) => transformPath(p, matrix));
      bounds = pathsBounds(baked);
      const c = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      part = createPart({
        name: this.nameOf(el, tag === 'path' ? 'Path' : tag[0]!.toUpperCase() + tag.slice(1)),
        kind: 'shape',
        rest: { x: c.x, y: c.y, rotation: 0, scaleX: 1, scaleY: 1 },
        drawOrder: this.drawOrder++,
        paths: baked.map((p) => translatePath(p, -c.x, -c.y)),
        style: this.shapeStyle(style, matrix, tag === 'line' || tag === 'polyline', { box: pathsBounds(paths), toDrawing: multiply([1, 0, 0, 1, -c.x, -c.y], matrix) }),
      });
    }

    const opacity = parseFloat(style.opacity ?? '1');
    if (Number.isFinite(opacity) && opacity < 1) part = { ...part, opacity: Math.max(0, opacity) };
    if (style.visibility === 'hidden' || style.visibility === 'collapse') part = { ...part, visible: false };
    return { part, bounds };
  }

  private geometry(el: Element): VectorPath[] {
    const num = (attr: string, ref = 0) => parseLength(el.getAttribute(attr), ref) ?? 0;
    const points = (): Vec2[] => {
      const n = (el.getAttribute('points') ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
      const out: Vec2[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i]!, y: n[i + 1]! });
      return out;
    };
    switch (el.localName) {
      case 'path':
        return parsePathData(el.getAttribute('d') ?? '');
      case 'rect': {
        const w = num('width');
        const h = num('height');
        if (w <= 0 || h <= 0) return [];
        const rxAttr = parseLength(el.getAttribute('rx'));
        const ryAttr = parseLength(el.getAttribute('ry'));
        const rx = rxAttr ?? ryAttr ?? 0;
        const ry = ryAttr ?? rxAttr ?? 0;
        return [rx > 0 && ry > 0 ? roundedRectPath(num('x'), num('y'), w, h, rx, ry) : rectPath(num('x'), num('y'), w, h)];
      }
      case 'circle': {
        const r = num('r');
        return r > 0 ? [ellipsePath(num('cx'), num('cy'), r, r)] : [];
      }
      case 'ellipse': {
        const rx = num('rx');
        const ry = num('ry');
        return rx > 0 && ry > 0 ? [ellipsePath(num('cx'), num('cy'), rx, ry)] : [];
      }
      case 'line':
        return [polygonPath([{ x: num('x1'), y: num('y1') }, { x: num('x2'), y: num('y2') }], false)];
      case 'polyline':
      case 'polygon': {
        const pts = points();
        return pts.length >= 2 ? [polygonPath(pts, el.localName === 'polygon')] : [];
      }
      default:
        return [];
    }
  }

  private paint(value: string | undefined, style: Style, fallback: string | null, onGradient?: (id: string) => void): RGBA | null {
    const v = (value ?? fallback)?.trim();
    if (!v || v === 'none') return null;
    const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/.exec(v);
    if (url) {
      const stop = this.firstGradientStop(url[1]!);
      if (stop) {
        if (onGradient) onGradient(url[1]!);
        else this.warn('Gradient outlines were simplified to a solid color (gradients work on fills).');
        return stop;
      }
      return url[2] ? parseColor(url[2]) : null;
    }
    if (v === 'currentColor') return parseColor(style.color ?? 'black');
    return parseColor(v);
  }

  private firstGradientStop(id: string, depth = 0): RGBA | null {
    const grad = this.byId.get(id);
    if (!grad || depth > 5) return null;
    const stops = [...grad.children].filter((c) => c.localName === 'stop');
    if (stops.length === 0) {
      const href = grad.getAttribute('href') ?? grad.getAttribute('xlink:href');
      return href?.startsWith('#') ? this.firstGradientStop(href.slice(1), depth + 1) : null;
    }
    const stop = stops[0]!;
    const inline = parseDeclarationsLoose(stop.getAttribute('style') ?? '');
    const color = parseColor(inline['stop-color'] ?? stop.getAttribute('stop-color') ?? 'black');
    const opacity = parseFloat(inline['stop-opacity'] ?? stop.getAttribute('stop-opacity') ?? '1');
    return color ? { ...color, a: color.a * (Number.isFinite(opacity) ? opacity : 1) } : null;
  }

  /**
   * A gradient fill (docs/DESIGN.md D10) in the shape's drawing coordinates.
   * `box` is the shape's bounds in its own user space (for objectBoundingBox
   * units); `toDrawing` maps user space to drawing coordinates.
   */
  private gradient(id: string, target: { box: Bounds; toDrawing: Mat2D }, opacity: number): Gradient | undefined {
    // Attributes and stops can be inherited through href.
    const chain: Element[] = [];
    for (let el = this.byId.get(id); el && chain.length < 6 && !chain.includes(el); ) {
      chain.push(el);
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
      el = href?.startsWith('#') ? this.byId.get(href.slice(1)) : undefined;
    }
    const kindEl = chain[0];
    if (!kindEl || (kindEl.localName !== 'linearGradient' && kindEl.localName !== 'radialGradient')) return undefined;
    const attr = (name: string) => chain.find((e) => e.hasAttribute(name))?.getAttribute(name) ?? null;
    const stopsEl = chain.find((e) => [...e.children].some((c) => c.localName === 'stop'));
    const stops: Gradient['stops'] = [];
    let last = 0;
    for (const stop of [...(stopsEl?.children ?? [])].filter((c) => c.localName === 'stop')) {
      const inline = parseDeclarationsLoose(stop.getAttribute('style') ?? '');
      const color = parseColor(inline['stop-color'] ?? stop.getAttribute('stop-color') ?? 'black');
      const a = parseFloat(inline['stop-opacity'] ?? stop.getAttribute('stop-opacity') ?? '1');
      const raw = stop.getAttribute('offset') ?? '0';
      const offset = Math.min(1, Math.max(last, raw.trim().endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw) || 0));
      last = offset;
      const css = color ? formatColor(color, (Number.isFinite(a) ? a : 1) * opacity) : null;
      if (css) stops.push({ offset, color: css });
    }
    if (stops.length === 0) return undefined;

    const box = target.box;
    const bbox = attr('gradientUnits') !== 'userSpaceOnUse';
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    // Gradient space → user space → drawing coordinates.
    let m = multiply(target.toDrawing, bbox ? [w, 0, 0, h, box.minX, box.minY] : IDENTITY);
    m = multiply(m, parseTransform(attr('gradientTransform')));
    const coord = (name: string, fallback: string) => {
      const v = (attr(name) ?? fallback).trim();
      return v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) || 0;
    };
    if (kindEl.localName === 'linearGradient') {
      const from = applyToPoint(m, { x: coord('x1', '0%'), y: coord('y1', '0%') });
      const to = applyToPoint(m, { x: coord('x2', '100%'), y: coord('y2', '0%') });
      return { kind: 'linear', from, to, stops };
    }
    const cx = coord('cx', '50%');
    const cy = coord('cy', '50%');
    const r = coord('r', '50%');
    const from = applyToPoint(m, { x: cx, y: cy });
    const rx = applyToPoint(m, { x: cx + r, y: cy });
    const ry = applyToPoint(m, { x: cx, y: cy + r });
    const a = Math.hypot(rx.x - from.x, rx.y - from.y);
    const b = Math.hypot(ry.x - from.x, ry.y - from.y);
    if (Math.abs(a - b) > 0.02 * Math.max(a, b)) this.warn('Oval (stretched) round gradients were made circular.');
    return { kind: 'radial', from, to: { x: from.x + Math.max(a, b), y: from.y }, stops };
  }

  private shapeStyle(style: Style, matrix: Mat2D, open: boolean, target?: { box: Bounds; toDrawing: Mat2D }): ShapeStyle {
    const found: { gradient?: string } = {};
    const fill = this.paint(style.fill, style, open ? 'none' : 'black', (id) => (found.gradient = id));
    const stroke = this.paint(style.stroke, style, 'none');
    const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
    const width = parseLength(style['stroke-width']) ?? 1;
    const fillOpacity = parseFloat(style['fill-opacity'] ?? '1');
    const strokeOpacity = parseFloat(style['stroke-opacity'] ?? '1');
    const cap = style['stroke-linecap'];
    const join = style['stroke-linejoin'];
    const fillGradient = fill && found.gradient && target ? this.gradient(found.gradient, target, Number.isFinite(fillOpacity) ? fillOpacity : 1) : undefined;
    return {
      ...(fillGradient ? { fillGradient } : {}),
      fill: fill ? formatColor(fill, Number.isFinite(fillOpacity) ? fillOpacity : 1) : null,
      stroke: stroke ? formatColor(stroke, Number.isFinite(strokeOpacity) ? strokeOpacity : 1) : null,
      strokeWidth: width * scale,
      lineCap: cap === 'round' || cap === 'square' ? cap : 'butt',
      lineJoin: join === 'round' || join === 'bevel' ? join : 'miter',
      fillRule: style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
    };
  }

  private image(el: Element, matrix: Mat2D): { part: Part; bounds: Bounds } | null {
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
    const data = /^data:(image\/(?:png|jpeg|jpg));base64,(.*)$/s.exec(href);
    if (!data) {
      this.warn('Linked (not embedded) images were skipped. Embed images in the SVG, or import them as PNG/JPG.');
      return null;
    }
    const width = parseLength(el.getAttribute('width'));
    const height = parseLength(el.getAttribute('height'));
    if (!width || !height) {
      this.warn('Images without a width and height were skipped.');
      return null;
    }
    const mimeType = data[1] === 'image/jpg' ? 'image/jpeg' : data[1]!;
    const id = createId();
    const name = this.nameOf(el, 'Image');
    this.assets.push({ id, name, mimeType, bytes: base64ToBytes(data[2]!) });
    const m = multiply(matrix, [1, 0, 0, 1, parseLength(el.getAttribute('x')) ?? 0, parseLength(el.getAttribute('y')) ?? 0]);
    const part = createPart({
      name,
      kind: 'image',
      rest: decompose(m, { x: 0, y: 0 }),
      drawOrder: this.drawOrder++,
      image: { assetId: id, width, height },
    });
    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ].map((p) => applyToPoint(m, p));
    return { part, bounds: boundsOfPoints(corners) };
  }
}

function parseDeclarationsLoose(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}
