// The API the preload script exposes to the renderer as `window.nyah`.

export interface OpenedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export interface SavedFile {
  path: string;
  name: string;
}

export interface ImportedFile {
  name: string;
  bytes: Uint8Array;
}

export interface LibraryEntry {
  /** Path inside the library folder, with forward slashes. */
  relPath: string;
  /** Subfolder ('' for the top level). */
  folder: string;
  name: string;
  kind: 'character' | 'background' | 'parts';
  tags: string[];
  thumbnail: Uint8Array | null;
  modified: number;
  /** The file couldn't be read. */
  damaged?: boolean;
}

export interface LibraryApi {
  list(): Promise<{ dir: string; items: LibraryEntry[] }>;
  read(relPath: string): Promise<Uint8Array>;
  /** Saves a new item in the top of the library folder; returns its path (a number is added if the name is taken). */
  save(name: string, bytes: Uint8Array): Promise<string>;
  /** Moves an item to the Trash / Recycle Bin. */
  remove(relPath: string): Promise<void>;
  /** Opens the library folder in Finder / Explorer. */
  reveal(): Promise<void>;
}

export type ExportFormat = 'mp4' | 'png';

export interface ExportApi {
  /** Asks where to save: a .mp4 file, or a folder for PNG frames. Null if cancelled. */
  choose(format: ExportFormat, suggestedName: string): Promise<string | null>;
  begin(options: { format: ExportFormat; path: string; width: number; height: number; fps: number }): Promise<number>;
  /** MP4: raw RGBA pixels (width × height × 4 bytes). PNG: an encoded PNG file. */
  frame(session: number, index: number, bytes: Uint8Array): Promise<void>;
  end(session: number): Promise<{ path: string }>;
  cancel(session: number): Promise<void>;
}

/** Commands sent from the native menu (see src/main/menu.ts). */
export type MenuCommand =
  | 'new'
  | 'open'
  | 'openDemo'
  | 'save'
  | 'saveAs'
  | 'import'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'selectAll'
  | 'deselect'
  | 'group'
  | 'ungroup'
  | 'combine'
  | 'bringForward'
  | 'sendBackward'
  | 'bringToFront'
  | 'sendToBack'
  | 'newCharacterLayer'
  | 'newBackgroundLayer'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomFit'
  | 'zoom100'
  | 'toggleGrid'
  | 'toggleSnap'
  | 'saveToLibrary'
  | 'autoChainRoots'
  | 'export';

export interface NyahApi {
  /** Shows an Open dialog. Resolves to null if cancelled. */
  openProject(): Promise<OpenedFile | null>;
  /** Saves to `path`, or shows a Save dialog when no path is given. Null if cancelled. */
  saveProject(bytes: Uint8Array, path?: string): Promise<SavedFile | null>;
  /** Shows an Import dialog for SVG, PNG and JPEG files. Null if cancelled. */
  importFile(): Promise<ImportedFile | null>;
  /** Subscribes to native menu commands. Returns an unsubscribe function. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  library: LibraryApi;
  export: ExportApi;
  /** Tells the window about the document, for its title and the unsaved-changes prompt. */
  setDocumentState(state: { title: string; path: string | null; dirty: boolean }): void;
}

declare global {
  interface Window {
    /** Undefined when the UI runs in a plain browser (e.g. UI tests). */
    nyah?: NyahApi;
  }
}
