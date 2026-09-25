import { useEffect, useRef } from 'react';
import { drawingItemsBounds } from '../../../engine/drawingItems';
import { isEmptyBounds } from '../../../engine/geometry';
import type { DrawingItem } from '../../../engine/types';
import { assetMimeType } from '../editor/actions';
import { store, useEditor } from '../editor/store';
import { drawItems } from '../render/canvasRenderer';
import { getImage } from '../render/images';

/** A small picture of a switch-layer drawing (a mouth shape, an eye…). */
export function DrawingThumb({ items, size }: { items: readonly DrawingItem[]; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const imagesVersion = useEditor((s) => s.imagesVersion);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const b = drawingItemsBounds(items, [1, 0, 0, 1, 0, 0]);
    if (isEmptyBounds(b)) return;
    const pad = 2 * dpr;
    const k = Math.min((c.width - pad * 2) / Math.max(1, b.maxX - b.minX), (c.height - pad * 2) / Math.max(1, b.maxY - b.minY));
    ctx.setTransform(k, 0, 0, k, c.width / 2 - ((b.minX + b.maxX) / 2) * k, c.height / 2 - ((b.minY + b.maxY) / 2) * k);
    const s = store.getState();
    drawItems(ctx, items, (id) => getImage(id, s.assets.get(id), assetMimeType(s, id)));
  }, [items, size, imagesVersion]);
  return <canvas ref={ref} className="drawing-thumb" style={{ width: size, height: size }} />;
}
