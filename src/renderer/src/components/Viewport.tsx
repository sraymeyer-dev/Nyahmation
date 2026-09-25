import { useEffect, useRef } from 'react';
import type { Mat2D } from '../../../engine/math';
import { assetMimeType, resolvedScene, zoomToFit } from '../editor/actions';
import { drawGrid, drawOutsideScene, drawSelection, makeOverlayContext } from '../editor/overlay';
import { store } from '../editor/store';
import { onInvalidate } from '../editor/tools/common';
import { TOOLS } from '../editor/tools';
import type { Tool, ToolPointer } from '../editor/tools/types';
import { screenToScene, zoomAt } from '../editor/view';
import { renderScene } from '../render/canvasRenderer';
import { getImage } from '../render/images';
import { drawPins } from '../editor/tools/pin';
import { evaluateScene } from '../../../engine/evaluate';
import type { EditorState } from '../editor/store';
import type { ImageLookup } from '../render/canvasRenderer';

let onionCanvas: OffscreenCanvas | null = null;

/**
 * Onion skinning (docs/DESIGN.md A8): earlier frames tinted red, later frames
 * tinted green, fading with distance.
 */
function drawOnionSkins(ctx: CanvasRenderingContext2D, s: EditorState, view: Mat2D, images: ImageLookup): void {
  const { width, height } = ctx.canvas;
  if (!onionCanvas || onionCanvas.width !== width || onionCanvas.height !== height) onionCanvas = new OffscreenCanvas(width, height);
  const off = onionCanvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const n = s.project.scene.durationFrames;
  const { before, after, step } = s.onion;
  const skins: { frame: number; color: string; alpha: number }[] = [];
  for (let k = before; k >= 1; k--) skins.push({ frame: s.frame - k * step, color: '#e5484d', alpha: 0.35 / k });
  for (let k = after; k >= 1; k--) skins.push({ frame: s.frame + k * step, color: '#30a46c', alpha: 0.35 / k });
  for (const skin of skins) {
    if (skin.frame < 0 || skin.frame >= n) continue;
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.globalCompositeOperation = 'source-over';
    off.clearRect(0, 0, width, height);
    renderScene(off, s.project, evaluateScene(s.project, skin.frame), view, images, { clip: false, background: false });
    off.setTransform(1, 0, 0, 1, 0, 0);
    off.globalCompositeOperation = 'source-in';
    off.fillStyle = skin.color;
    off.fillRect(0, 0, width, height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = skin.alpha;
    ctx.drawImage(onionCanvas, 0, 0);
    ctx.restore();
  }
}

// The drawing canvas: renders the scene, the editor overlays, and routes
// mouse input to the active tool. Wheel scrolls/pans; pinch or Cmd/Ctrl+wheel
// zooms; Space-drag or the middle button pans.

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let fitted = false;
    let spaceHeld = false;
    let panning: { last: { x: number; y: number } } | null = null;
    let activeTool: Tool | null = null;
    let buttonDown = false;

    const draw = () => {
      frame = 0;
      const s = store.getState();
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#26272b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const resolved = resolvedScene(s);
      const { zoom, panX, panY } = s.view;
      const view: Mat2D = [zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr];
      const images = (id: string) => getImage(id, s.assets.get(id), assetMimeType(s, id));
      const onion = s.mode === 'animate' && s.onion.enabled && !s.playing;
      if (onion) {
        // Scene background, then faint tinted copies of nearby frames, then this frame on top.
        ctx.setTransform(...view);
        ctx.fillStyle = s.project.scene.background;
        ctx.fillRect(0, 0, s.project.scene.width, s.project.scene.height);
        drawOnionSkins(ctx, s, view, images);
      }
      renderScene(ctx, s.project, resolved, view, images, { clip: false, background: !onion });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const o = makeOverlayContext(ctx, s, resolved);
      drawOutsideScene(o, canvas.width / dpr, canvas.height / dpr);
      if (s.grid.show) drawGrid(o);
      drawSelection(o);
      if (s.mode === 'animate') drawPins(o);
      TOOLS[s.tool].drawOverlay?.(o);
    };
    const requestDraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      store.set({ viewportSize: { width: w, height: h } });
      if (!fitted && w > 0 && h > 0) {
        fitted = true;
        zoomToFit();
      }
      requestDraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const pointer = (e: PointerEvent | MouseEvent): ToolPointer => {
      const rect = canvas.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      return {
        screen,
        scene: screenToScene(store.getState().view, screen),
        shift: e.shiftKey,
        alt: e.altKey,
        mod: e.metaKey || e.ctrlKey,
      };
    };

    const currentTool = (): Tool | null => {
      if (spaceHeld) return TOOLS.hand;
      return TOOLS[store.getState().tool];
    };

    const updateCursor = () => {
      canvas.style.cursor = panning ? 'grabbing' : (currentTool()?.cursor(store.getState()) ?? 'default');
    };

    const onDown = (e: PointerEvent) => {
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        panning = { last: { x: e.clientX, y: e.clientY } };
        updateCursor();
        return;
      }
      if (e.button !== 0) return;
      if (store.getState().playing) store.set({ playing: false });
      buttonDown = true;
      activeTool = currentTool();
      activeTool?.down?.(pointer(e));
      updateCursor();
    };
    const onMove = (e: PointerEvent) => {
      if (panning) {
        const dx = e.clientX - panning.last.x;
        const dy = e.clientY - panning.last.y;
        panning.last = { x: e.clientX, y: e.clientY };
        store.set((s) => ({ view: { ...s.view, panX: s.view.panX + dx, panY: s.view.panY + dy } }));
        return;
      }
      (buttonDown ? activeTool : currentTool())?.move?.(pointer(e), buttonDown);
    };
    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (panning) {
        panning = null;
        updateCursor();
        return;
      }
      if (!buttonDown) return;
      buttonDown = false;
      activeTool?.up?.(pointer(e));
      activeTool = null;
      updateCursor();
    };
    const onDoubleClick = (e: MouseEvent) => currentTool()?.doubleClick?.(pointer(e));
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = store.getState();
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel.
        const rect = canvas.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        store.set({ view: zoomAt(s.view, factor, { x: e.clientX - rect.left, y: e.clientY - rect.top }) });
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        store.set({ view: { ...s.view, panX: s.view.panX - e.deltaX * k, panY: s.view.panY - e.deltaY * k } });
      }
    };
    const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target) && store.getState().mode === 'build' && !spaceHeld) {
        spaceHeld = true;
        updateCursor();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceHeld) {
        spaceHeld = false;
        updateCursor();
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const onContextMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const unsubStore = store.subscribe(() => {
      requestDraw();
      if (!buttonDown) updateCursor();
    });
    const unsubOverlay = onInvalidate(requestDraw);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      unsubStore();
      unsubOverlay();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="viewport" data-testid="stage" tabIndex={0} />;
}
