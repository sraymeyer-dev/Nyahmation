import { drawingAt, MOUTH_SHAPES } from '../../../engine/drawings';
import type { AudioClip, Part } from '../../../engine/types';
import { removeClip, updateClip } from '../editor/actions';
import * as lipsync from '../editor/lipsync';
import { store, useEditor } from '../editor/store';
import { DrawingThumb } from './DrawingThumb';
import { NumberField, Row, Section } from './fields';

/** A switch layer's drawings: keys, the rest drawing, and adding more (docs/DESIGN.md §8). */
export function SwitchSection({ part }: { part: Part }) {
  const project = useEditor((s) => s.project);
  const mode = useEditor((s) => s.mode);
  const showing = useEditor((s) => (s.mode === 'animate' ? drawingAt(s.project, part.id, s.frame) : part.restDrawing));
  const set = project.drawingSets.find((d) => d.id === part.drawingSetId);
  if (!set) return null;
  const mouth = set.vocabulary === 'mouth';
  const missing = mouth ? MOUTH_SHAPES.filter((m) => !set.drawings.some((d) => d.key === m.key)) : [];
  return (
    <Section title="Drawings">
      <Row label="Drawing set">
        <select aria-label="Drawing set" value={set.id} onChange={(e) => lipsync.useDrawingSet(part.id, e.target.value)}>
          {project.drawingSets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Set name">
        <input
          aria-label="Set name"
          key={set.id + set.name}
          defaultValue={set.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== set.name) lipsync.renameSet(set.id, name);
          }}
        />
      </Row>
      <Row label="Used for">
        <select aria-label="Used for" value={set.vocabulary} onChange={(e) => lipsync.setVocabulary(set.id, e.target.value as 'mouth' | 'custom')}>
          <option value="mouth">Mouth (lip sync)</option>
          <option value="custom">Other (eyes, hands…)</option>
        </select>
      </Row>
      <div className="drawing-list" data-testid="drawing-list">
        {set.drawings.map((d, i) => {
          const hint = mouth ? MOUTH_SHAPES.find((m) => m.key === d.key) : undefined;
          return (
            <div key={d.key} className={`drawing-row ${d.key === showing ? 'showing' : ''}`}>
              <button
                className="icon"
                title={mode === 'animate' ? 'Show on this frame' : 'Show when not animated (rest)'}
                onClick={() => (mode === 'animate' ? lipsync.enterDrawing(d.key, false) : lipsync.setRestDrawing(part.id, d.key))}
              >
                <DrawingThumb items={d.items} size={30} />
              </button>
              <input
                type="text"
                aria-label={`Key for ${d.name}`}
                key={d.key}
                defaultValue={d.key}
                onBlur={(e) => lipsync.renameKey(set.id, d.key, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <span className="name" title={d.name}>
                {hint ? `${hint.name} · ${hint.sounds}` : `${i + 1} · ${d.name}`}
              </span>
              {part.restDrawing === d.key && <span className="hint">rest</span>}
              <button className="icon" title={`Remove ${d.key}`} aria-label={`Remove ${d.key}`} onClick={() => lipsync.removeDrawingFromSet(set.id, d.key)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <Row label="">
        <button onClick={() => void lipsync.addDrawingsFromFiles()}>Add drawings from files…</button>
      </Row>
      {missing.length > 0 && (
        <p className="hint">
          Missing mouth shapes: {missing.map((m) => `${m.key} (${m.sounds})`).join(', ')}. Name a file or shape after the letter to add it.
        </p>
      )}
      <p className="hint">
        {mode === 'animate'
          ? mouth
            ? 'Type a letter on the timeline to set the mouth; the playhead moves on so you can keep typing.'
            : 'Click a drawing, or press its number, to show it from this frame.'
          : 'Click a drawing to show it when nothing is animated. In Animate mode, type keys to switch drawings.'}
      </p>
    </Section>
  );
}

/** The selected sound on the timeline (docs/DESIGN.md §8.4). */
export function AudioClipSection({ clip }: { clip: AudioClip }) {
  const fps = useEditor((s) => s.project.scene.fps);
  return (
    <Section title="Sound">
      <Row label="Name">
        <input
          aria-label="Sound name"
          key={clip.id + clip.name}
          defaultValue={clip.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== clip.name) updateClip(clip.id, { name });
          }}
        />
      </Row>
      <Row label="Starts on">
        <NumberField label="Start frame" value={clip.startFrame + 1} digits={0} onCommit={(v) => updateClip(clip.id, { startFrame: Math.round(v) - 1 }, 'clipStart')} suffix="frame" />
      </Row>
      <Row label="Length">
        <span className="value">
          {clip.duration.toFixed(2)} s · {Math.ceil(clip.duration * fps)} frames
        </span>
      </Row>
      <Row label="Volume">
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={200}
          value={Math.round(clip.volume * 100)}
          onChange={(e) => updateClip(clip.id, { volume: Number(e.target.value) / 100 }, 'clipVolume')}
        />
        <span className="value">{Math.round(clip.volume * 100)}%</span>
      </Row>
      <Row label="Mute">
        <input type="checkbox" aria-label="Mute" checked={!!clip.muted} onChange={(e) => updateClip(clip.id, { muted: e.target.checked })} />
      </Row>
      <p className="hint">Drag the sound on the timeline to line it up. Muted sounds are left out of playback and export.</p>
      <Row label="">
        <button onClick={() => removeClip(clip.id)}>Remove sound</button>
        <button onClick={() => store.set({ selectedClip: null })}>Done</button>
      </Row>
    </Section>
  );
}
