// A 16-bit PCM WAV writer, for exporting the mixed soundtrack.

export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataSize = frames * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((ch, i) => v.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numChannels * 2, true);
  v.setUint16(32, numChannels * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(buffer);
}
