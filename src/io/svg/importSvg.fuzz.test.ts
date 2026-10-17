// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { insertPartAtScene, walkParts } from '../../engine/edit';
import { createLayer, createProject, parseProject } from '../../engine/project';
import { importSvg } from './importSvg';

// Random SVG files, built from the pieces real files use (groups, shapes,
// paths with every command, transforms, viewBoxes, styles, gradients, <use>)
// with odd values mixed in. Importing must either explain the problem or give
// parts with finite numbers that make a valid project. NYAH_FUZZ_SEEDS=5000
// runs a longer search.

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(env.NYAH_FUZZ_SEEDS) || 300;

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
  return { next, int, pick };
}

type Rng = ReturnType<typeof rng>;

const num = (r: Rng) => r.pick([String(r.int(-300, 300)), (r.next() * 200 - 100).toFixed(3), '0', '1e3', '-0.5', '.5', '1e-9', '2E2'] as const);
const len = (r: Rng) => r.pick([String(r.int(0, 400)), `${r.int(1, 100)}%`, `${r.int(1, 50)}mm`, `${r.int(1, 30)}pt`, '0', 'auto', ''] as const);

function pathData(r: Rng): string {
  const parts = [`M${num(r)} ${num(r)}`];
  for (let i = r.int(0, 8); i > 0; i--) {
    const cmd = r.pick(['L', 'l', 'H', 'h', 'V', 'v', 'C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a', 'Z', 'z', 'M', 'm'] as const);
    const args = { L: 2, l: 2, H: 1, h: 1, V: 1, v: 1, C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2, Z: 0, z: 0, M: 2, m: 2 } as Record<string, number>;
    if (cmd === 'A' || cmd === 'a') parts.push(`${cmd}${num(r)} ${num(r)} ${num(r)} ${r.int(0, 1)} ${r.int(0, 1)} ${num(r)} ${num(r)}`);
    else parts.push(cmd + Array.from({ length: args[cmd]! }, () => num(r)).join(r.pick([' ', ',', ' ,'])));
  }
  return parts.join(r.pick([' ', '', '\n']));
}

function transform(r: Rng): string {
  return r.pick([
    `translate(${num(r)} ${num(r)})`,
    `rotate(${num(r)})`,
    `rotate(${num(r)} ${num(r)} ${num(r)})`,
    `scale(${num(r)})`,
    `scale(${num(r)},${num(r)})`,
    `skewX(${num(r)})`,
    `matrix(${Array.from({ length: 6 }, () => num(r)).join(' ')})`,
    `scale(0)`,
    `translate(${num(r)}) rotate(${num(r)})`,
  ]);
}

function style(r: Rng): string {
  const attrs: string[] = [];
  if (r.next() < 0.6) attrs.push(`fill="${r.pick(['#f00', 'none', 'red', 'rgb(10,20,30)', 'url(#g)', 'url(#missing)', 'currentColor', '#12345678', 'transparent'])}"`);
  if (r.next() < 0.4) attrs.push(`stroke="${r.pick(['#000', 'none', 'blue', 'url(#g)'])}" stroke-width="${num(r)}"`);
  if (r.next() < 0.3) attrs.push(`opacity="${r.pick(['0.5', '0', '2', '-1', 'x'])}"`);
  if (r.next() < 0.3) attrs.push(`transform="${transform(r)}"`);
  if (r.next() < 0.2) attrs.push(`style="fill:${r.pick(['#0f0', 'none'])};fill-rule:${r.pick(['evenodd', 'nonzero', 'bogus'])}"`);
  if (r.next() < 0.1) attrs.push(`display="none"`);
  if (r.next() < 0.3) attrs.push(`id="e${r.int(0, 5)}"`);
  return attrs.join(' ');
}

function element(r: Rng, depth: number): string {
  const kind = r.pick(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'g', 'g', 'use', 'text', 'image'] as const);
  const s = style(r);
  switch (kind) {
    case 'rect':
      return `<rect x="${num(r)}" y="${num(r)}" width="${len(r)}" height="${len(r)}" rx="${r.next() < 0.3 ? num(r) : 0}" ${s}/>`;
    case 'circle':
      return `<circle cx="${num(r)}" cy="${num(r)}" r="${len(r)}" ${s}/>`;
    case 'ellipse':
      return `<ellipse cx="${num(r)}" cy="${num(r)}" rx="${len(r)}" ry="${len(r)}" ${s}/>`;
    case 'line':
      return `<line x1="${num(r)}" y1="${num(r)}" x2="${num(r)}" y2="${num(r)}" ${s}/>`;
    case 'polyline':
    case 'polygon':
      return `<${kind} points="${Array.from({ length: r.int(0, 6) }, () => `${num(r)},${num(r)}`).join(' ')}" ${s}/>`;
    case 'path':
      return `<path d="${pathData(r)}" ${s}/>`;
    case 'use':
      return `<use href="#e${r.int(0, 5)}" x="${num(r)}" y="${num(r)}" ${s}/>`;
    case 'text':
      return `<text x="1" y="2">Hi</text>`;
    case 'image':
      return `<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="${len(r)}" height="${len(r)}" ${s}/>`;
    case 'g':
      return depth > 3 ? '<g/>' : `<g ${s}>${Array.from({ length: r.int(0, 4) }, () => element(r, depth + 1)).join('')}</g>`;
  }
}

function randomSvg(r: Rng): string {
  const viewBox = r.pick(['0 0 200 100', `${num(r)} ${num(r)} ${num(r)} ${num(r)}`, '0 0 0 0', '', 'nonsense']);
  const defs = r.next() < 0.4 ? `<defs><linearGradient id="g" x1="${num(r)}" x2="${num(r)}" gradientTransform="${transform(r)}"><stop offset="0" stop-color="red"/><stop offset="${r.pick(['1', '50%', '2', 'x'])}" stop-color="blue"/></linearGradient></defs>` : '';
  const body = Array.from({ length: r.int(1, 6) }, () => element(r, 0)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${len(r)}" height="${len(r)}"${viewBox ? ` viewBox="${viewBox}"` : ''}>${defs}${body}</svg>`;
}

const finite = (v: unknown): boolean => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finite);
  if (v && typeof v === 'object') return Object.values(v).every(finite);
  return true;
};

describe('importing random SVG files', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}`, () => {
      const text = randomSvg(rng(seed));
      let result;
      try {
        result = importSvg(text, 'random.svg');
      } catch (err) {
        // A refusal must explain itself.
        expect((err as Error).message).toMatch(/random\.svg/);
        return;
      }
      for (const part of walkParts(result.root)) if (!finite(part)) throw new Error(`${part.name} has a number that isn't finite\n${text}`);
      expect(Number.isFinite(result.width) && Number.isFinite(result.height)).toBe(true);
      // It goes into a project that saves and opens again.
      const base = createProject({ layers: [createLayer('background', 'Art')] });
      const { project } = insertPartAtScene(base, base.scene.layers[0]!.root.id, result.root, [1, 0, 0, 1, 0, 0]);
      const withAssets = { ...project, assets: result.assets.map(({ id, name, mimeType }) => ({ id, name, mimeType })) };
      parseProject(JSON.parse(JSON.stringify(withAssets)));
    });
  }
});
