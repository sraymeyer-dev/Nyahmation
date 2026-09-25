import { describe, expect, it } from 'vitest';
import { collectAnchors, steppedFrame } from './stepping';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('steppedFrame', () => {
  it('on ones shows every frame', () => {
    for (const f of range(0, 20)) expect(steppedFrame(f, 1, [0, 7])).toBe(f);
  });

  it('on twos with poses on 1 and 8 shows new positions on 1, 3, 5, 7 and exactly 8', () => {
    const shown = range(1, 12).map((f) => steppedFrame(f, 2, [1, 8]));
    expect(shown).toEqual([1, 1, 3, 3, 5, 5, 7, 8, 8, 10, 10, 12]);
  });

  it('on threes restarts at every pose', () => {
    const shown = range(0, 10).map((f) => steppedFrame(f, 3, [0, 5]));
    expect(shown).toEqual([0, 0, 0, 3, 3, 5, 5, 5, 8, 8, 8]);
  });

  it('never shows a frame from before the current pose', () => {
    const anchors = [0, 3, 4, 9];
    for (const f of range(0, 20)) {
      const s = steppedFrame(f, 2, anchors);
      expect(s).toBeLessThanOrEqual(f);
      const anchor = Math.max(...anchors.filter((a) => a <= f));
      expect(s).toBeGreaterThanOrEqual(anchor);
    }
  });

  it('leaves frames before the first pose alone', () => {
    expect(steppedFrame(3, 2, [10])).toBe(3);
    expect(steppedFrame(3, 2, [])).toBe(3);
  });
});

describe('collectAnchors', () => {
  it('merges, sorts and de-duplicates pose frames', () => {
    expect(collectAnchors([[{ frame: 8 }, { frame: 1 }], [{ frame: 5 }, { frame: 8 }], []])).toEqual([1, 5, 8]);
  });
});
