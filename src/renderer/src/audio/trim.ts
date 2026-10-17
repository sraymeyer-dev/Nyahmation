// Trimming the silence at the start and end of a recorded take (docs/DESIGN.md
// AU6): the pause between clicking Start and speaking, and before Stop.
// The start is trimmed in whole frames, so a take recorded while the scene
// played can move by exactly that many frames and keep its timing.

export interface Trimmed {
  samples: Float32Array;
  /** Whole frames taken off the start. */
  framesSkipped: number;
}

/** Anything quieter than this, compared with the loudest moment, counts as silence. */
const QUIET = 0.04;
/** Kept around the sound, so breaths and soft starts aren't clipped (seconds). */
const MARGIN = 0.15;

export function trimSilence(samples: Float32Array, sampleRate: number, fps: number): Trimmed {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return { samples, framesSkipped: 0 };
  const threshold = peak * QUIET;
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]!) < threshold) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]!) < threshold) last--;
  const margin = Math.round(MARGIN * sampleRate);
  const perFrame = sampleRate / fps;
  const framesSkipped = Math.max(0, Math.floor((first - margin) / perFrame));
  const start = Math.round(framesSkipped * perFrame);
  const end = Math.min(samples.length, last + 1 + margin);
  return { samples: samples.subarray(start, end), framesSkipped };
}
