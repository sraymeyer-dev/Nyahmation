import { applyToPoint, IDENTITY, invert, multiply, type Mat2D } from '../../../engine/math';
import type { Vec2 } from '../../../engine/types';
import { resolvedScene } from './actions';
import type { EditorState } from './store';

// Stage ↔ screen for the canvas. Tools, poses and pins all work in stage
// coordinates (docs/DESIGN.md D-48); only what is shown changes. In Animate
// mode with "Camera view" on, the canvas looks through the camera, so the
// camera's matrix sits between the stage and the screen.

/** Whether the canvas is looking through the camera right now. */
export function throughCamera(s: EditorState): boolean {
  return s.mode === 'animate' && s.cameraView;
}

/** Stage → what the view's pan and zoom apply to (the picture, when looking through the camera). */
export function lensMatrix(s: EditorState): Mat2D {
  return throughCamera(s) ? resolvedScene(s).cameraMatrix : IDENTITY;
}

/** Stage coordinates → canvas CSS pixels. */
export function stageToScreen(s: EditorState): Mat2D {
  const { zoom, panX, panY } = s.view;
  return multiply([zoom, 0, 0, zoom, panX, panY], lensMatrix(s));
}

export function toScreen(s: EditorState, p: Vec2): Vec2 {
  return applyToPoint(stageToScreen(s), p);
}

export function fromScreen(s: EditorState, p: Vec2): Vec2 {
  return applyToPoint(invert(stageToScreen(s)), p);
}

/** Screen pixels per stage unit. */
export function screenScale(s: EditorState): number {
  const m = stageToScreen(s);
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}
