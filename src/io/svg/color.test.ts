import { describe, expect, it } from 'vitest';
import { formatColor, parseColor } from './color';

describe('parseColor', () => {
  it('reads the common formats', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#00ff0080')!.a).toBeCloseTo(0.5, 2);
    expect(parseColor('rebeccapurple')).toEqual({ r: 0x66, g: 0x33, b: 0x99, a: 1 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseColor('none')).toBeNull();
    expect(parseColor('url(#x)')).toBeNull();
  });
});

describe('formatColor', () => {
  it('uses hex when opaque and rgba otherwise', () => {
    expect(formatColor({ r: 255, g: 128, b: 0, a: 1 })).toBe('#ff8000');
    expect(formatColor({ r: 255, g: 128, b: 0, a: 1 }, 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    expect(formatColor({ r: 0, g: 0, b: 0, a: 1 }, 0)).toBeNull();
  });
});
