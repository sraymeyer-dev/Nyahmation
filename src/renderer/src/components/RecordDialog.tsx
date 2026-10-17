import { useEffect, useRef, useState } from 'react';
import { startRecording, type Recording } from '../audio/recorder';
import { importAudio } from '../editor/actions';
import { store, useEditor } from '../editor/store';

// Record dialogue (docs/DESIGN.md AU6): straight from the microphone onto
// the Sound row, starting at the playhead. Listen to it, then keep it or try
// again.

type Take = { wav: Uint8Array; seconds: number; url: string };

/** "Line 1", "Line 2"…: the next name not used by a sound in the project. */
function nextLineName(names: readonly string[]): string {
  let n = 1;
  while (names.includes(`Line ${n}`)) n++;
  return `Line ${n}`;
}

export function RecordDialog() {
  const open = useEditor((s) => s.recordOpen);
  // Imported sounds start at the playhead in Animate mode, otherwise on frame 1.
  const frame = useEditor((s) => (s.mode === 'animate' ? s.frame : 0));
  const fps = useEditor((s) => s.project.scene.fps);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const live = useRef<Recording | null>(null);

  // The meter and the clock, while recording.
  useEffect(() => {
    if (!recording) return;
    let raf = requestAnimationFrame(function tick() {
      setLevel(recording.level());
      setElapsed(recording.elapsed());
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [recording]);

  // Closing the dialog (or the app) never leaves the microphone on.
  useEffect(() => () => live.current?.cancel(), []);

  if (!open) return null;

  const forgetTake = () => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
  };
  const close = () => {
    live.current?.cancel();
    live.current = null;
    setRecording(null);
    forgetTake();
    setError(null);
    store.set({ recordOpen: false });
  };
  const start = async () => {
    forgetTake();
    setError(null);
    setBusy(true);
    try {
      if (!(await window.nyah?.askForMicrophone())) throw new Error('Nyahmation isn’t allowed to use the microphone.');
      const r = await startRecording();
      live.current = r;
      setRecording(r);
    } catch (err) {
      const mac = navigator.platform.toLowerCase().includes('mac');
      setError(`${(err as Error).message}${/allowed/.test((err as Error).message) && mac ? ' Turn it on for Nyahmation in System Settings → Privacy & Security → Microphone, then try again.' : ''}`);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    const r = live.current;
    if (!r) return;
    live.current = null;
    setRecording(null);
    setBusy(true);
    try {
      const result = await r.stop();
      setTake({ ...result, url: URL.createObjectURL(new Blob([result.wav as BlobPart], { type: 'audio/wav' })) });
    } catch (err) {
      setError(`The recording couldn't be read (${(err as Error).message}).`);
    } finally {
      setBusy(false);
    }
  };
  const keep = async () => {
    if (!take) return;
    const name = nextLineName(store.getState().project.scene.audio.map((c) => c.name));
    await importAudio(`${name}.wav`, take.wav);
    close();
  };

  return (
    <div className="modal-backdrop" onClick={() => !recording && !busy && close()}>
      <div className="modal record" role="dialog" aria-label="Record dialogue" data-testid="record-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Record dialogue</h2>
        <p className="hint">
          The recording goes on the Sound row from frame {frame + 1} (where the playhead is). Then you can lip sync to it.
        </p>
        {recording ? (
          <>
            <div className="record-status">
              <span className="record-dot" aria-hidden />
              <span data-testid="record-time">Recording… {elapsed.toFixed(1)} s</span>
            </div>
            <div className="level" aria-label="Microphone level">
              <div className="bar" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
          </>
        ) : take ? (
          <>
            <p className="hint">
              {take.seconds.toFixed(1)} s ({Math.ceil(take.seconds * fps)} frames). Listen, then keep it or try again.
            </p>
            <audio controls src={take.url} aria-label="Listen to the recording" />
          </>
        ) : (
          <p className="hint">Use headphones if the scene has other sounds, so the microphone doesn't hear them.</p>
        )}
        {error && <p className="hint warn">{error}</p>}
        <div className="buttons">
          {recording ? (
            <button className="primary" autoFocus onClick={() => void stop()}>
              Stop
            </button>
          ) : (
            <>
              {take && (
                <button className="primary" disabled={busy} onClick={() => void keep()}>
                  Keep it
                </button>
              )}
              <button className={take ? '' : 'primary'} autoFocus disabled={busy || !window.nyah} onClick={() => void start()}>
                {take ? 'Try again' : 'Start recording'}
              </button>
              <button disabled={busy} onClick={close}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
