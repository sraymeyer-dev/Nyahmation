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

export interface NyahApi {
  /** Shows an Open dialog. Resolves to null if cancelled. */
  openProject(): Promise<OpenedFile | null>;
  /** Saves to `path`, or shows a Save dialog when no path is given. Null if cancelled. */
  saveProject(bytes: Uint8Array, path?: string): Promise<SavedFile | null>;
}

declare global {
  interface Window {
    /** Undefined when the UI runs in a plain browser (e.g. UI tests). */
    nyah?: NyahApi;
  }
}
