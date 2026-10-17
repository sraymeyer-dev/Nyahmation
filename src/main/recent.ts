import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Recently opened and saved projects, newest first, for File → Open Recent.
// Kept in the app's data folder; NYAH_RECENT_FILE overrides it (tests). The
// system's list (the Dock menu on a Mac, Jump Lists on Windows) is told too.

const LIMIT = 10;

let list: string[] | null = null;
const listeners = new Set<() => void>();

function recentFile(): string {
  return resolve(process.env.NYAH_RECENT_FILE || join(app.getPath('userData'), 'recent.json'));
}

export function recentProjects(): readonly string[] {
  if (!list) {
    try {
      const raw: unknown = JSON.parse(readFileSync(recentFile(), 'utf8'));
      list = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string').slice(0, LIMIT) : [];
    } catch {
      list = [];
    }
  }
  return list;
}

function update(next: string[]): void {
  list = next.slice(0, LIMIT);
  try {
    mkdirSync(dirname(recentFile()), { recursive: true });
    writeFileSync(recentFile(), JSON.stringify(list));
  } catch {
    // Not remembered next time; the menu still shows it now.
  }
  for (const l of listeners) l();
}

/** Calls `listener` whenever the list changes. */
export function onRecentChange(listener: () => void): void {
  listeners.add(listener);
}

/** Puts a project at the top of the list (it was just opened or saved). */
export function rememberProject(path: string): void {
  if (process.platform !== 'linux') app.addRecentDocument(path);
  if (recentProjects()[0] === path) return;
  update([path, ...recentProjects().filter((p) => p !== path)]);
}

/** Takes a project off the list (it couldn't be found). */
export function forgetProject(path: string): void {
  if (recentProjects().includes(path)) update(recentProjects().filter((p) => p !== path));
}

export function clearRecentProjects(): void {
  if (process.platform !== 'linux') app.clearRecentDocuments();
  update([]);
}
