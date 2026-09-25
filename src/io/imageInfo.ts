// Reads the pixel size of PNG and JPEG files from their headers, without
// decoding the image, so imports can be sized and checked anywhere (including tests).

export interface ImageInfo {
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: 8-byte signature, then the IHDR chunk with width and height.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the markers until a start-of-frame (SOFn) segment.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const length = view.getUint16(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { mimeType: 'image/jpeg', height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      i += 2 + length;
    }
  }
  return null;
}
