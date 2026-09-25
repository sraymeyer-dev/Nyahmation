import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { pinIntervals } from '../../../engine/pins';
import type { Project } from '../../../engine/types';
import { select } from '../editor/actions';
import { deleteSelectedMarks, jumpToPose, retimeMarks, rowFrames, setFrame, setLoopPoint } from '../editor/animate';
import { store, useEditor, type MarkRef } from '../editor/store';

// The timeline (docs/DESIGN.md A1, A6): one row for the whole scene, one per
// layer and one per part. Each diamond is a pose mark. Drag a mark to retime
// it: the motion into it speeds up or slows down.
//   Shift-drag  ripple: everything after it moves too, keeping later timing
//   Alt/Option- or Cmd/Ctrl-drag  copy the pose to another frame (a hold)
// The row decides what moves: a part row moves that part's poses, a layer row
// every part in the layer, the scene row everything. Lip sync only moves from
// the mouth's own row, so it stays in sync with the dialogue.

const NAME_W = 190;

interface Row {
  row: MarkRef['row'];
  id: string;
  name: string;
  depth: number;
  layerKind?: 'character' | 'background';
}

function buildRows(project: Project, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [{ row: 'scene', id: '', name: 'Scene', depth: 0 }];
  for (const layer of project.scene.layers.slice().reverse()) {
    rows.push({ row: 'layer', id: layer.id, name: layer.name, depth: 0, layerKind: layer.kind });
    if (collapsed.has(layer.id)) continue;
    const visit = (p: typeof layer.root, depth: number) => {
      for (const c of p.children) {
        rows.push({ row: 'part', id: c.id, name: c.name, depth });
        visit(c, depth + 1);
      }
    };
    visit(layer.root, 1);
  }
  return rows;
}

const sameMark = (a: MarkRef, b: MarkRef) => a.row === b.row && a.id === b.id && a.frame === b.frame;

