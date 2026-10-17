import { describe, expect, it } from 'vitest';
import { addBlinks, blinkTiming, closedDrawingOf } from './blink';
import { evaluateScene } from './evaluate';
import { defaultStyle, ellipsePath } from './geometry';
import { createPart, createProject } from './project';
import { findTrack, setPartPose } from './tracks';
import type { DrawingSet, Layer, Project } from './types';

const EYES_SET: DrawingSet = {
  id: 'eyes-set',
  name: 'Eyes',
  vocabulary: 'custom',
  drawings: [
    { key: 'open', name: 'Open', items: [] },
    { key: 'closed', name: 'Closed', items: [] },
  ],
};

function scene(stepping: 1 | 2 = 1, cycle?: Layer['cycle']): { project: Project; dots: string; eyes: string } {
  const dots = createPart({ name: 'Dots', kind: 'shape', paths: [ellipsePath(0, 0, 9, 13)], style: defaultStyle() });
  const eyes = createPart({ name: 'Eyes', kind: 'switch', drawingSetId: EYES_SET.id, restDrawing: 'open' });
  const root = createPart({ name: 'Pip', kind: 'group', children: [dots, eyes] });
  const project = createProject({ width: 1000, height: 500, durationFrames: 24 * 20, stepping, layers: [{ id: 'pip', name: 'Pip', kind: 'character', root, cycle }] });
  return { project: { ...project, drawingSets: [EYES_SET] }, dots: dots.id, eyes: eyes.id };
}

const scaleYOn = (project: Project, id: string, frame: number) => {
  const part = evaluateScene(project, frame).parts.find((p) => p.id === id)!;
  return part.local.scaleY;
};
const drawingOn = (project: Project, id: string, frame: number) => evaluateScene(project, frame).parts.find((p) => p.id === id)!.drawing;

describe('blinks', () => {
  it('squashes a shape shut for a moment, every few seconds, unevenly', () => {
    const { project, dots } = scene();
    const { project: blinked, blinks } = addBlinks(project, dots, { from: 0, to: 24 * 20 - 1, every: 4 });
    // About one every 4 seconds over 20 seconds (some may be doubles).
    expect(blinks).toBeGreaterThanOrEqual(3);
    expect(blinks).toBeLessThanOrEqual(9);
    const shut = Array.from({ length: 24 * 20 }, (_, f) => scaleYOn(blinked, dots, f) < 0.5);
    // Never at the very start, and open again at the end.
    expect(shut.slice(0, 24).some(Boolean)).toBe(false);
    expect(shut[shut.length - 1]).toBe(false);
    // Each blink is shut for two frames or so at 24 fps, never long.
    const runs: number[] = [];
    shut.forEach((s, f) => {
      if (s && !shut[f - 1]) runs.push(1);
      else if (s) runs[runs.length - 1]!++;
    });
    expect(runs.length).toBe(blinks);
    for (const run of runs) expect(run).toBeLessThanOrEqual(3);
    // The gaps differ.
    const starts = shut.flatMap((s, f) => (s && !shut[f - 1] ? [f] : []));
    const gaps = starts.slice(1).map((f, i) => f - starts[i]!);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('shows a switch layer’s closed drawing for a moment, then what it showed before', () => {
    let { project, eyes } = scene();
    project = setPartPose(project, eyes, 'drawing', 0, 'open');
    expect(closedDrawingOf(project, eyes)).toBe('closed');
    const { project: blinked, blinks } = addBlinks(project, eyes, { from: 0, to: 479, every: 3, closed: 'closed' });
    expect(blinks).toBeGreaterThan(2);
    const drawings = Array.from({ length: 480 }, (_, f) => drawingOn(blinked, eyes, f));
    expect(drawings[0]).toBe('open');
    expect(drawings[479]).toBe('open');
    expect(drawings.filter((d) => d === 'closed').length).toBeGreaterThan(0);
    expect(new Set(drawings)).toEqual(new Set(['open', 'closed']));
  });

  it('keeps the start as it was when the switch layer had no drawing poses', () => {
    const { project, eyes } = scene();
    const { project: blinked } = addBlinks(project, eyes, { from: 0, to: 479, every: 3, closed: 'closed' });
    expect(drawingOn(blinked, eyes, 0)).toBe('open');
  });

  it('leaves the animator’s own poses alone', () => {
    let { project, dots } = scene();
    project = setPartPose(project, dots, 'scaleY', 0, 1);
    project = setPartPose(project, dots, 'scaleY', 100, 1.5);
    const { project: blinked } = addBlinks(project, dots, { from: 0, to: 479, every: 1 });
    const poses = findTrack(blinked.scene.tracks, dots, 'scaleY')!.poses;
    expect(poses.find((p) => p.frame === 100)?.value).toBe(1.5);
    expect(poses.filter((p) => p.frame >= 99 && p.frame <= 101)).toHaveLength(1);
    // A blink while the eyes are bigger opens back to the bigger size.
    expect(scaleYOn(blinked, dots, 479)).toBeCloseTo(1.5);
  });

  it('stays inside the frames asked for, and before a cycle repeats', () => {
    const { project, dots } = scene(1, { from: 0, to: 120, travel: false });
    const { project: blinked } = addBlinks(project, dots, { from: 0, to: 400, every: 1 });
    const frames = findTrack(blinked.scene.tracks, dots, 'scaleY')!.poses.map((p) => p.frame);
    expect(Math.max(...frames)).toBeLessThanOrEqual(120);
    const ranged = addBlinks(project, dots, { from: 200, to: 300, every: 1 }).project;
    const inRange = findTrack(ranged.scene.tracks, dots, 'scaleY')?.poses.map((p) => p.frame) ?? [];
    for (const f of inRange) expect(f >= 200 && f <= 300).toBe(true);
  });

  it('still shows on twos, since every pose is shown on its own frame', () => {
    const { project, dots } = scene(2);
    const { project: blinked, blinks } = addBlinks(project, dots, { from: 0, to: 479, every: 4 });
    const shut = Array.from({ length: 480 }, (_, f) => scaleYOn(blinked, dots, f) < 0.5);
    const runs = shut.filter((s, f) => s && !shut[f - 1]).length;
    expect(runs).toBe(blinks);
  });

  it('takes longer at higher frame rates, the same time in seconds', () => {
    expect(blinkTiming(24)).toEqual({ closing: 1, shut: 1, opening: 2 });
    expect(blinkTiming(60)).toEqual({ closing: 3, shut: 3, opening: 5 });
    expect(blinkTiming(12)).toEqual({ closing: 1, shut: 1, opening: 1 });
  });
});
