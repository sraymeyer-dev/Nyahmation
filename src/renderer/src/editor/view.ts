import type { Vec2 } from '../../../engine/types';
import type { View } from './store';

export function screenToScene(view: View, p: Vec2): Vec2 {
  return { x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom };
}

export function sceneToScreen(view: View, p: Vec2): Vec2 {
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY };
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

/** Zooms by `factor`, keeping the scene point under `anchor` (screen px) still. */
export function zoomAt(view: View, factor: number, anchor: Vec2): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const k = zoom / view.zoom;
  return { zoom, panX: anchor.x - (anchor.x - view.panX) * k, panY: anchor.y - (anchor.y - view.panY) * k };
}

/** Fits a scene of the given size into the viewport with a margin. */
export function fitView(sceneW: number, sceneH: number, viewW: number, viewH: number, margin = 32): View {
  const zoom = Math.max(MIN_ZOOM, Math.min((viewW - margin * 2) / sceneW, (viewH - margin * 2) / sceneH));
  return { zoom, panX: (viewW - sceneW * zoom) / 2, panY: (viewH - sceneH * zoom) / 2 };
}

export function snapToGrid(p: Vec2, size: number): Vec2 {
  return { x: Math.round(p.x / size) * size, y: Math.round(p.y / size) * size };
}
