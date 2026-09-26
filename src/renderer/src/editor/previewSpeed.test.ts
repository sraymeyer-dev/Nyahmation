import { describe, expect, it } from 'vitest';
import { sampleFrames, verdict } from './previewSpeed';

describe('preview speed', () => {
  it('recommends the sharpest quality that keeps up, with room to spare', () => {
    // 24 fps allows 41.7 ms a frame; keeping a quarter free leaves 31.25 ms.
    const r = verdict(
      [
        { quality: 1, msPerFrame: 38 },
        { quality: 0.5, msPerFrame: 14 },
        { quality: 0.25, msPerFrame: 6 },
      ],
      24,
    );
    expect(r.recommended).toBe(0.5);
    expect(r.lines[0]).toContain('Full: 38.0 ms');
    expect(r.lines[0]).toContain('too slow');
    expect(r.lines[1]).toContain('keeps up');
  });

  it('says so when nothing keeps up', () => {
    expect(verdict([{ quality: 0.25, msPerFrame: 30 }], 60).recommended).toBeNull();
  });

  it('samples frames evenly across the scene', () => {
    expect(sampleFrames(10, 72)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const many = sampleFrames(720, 72);
    expect(many).toHaveLength(72);
    expect(many[0]).toBe(0);
    expect(many[1]).toBe(10);
    expect(many.at(-1)).toBe(710);
  });
});
