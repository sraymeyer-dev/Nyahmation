import { evaluateScene } from '../../../engine/evaluate';
import type { ExportFormat } from '../../../preload/api';
import { renderScene } from '../render/canvasRenderer';
import { store } from './store';

// Renders the scene frame by frame at full quality and hands each frame to
// the main process (docs/DESIGN.md E6). Slow computers only take longer; no
// frame is ever skipped.

export interface ExportSettings {
  format: ExportFormat;
  /** Output height in pixels; width follows the scene's shape. */
  height: number;
  range: 'all' | 'loop';
  /** PNG only: leave the background see-through. */
  transparent: boolean;
}

export interface ExportProgress {
  done: number;
  total: number;
}

/** Output size for a height, keeping the scene's shape; both sides even (video encoders need that). */
export function exportSize(sceneW: number, sceneH: number, height: number): { width: number; height: number; scale: number } {
  const h = Math.max(2, Math.round(height / 2) * 2);
  const w = Math.max(2, Math.round((sceneW * h) / sceneH / 2) * 2);
  return { width: w, height: h, scale: h / sceneH };
}

async function decodeImages(): Promise<Map<string, ImageBitmap>> {
  const s = store.getState();
  const out = new Map<string, ImageBitmap>();
  for (const ref of s.project.assets) {
    const bytes = s.assets.get(ref.id);
    if (!bytes || !ref.mimeType.startsWith('image/')) continue;
    try {
      out.set(ref.id, await createImageBitmap(new Blob([bytes as BlobPart], { type: ref.mimeType })));
    } catch {
      // A damaged image is left out of the video rather than stopping it.
    }
  }
  return out;
}

/**
 * Runs an export. Returns the saved path, or null if cancelled (before or
 * during). `isCancelled` is checked between frames.
 */
export async function runExport(
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  isCancelled: () => boolean,
): Promise<string | null> {
  const api = window.nyah;
  if (!api) throw new Error('Export needs the desktop app.');
  const s = store.getState();
  const project = s.project;
  const { width: W, height: H, fps, durationFrames } = project.scene;
  const first = settings.range === 'loop' && s.loop ? s.loop.in : 0;
  const last = settings.range === 'loop' && s.loop ? s.loop.out : durationFrames - 1;
  const total = last - first + 1;
  const size = exportSize(W, H, settings.height);

  const name = (s.file?.name ?? 'Untitled').replace(/\.nyah$/i, '');
  const path = await api.export.choose(settings.format, name);
  if (!path) return null;

  const images = await decodeImages();
  const session = await api.export.begin({ format: settings.format, path, width: size.width, height: size.height, fps });
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: settings.format === 'mp4' }) as unknown as CanvasRenderingContext2D;
  try {
    for (let i = 0; i < total; i++) {
      if (isCancelled()) {
        await api.export.cancel(session);
        return null;
      }
      const frame = first + i;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      renderScene(ctx, project, evaluateScene(project, frame), [size.scale, 0, 0, size.scale, 0, 0], (id) => images.get(id) ?? null, {
        background: !(settings.format === 'png' && settings.transparent),
      });
      let bytes: Uint8Array;
      if (settings.format === 'mp4') {
        const data = ctx.getImageData(0, 0, size.width, size.height).data;
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else {
        bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      }
      await api.export.frame(session, i, bytes);
      onProgress({ done: i + 1, total });
    }
    const result = await api.export.end(session);
    return result.path;
  } catch (err) {
    await api.export.cancel(session).catch(() => undefined);
    throw err;
  }
}
