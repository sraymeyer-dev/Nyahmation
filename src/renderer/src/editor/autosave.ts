import type { Project } from '../../../engine/types';
import type { RecoveryApi } from '../../../preload/api';
import type { EditorState } from './store';

// Autosave (docs/DESIGN.md F3). While there are unsaved changes, the project
// is written to a recovery file: soon after the first change, then at most
// once a minute while you keep working. Saving, or opening something else,
// deletes the recovery file. It is never written in the middle of a drag.

export const AUTOSAVE_INTERVAL_MS = 60_000;

type Snapshot = Pick<EditorState, 'project' | 'assets' | 'dirty' | 'file'>;

export interface AutosaveDeps {
  recovery: Pick<RecoveryApi, 'write' | 'clear'>;
  pack: (s: Snapshot) => Uint8Array;
  now?: () => number;
  intervalMs?: number;
}

export class Autosaver {
  private written: { project: Project; assets: Snapshot['assets'] } | null = null;
  private hasFile = false;
  private lastWrite = -Infinity;
  private busy = false;

  constructor(private readonly deps: AutosaveDeps) {}

  /** Call regularly. Writes, clears or does nothing; `force` skips the once-a-minute limit. */
  async tick(s: Snapshot, options: { inGesture?: boolean; force?: boolean } = {}): Promise<'wrote' | 'cleared' | 'idle'> {
    if (this.busy) return 'idle';
    const now = (this.deps.now ?? Date.now)();
    if (!s.dirty) {
      if (!this.hasFile) return 'idle';
      return this.run(async () => {
        await this.deps.recovery.clear();
        this.hasFile = false;
        this.written = null;
        return 'cleared' as const;
      });
    }
    if (options.inGesture) return 'idle';
    if (this.written && this.written.project === s.project && this.written.assets === s.assets) return 'idle';
    if (!options.force && now - this.lastWrite < (this.deps.intervalMs ?? AUTOSAVE_INTERVAL_MS)) return 'idle';
    // Counts as a write even if it fails, so a full disk isn't retried every few seconds.
    this.lastWrite = now;
    return this.run(async () => {
      await this.deps.recovery.write(this.deps.pack(s), { name: s.file?.name ?? 'Untitled', path: s.file?.path ?? null });
      this.written = { project: s.project, assets: s.assets };
      this.hasFile = true;
      return 'wrote' as const;
    });
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
}
