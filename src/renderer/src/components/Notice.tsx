import { store, useEditor } from '../editor/store';

export function Notice() {
  const notice = useEditor((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="notice" role="status" data-testid="notice">
      <strong>{notice.title}</strong>
      <ul>
        {notice.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <button onClick={() => store.set({ notice: null })} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}
