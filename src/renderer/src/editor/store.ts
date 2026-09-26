import { useSyncExternalStore } from 'react';
import { locatePart } from '../../../engine/edit';
import { defaultStyle } from '../../../engine/geometry';
import { createProject } from '../../../engine/project';
import type { Project, ShapeStyle } from '../../../engine/types';
import type { LibraryEntry, RecoveryEntry } from '../../../preload/api';

// Editor state and undo history. The project is immutable, so every undo
// step is simply an earlier project object; unchanged parts are shared
// between steps, which keeps history cheap (docs/DESIGN.md D-31).

export type ToolId = 'select' | 'points' | 'joint' | 'pose' | 'pin' | 'camera' | 'pen' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'hand';
export type Mode = 'build' | 'animate';
/** Preview resolution (docs/DESIGN.md N9): full, half or quarter. Export is always full. */
export type PreviewQuality = 1 | 0.5 | 0.25;

export interface View {
  /** Screen pixels per scene unit. */
  zoom: number;
  /** Screen position (CSS px, relative to the canvas) of the scene origin. */
  panX: number;
  panY: number;
}

/** A pose mark on the timeline: a row (scene, layer or part) and a frame. */
export interface MarkRef {
  row: 'scene' | 'layer' | 'part';
  /** Layer id or part id ('' for the scene row). */
  id: string;
  frame: number;
}

export interface PointRef {
  path: number;
  index: number;
}

export interface EditorState {
  project: Project;
  /** Embedded file bytes by asset id (images now, audio later). */
  assets: ReadonlyMap<string, Uint8Array>;
  file: { path: string; name: string } | null;
  dirty: boolean;
  mode: Mode;
  tool: ToolId;
  selection: readonly string[];
  /** Selected points on the first selected shape, for the Points tool. */
  points: readonly PointRef[];
  /** Where new parts go when nothing suitable is selected. */
  activeLayerId: string | null;
  view: View;
  /** Canvas size in CSS pixels, reported by the viewport. */
  viewportSize: { width: number; height: number };
  grid: { show: boolean; snap: boolean; size: number };
  /** Style for newly drawn shapes: the last style you used. */
  style: ShapeStyle;
  toolOptions: { cornerRadius: number; polygonSides: number; starPoints: number; starInner: number };
  frame: number;
  playing: boolean;
  /** Messages for the user, such as import warnings. */
  notice: { title: string; lines: string[] } | null;
  status: string;
  /** Increments when decoded images become available, so the canvas redraws. */
  imagesVersion: number;
  sidebarTab: 'layers' | 'library';
  /** Playback loops between these frames (inclusive) when set. */
  loop: { in: number; out: number } | null;
  onion: { enabled: boolean; before: number; after: number; step: number };
  /** Timeline zoom (pixels per frame) and selected pose marks. */
  timeline: { zoom: number; marks: readonly MarkRef[] };
  exportOpen: boolean;
  /** Play a snippet of sound when stepping or scrubbing (LS2). */
  audioScrub: boolean;
  /** The audio clip selected on the timeline. */
  selectedClip: string | null;
  /** Frames the playhead moves after each typed mouth sound (LS3a). */
  lipSyncStep: 1 | 2;
  /** Increments when decoded audio becomes available, so waveforms redraw. */
  audioVersion: number;
  library: { dir: string; items: readonly LibraryEntry[]; loaded: boolean };
  /** How sharply the canvas draws the scene; lower is faster (N9). */
  previewQuality: PreviewQuality;
  /** Preview characters on ones even if they animate on twos or threes (ST6). Export is unaffected. */
  viewOnOnes: boolean;
  /** Animate mode: look through the camera, as the video will be (docs/DESIGN.md CAM3). Otherwise the stage is shown with the camera's frame on it. */
  cameraView: boolean;
  /** The camera is selected (its timeline row, or the Camera tool): Properties shows it. */
  cameraSelected: boolean;
  /** Autosaved work from a session that didn't close normally, offered back (F3). */
  recoveries: readonly RecoveryEntry[];
}

const QUALITY_KEY = 'nyah.previewQuality';

/** The preview quality chosen last time (a per-computer preference, not part of the project). */
function savedQuality(): PreviewQuality {
  try {
    const q = Number(localStorage.getItem(QUALITY_KEY));
    return q === 0.5 || q === 0.25 ? q : 1;
  } catch {
    return 1;
  }
}

