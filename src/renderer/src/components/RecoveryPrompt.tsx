import { describeTime, discardRecovery, restoreRecovery } from '../editor/recovery';
import { store, useEditor } from '../editor/store';

/** Offers back work autosaved before Nyahmation closed unexpectedly (docs/DESIGN.md F3). */
export function RecoveryPrompt() {
  const recoveries = useEditor((s) => s.recoveries);
  if (!recoveries.length) return null;
  return (
    <div className="notice recovery" role="alertdialog" aria-label="Recover unsaved work" data-testid="recovery">
      <strong>Nyahmation didn't close properly last time</strong>
      <p>Your unsaved work was saved automatically. Restore it to carry on where you left off.</p>
      <ul>
        {recoveries.map((r) => (
          <li key={r.id}>
            <span className="recovery-name">{r.name}</span> <span className="muted">autosaved {describeTime(r.savedAt)}</span>
            <span className="recovery-actions">
              <button className="primary" onClick={() => void restoreRecovery(r)}>Restore</button>
              <button onClick={() => void discardRecovery(r)}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      <button onClick={() => store.set({ recoveries: [] })} title="Ask again next time Nyahmation starts">Decide later</button>
    </div>
  );
}
