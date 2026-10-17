import { useState } from 'react';
import { importFile, openDemo } from '../editor/actions';
import { useEditor } from '../editor/store';

// A first step for an empty scene: what to do, the demo puppet and the
// manual. It goes away as soon as anything is drawn or imported.

export function EmptyScene() {
  const empty = useEditor((s) => s.mode === 'build' && !s.file && s.project.scene.layers.every((l) => l.root.children.length === 0));
  const busy = useEditor((s) => s.notice !== null || s.recoveries.length > 0);
  const [dismissed, setDismissed] = useState(false);
  if (!empty || busy || dismissed) return null;
  return (
    <div className="empty-scene" data-testid="empty-scene">
      <strong>An empty scene</strong>
      <p>Draw with the tools on the left, or drag pictures (SVG, PNG, JPEG) here from your computer. To see how animating works, open Pip, the demo puppet.</p>
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
