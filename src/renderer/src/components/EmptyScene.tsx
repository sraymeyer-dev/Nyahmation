import { useState } from 'react';
import { resizeScene, SCENE_SIZES } from '../../../engine/stage';
import { importFile, openDemo, zoomToFit } from '../editor/actions';
import { store, useEditor } from '../editor/store';

// A first step for an empty scene: what to do, the demo puppet and the
// manual. It goes away as soon as anything is drawn or imported.

export function EmptyScene() {
  const empty = useEditor((s) => s.mode === 'build' && !s.file && s.project.scene.layers.every((l) => l.root.children.length === 0));
  const busy = useEditor((s) => s.notice !== null || s.recoveries.length > 0);
  const [dismissed, setDismissed] = useState(false);
  const size = useEditor((s) => SCENE_SIZES.findIndex((p) => p.width === s.project.scene.width && p.height === s.project.scene.height));
  if (!empty || busy || dismissed) return null;
  return (
    <div className="empty-scene" data-testid="empty-scene">
      <strong>An empty scene</strong>
      <p>Draw with the tools on the left, or drag pictures (SVG, PNG, JPEG) here from your computer. To see how animating works, open Pip, the demo puppet.</p>
      {/* Easiest to choose before drawing: a video for phones is tall. */}
      <label className="shape">
        Shape of the video:{' '}
        <select
          aria-label="Shape of the video"
          value={size}
          onChange={(e) => {
            const p = SCENE_SIZES[Number(e.target.value)];
            if (!p) return;
            store.commit(resizeScene(store.getState().project, p.width, p.height));
            zoomToFit();
          }}
        >
          {size < 0 && <option value={-1}>Custom</option>}
          {SCENE_SIZES.map((p, i) => (
            <option key={i} value={i}>
              {p.name} ({p.use})
            </option>
          ))}
        </select>
      </label>
      <div className="buttons">
        <button className="primary" onClick={openDemo}>
          Open the demo puppet
        </button>
        <button onClick={() => void importFile()} disabled={!window.nyah}>
          Import art…
        </button>
        <button onClick={() => window.nyah?.openManual()} disabled={!window.nyah}>
          User manual
        </button>
        <button className="link" onClick={() => setDismissed(true)} aria-label="Hide this">
          Hide
        </button>
      </div>
    </div>
  );
}
