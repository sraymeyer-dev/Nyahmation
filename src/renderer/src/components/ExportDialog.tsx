import { useRef, useState } from 'react';
import { enlargedImages, exportSize, runExport, type ExportProgress, type ExportSettings } from '../editor/exporter';
import { store, useEditor } from '../editor/store';

// File → Export Video… (docs/DESIGN.md §11).

const HEIGHTS = [720, 1080, 1440, 2160];

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const scene = useEditor((s) => s.project.scene);
  const loop = useEditor((s) => s.loop);
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const [settings, setSettings] = useState<ExportSettings>({ format: 'mp4', height: 0, range: 'all', transparent: false });
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const cancelled = useRef(false);
  if (!open) return null;

  const height = settings.height || scene.height;
  const size = exportSize(scene.width, scene.height, height);
  const frames = settings.range === 'loop' && loop ? loop.out - loop.in + 1 : scene.durationFrames;
  const sounds = project.scene.audio.filter((c) => !c.muted && c.volume > 0).length;
  const enlarged = enlargedImages(project, assets, size.scale);
  const busy = progress !== null && !done && !error;
  const close = () => {
    if (busy) return;
    setProgress(null);
    setError(null);
    setDone(null);
    store.set({ exportOpen: false });
  };

  const start = async () => {
    cancelled.current = false;
    setError(null);
    setDone(null);
    setProgress({ done: 0, total: frames });
    try {
      const path = await runExport({ ...settings, height }, setProgress, () => cancelled.current);
      if (path) {
        setDone(path);
        store.set({ status: `Exported ${path}` });
      } else setProgress(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const heights = [...new Set([scene.height, ...HEIGHTS])].sort((a, b) => a - b);
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-label="Export video" onClick={(e) => e.stopPropagation()}>
        <h2>Export video</h2>
        <label className="row">
          <span className="row-label">Format</span>
          <select aria-label="Export format" value={settings.format} disabled={busy} onChange={(e) => setSettings({ ...settings, format: e.target.value as ExportSettings['format'] })}>
            <option value="mp4">MP4 video (H.264)</option>
            <option value="png">PNG image sequence</option>
          </select>
        </label>
        <label className="row">
          <span className="row-label">Size</span>
          <select aria-label="Export size" value={height} disabled={busy} onChange={(e) => setSettings({ ...settings, height: Number(e.target.value) })}>
            {heights.map((h) => {
              const sz = exportSize(scene.width, scene.height, h);
              return (
                <option key={h} value={h}>
                  {sz.width} × {sz.height}
                  {h === scene.height ? ' (scene size)' : ''}
                </option>
              );
            })}
          </select>
        </label>
        <label className="row">
          <span className="row-label">Frames</span>
          <select aria-label="Export range" value={settings.range} disabled={busy} onChange={(e) => setSettings({ ...settings, range: e.target.value as ExportSettings['range'] })}>
            <option value="all">Whole scene (1–{scene.durationFrames})</option>
            {loop && (
              <option value="loop">
                Loop range ({loop.in + 1}–{loop.out + 1})
              </option>
            )}
          </select>
        </label>
        {settings.format === 'png' && (
          <label className="row">
            <span className="row-label">Background</span>
            <span className="row-control">
              <input type="checkbox" checked={settings.transparent} disabled={busy} onChange={(e) => setSettings({ ...settings, transparent: e.target.checked })} />
              <span className="value">See-through (for compositing)</span>
            </span>
          </label>
        )}
        <p className="hint">
          {frames} frames at {scene.fps} fps = {(frames / scene.fps).toFixed(1)} s, {size.width} × {size.height}.
        </p>
        <p className="hint" data-testid="export-sound">
          {sounds === 0
            ? 'No sound.'
            : settings.format === 'mp4'
              ? `Includes the sound (${sounds} clip${sounds === 1 ? '' : 's'}, mixed).`
              : 'The sound is saved next to the frames as soundtrack.wav.'}
        </p>
        {enlarged.length > 0 && (
          <div className="hint warn" data-testid="export-enlarged">
            These images are shown bigger than their own pixels, so they may look soft:
            <ul>
              {enlarged.slice(0, 6).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {enlarged.length > 6 && <li>and {enlarged.length - 6} more</li>}
            </ul>
            Use a smaller export size or larger PNGs.
          </div>
        )}
        {progress && (
          <div className="progress" aria-label="Export progress">
            <div className="bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            <span>
              {done ? 'Done' : `Frame ${progress.done} of ${progress.total}`}
            </span>
          </div>
        )}
        {done && <p className="hint" data-testid="export-done">Saved to {done}</p>}
        {error && <p className="hint warn">Export failed: {error}</p>}
        <div className="buttons">
          {busy ? (
            <button onClick={() => (cancelled.current = true)}>Cancel</button>
          ) : (
            <>
              <button className="primary" onClick={() => void start()} disabled={!window.nyah}>
                {done ? 'Export again…' : 'Export…'}
              </button>
              <button onClick={close}>Close</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
