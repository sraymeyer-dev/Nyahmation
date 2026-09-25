import { describe, expect, it } from 'vitest';
import { applyToPoint } from '../../engine/math';
import { parseTransform } from './transform';

const apply = (t: string, x: number, y: number) => applyToPoint(parseTransform(t), { x, y });

describe('parseTransform', () => {
  it('applies functions left to right like SVG', () => {
    const p = apply('translate(10 20) scale(2)', 1, 1);
    expect(p).toEqual({ x: 12, y: 22 });
  });

  it('rotates around a centre', () => {
    const p = apply('rotate(90 10 10)', 20, 10);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(20);
  });

  it('reads matrix and skew', () => {
    expect(apply('matrix(1,0,0,1,5,6)', 0, 0)).toEqual({ x: 5, y: 6 });
    expect(apply('skewX(45)', 0, 10).x).toBeCloseTo(10);
  });

  it('is the identity when empty', () => {
    expect(apply('', 3, 4)).toEqual({ x: 3, y: 4 });
  });
});
