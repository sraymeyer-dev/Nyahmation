import { useEffect, useState } from 'react';
import { runAutoLipSync } from '../editor/autoLipSync';
import { store, useEditor } from '../editor/store';

// Auto lip sync… (docs/DESIGN.md LS7): pick the dialogue, optionally type the
// words, and Rhubarb Lip Sync fills in the mouth shapes.

export function LipSyncDialog() {
  const mouthId = useEditor((s) => s.lipSyncDialogFor);
  const project = useEditor((s) => s.project);
  const frame = useEditor((s) => s.frame);
  const [clipId, setClipId] = useState('');
  const [script, setScript] = useState('');
  const [recognizer, setRecognizer] = useState<'english' | 'phonetic'>('english');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  const clips = project.scene.audio;
  useEffect(() => {
    if (!mouthId) return;
    setError(null);
    setProgress(null);
    // Start with the sound under the playhead, or the first one.
    const fps = project.scene.fps;
    const under = clips.find((c) => frame >= c.startFrame && frame < c.startFrame + c.duration * fps);
    setClipId((under ?? clips[0])?.id ?? '');
    void window.nyah?.lipSync.available().then(setAvailable);
    return window.nyah?.lipSync.onProgress((v) => setProgress(v));
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mouthId]);

  if (!mouthId) return null;
  const mouth = findName(project, mouthId);
  const busy = progress !== null && !error;
  const close = () => {
    if (busy) return;
    store.set({ lipSyncDialogFor: null });
  };
  const start = async () => {
    setError(null);
    setProgress(0);
    try {
      await runAutoLipSync(mouthId, clipId, { script, recognizer });
      store.set({ lipSyncDialogFor: null });
    } catch (err) {
      const message = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      setError(message);
      setProgress(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-label="Auto lip sync" onClick={(e) => e.stopPropagation()} data-testid="lipsync-dialog">
        <h2>Auto lip sync for “{mouth}”</h2>
        <p className="hint">Listens to the dialogue and fills in the mouth shapes (A–H, X) for the length of the sound. Anything already there during the sound is replaced; you can undo it.</p>
        {clips.length === 0 ? (
          <p className="hint warn">Import the dialogue first (File → Import Art or Sound…).</p>
        ) : (
          <>
            <label className="row">
              <span className="row-label">Sound</span>
              <select aria-label="Dialogue sound" value={clipId} disabled={busy} onChange={(e) => setClipId(e.target.value)}>
                {clips.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (from frame {c.startFrame + 1}, {c.duration.toFixed(1)} s)
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <span className="row-label">Language</span>
              <select aria-label="Dialogue language" value={recognizer} disabled={busy} onChange={(e) => setRecognizer(e.target.value as 'english' | 'phonetic')}>
                <option value="english">English</option>
                <option value="phonetic">Another language (by sound)</option>
              </select>
            </label>
            <label className="column">
              <span className="row-label">The words (optional, but it helps)</span>
              <textarea aria-label="Dialogue words" rows={3} value={script} disabled={busy} placeholder="Type what is said, exactly as spoken." onChange={(e) => setScript(e.target.value)} />
            </label>
          </>
        )}
        {available === false && (
          <p className="hint warn" data-testid="lipsync-missing">
            Automatic lip sync isn't installed yet. In Terminal, in the Nyahmation folder, run <code>npm run setup</code> (it downloads about 90 MB), then restart Nyahmation.
          </p>
        )}
        {busy && (
          <div className="progress" aria-label="Lip sync progress">
            <div className="bar" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            <span>Listening… {Math.round((progress ?? 0) * 100)}%</span>
          </div>
        )}
        {error && <p className="hint warn">Lip sync failed: {error}</p>}
        <div className="buttons">
          {busy ? (
            <button onClick={() => void window.nyah?.lipSync.cancel()}>Cancel</button>
          ) : (
            <>
              <button className="primary" onClick={() => void start()} disabled={!clipId || available === false}>
                Start
              </button>
              <button onClick={close}>Close</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function findName(project: ReturnType<typeof store.getState>['project'], id: string): string {
  for (const layer of project.scene.layers) {
    const stack = [layer.root];
    while (stack.length) {
      const p = stack.pop()!;
      if (p.id === id) return p.name;
      stack.push(...p.children);
    }
  }
  return 'mouth';
}
