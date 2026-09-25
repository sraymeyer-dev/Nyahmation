import type { Vec2 } from '../../../../engine/types';
import { store } from '../store';
import type { Tool, ToolPointer } from './types';

// Hand tool (and Space-drag): pan the canvas.

let last: Vec2 | null = null;

export const handTool: Tool = {
  cursor: () => (last ? 'grabbing' : 'grab'),
  down(p: ToolPointer) {
    last = p.screen;
  },
  move(p, dragging) {
    if (!dragging || !last) return;
    const dx = p.screen.x - last.x;
    const dy = p.screen.y - last.y;
    last = p.screen;
    store.set((s) => ({ view: { ...s.view, panX: s.view.panX + dx, panY: s.view.panY + dy } }));
  },
  up() {
    last = null;
  },
};
