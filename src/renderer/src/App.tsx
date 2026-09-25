import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateScene } from '../../engine/evaluate';
import type { Mat2D } from '../../engine/math';
import type { Project, Stepping } from '../../engine/types';
import { packProject, unpackProject } from '../../io/projectFile';
import { createDemoProject } from './demo';
import { renderScene } from './render/canvasRenderer';

// Phase 0 test harness: plays the demo puppet and exercises save/open.
// The real editor UI arrives in phases 1–3.

export function App() {
  const [project, setProject] = useState<Project>(createDemoProject);
  const [assets, setAssets] = useState<Map<string, Uint8Array>>(() => new Map());
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [status, setStatus] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { fps, durationFrames } = project.scene;
  const api = window.nyah;

  const resolved = useMemo(() => evaluateScene(project, frame), [project, frame]);

  // Draw whenever the frame changes or the canvas is resized.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = canvas;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Fit the scene inside the canvas, centred.
    const scale = Math.min(w / resolved.width, h / resolved.height) * dpr;
    const view: Mat2D = [
      scale,
      0,
      0,
      scale,
      (canvas.width - resolved.width * scale) / 2,
      (canvas.height - resolved.height * scale) / 2,
    ];
    renderScene(ctx, project, resolved, view);
  }, [project, resolved]);

  useEffect(draw, [draw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  // Playback: frame follows the wall clock, looping over the scene.
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const startFrame = frame;
    let raf = requestAnimationFrame(function tick(now) {
      const elapsed = Math.floor(((now - start) / 1000) * fps);
      setFrame((startFrame + elapsed) % durationFrames);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
    // Restart the clock only when play is toggled or timing changes.
  }, [playing, fps, durationFrames]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setFrame((f) => (f + delta + durationFrames) % durationFrames);
    },
    [durationFrames],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === 'ArrowRight') step(1);
      else if (e.code === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const setStepping = (stepping: Stepping) =>
    setProject((p) => ({ ...p, scene: { ...p.scene, stepping } }));

  const save = async (saveAs: boolean) => {
    if (!api) return;
    try {
      const saved = await api.saveProject(packProject({ project, assets }), saveAs ? undefined : file?.path);
      if (saved) {
        setFile(saved);
        setStatus(`Saved ${saved.name}`);
      }
    } catch (err) {
      setStatus(`Couldn't save: ${(err as Error).message}`);
    }
  };

  const open = async () => {
    if (!api) return;
    try {
      const opened = await api.openProject();
      if (!opened) return;
      const bundle = unpackProject(opened.bytes);
      setPlaying(false);
      setProject(bundle.project);
      setAssets(bundle.assets);
      setFrame(0);
      setFile({ path: opened.path, name: opened.name });
      setStatus(`Opened ${opened.name}`);
    } catch (err) {
      setStatus(`Couldn't open: ${(err as Error).message}`);
    }
  };

  const noFiles = api ? undefined : 'Saving needs the desktop app';

  return (
    <div className="app">
      <header className="toolbar">
        <span className="title">Nyahmation</span>
        <span className="file">{file?.name ?? 'Demo (unsaved)'}</span>
        <div className="spacer" />
        <button onClick={open} disabled={!api} title={noFiles}>Open…</button>
        <button onClick={() => save(false)} disabled={!api} title={noFiles}>Save</button>
        <button onClick={() => save(true)} disabled={!api} title={noFiles}>Save As…</button>
      </header>

      <main className="stage">
        <canvas ref={canvasRef} className="canvas" data-testid="stage" />
      </main>

      <footer className="transport">
        <button onClick={() => step(-1)} aria-label="Previous frame">◀︎</button>
        <button onClick={() => setPlaying((p) => !p)} className="play">{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => step(1)} aria-label="Next frame">▶︎</button>
        <input
          type="range"
          min={0}
          max={durationFrames - 1}
          value={frame}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
          aria-label="Frame"
        />
        <span className="frame" data-testid="frame">
          {frame + 1} / {durationFrames}
        </span>
        <label>
          Animate on
          <select value={project.scene.stepping} onChange={(e) => setStepping(Number(e.target.value) as Stepping)}>
            <option value={1}>ones</option>
            <option value={2}>twos</option>
            <option value={3}>threes</option>
          </select>
        </label>
        <span className="status">{status}</span>
      </footer>
    </div>
  );
}
