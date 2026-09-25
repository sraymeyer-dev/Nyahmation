import { locatePart, restWorldMatrix, updateLayer, updatePart, type PartLocation } from '../../../engine/edit';
import type { Part, Project, Scene, ShapeStyle, Stepping, Transform } from '../../../engine/types';
import { store, useEditor } from '../editor/store';
import { NumberField, PaintField, Row, Section } from './fields';

// Shows and edits whatever is selected: the scene (nothing selected), a
// layer, one part, or several parts at once (shared settings only).

function commitParts(ids: readonly string[], fn: (p: Part) => Part, key?: string, extra = {}) {
  let project = store.getState().project;
  for (const id of ids) project = updatePart(project, id, fn);
  store.commit(project, extra, key);
}

function StyleEditor({ style, onChange }: { style: ShapeStyle; onChange: (patch: Partial<ShapeStyle>, key: string) => void }) {
  return (
    <>
      <Row label="Fill">
        <PaintField label="Fill" value={style.fill} onChange={(fill) => onChange({ fill }, 'fill')} />
      </Row>
      <Row label="Stroke">
        <PaintField label="Stroke" value={style.stroke} onChange={(stroke) => onChange({ stroke }, 'stroke')} />
      </Row>
      <Row label="Width">
        <NumberField label="Stroke width" value={style.strokeWidth} min={0} step={0.5} onCommit={(strokeWidth) => onChange({ strokeWidth }, 'strokeWidth')} />
      </Row>
      <Row label="Ends">
        <select aria-label="Line ends" value={style.lineCap} onChange={(e) => onChange({ lineCap: e.target.value as ShapeStyle['lineCap'] }, 'lineCap')}>
          <option value="round">Round</option>
          <option value="butt">Flat</option>
          <option value="square">Square</option>
        </select>
      </Row>
      <Row label="Corners">
        <select aria-label="Line corners" value={style.lineJoin} onChange={(e) => onChange({ lineJoin: e.target.value as ShapeStyle['lineJoin'] }, 'lineJoin')}>
          <option value="round">Round</option>
          <option value="miter">Sharp</option>
          <option value="bevel">Bevelled</option>
        </select>
      </Row>
      <Row label="Holes">
        <select aria-label="Fill rule" value={style.fillRule} onChange={(e) => onChange({ fillRule: e.target.value as ShapeStyle['fillRule'] }, 'fillRule')}>
          <option value="nonzero">Fill overlaps</option>
          <option value="evenodd">Overlaps make holes</option>
        </select>
      </Row>
    </>
  );
}

function SceneProperties({ project }: { project: Project }) {
  const scene = project.scene;
  const style = useEditor((s) => s.style);
  const set = (patch: Partial<Scene>, key: string) => store.commit({ ...project, scene: { ...scene, ...patch } }, {}, key);
  return (
    <>
      <Section title="Scene">
        <Row label="Width">
          <NumberField label="Scene width" value={scene.width} digits={0} min={16} max={8192} onCommit={(v) => set({ width: Math.round(v) }, 'w')} suffix="px" />
        </Row>
        <Row label="Height">
          <NumberField label="Scene height" value={scene.height} digits={0} min={16} max={8192} onCommit={(v) => set({ height: Math.round(v) }, 'h')} suffix="px" />
        </Row>
        <Row label="Frame rate">
          <select aria-label="Frame rate" value={scene.fps} onChange={(e) => set({ fps: Number(e.target.value) }, 'fps')}>
            {[24, 25, 30, 60].map((f) => (
              <option key={f} value={f}>{f} fps</option>
            ))}
          </select>
        </Row>
        <Row label="Length">
          <NumberField label="Length in frames" value={scene.durationFrames} digits={0} min={1} onCommit={(v) => set({ durationFrames: Math.round(v) }, 'dur')} suffix={`frames · ${(scene.durationFrames / scene.fps).toFixed(1)} s`} />
        </Row>
        <Row label="Background">
          <input type="color" aria-label="Background color" value={scene.background} onChange={(e) => set({ background: e.target.value }, 'bg')} />
        </Row>
        <Row label="Animate on">
          <select aria-label="Animate on" value={scene.stepping} onChange={(e) => set({ stepping: Number(e.target.value) as Stepping }, 'step')}>
            <option value={1}>Ones</option>
            <option value={2}>Twos</option>
            <option value={3}>Threes</option>
          </select>
        </Row>
      </Section>
      <Section title="Style for new shapes">
        <StyleEditor style={style} onChange={(patch) => store.set((s) => ({ style: { ...s.style, ...patch } }))} />
      </Section>
    </>
  );
}

