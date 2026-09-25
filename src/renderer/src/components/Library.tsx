import { useEffect, useMemo, useState } from 'react';
import type { LibraryEntry } from '../../../preload/api';
import { addFromLibrary, libraryCandidate, refreshLibrary, removeFromLibrary, revealLibrary, saveSelectionToLibrary } from '../editor/library';
import { useEditor } from '../editor/store';

// The Library tab: reusable characters, backgrounds and shapes stored as
// files in the library folder (docs/DESIGN.md §7).

const KIND_LABEL: Record<LibraryEntry['kind'], string> = { character: 'Character', background: 'Background', parts: 'Shape' };

const thumbUrls = new Map<string, string>();
function thumbnailUrl(entry: LibraryEntry): string | null {
  if (!entry.thumbnail) return null;
  const key = `${entry.relPath}@${entry.modified}`;
  let url = thumbUrls.get(key);
  if (!url) {
    url = URL.createObjectURL(new Blob([entry.thumbnail as BlobPart], { type: 'image/png' }));
    thumbUrls.set(key, url);
  }
  return url;
}

function SaveForm({ defaultName, label, onDone }: { defaultName: string; label: string; onDone: () => void }) {
  const [name, setName] = useState(defaultName);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await saveSelectionToLibrary(
      name.trim(),
      tags.split(',').map((t) => t.trim()).filter(Boolean),
    );
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form
      className="save-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="hint">Saving: {label}</p>
      <input aria-label="Library item name" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" />
      <div className="buttons">
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Library() {
  const library = useEditor((s) => s.library);
  const candidate = useEditor(libraryCandidateKey);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const hasApi = !!window.nyah;

  useEffect(() => {
    void refreshLibrary();
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library.items;
    return library.items.filter((i) => [i.name, i.folder, ...i.tags].some((t) => t.toLowerCase().includes(q)));
  }, [library.items, query]);

  const info = candidate ? JSON.parse(candidate) as { label: string; defaultName: string } : null;
  let lastFolder: string | null = null;

  return (
    <div className="library">
      <div className="library-actions">
        <input className="search" aria-label="Search library" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={() => void refreshLibrary()} disabled={!hasApi} title="Reload the library folder">↻</button>
        <button onClick={revealLibrary} disabled={!hasApi} title={library.dir}>Folder</button>
      </div>
      {saving && info ? (
        <SaveForm key={info.defaultName} defaultName={info.defaultName} label={info.label} onDone={() => setSaving(false)} />
      ) : (
        <div className="save-row">
          <button className="save-button" disabled={!info || !hasApi} onClick={() => setSaving(true)}>
            Save to library…
          </button>
          <span className="hint">{info ? info.label : 'Select a layer or parts to save them.'}</span>
        </div>
      )}
      <div className="library-list" data-testid="library-list">
        {library.loaded && library.items.length === 0 && (
          <p className="empty">The library is empty. Select a character layer (or some parts) and save it here to reuse it in other projects.</p>
        )}
        {items.map((entry) => {
          const header = entry.folder !== lastFolder && entry.folder ? <div className="folder" key={`f:${entry.folder}`}>{entry.folder}</div> : null;
          lastFolder = entry.folder;
          const url = thumbnailUrl(entry);
          return [
            header,
            <div
              key={entry.relPath}
              className={`library-item ${entry.damaged ? 'damaged' : ''}`}
              data-testid="library-item"
              onDoubleClick={() => !entry.damaged && void addFromLibrary(entry)}
              title={entry.relPath}
            >
              <div className="thumb">{url ? <img src={url} alt="" /> : <span>?</span>}</div>
              <div className="meta">
                <strong>{entry.name}</strong>
                <span>{entry.damaged ? "Can't be read" : KIND_LABEL[entry.kind]}{entry.tags.length ? ` · ${entry.tags.join(', ')}` : ''}</span>
              </div>
              <button disabled={entry.damaged} onClick={() => void addFromLibrary(entry)}>Add</button>
              <button className="icon" aria-label={`Delete ${entry.name}`} onClick={() => void removeFromLibrary(entry)}>×</button>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}

/** A stable string for the save candidate, so the panel only re-renders when it changes. */
function libraryCandidateKey(s: Parameters<typeof libraryCandidate>[0]): string {
  const c = libraryCandidate(s);
  return c ? JSON.stringify(c) : '';
}
