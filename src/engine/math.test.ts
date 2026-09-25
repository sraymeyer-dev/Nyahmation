import { describe, expect, it } from 'vitest';
import { applyToPoint, decompose, IDENTITY, invert, localMatrix, multiply } from './math';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe('invert', () => {
  it('undoes a transform', () => {
    const m = localMatrix({ x: 30, y: -12, rotation: 37, scaleX: 2, scaleY: 0.5 }, { x: 4, y: 9 });
    close(multiply(m, invert(m)), IDENTITY);
    const p = { x: 3, y: 7 };
    const back = applyToPoint(invert(m), applyToPoint(m, p));
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(7);
  });
});

describe('decompose', () => {
  it('recovers the transform that built a matrix', () => {
    const pivot = { x: 4, y: 9 };
    for (const t of [
      { x: 30, y: -12, rotation: 37, scaleX: 2, scaleY: 0.5 },
      { x: 0, y: 0, rotation: -150, scaleX: 1, scaleY: 1 },
      { x: 5, y: 5, rotation: 10, scaleX: -1, scaleY: 1 },
    ]) {
      close(localMatrix(decompose(localMatrix(t, pivot), pivot), pivot), localMatrix(t, pivot));
    }
  });
});
