import type { Vec2 } from '../../../engine/types';
import { importAudio, importBytes, isSoundFile, openProjectFile } from './actions';
import { fromScreen } from './screen';
import { store } from './store';

// Files dragged from Finder or Explorer onto the window: a project opens;
// art (SVG, PNG, JPEG) is imported where it was dropped on the canvas; sounds
// go on the Sound row, like File → Import.

const ART = /\.(svg|png|jpe?g)$/i;
const PROJECT = /\.nyah$/i;

export async function dropFiles(files: readonly File[], at: Vec2 | null): Promise<void> {
  const project = files.find((f) => PROJECT.test(f.name));
  if (project) {
    const path = window.nyah?.pathForFile(project) ?? null;
    const bytes = new Uint8Array(await project.arrayBuffer());
    // Without a place on disk it opens as a new, unsaved project.
    const opened = openProjectFile({ path: path ?? '', name: project.name, bytes });
    if (opened && files.length > 1) store.set({ status: `Opened ${project.name}. Drop other files on their own to import them.` });
    return;
  }
  const skipped: string[] = [];
  for (const file of files) {
    if (!ART.test(file.name) && !isSoundFile(file.name)) {
      skipped.push(file.name);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isSoundFile(file.name)) await importAudio(file.name, bytes);
    else importBytes(file.name, bytes, at ?? undefined);
  }
  if (skipped.length) {
    store.set({
      notice: {
        title: skipped.length === 1 ? `Couldn't import ${skipped[0]}` : `Couldn't import ${skipped.length} files`,
        lines: [...(skipped.length > 1 ? skipped : []), 'Drop SVG, PNG or JPEG art, WAV, MP3, M4A, OGG or FLAC sound, or a .nyah project.'],
      },
    });
  }
}

/** Lets files be dropped anywhere on the window. Returns a function that stops it. */
export function acceptDroppedFiles(): () => void {
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    // Never let the window navigate to the file.
    e.preventDefault();
    const s = store.getState();
    if (s.exportOpen || s.lipSyncDialogFor) return;
    const canvas = document.querySelector<HTMLElement>('[data-testid="stage"]');
    const rect = canvas?.getBoundingClientRect();
    const onCanvas = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    const at = onCanvas ? fromScreen(s, { x: e.clientX - rect.left, y: e.clientY - rect.top }) : null;
    dropFiles([...e.dataTransfer!.files], at).catch((err: Error) => store.set({ notice: { title: "Couldn't open the dropped files", lines: [err.message] } }));
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}
