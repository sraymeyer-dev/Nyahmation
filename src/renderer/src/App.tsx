import { useEffect } from 'react';
import { addLayer } from '../../engine/edit';
import { createProject } from '../../engine/project';
import type { MenuCommand } from '../../preload/api';
import * as actions from './editor/actions';
import { store, useEditor, type ToolId } from './editor/store';
import { TOOL_INFO, TOOLS } from './editor/tools';
import { Notice } from './components/Notice';
import { Outliner } from './components/Outliner';
import { Properties } from './components/Properties';
import { ToolOptions } from './components/ToolOptions';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { Transport } from './components/Transport';
import { Viewport } from './components/Viewport';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/** Menu Undo/Redo/Select All act on text while typing in a field. */
function textCommand(command: 'undo' | 'redo' | 'selectAll'): boolean {
  if (!isTyping(document.activeElement)) return false;
  document.execCommand(command);
  return true;
}

const MENU: Record<MenuCommand, () => void> = {
  new: actions.newProject,
  open: () => void actions.openProject(),
  openDemo: actions.openDemo,
  save: () => void actions.save(),
  saveAs: () => void actions.save(true),
  import: () => void actions.importFile(),
  undo: () => textCommand('undo') || store.undo(),
  redo: () => textCommand('redo') || store.redo(),
  duplicate: actions.duplicate,
  selectAll: () => textCommand('selectAll') || actions.selectAll(),
  deselect: actions.deselect,
  group: actions.group,
  ungroup: actions.ungroup,
  combine: actions.combine,
  bringForward: () => actions.arrange('forward'),
  sendBackward: () => actions.arrange('backward'),
  bringToFront: () => actions.arrange('front'),
  sendToBack: () => actions.arrange('back'),
  newCharacterLayer: () => actions.newLayer('character'),
  newBackgroundLayer: () => actions.newLayer('background'),
  zoomIn: () => actions.zoomBy(1.25),
  zoomOut: () => actions.zoomBy(1 / 1.25),
  zoomFit: actions.zoomToFit,
  zoom100: actions.zoomActualSize,
  toggleGrid: actions.toggleGrid,
  toggleSnap: actions.toggleSnap,
};

const TOOL_KEYS = new Map<string, ToolId>(TOOL_INFO.map((t) => [t.key.toLowerCase(), t.id]));

function onKeyDown(e: KeyboardEvent): void {
  if (isTyping(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  const s = store.getState();
  if (s.mode === 'animate') {
    if (e.code === 'Space') {
      e.preventDefault();
      store.set((st) => ({ playing: !st.playing }));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const n = s.project.scene.durationFrames;
      store.set({ playing: false, frame: (s.frame + d + n) % n });
    }
    return;
  }
  if (TOOLS[s.tool].keyDown?.(e)) {
    e.preventDefault();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return; // the menu handles shortcuts with modifiers
  const tool = TOOL_KEYS.get(e.key.toLowerCase());
  if (tool && !e.shiftKey) {
    actions.setTool(tool);
    return;
  }
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      actions.deleteSelection();
      break;
    case 'Escape':
      if (s.points.length) store.set({ points: [] });
      else actions.deselect();
      break;
    case 'Enter':
      if (e.shiftKey) actions.selectParent();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      actions.nudge(-step, 0);
      break;
    case 'ArrowRight':
      e.preventDefault();
      actions.nudge(step, 0);
      break;
    case 'ArrowUp':
      e.preventDefault();
      actions.nudge(0, -step);
      break;
    case 'ArrowDown':
      e.preventDefault();
      actions.nudge(0, step);
      break;
  }
}

export function App() {
  const mode = useEditor((s) => s.mode);

  useEffect(() => {
    // Start with an empty scene that has one background layer to draw on.
    const { project } = addLayer(createProject(), 'background', 'Background');
    store.load(project, new Map(), null);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    const unsubscribeMenu = window.nyah?.onMenuCommand((cmd) => MENU[cmd]?.());

    // Finish in-progress drawing when the tool or mode changes, and keep the
    // window title and unsaved-changes prompt up to date.
    let prev = store.getState();
    const unsubscribe = store.subscribe(() => {
      const s = store.getState();
      if (s.tool !== prev.tool || s.mode !== prev.mode) TOOLS[prev.tool].finish?.();
      if (s.dirty !== prev.dirty || s.file !== prev.file) {
        window.nyah?.setDocumentState({ title: s.file?.name ?? 'Untitled', path: s.file?.path ?? null, dirty: s.dirty });
      }
      prev = s;
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubscribeMenu?.();
      unsubscribe();
    };
  }, []);

  return (
    <div className={`app mode-${mode}`}>
      <TopBar />
      <div className="workspace">
        {mode === 'build' && <Toolbar />}
        <div className="center">
          <ToolOptions />
          <div className="stage">
            <Viewport />
            <Notice />
          </div>
          {mode === 'animate' && <Transport />}
        </div>
        <aside className="sidebar">
          <Outliner />
          <Properties />
        </aside>
      </div>
    </div>
  );
}
