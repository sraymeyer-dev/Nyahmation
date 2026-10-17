import { describe, expect, it } from 'vitest';
import { trimSilence } from './trim';

const RATE = 48000;
/** Silence, then a tone, then silence (seconds). */
function take(before: number, sound: number, after: number): Float32Array {
  const s = new Float32Array(Math.round((before + sound + after) * RATE));
  const from = Math.round(before * RATE);
  for (let i = 0; i < Math.round(sound * RATE); i++) s[from + i] = 0.5 * Math.sin(i / 10);
  return s;
}

describe('trimSilence', () => {
  it('takes whole frames of silence off the start, keeping a little before the sound', () => {
    const r = trimSilence(take(1, 0.5, 0), RATE, 24);
    // 1 s of silence, less 0.15 s kept: 0.85 s = 20.4 frames, so 20.
    expect(r.framesSkipped).toBe(20);
    expect(r.samples.length).toBe(Math.round(1.5 * RATE) - 20 * 2000);
  });

  it('takes the silence off the end, keeping a little after the sound', () => {
    const r = trimSilence(take(0, 0.5, 2), RATE, 24);
    expect(r.framesSkipped).toBe(0);
    expect(r.samples.length / RATE).toBeCloseTo(0.5 + 0.15, 2);
  });

  it('leaves a silent take alone', () => {
    const silent = new Float32Array(RATE);
    expect(trimSilence(silent, RATE, 24)).toEqual({ samples: silent, framesSkipped: 0 });
  });
});
