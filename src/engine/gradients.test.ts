import { describe, expect, it } from 'vitest';
import { gradientAngle, gradientForBounds } from './gradients';

const box = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
const stops = [
  { offset: 0, color: '#000' },
  { offset: 1, color: '#fff' },
];

describe('gradients fitted to a shape', () => {
  it('runs top to bottom at 90°, across the whole shape', () => {
    const g = gradientForBounds('linear', box, stops, 90);
    expect(g.from.x).toBeCloseTo(100);
    expect(g.from.y).toBeCloseTo(0);
    expect(g.to.y).toBeCloseTo(100);
    expect(gradientAngle(g)).toBe(90);
  });

  it('reaches the corners at an angle', () => {
    const g = gradientForBounds('linear', box, stops, 45);
    // Projected half-length: (200·cos45 + 100·sin45) / 2.
    expect(Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y)).toBeCloseTo(300 * Math.SQRT1_2);
    expect(gradientAngle(g)).toBe(45);
  });

  it('spreads a round gradient from the middle to the furthest side', () => {
    const g = gradientForBounds('radial', box, stops);
    expect(g.from).toEqual({ x: 100, y: 50 });
    expect(Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y)).toBe(100);
  });
});