export function rememberQuality(q: PreviewQuality): void {
  try {
    localStorage.setItem(QUALITY_KEY, String(q));
  } catch {
    // Not remembered; it still applies now.
  }
}

const HISTORY_LIMIT = 200;

function initialState(): EditorState {
  return {
    project: createProject(),
    assets: new Map(),
    file: null,
    dirty: false,
    mode: 'build',
    tool: 'select',
    selection: [],
    points: [],
    activeLayerId: null,
    view: { zoom: 0.5, panX: 40, panY: 40 },
    viewportSize: { width: 800, height: 600 },
    grid: { show: false, snap: false, size: 20 },
    style: defaultStyle({ fill: '#f2c9a0', stroke: '#3b2a20', strokeWidth: 4 }),
    toolOptions: { cornerRadius: 0, polygonSides: 6, starPoints: 5, starInner: 0.5 },
    frame: 0,
    playing: false,
    notice: null,
    status: '',
    imagesVersion: 0,
    sidebarTab: 'layers',
    loop: null,
    onion: { enabled: false, before: 2, after: 2, step: 2 },
    timeline: { zoom: 14, marks: [] },
    exportOpen: false,
    audioScrub: true,
    selectedClip: null,
    lipSyncStep: 1,
    audioVersion: 0,
    library: { dir: '', items: [], loaded: false },
    previewQuality: savedQuality(),
    viewOnOnes: false,
    cameraView: true,
    cameraSelected: false,
    recoveries: [],
  };
}

type Listener = () => void;

export class EditorStore {
  private state: EditorState = initialState();
  private past: Project[] = [];
  private future: Project[] = [];
  private listeners = new Set<Listener>();
  /** Project at the start of a drag, so the whole drag is one undo step. */
  private gestureBase: Project | null = null;

  getState = (): EditorState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  private lastCoalesce: { key: string; time: number } | null = null;

  /**
   * Replaces the project as one undoable step. Repeated commits with the same
   * `coalesceKey` within a second (dragging a color picker, typing a value)
   * merge into a single step.
   */
  commit(project: Project, extra: Partial<EditorState> = {}, coalesceKey?: string): void {
    if (project === this.state.project) {
      if (Object.keys(extra).length) this.set(extra);
      return;
    }
    const now = Date.now();
    const merge = coalesceKey !== undefined && this.lastCoalesce?.key === coalesceKey && now - this.lastCoalesce.time < 1000;
    if (!this.gestureBase && !merge) this.pushHistory(this.state.project);
    this.lastCoalesce = coalesceKey !== undefined ? { key: coalesceKey, time: now } : null;
    this.set({ project, dirty: true, ...extra });
  }

  /** Starts a drag: changes until endGesture() become a single undo step. */
  beginGesture(): void {
    this.gestureBase = this.state.project;
  }

  /** Updates the project during a drag without adding history. */
  preview(project: Project, extra: Partial<EditorState> = {}): void {
    this.set({ project, ...extra });
  }

  endGesture(): void {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (base && base !== this.state.project) {
      this.pushHistory(base);
      this.set({ dirty: true });
    }
  }

  get inGesture(): boolean {
    return this.gestureBase !== null;
  }

  private pushHistory(project: Project): void {
    if (this.past.at(-1) === project) return;
    this.past.push(project);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    this.lastCoalesce = null;
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.project);
    this.set((s) => ({ project: previous, dirty: true, ...this.pruneSelection(previous, s) }));
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.project);
    this.set((s) => ({ project: next, dirty: true, ...this.pruneSelection(next, s) }));
  }

  private pruneSelection(project: Project, s: EditorState): Partial<EditorState> {
    const selection = s.selection.filter((id) => locatePart(project, id));
    return { selection, points: selection.length === s.selection.length ? s.points : [] };
  }

  /** Loads a different document, clearing history. */
  load(project: Project, assets: ReadonlyMap<string, Uint8Array>, file: EditorState['file']): void {
    this.past = [];
    this.future = [];
    this.gestureBase = null;
    this.set({
      project,
      assets,
      file,
      dirty: false,
      selection: [],
      points: [],
      activeLayerId: project.scene.layers.at(-1)?.id ?? null,
      frame: 0,
      playing: false,
      notice: null,
    });
  }
}

export const store = new EditorStore();

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
