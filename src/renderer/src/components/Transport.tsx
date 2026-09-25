import { useEffect } from 'react';
import { store, useEditor } from '../editor/store';

// Playback controls for Animate mode. Posing on the timeline arrives in
// phase 3; for now this previews existing animation.

export function Transport() {
  const frame = useEditor((s) => s.frame);
  const playing = useEditor((s) => s.playing);
  const duration = useEditor((s) => s.project.scene.durationFrames);
  const fps = useEditor((s) => s.project.scene.fps);

  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const startFrame = store.getState().frame;
    let raf = requestAnimationFrame(function tick(now) {
      const elapsed = Math.floor(((now - start) / 1000) * fps);
      store.set({ frame: (startFrame + elapsed) % duration });
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, duration]);

  const step = (d: number) => store.set((s) => ({ playing: false, frame: (s.frame + d + duration) % duration }));

  return (
    <footer className="transport">
      <button onClick={() => step(-1)} aria-label="Previous frame">◀︎</button>
      <button className="play" onClick={() => store.set((s) => ({ playing: !s.playing }))}>{playing ? 'Pause' : 'Play'}</button>
      <button onClick={() => step(1)} aria-label="Next frame">▶︎</button>
      <input
        type="range"
        min={0}
        max={duration - 1}
        value={Math.min(frame, duration - 1)}
        onChange={(e) => store.set({ playing: false, frame: Number(e.target.value) })}
        aria-label="Frame"
      />
      <span className="frame" data-testid="frame">
        {frame + 1} / {duration}
      </span>
    </footer>
  );
}
