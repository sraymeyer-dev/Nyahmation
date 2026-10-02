// Playback speed, as the viewport actually managed it (docs/DESIGN.md N2, N9).
// While playing, the frame shown follows the sound clock, so a slow computer
// skips frames rather than slowing down. This counts the frames that were
// really drawn, so the timeline can say "showing 17 of 24 fps".

const WINDOW_MS = 1000;

const draws: { at: number; ms: number }[] = [];
let lastFrame = -1;

/** Called by the viewport after drawing `frame` during playback. */
export function recordPlaybackDraw(frame: number, ms: number, now = performance.now()): void {
  if (frame === lastFrame) return;
  lastFrame = frame;
  draws.push({ at: now, ms });
  while (draws.length && draws[0]!.at < now - WINDOW_MS) draws.shift();
}

export function resetPlaybackStats(): void {
  draws.length = 0;
  lastFrame = -1;
}

/** Distinct frames drawn in the last second, and the average time each took. */
export function playbackStats(now = performance.now()): { fps: number; drawMs: number } | null {
  const recent = draws.filter((d) => d.at >= now - WINDOW_MS);
  if (recent.length < 2) return null;
  const span = Math.max(recent.at(-1)!.at - recent[0]!.at, 1);
  const fps = ((recent.length - 1) * 1000) / span;
  const drawMs = recent.reduce((sum, d) => sum + d.ms, 0) / recent.length;
  return { fps, drawMs };
}