function LayerProperties({ loc }: { loc: PartLocation }) {
  const layer = loc.layer;
  const project = useEditor((s) => s.project);
  return (
    <Section title="Layer">
      <Row label="Name">
        <input
          aria-label="Layer name"
          defaultValue={layer.name}
          key={layer.id + layer.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (!name || name === layer.name) return;
            store.commit(updatePart(updateLayer(project, layer.id, (l) => ({ ...l, name })), layer.root.id, (p) => ({ ...p, name })));
          }}
        />
      </Row>
      <Row label="Kind">
        <select aria-label="Layer kind" value={layer.kind} onChange={(e) => store.commit(updateLayer(project, layer.id, (l) => ({ ...l, kind: e.target.value as typeof l.kind })))}>
          <option value="character">Character</option>
          <option value="background">Background</option>
        </select>
      </Row>
      <Row label="Animate on">
        <select
          aria-label="Layer stepping"
          value={layer.stepping ?? 0}
          onChange={(e) => {
            const v = Number(e.target.value);
            store.commit(updateLayer(project, layer.id, (l) => {
              const { stepping: _old, ...rest } = l;
              return v ? { ...rest, stepping: v as Stepping } : rest;
            }));
          }}
        >
          <option value={0}>Same as scene</option>
          <option value={1}>Ones</option>
          <option value={2}>Twos</option>
          <option value={3}>Threes</option>
        </select>
      </Row>
    </Section>
  );
}

function PartProperties({ locs }: { locs: PartLocation[] }) {
  const ids = locs.map((l) => l.part.id);
  const single = locs.length === 1 ? locs[0]!.part : null;
  const shapes = locs.map((l) => l.part).filter((p) => p.kind === 'shape' && p.style);
  const same = <T,>(get: (p: Part) => T): T | null => {
    const first = get(locs[0]!.part);
    return locs.every((l) => get(l.part) === first) ? first : null;
  };
  const setRest = (patch: Partial<Transform>, key: string) => commitParts(ids, (p) => ({ ...p, rest: { ...p.rest, ...patch } }), key);
  const opacity = same((p) => p.opacity);

  return (
    <>
      <Section title={single ? `${kindLabel(single)}` : `${locs.length} parts`}>
        {single && (
          <Row label="Name">
            <input
              aria-label="Part name"
              key={single.id + single.name}
              defaultValue={single.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== single.name) commitParts(ids, (p) => ({ ...p, name }));
              }}
            />
          </Row>
        )}
        {single && (
          <>
            <Row label="Position">
              <NumberField label="X" value={single.rest.x} onCommit={(x) => setRest({ x }, 'x')} suffix="x" />
              <NumberField label="Y" value={single.rest.y} onCommit={(y) => setRest({ y }, 'y')} suffix="y" />
            </Row>
            <Row label="Rotation">
              <NumberField label="Rotation" value={single.rest.rotation} onCommit={(rotation) => setRest({ rotation }, 'rot')} suffix="°" />
            </Row>
            <Row label="Scale">
              <NumberField label="Scale X" value={single.rest.scaleX * 100} digits={1} onCommit={(v) => setRest({ scaleX: v / 100 }, 'sx')} suffix="%" />
              <NumberField label="Scale Y" value={single.rest.scaleY * 100} digits={1} onCommit={(v) => setRest({ scaleY: v / 100 }, 'sy')} suffix="%" />
            </Row>
          </>
        )}
        <Row label="Opacity">
          <input
            type="range"
            aria-label="Opacity"
            min={0}
            max={100}
            value={Math.round((opacity ?? 1) * 100)}
            onChange={(e) => commitParts(ids, (p) => ({ ...p, opacity: Number(e.target.value) / 100 }), 'opacity')}
          />
          <span className="value">{opacity === null ? 'mixed' : `${Math.round(opacity * 100)}%`}</span>
        </Row>
        {single?.kind === 'image' && single.image && <ImageHint loc={locs[0]!} />}
      </Section>
      {shapes.length > 0 && (
        <Section title={shapes.length === 1 ? 'Fill & stroke' : `Fill & stroke (${shapes.length} shapes)`}>
          <StyleEditor
            style={shapes[0]!.style!}
            onChange={(patch, key) =>
              commitParts(
                shapes.map((p) => p.id),
                (p) => (p.style ? { ...p, style: { ...p.style, ...patch } } : p),
                key,
                { style: { ...store.getState().style, ...patch } },
              )
            }
          />
        </Section>
      )}
    </>
  );
}

/** Explains how big an image is shown compared with its own pixels (docs/DESIGN.md S6). */
function ImageHint({ loc }: { loc: PartLocation }) {
  const image = loc.part.image!;
  const m = restWorldMatrix(loc);
  const shown = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
  const percent = Math.round(shown * 100);
  return (
    <p className={percent > 100 ? 'hint warn' : 'hint'}>
      {image.width} × {image.height} pixels, shown at {percent}% of its own size in the scene.
      {percent > 100 && ' It is enlarged, so it may look soft in the video.'}
    </p>
  );
}

function kindLabel(p: Part): string {
  return { group: 'Group', shape: 'Shape', switch: 'Switch layer', image: 'Image' }[p.kind];
}

export function Properties() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const locs = selection.map((id) => locatePart(project, id)).filter((l): l is PartLocation => !!l);
  const layerRoot = locs.length === 1 && !locs[0]!.parent ? locs[0] : null;
  return (
    <div className="properties" data-testid="properties">
      <div className="panel-header">
        <h2>Properties</h2>
      </div>
      <div className="properties-body">
        {locs.length === 0 && <SceneProperties project={project} />}
        {layerRoot && <LayerProperties loc={layerRoot} />}
        {locs.length > 0 && !layerRoot && <PartProperties locs={locs.filter((l) => l.parent)} />}
      </div>
    </div>
  );
}
