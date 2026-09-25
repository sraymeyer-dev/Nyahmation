import type { ResolvedScene } from '../../../../engine/evaluate';
import type { Mat2D } from '../../../../engine/math';
import type { Vec2 } from '../../../../engine/types';
import type { EditorState } from '../store';

export interface ToolPointer {
  /** CSS pixels relative to the canvas. */
  screen: Vec2;
  scene: Vec2;
  shift: boolean;
  alt: boolean;
  /** Cmd on Mac, Ctrl elsewhere. */
  mod: boolean;
}

export interface OverlayContext {
  ctx: CanvasRenderingContext2D;
  s: EditorState;
  resolved: ResolvedScene;
  toScreen(p: Vec2): Vec2;
  /** Matrix from a part's drawing space to screen CSS pixels. */
  toScreenMatrix(world: Mat2D): Mat2D;
}

export interface Tool {
  cursor(s: EditorState): string;
  down?(p: ToolPointer): void;
  /** `dragging` is true while the mouse button is held. */
  move?(p: ToolPointer, dragging: boolean): void;
  up?(p: ToolPointer): void;
  doubleClick?(p: ToolPointer): void;
  /** Return true if the key was handled. */
  keyDown?(e: KeyboardEvent): boolean;
  /** Finish or abandon any work in progress (called when switching tools). */
  finish?(): void;
  drawOverlay?(o: OverlayContext): void;
}
