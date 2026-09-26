// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { walkParts } from '../../engine/edit';
import { pathsBounds, translatePath } from '../../engine/geometry';
import type { Part } from '../../engine/types';
import { importSvg } from './importSvg';

const svg = (body: string, attrs = 'width="200" height="100" viewBox="0 0 200 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;

const find = (root: Part, name: string) => [...walkParts(root)].find((p) => p.name === name)!;
/** A shape's outline back in SVG coordinates. */
const sceneBounds = (p: Part) => pathsBounds(p.paths!.map((path) => translatePath(path, p.rest.x, p.rest.y)));

describe('importSvg', () => {
  it('keeps groups and names, and centres each shape on its joint', () => {
    const { root, width, height, warnings } = importSvg(
      svg(`<g id="Arm"><rect id="Upper" x="10" y="20" width="30" height="40" fill="#ff0000"/><circle id="Hand" cx="100" cy="50" r="10"/></g>`),
      'pip.svg',
    );
    expect(root.name).toBe('pip');
    expect([width, height]).toEqual([200, 100]);
    expect(warnings).toEqual([]);
    const arm = find(root, 'Arm');
    expect(arm.kind).toBe('group');
    expect(arm.children.map((c) => c.name)).toEqual(['Upper', 'Hand']);
    const upper = find(root, 'Upper');
    expect(upper.rest.x).toBe(25);
    expect(upper.rest.y).toBe(40);
    expect(upper.joint.pivot).toEqual({ x: 0, y: 0 });
    expect(upper.style!.fill).toBe('#ff0000');
    // Default SVG paint: black fill, no stroke.
    expect(find(root, 'Hand').style).toMatchObject({ fill: '#000000', stroke: null });
  });

  it('bakes transforms (and scales stroke width with them)', () => {
    const { root } = importSvg(
      svg(`<g transform="translate(50 0) scale(2)"><rect id="Box" x="0" y="0" width="10" height="10" stroke="blue" stroke-width="3"/></g>`),
      'a.svg',
    );
    const box = find(root, 'Box');
    const b = sceneBounds(box);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([50, 0, 70, 20]);
    expect(box.style!.strokeWidth).toBeCloseTo(6);
  });

  it('maps the viewBox onto the width and height', () => {
    const { root } = importSvg(svg(`<rect id="R" x="0" y="0" width="10" height="10"/>`, 'width="100mm" height="50mm" viewBox="0 0 100 50"'), 'a.svg');
    const b = sceneBounds(find(root, 'R'));
    expect(b.maxX).toBeCloseTo(37.795, 2); // 10 mm in pixels
  });

  it('resolves styles from classes, inline style and inheritance', () => {
    const { root } = importSvg(
      svg(`
        <style>.skin { fill: #f2c9a0; } #special { stroke: red } rect.thick { stroke-width: 4 }</style>
        <g fill="green" stroke="black" opacity="0.5">
          <rect id="A" class="skin thick" x="0" y="0" width="5" height="5"/>
          <rect id="special" x="0" y="0" width="5" height="5" style="fill: blue; fill-opacity: 0.5"/>
          <rect id="C" x="0" y="0" width="5" height="5"/>
        </g>`),
      'a.svg',
    );
    expect(find(root, 'A').style).toMatchObject({ fill: '#f2c9a0', stroke: '#000000', strokeWidth: 4 });
    expect(find(root, 'special').style).toMatchObject({ fill: 'rgba(0, 0, 255, 0.5)', stroke: '#ff0000' });
    expect(find(root, 'C').style!.fill).toBe('#008000');
    // Opacity belongs to the group, not inherited by each shape.
    expect(root.children[0]!.opacity).toBe(0.5);
    expect(find(root, 'C').opacity).toBe(1);
  });

  it('supports all basic shapes and compound paths', () => {
    const { root } = importSvg(
      svg(`
        <ellipse id="E" cx="10" cy="10" rx="5" ry="3"/>
        <line id="L" x1="0" y1="0" x2="10" y2="10" stroke="black"/>
        <polyline id="PL" points="0,0 10,0 10,10" stroke="black"/>
        <polygon id="PG" points="0,0 10,0 10,10"/>
        <rect id="RR" x="0" y="0" width="20" height="10" rx="3"/>
        <path id="Donut" fill-rule="evenodd" d="M0 0h10v10h-10z M3 3h4v4h-4z"/>`),
      'a.svg',
    );
    expect(find(root, 'L').style!.fill).toBeNull();
    expect(find(root, 'PL').paths![0]!.closed).toBe(false);
    expect(find(root, 'PG').paths![0]!.closed).toBe(true);
    expect(find(root, 'RR').paths![0]!.points).toHaveLength(8);
    expect(find(root, 'Donut').paths).toHaveLength(2);
    expect(find(root, 'Donut').style!.fillRule).toBe('evenodd');
  });

  it('assigns stacking order in document order', () => {
    const { root } = importSvg(svg(`<rect id="Back" width="1" height="1"/><g><rect id="Front" width="1" height="1"/></g>`), 'a.svg');
    expect(find(root, 'Front').drawOrder).toBeGreaterThan(find(root, 'Back').drawOrder);
  });

  it('follows <use> references', () => {
    const { root } = importSvg(
      svg(`<defs><circle id="dot" cx="0" cy="0" r="2"/></defs><use id="U" href="#dot" x="50" y="20"/>`),
      'a.svg',
    );
    const dot = find(root, 'U').children[0]!;
    expect(dot.rest).toMatchObject({ x: 50, y: 20 });
  });

  it('imports gradient fills, placed on the shape', () => {
    const { root, warnings } = importSvg(
      svg(`
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#123456"/><stop offset="100%" stop-color="#fff" stop-opacity="0.5"/></linearGradient>
          <linearGradient id="skyLater" href="#sky"/>
          <radialGradient id="sun" gradientUnits="userSpaceOnUse" cx="60" cy="60" r="10"><stop offset="0" stop-color="yellow"/><stop offset="1" stop-color="orange"/></radialGradient>
        </defs>
        <rect id="Sky" x="10" y="20" width="40" height="20" fill="url(#skyLater)"/>
        <circle id="Sun" cx="60" cy="60" r="10" fill="url(#sun)"/>`),
      'a.svg',
    );
    const sky = find(root, 'Sky');
    const g = sky.style!.fillGradient!;
    expect(g.kind).toBe('linear');
    expect(sky.style!.fill).toBe('#123456');
    expect(g.stops.map((x) => x.offset)).toEqual([0, 1]);
    expect(g.stops[1]!.color).toBe('rgba(255, 255, 255, 0.5)');
    // Top to bottom of the rectangle, in the shape's own coordinates (centred on its middle).
    const top = { x: g.from.x + sky.rest.x, y: g.from.y + sky.rest.y };
    const bottom = { x: g.to.x + sky.rest.x, y: g.to.y + sky.rest.y };
    expect(top).toEqual({ x: 10, y: 20 });
    expect(bottom).toEqual({ x: 10, y: 40 });
    const sun = find(root, 'Sun');
    const r = sun.style!.fillGradient!;
    expect(r.kind).toBe('radial');
    expect(r.from.x + sun.rest.x).toBeCloseTo(60);
    expect(Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y)).toBeCloseTo(10);
    expect(warnings).toEqual([]);
  });

  it('skips unsupported things with plain warnings', () => {
    const { root, warnings } = importSvg(
      svg(`
        <defs><linearGradient id="g"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
        <rect id="G" width="5" height="5" fill="url(#g)"/>
        <text x="0" y="0">Hi</text><text x="0" y="0">There</text>
        <rect id="Clipped" width="5" height="5" clip-path="url(#c)"/>
        <rect id="Gone" width="5" height="5" display="none"/>`),
      'a.svg',
    );
    expect(find(root, 'G').style!.fill).toBe('#123456');
    expect(find(root, 'G').style!.fillGradient?.kind).toBe('linear');
    expect(find(root, 'Gone')).toBeUndefined();
    expect(warnings.some((w) => w.startsWith('Text was skipped') && w.endsWith('(2 times)'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('Clipping paths were ignored'))).toBe(true);
  });

  it('imports embedded PNG images as image parts with assets', () => {
    const png = 'iVBORw0KGgo='; // just needs to be valid base64 here
    const { root, assets } = importSvg(svg(`<image id="Pic" x="5" y="6" width="40" height="30" href="data:image/png;base64,${png}"/>`), 'a.svg');
    const pic = find(root, 'Pic');
    expect(pic.kind).toBe('image');
    expect(pic.image).toMatchObject({ width: 40, height: 30, assetId: assets[0]!.id });
    expect(pic.rest).toMatchObject({ x: 5, y: 6 });
    expect(assets[0]!.mimeType).toBe('image/png');
    expect(assets[0]!.bytes.length).toBeGreaterThan(0);
  });

  it('rejects files that are not SVG', () => {
    expect(() => importSvg('<html></html>', 'x.svg')).toThrow(/isn't a valid SVG/);
    expect(() => importSvg('<svg', 'x.svg')).toThrow(/isn't a valid SVG/);
  });
});
