import { toggleGrid, toggleSnap, zoomActualSize, zoomBy, zoomToFit } from '../editor/actions';
import { store, useEditor } from '../editor/store';
import { NumberField } from './fields';

// The strip above the canvas: options for the current tool, grid and zoom.

export function ToolOptions() {
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  const options = useEditor((s) => s.toolOptions);
  const grid = useEditor((s) => s.grid);
  const zoom = useEditor((s) => s.view.zoom);
  const setOption = (patch: Partial<typeof options>) => store.set((s) => ({ toolOptions: { ...s.toolOptions, ...patch } }));

  return (
    <div className="tool-options">
      {mode === 'build' && tool === 'rect' && (
        <label>
          Corner radius
          <NumberField label="Corner radius" value={options.cornerRadius} min={0} digits={0} onCommit={(cornerRadius) => setOption({ cornerRadius })} />
        </label>
      )}
      {mode === 'build' && tool === 'polygon' && (
        <label>
          Sides
          <NumberField label="Sides" value={options.polygonSides} min={3} max={64} digits={0} onCommit={(v) => setOption({ polygonSides: Math.round(v) })} />
        </label>
      )}
      {mode === 'build' && tool === 'star' && (
        <>
          <label>
            Points
            <NumberField label="Star points" value={options.starPoints} min={3} max={64} digits={0} onCommit={(v) => setOption({ starPoints: Math.round(v) })} />
          </label>
          <label>
            Inner size
            <NumberField label="Inner size" value={options.starInner * 100} min={5} max={95} digits={0} suffix="%" onCommit={(v) => setOption({ starInner: v / 100 })} />
          </label>
        </>
      )}
      {mode === 'build' && tool === 'pen' && <span className="hint">Click for corners, drag for curves. Click the first point to close; Enter to finish.</span>}
      {mode === 'build' && tool === 'points' && <span className="hint">Drag points, handles or curves. Double-click a curve to add a point, a point to make it smooth or sharp.</span>}
      <div className="spacer" />
      <label className="check">
        <input type="checkbox" checked={grid.show} onChange={toggleGrid} /> Grid
      </label>
      <label className="check">
        <input type="checkbox" checked={grid.snap} onChange={toggleSnap} /> Snap
      </label>
      <label>
        Size
        <NumberField label="Grid size" value={grid.size} min={2} max={500} digits={0} onCommit={(size) => store.set((s) => ({ grid: { ...s.grid, size } }))} />
      </label>
      <span className="divider" />
      <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
      <button onClick={zoomActualSize} className="zoom-label" title="Actual size">{Math.round(zoom * 100)}%</button>
      <button onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
      <button onClick={zoomToFit}>Fit</button>
    </div>
  );
}
