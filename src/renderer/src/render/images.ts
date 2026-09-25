import { store } from '../editor/store';

// Decodes embedded images (asset bytes) into bitmaps for drawing. Decoding is
// asynchronous; when an image becomes ready the canvas is asked to redraw.

const cache = new Map<string, ImageBitmap | 'loading' | 'failed'>();

export function getImage(assetId: string, bytes: Uint8Array | undefined, mimeType = 'image/png'): ImageBitmap | null {
  const entry = cache.get(assetId);
  if (entry instanceof ImageBitmap) return entry;
  if (entry || !bytes) return null;
  cache.set(assetId, 'loading');
  createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }))
    .then((bitmap) => {
      cache.set(assetId, bitmap);
      store.set((s) => ({ imagesVersion: s.imagesVersion + 1 }));
    })
    .catch(() => cache.set(assetId, 'failed'));
  return null;
}
