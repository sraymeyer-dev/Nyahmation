import { useEffect } from 'react';
import { addLayer } from '../../engine/edit';
import { createProject } from '../../engine/project';
import type { MenuCommand } from '../../preload/api';
import * as actions from './editor/actions';
import * as library from './editor/library';
import * as lipsync from './editor/lipsync';
import { store, useEditor, type EditorState, type ToolId } from './editor/store';
import { deleteSelectedMarks, jumpToPose, setFrame, setLoopPoint } from './editor/animate';
import { toolsFor, TOOLS } from './editor/tools';
import { ExportDialog } from './components/ExportDialog';
import { Notice } from './components/Notice';
import { Sidebar } from './components/Sidebar';
import { ToolOptions } from './components/ToolOptions';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { Timeline } from './components/Timeline';
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
  saveToLibrary: () => store.set({ sidebarTab: 'library' }),
  autoChainRoots: library.autoChainRootsForActiveLayer,
  export: () => store.set({ exportOpen: true }),
  makeSwitchLayer: lipsync.makeSwitchLayerFromSelection,
};

const TOOL_KEYS = {
  build: new Map<string, ToolId>(toolsFor('build').map((t) => [t.key.toLowerCase(), t.id])),
  animate: new Map<string, ToolId>(toolsFor('animate').map((t) => [t.key.toLowerCase(), t.id])),
};

/**
 * Lip sync keys while a switch layer is selected in Animate mode (LS3): a
 * drawing's key (A–H, X for mouths) or its number 1–9 shows it on this frame;
 * Backspace steps back and clears. These win over tool keys (H is a mouth).
 */
function lipSyncKey(e: KeyboardEvent, s: EditorState): boolean {
  const active = lipsync.activeSwitch(s);
  if (!active || e.shiftKey) return false;
  if (e.key === 'Backspace' && !s.timeline.marks.length && !s.selectedClip) {
    lipsync.lipSyncBackspace();
    return true;
  }
  const byKey = active.set.drawings.find((d) => d.key.toLowerCase() === e.key.toLowerCase());
  const drawing = byKey ?? (/^[1-9]$/.test(e.key) ? active.set.drawings[Number(e.key) - 1] : undefined);
  if (!drawing) return false;
  lipsync.enterDrawing(drawing.key);
  return true;
}

function onKeyDown(e: KeyboardEvent): void {
  if (isTyping(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  const s = store.getState();
  if (s.exportOpen) return;
  if (s.mode === 'animate' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (lipSyncKey(e, s)) {
      e.preventDefault();
      return;
    }
    const tool = TOOL_KEYS.animate.get(e.key.toLowerCase());
    if (tool && !e.shiftKey) {
      actions.setTool(tool);
      return;
    }
    switch (e.key) {
      case ' ':
        e.preventDefault();
        store.set((st) => ({ playing: !st.playing }));
        return;
      case 'ArrowRight':
      case 'ArrowLeft': {
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) jumpToPose(d);
        else setFrame(s.frame + d);
        return;
      }
      case 'Home':
        setFrame(0);
        return;
      case 'End':
        setFrame(s.project.scene.durationFrames - 1);
        return;
      case 'i':
      case 'I':
        setLoopPoint('in');
        return;
      case 'o':
      case 'O':
        setLoopPoint('out');
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (s.selectedClip) actions.removeClip(s.selectedClip);
        else deleteSelectedMarks();
        return;
      case 'Escape':
        store.set((st) => ({ selection: [], selectedClip: null, timeline: { ...st.timeline, marks: [] } }));
        return;
    }
    return;
  }
  if (TOOLS[s.tool].keyDown?.(e)) {
    e.preventDefault();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return; // the menu handles shortcuts with modifiers
  const tool = TOOL_KEYS.build.get(e.key.toLowerCase());
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
        <Toolbar />
        <div className="center">
          <ToolOptions />
          <div className="stage">
            <Viewport />
            <Notice />
          </div>
          {mode === 'animate' && <Timeline />}
        </div>
        <Sidebar />
        <ExportDialog />
      </div>
    </div>
  );
}
