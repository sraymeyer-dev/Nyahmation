import { evaluateRestPose } from '../../../engine/evaluate';
import { EMPTY_BOUNDS, isEmptyBounds, unionBounds } from '../../../engine/geometry';
import type { Project } from '../../../engine/types';
import { resolvedBounds } from '../editor/hitTest';
import { renderScene, type ImageLookup } from './canvasRenderer';

/** Renders everything in `project` into a small transparent PNG, fitted and centred. */
export async function renderThumbnail(project: Project, images: ImageLookup, size = 160): Promise<Uint8Array | null> {
  const scene = evaluateRestPose(project);
  let bounds = EMPTY_BOUNDS;
  for (const part of scene.parts) if (part.visible) bounds = unionBounds(bounds, resolvedBounds(project, part));
  if (isEmptyBounds(bounds)) return null;
  const pad = 8;
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const k = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderScene(
    ctx,
    project,
    scene,
    [k, 0, 0, k, size / 2 - (bounds.minX + w / 2) * k, size / 2 - (bounds.minY + h / 2) * k],
    images,
    { clip: false, background: false },
  );
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
