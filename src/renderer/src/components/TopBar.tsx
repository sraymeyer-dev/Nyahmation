import { importFile, save, setMode } from '../editor/actions';
import { useEditor } from '../editor/store';

export function TopBar() {
  const file = useEditor((s) => s.file);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const status = useEditor((s) => s.status);
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
      <button onClick={() => void importFile()} disabled={!hasApi}>Import…</button>
      <button onClick={() => void save()} disabled={!hasApi}>Save</button>
    </header>
  );
}
