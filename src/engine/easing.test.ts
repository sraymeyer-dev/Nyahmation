import { describe, expect, it } from 'vitest';
import { cubicBezierEase, EASE_PRESET_CURVES, easeCurve } from './easing';

describe('cubicBezierEase', () => {
  it('is pinned at 0 and 1', () => {
    for (const curve of Object.values(EASE_PRESET_CURVES)) {
      expect(cubicBezierEase(curve, 0)).toBe(0);
      expect(cubicBezierEase(curve, 1)).toBe(1);
    }
  });

  it('is the identity for the straight curve', () => {
    for (const u of [0.1, 0.25, 0.5, 0.9]) {
      expect(cubicBezierEase([0, 0, 1, 1], u)).toBeCloseTo(u, 6);
    }
  });

  it('ease-in starts slow, ease-out starts fast', () => {
    expect(cubicBezierEase(EASE_PRESET_CURVES.easeIn, 0.25)).toBeLessThan(0.25);
    expect(cubicBezierEase(EASE_PRESET_CURVES.easeOut, 0.25)).toBeGreaterThan(0.25);
  });

  it('ease-in-out is symmetric around the middle', () => {
    const f = (u: number) => cubicBezierEase(EASE_PRESET_CURVES.easeInOut, u);
    expect(f(0.5)).toBeCloseTo(0.5, 6);
    for (const u of [0.1, 0.2, 0.3, 0.4]) expect(f(u) + f(1 - u)).toBeCloseTo(1, 6);
  });

  it('matches known CSS ease-in values', () => {
    // Reference values from the CSS cubic-bezier(0.42, 0, 1, 1) curve.
    expect(cubicBezierEase(EASE_PRESET_CURVES.easeIn, 0.5)).toBeCloseTo(0.3153, 3);
  });

  it('allows overshoot when control points leave 0..1', () => {
    const back: [number, number, number, number] = [0.34, 1.56, 0.64, 1];
    const values = Array.from({ length: 99 }, (_, i) => cubicBezierEase(back, (i + 1) / 100));
    expect(Math.max(...values)).toBeGreaterThan(1);
  });

  it('is monotonic for the presets', () => {
    for (const curve of Object.values(EASE_PRESET_CURVES)) {
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const v = cubicBezierEase(curve, i / 100);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });
});

describe('easeCurve', () => {
  it('maps presets and custom curves, and nothing for the rest', () => {
    expect(easeCurve('easeIn')).toEqual(EASE_PRESET_CURVES.easeIn);
    expect(easeCurve({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(easeCurve('smooth')).toBeNull();
    expect(easeCurve('linear')).toBeNull();
    expect(easeCurve('hold')).toBeNull();
  });
});
