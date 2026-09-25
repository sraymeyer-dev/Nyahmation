import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo header and samples', () => {
    const left = new Float32Array([0, 1, -1]);
    const right = new Float32Array([0.5, 0, 2]); // out of range is clipped
    const bytes = encodeWav([left, right], 48000);
    const v = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(3 * 2 * 2);
    expect(bytes.length).toBe(44 + 12);
    expect(v.getInt16(44 + 2, true)).toBe(Math.floor(0.5 * 0x7fff)); // right, sample 0
    expect(v.getInt16(44 + 4, true)).toBe(0x7fff); // left, sample 1
    expect(v.getInt16(44 + 8, true)).toBe(-0x8000); // left, sample 2
    expect(v.getInt16(44 + 10, true)).toBe(0x7fff); // right, sample 2 (clipped)
  });
});
