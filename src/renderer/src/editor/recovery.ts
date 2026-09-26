import { unpackProject } from '../../../io/projectFile';
import type { RecoveryEntry } from '../../../preload/api';
import { confirmDiscard, loadProject, packForSave } from './actions';
import { Autosaver } from './autosave';
import { store } from './store';

// Wires autosave to the app, and offers back work left by a crash
// (docs/DESIGN.md F3). See autosave.ts for when files are written.

const CHECK_EVERY_MS = 5_000;

let autosaver: Autosaver | null = null;

function tick(force = false) {
  if (!autosaver) return Promise.resolve('idle' as const);
  return autosaver.tick(store.getState(), { inGesture: store.inGesture, force }).catch((err: unknown) => {
    store.set({ status: `Autosave failed: ${(err as Error).message}` });
    return 'idle' as const;
  });
}

/** Starts autosaving and looks for work to recover. Returns a function that stops autosaving. */
export function startAutosave(): () => void {
  const api = window.nyah;
  if (!api) return () => {};
  autosaver = new Autosaver({ recovery: api.recovery, pack: packForSave });
  const timer = window.setInterval(() => void tick(), CHECK_EVERY_MS);
  void api.recovery.list().then((recoveries) => store.set({ recoveries }), () => {});
  return () => {
    window.clearInterval(timer);
    autosaver = null;
  };
}

function forget(id: string) {
  store.set((s) => ({ recoveries: s.recoveries.filter((r) => r.id !== id) }));
}

/** Opens autosaved work as an unsaved project. Saving writes it back to where it came from. */
export async function restoreRecovery(entry: RecoveryEntry): Promise<void> {
  const api = window.nyah;
  if (!api || !confirmDiscard()) return;
  try {
    const bundle = unpackProject(await api.recovery.read(entry.id));
    loadProject(bundle.project, bundle.assets, entry.path ? { path: entry.path, name: entry.name } : null);
    store.set({ dirty: true, status: `Restored “${entry.name}” as it was ${describeTime(entry.savedAt)}. Save to keep it.` });
    forget(entry.id);
    // Keep the old recovery file until this window has written its own copy.
    if ((await tick(true)) === 'wrote') await api.recovery.discard(entry.id);
  } catch (err) {
    store.set({ notice: { title: `Couldn't restore “${entry.name}”`, lines: [(err as Error).message] } });
  }
}

export async function discardRecovery(entry: RecoveryEntry): Promise<void> {
  if (!window.confirm(`Delete the autosaved copy of “${entry.name}”? This can't be undone.`)) return;
  forget(entry.id);
  await window.nyah?.recovery.discard(entry.id);
}

/** "at 3:41 PM today" or "at 3:41 PM on 24 Sept". */
export function describeTime(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `at ${time} today` : `at ${time} on ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
