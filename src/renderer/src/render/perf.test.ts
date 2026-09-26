import { beforeEach, describe, expect, it } from 'vitest';
import { playbackStats, recordPlaybackDraw, resetPlaybackStats } from './perf';

describe('playback rate', () => {
  beforeEach(() => resetPlaybackStats());

  it('counts distinct frames drawn in the last second', () => {
    // 12 new frames a second: a 24 fps scene skipping every other frame.
    for (let i = 0; i <= 12; i++) recordPlaybackDraw(i * 2, 30, 1000 + i * (1000 / 12));
    const stats = playbackStats(2000)!;
    expect(stats.fps).toBeCloseTo(12, 0);
    expect(stats.drawMs).toBeCloseTo(30);
  });

  it('ignores redraws of the same frame', () => {
    recordPlaybackDraw(1, 5, 0);
    recordPlaybackDraw(1, 5, 10);
    expect(playbackStats(10)).toBeNull();
  });
});
