import type { Vec2 } from '../../../../engine/types';
import { screenScale } from '../screen';
import { store } from '../store';
import { snapToGrid } from '../view';

export const ACCENT = '#4f8cff';
export const HANDLE_RADIUS = 5;
/** How close (in screen pixels) the mouse must be to grab something. */
export const GRAB_PX = 7;

const overlayListeners = new Set<() => void>();
/** Asks the canvas to redraw (for tool previews that aren't in the store). */
export function invalidate(): void {
  for (const l of overlayListeners) l();
}
export function onInvalidate(listener: () => void): () => void {
  overlayListeners.add(listener);
  return () => overlayListeners.delete(listener);
}

export function snap(p: Vec2): Vec2 {
  const { grid } = store.getState();
  return grid.snap ? snapToGrid(p, grid.size) : p;
}

/** Scene units per screen pixel. */
export function pixel(): number {
  return 1 / screenScale(store.getState());
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function drawHandle(ctx: CanvasRenderingContext2D, p: Vec2, filled: boolean, shape: 'square' | 'circle' = 'square'): void {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(p.x, p.y, HANDLE_RADIUS - 1, 0, Math.PI * 2);
  else ctx.rect(p.x - HANDLE_RADIUS + 1, p.y - HANDLE_RADIUS + 1, (HANDLE_RADIUS - 1) * 2, (HANDLE_RADIUS - 1) * 2);
  ctx.fillStyle = filled ? ACCENT : '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
}

export function drawMarquee(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2): void {
  ctx.save();
  ctx.fillStyle = 'rgba(79, 140, 255, 0.1)';
  ctx.strokeStyle = ACCENT;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  ctx.fillRect(x, y, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  ctx.restore();
}
