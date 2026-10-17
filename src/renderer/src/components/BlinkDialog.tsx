import { useEffect, useState } from 'react';
import { addBlinks, closedDrawingOf } from '../../../engine/blink';
import { locatePart } from '../../../engine/edit';
import { store, useEditor } from '../editor/store';
import { NumberField } from './fields';

// Object → Add Blinks… (docs/DESIGN.md A14): blinks scattered over the scene
// at a natural, uneven rhythm, as ordinary poses.

/** In the closed-drawing list: squash the part instead of switching drawings. */
const SQUASH = '';

export function BlinkDialog() {
  const partId = useEditor((s) => s.blinkDialogFor);
  const project = useEditor((s) => s.project);
  const loop = useEditor((s) => s.loop);
  const [every, setEvery] = useState(4);
  const [range, setRange] = useState<'all' | 'loop'>('all');
  const [closed, setClosed] = useState(SQUASH);
  const [none, setNone] = useState(false);

  const loc = partId ? locatePart(project, partId) : undefined;
  const set = loc?.part.kind === 'switch' ? project.drawingSets.find((d) => d.id === loc.part.drawingSetId) : undefined;
  useEffect(() => {
    if (!partId) return;
    setNone(false);
    setRange(store.getState().loop ? 'loop' : 'all');
    setClosed(closedDrawingOf(store.getState().project, partId) ?? SQUASH);
  }, [partId]);

  if (!partId || !loc) return null;
  const close = () => store.set({ blinkDialogFor: null });
  const mouth = set?.vocabulary === 'mouth';
  const add = () => {
    const s = store.getState();
    const span = range === 'loop' && s.loop ? { from: s.loop.in, to: s.loop.out } : { from: 0, to: s.project.scene.durationFrames - 1 };
    const result = addBlinks(s.project, partId, { ...span, every, closed: closed === SQUASH ? undefined : closed });
    if (result.blinks === 0) {
      setNone(true);
      return;
    }
    store.commit(result.project, {
      blinkDialogFor: null,
      status: `Added ${result.blinks} blink${result.blinks === 1 ? '' : 's'} to ${loc.part.name}. Each is a pose you can move or delete; Undo removes them all.`,
    });
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-label="Add blinks" data-testid="blink-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Add blinks to “{loc.part.name}”</h2>
        <p className="hint">
          Blinks every few seconds, unevenly, the way people do, sometimes two at once. Frames where {loc.part.name} already has poses of its own are left alone.
        </p>
        {mouth ? (
          <p className="hint warn">This is a mouth. Select the eyes, then Add Blinks.</p>
        ) : (
          <>
            <label className="row">
              <span className="row-label">How</span>
              <select aria-label="Blink with" value={closed} onChange={(e) => setClosed(e.target.value)}>
                {set?.drawings.map((d) => (
                  <option key={d.key} value={d.key}>
                    Show the “{d.name}” drawing
                  </option>
                ))}
                <option value={SQUASH}>Squash it flat for a moment</option>
              </select>
            </label>
            <label className="row">
              <span className="row-label">Every</span>
              <NumberField label="Seconds between blinks" value={every} min={1} max={30} step={0.5} digits={1} onCommit={setEvery} suffix="seconds, about" />
            </label>
            <label className="row">
              <span className="row-label">Frames</span>
              <select aria-label="Blink range" value={range} onChange={(e) => setRange(e.target.value as 'all' | 'loop')}>
                <option value="all">Whole scene</option>
                {loop && (
                  <option value="loop">
                    Loop range ({loop.in + 1}–{loop.out + 1})
                  </option>
                )}
              </select>
            </label>
            {closed === SQUASH && <p className="hint">The part squashes toward its joint, so put the joint in the middle of the eyes.</p>}
            {none && <p className="hint warn">There was no room for a blink: the frames are too few, or already have poses of their own.</p>}
          </>
        )}
        <div className="buttons">
          <button className="primary" autoFocus disabled={mouth} onClick={add}>
            Add blinks
          </button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
