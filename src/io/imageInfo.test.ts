import { describe, expect, it } from 'vitest';
import { readImageInfo } from './imageInfo';

describe('readImageInfo', () => {
  it('reads PNG sizes', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 480);
    expect(readImageInfo(png)).toEqual({ mimeType: 'image/png', width: 640, height: 480 });
  });

  it('reads JPEG sizes, skipping other segments', () => {
    const jpg = new Uint8Array([
      0xff, 0xd8, // start of image
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, 2 bytes of payload
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, // SOF0: height 300, width 600
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(readImageInfo(jpg)).toEqual({ mimeType: 'image/jpeg', width: 600, height: 300 });
  });

  it('returns null for anything else', () => {
    expect(readImageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
