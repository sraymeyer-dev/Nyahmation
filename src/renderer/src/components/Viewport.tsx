import { useEffect, useRef } from 'react';
import { assetMimeType, resolvedScene, zoomToFit } from '../editor/actions';
import { drawGrid, drawOutsideScene, drawSelection, makeOverlayContext } from '../editor/overlay';
import { store } from '../editor/store';
import { onInvalidate } from '../editor/tools/common';
import { TOOLS } from '../editor/tools';
import type { Tool, ToolPointer } from '../editor/tools/types';
import { screenToScene, zoomAt } from '../editor/view';
import { getImage } from '../render/images';
import { recordPlaybackDraw } from '../render/perf';
import { renderPreview } from '../render/preview';
import { drawPins } from '../editor/tools/pin';

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
      const started = performance.now();
      const s = store.getState();
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#26272b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const resolved = resolvedScene(s);
      const images = (id: string) => getImage(id, s.assets.get(id), assetMimeType(s, id));
      renderPreview(ctx, s, resolved, dpr, images);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const o = makeOverlayContext(ctx, s, resolved);
      drawOutsideScene(o, canvas.width / dpr, canvas.height / dpr);
      if (s.grid.show) drawGrid(o);
      drawSelection(o);
      if (s.mode === 'animate') drawPins(o);
      TOOLS[s.tool].drawOverlay?.(o);
      if (s.playing) recordPlaybackDraw(s.frame, performance.now() - started);
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
