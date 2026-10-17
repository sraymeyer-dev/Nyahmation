import { describe, expect, it } from 'vitest';
import { exportSize, timeLeft } from './exporter';

describe('exportSize', () => {
  it('keeps the scene shape with even sides', () => {
    expect(exportSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720, scale: 720 / 1080 });
    expect(exportSize(1000, 333, 333)).toEqual({ width: 1004, height: 334, scale: 334 / 333 });
  });
});

describe('timeLeft', () => {
  it('waits for a few frames before guessing', () => {
    expect(timeLeft(2, 100, 5000)).toBeNull();
    expect(timeLeft(10, 100, 1000)).toBeNull();
    expect(timeLeft(100, 100, 9000)).toBeNull();
  });

  it('estimates from the frames so far, in plain words', () => {
    expect(timeLeft(50, 100, 4000)).toBe('a few seconds left');
    expect(timeLeft(10, 100, 3000)).toBe('about 25 seconds left'); // 27 s
    expect(timeLeft(10, 100, 7000)).toBe('about a minute left'); // 63 s
    expect(timeLeft(10, 1000, 6000)).toBe('about 10 minutes left'); // 594 s
  });
});