function labelStep(zoom: number): number {
  for (const step of [1, 2, 5, 10, 12, 24, 48, 100, 240]) if (step * zoom >= 34) return step;
  return 480;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const frame = useEditor((s) => s.frame);
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  const onion = useEditor((s) => s.onion);
  const { zoom, marks } = useEditor((s) => s.timeline);
  const selection = useEditor((s) => s.selection);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(project.scene.layers.filter((l) => l.kind === 'background').map((l) => l.id)),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const { durationFrames: duration, fps } = project.scene;

  const rows = useMemo(() => buildRows(project, collapsed), [project, collapsed]);
  const selectedParts = new Set(selection);

  // Playback: the frame follows the clock, looping over the loop range or the scene.
  useEffect(() => {
    if (!playing) return;
    const range = loop ?? { in: 0, out: duration - 1 };
    const length = range.out - range.in + 1;
    const start = performance.now();
    const startFrame = Math.min(Math.max(store.getState().frame, range.in), range.out);
    let raf = requestAnimationFrame(function tick(now) {
      const elapsed = Math.floor(((now - start) / 1000) * fps);
      store.set({ frame: range.in + ((startFrame - range.in + elapsed) % length) });
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, duration, loop]);

  // Keep the playhead in view while playing or stepping.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = NAME_W + frame * zoom;
    if (x < el.scrollLeft + NAME_W || x > el.scrollLeft + el.clientWidth - zoom) el.scrollLeft = Math.max(0, x - NAME_W - 40);
  }, [frame, zoom]);

  const frameAt = (clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - NAME_W;
    return Math.max(0, Math.min(duration - 1, Math.floor(x / zoom)));
  };

  /** Click or drag in empty space: move the playhead (scrub). */
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection (dragging a selection would hijack the mouse)
    scroller.current?.focus();
    setFrame(frameAt(e.clientX));
    if (!e.shiftKey) store.set((s) => ({ timeline: { ...s.timeline, marks: [] } }));
    const move = (ev: PointerEvent) => setFrame(frameAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Press on a mark: select it, then drag to retime (Shift ripple, Alt copy). */
  const markDown = (e: ReactPointerEvent, mark: MarkRef) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    scroller.current?.focus();
    const s = store.getState();
    const alreadySelected = s.timeline.marks.some((m) => sameMark(m, mark));
    const toggle = e.shiftKey || e.metaKey || e.ctrlKey || e.altKey;
    const dragging = alreadySelected ? s.timeline.marks : [mark];
    if (!alreadySelected && !toggle) store.set({ timeline: { ...s.timeline, marks: [mark] }, frame: mark.frame, playing: false });
    const startX = e.clientX;
    const base = s.project;
    let moved = false;
    let applied = 0;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      if (!moved) {
        moved = true;
        store.beginGesture();
      }
      const delta = Math.round((ev.clientX - startX) / zoom);
      // Copy with Alt/Option or Cmd/Ctrl (on Windows, Alt alone can open the menu bar).
      const copy = ev.altKey || ev.metaKey || ev.ctrlKey;
      const result = retimeMarks(base, dragging, delta, { ripple: ev.shiftKey && !copy, copy });
      applied = result.delta;
      const how = copy ? 'Copying' : ev.shiftKey ? 'Moving (with everything after it)' : 'Moving';
      store.preview(result.project, {
        timeline: { ...store.getState().timeline, marks: dragging.map((m) => ({ ...m, frame: m.frame + applied })) },
        status: `${how} ${applied >= 0 ? '+' : ''}${applied} frames${result.extended ? ` — scene lengthened to ${result.project.scene.durationFrames} frames` : ''}`,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        store.endGesture();
        store.set({ frame: mark.frame + applied });
      } else if (toggle) {
        const current = store.getState().timeline.marks;
        const marks = alreadySelected ? current.filter((m) => !sameMark(m, mark)) : [...current, mark];
        store.set((st) => ({ timeline: { ...st.timeline, marks } }));
      } else {
        store.set((st) => ({ timeline: { ...st.timeline, marks: [mark] }, frame: mark.frame, playing: false }));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const selectRow = (r: Row) => {
    if (r.row === 'part') select([r.id]);
    else if (r.row === 'layer') {
      const layer = project.scene.layers.find((l) => l.id === r.id);
      if (layer) select([layer.root.id]);
    }
  };

  const setZoom = (z: number) => store.set((s) => ({ timeline: { ...s.timeline, zoom: Math.max(3, Math.min(48, z)) } }));
  const step = labelStep(zoom);
  const laneWidth = duration * zoom;

  const [height, setHeight] = useState(260);
  const resize = (e: ReactPointerEvent) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(120, Math.min(window.innerHeight - 200, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="timeline" aria-label="Timeline" style={{ height }}>
      <div className="timeline-resize" onPointerDown={resize} title="Drag to resize the timeline" />
      <div className="timeline-bar">
        <button onClick={() => setFrame(frame - 1)} aria-label="Previous frame" title="Previous frame (←)">◀︎</button>
        <button className="play" onClick={() => store.set((s) => ({ playing: !s.playing }))}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => setFrame(frame + 1)} aria-label="Next frame" title="Next frame (→)">▶︎</button>
        <span className="frame" data-testid="frame">
          {frame + 1} / {duration}
        </span>
        <button onClick={() => jumpToPose(-1)} title="Previous pose (Shift+←)" aria-label="Previous pose">⇤</button>
        <button onClick={() => jumpToPose(1)} title="Next pose (Shift+→)" aria-label="Next pose">⇥</button>
        <span className="divider" />
        <span className="label">Loop</span>
        <button onClick={() => setLoopPoint('in')} title="Loop from this frame (I)">In</button>
        <button onClick={() => setLoopPoint('out')} title="Loop to this frame (O)">Out</button>
        {loop && (
          <>
            <span className="value">
              {loop.in + 1}–{loop.out + 1}
            </span>
            <button onClick={() => store.set({ loop: null })} aria-label="Clear loop">×</button>
          </>
        )}
        <span className="divider" />
        <label className="check" title="Show faint copies of nearby frames">
          <input type="checkbox" checked={onion.enabled} onChange={(e) => store.set((s) => ({ onion: { ...s.onion, enabled: e.target.checked } }))} />
          Onion skin
        </label>
        <div className="spacer" />
        <span className="hint">Drag ◆ to retime · Shift: ripple · Option/Ctrl: copy</span>
        <button onClick={() => setZoom(zoom / 1.3)} aria-label="Zoom timeline out">−</button>
        <button onClick={() => setZoom(zoom * 1.3)} aria-label="Zoom timeline in">+</button>
        <button className="primary" onClick={() => store.set({ exportOpen: true })}>Export…</button>
      </div>
      <div
        className="timeline-body"
        ref={scroller}
        tabIndex={0}
        data-testid="timeline"
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && store.getState().timeline.marks.length) {
            e.preventDefault();
            e.stopPropagation();
            deleteSelectedMarks();
          }
        }}
      >
        <div className="tl-grid" style={{ width: NAME_W + laneWidth + 40 }}>
          <div className="tl-row tl-ruler-row">
            <div className="tl-name tl-corner">Frame</div>
            <div className="tl-lane tl-ruler" style={{ width: laneWidth }} onPointerDown={scrub}>
              {Array.from({ length: Math.ceil(duration / step) }, (_, i) => i * step).map((f) => (
                <span key={f} className="tick" style={{ left: f * zoom }}>
                  {f + 1}
                </span>
              ))}
            </div>
          </div>
          {rows.map((r) => {
            const frames = rowFrames(project, r.row, r.id);
            const pins = r.row === 'part' ? pinIntervals(project, r.id) : [];
            const active = r.row === 'part' ? selectedParts.has(r.id) : r.row === 'layer' && project.scene.layers.some((l) => l.id === r.id && selectedParts.has(l.root.id));
            return (
              <div key={`${r.row}:${r.id}`} className={`tl-row tl-${r.row} ${active ? 'active' : ''}`} data-testid={`tl-${r.row}`}>
                <div className="tl-name" style={{ paddingLeft: 6 + r.depth * 12 }} onClick={() => selectRow(r)} title={r.name}>
                  {r.row === 'layer' && (
                    <button
                      className="twisty"
                      aria-label={collapsed.has(r.id) ? 'Expand' : 'Collapse'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsed((c) => {
                          const n = new Set(c);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        });
                      }}
                    >
                      {collapsed.has(r.id) ? '▸' : '▾'}
                    </button>
                  )}
                  <span className="name">{r.name}</span>
                </div>
                <div className="tl-lane" style={{ width: laneWidth }} onPointerDown={scrub}>
                  {loop && <div className="tl-loop" style={{ left: loop.in * zoom, width: (loop.out - loop.in + 1) * zoom }} />}
                  {pins.map((p) => (
                    <div key={p.start} className="tl-pin" title="Pinned" style={{ left: p.start * zoom + zoom / 2, width: Math.max(2, (p.end - p.start) * zoom - zoom / 2) }} />
                  ))}
                  {frames.map((f) => {
                    const mark: MarkRef = { row: r.row, id: r.id, frame: f };
                    const selected = marks.some((m) => sameMark(m, mark));
                    return (
                      <div
                        key={f}
                        className={`tl-mark ${selected ? 'selected' : ''}`}
                        style={{ left: f * zoom + zoom / 2 }}
                        title={`Frame ${f + 1}`}
                        data-frame={f}
                        onPointerDown={(e) => markDown(e, mark)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="tl-playhead" style={{ left: NAME_W + frame * zoom + zoom / 2 }} />
        </div>
      </div>
    </section>
  );
}
