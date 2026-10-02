import { importFile, save, setMode } from '../editor/actions';
import { QUALITIES } from '../editor/previewSpeed';
import { rememberQuality, store, useEditor, type PreviewQuality } from '../editor/store';

export function TopBar() {
  const file = useEditor((s) => s.file);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const status = useEditor((s) => s.status);
  const quality = useEditor((s) => s.previewQuality);
  const hasApi = !!window.nyah;
  return (
    <header className="topbar">
      <span className="title">Nyahmation</span>
      <span className="file">
        {file?.name ?? 'Untitled'}
        {dirty && <span className="dirty" title="Unsaved changes"> •</span>}
      </span>
      <div className="mode-switch" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={mode === 'build'} className={mode === 'build' ? 'active' : ''} onClick={() => setMode('build')}>Build</button>
        <button role="tab" aria-selected={mode === 'animate'} className={mode === 'animate' ? 'active' : ''} onClick={() => setMode('animate')}>Animate</button>
      </div>
      <span className="status">{status}</span>
      <div className="spacer" />
      <label className="preview-quality" title="Draw the canvas at lower resolution if playback stutters. Export is always full quality. View → Measure Preview Speed suggests one.">
        Preview
        <select
          aria-label="Preview quality"
          value={quality}
          onChange={(e) => {
            const q = Number(e.target.value) as PreviewQuality;
            rememberQuality(q);
            store.set({ previewQuality: q });
          }}
        >
          {QUALITIES.map((x) => (
            <option key={x.quality} value={x.quality}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => void importFile()} disabled={!hasApi}>Import…</button>
      <button onClick={() => void save()} disabled={!hasApi}>Save</button>
    </header>
  );
}
