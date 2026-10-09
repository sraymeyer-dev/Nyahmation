import type { PreviewQuality } from './store';

// The arithmetic behind View → Measure Preview Speed (see measure.ts), kept
// apart from the drawing so it can be unit-tested.

export const QUALITIES: readonly { quality: PreviewQuality; label: string }[] = [
  { quality: 1, label: 'Full' },
  { quality: 0.5, label: 'Half' },
  { quality: 0.25, label: 'Quarter' },
];

export const qualityLabel = (q: PreviewQuality) => QUALITIES.find((x) => x.quality === q)!.label;

/**
 * Leave room in each frame's time for sound, the timeline and the browser's
 * own work: a quality "keeps up" if drawing takes at most this share of it.
 */
const HEADROOM = 0.75;

export interface Timing {
  quality: PreviewQuality;
  /** Poses plus drawing, per frame. */
  msPerFrame: number;
}

/** Which quality to recommend, and a line for each timing. */
export function verdict(timings: readonly Timing[], fps: number): { recommended: PreviewQuality | null; lines: string[] } {
  const budget = 1000 / fps;
  const keepsUp = (t: Timing) => t.msPerFrame <= budget * HEADROOM;
  const lines = timings.map(
    (t) =>
      `${qualityLabel(t.quality)}: ${t.msPerFrame.toFixed(1)} ms a frame (up to ${Math.floor(1000 / Math.max(t.msPerFrame, 0.1))} fps) — ${keepsUp(t) ? 'keeps up' : 'too slow, frames would be skipped'}.`,
  );
  const best = timings.filter(keepsUp).sort((a, b) => b.quality - a.quality)[0];
  return { recommended: best?.quality ?? null, lines };
}

/** Up to `max` frames spread evenly over the scene, in order. */
export function sampleFrames(duration: number, max: number): number[] {
  const n = Math.min(duration, max);
  return Array.from({ length: n }, (_, i) => Math.floor((i * duration) / n));
}
