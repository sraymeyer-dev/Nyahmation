import { locatePart, restWorldMatrix, updateLayer, updatePart, type PartLocation } from '../../../engine/edit';
import { channelValueAt, frameAccess, recordValue } from '../../../engine/access';
import { applyToPoint } from '../../../engine/math';
import { poseEaseAt } from '../../../engine/retime';
import { deleteSelectedMarks, editAccess, markTargets, setSelectedMarksEase } from '../editor/animate';
import { autoChainRoots, setPivotAtScene } from '../../../engine/rig';
import type { Ease, Part, Project, Scene, ShapeStyle, Stepping, Transform } from '../../../engine/types';
import { store, useEditor } from '../editor/store';
import { NumberField, PaintField, Row, Section } from './fields';
import { AudioClipSection, SwitchSection } from './SwitchProperties';
import { CameraSection, LayerCameraSection } from './CameraProperties';
import { GradientFields } from './GradientFields';
import { EffectsSection } from './EffectsSection';

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
        <Row label="Sky">
          <label className="check" title="A gradient behind everything, fixed to the picture: top colour fading to the bottom colour.">
            <input
              type="checkbox"
              aria-label="Sky gradient"
              checked={!!scene.sky}
              onChange={(e) => {
                const { sky: _old, ...rest } = scene;
                store.commit({ ...project, scene: e.target.checked ? { ...rest, sky: { top: '#5b9bd5', bottom: scene.background } } : rest });
              }}
            />
            Gradient
          </label>
          {scene.sky && (
            <>
              <input type="color" aria-label="Sky top colour" title="Top" value={scene.sky.top} onChange={(e) => set({ sky: { ...scene.sky!, top: e.target.value } }, 'skyTop')} />
              <input type="color" aria-label="Sky bottom colour" title="Bottom" value={scene.sky.bottom} onChange={(e) => set({ sky: { ...scene.sky!, bottom: e.target.value } }, 'skyBottom')} />
            </>
          )}
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
      <Row label="Rig">
        <button onClick={() => store.commit(autoChainRoots(project, layer.id), { status: 'Chain roots set where limbs branch off (shoulders, hips, neck).' })}>
          Mark branch joints as chain roots
        </button>
      </Row>
    </Section>
  );
}

function LayerSections({ loc }: { loc: PartLocation }) {
  return (
    <>
      <LayerProperties loc={loc} />
      <LayerCameraSection layer={loc.layer} />
      <EffectsSection part={loc.layer.root} title="Layer effects" />
    </>
  );
}

function PartProperties({ locs }: { locs: PartLocation[] }) {
  const mode = useEditor((s) => s.mode);
  const ids = locs.map((l) => l.part.id);
  const single = locs.length === 1 ? locs[0]!.part : null;
  const shapes = locs.map((l) => l.part).filter((p) => p.kind === 'shape' && p.style);
  const same = <T,>(get: (p: Part) => T): T | null => {
    const first = get(locs[0]!.part);
    return locs.every((l) => get(l.part) === first) ? first : null;
  };
  const frame = useEditor((s) => s.frame);
  const project = useEditor((s) => s.project);
  const animate = mode === 'animate';
  // In Animate mode the fields show (and record) the pose on the current frame.
  const shown = single ? (animate ? frameAccess(project, frame).local(single.id) : single.rest) ?? single.rest : null;
  const setRest = (patch: Partial<Transform>, key: string) => {
    if (animate && single) {
      const s = store.getState();
      store.commit(editAccess(s).write(s.project, new Map([[single.id, patch]])), {}, key);
    } else commitParts(ids, (p) => ({ ...p, rest: { ...p.rest, ...patch } }), key);
  };
  const opacity = animate
    ? (() => {
        const values = locs.map((l) => channelValueAt(project, l.part.id, 'opacity', frame) ?? 1);
        return values.every((v) => v === values[0]) ? values[0]! : null;
      })()
    : same((p) => p.opacity);
  const setOpacity = (v: number) => {
    if (!animate) return commitParts(ids, (p) => ({ ...p, opacity: v }), 'opacity');
    let next = store.getState().project;
    for (const id of ids) next = recordValue(next, id, 'opacity', frame, v);
    store.commit(next, {}, 'opacity');
  };

  return (
    <>
      <Section title={`${single ? kindLabel(single) : `${locs.length} parts`}${animate ? ` · frame ${frame + 1}` : ''}`}>
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
              <NumberField label="X" value={shown!.x} onCommit={(x) => setRest({ x }, 'x')} suffix="x" />
              <NumberField label="Y" value={shown!.y} onCommit={(y) => setRest({ y }, 'y')} suffix="y" />
            </Row>
            <Row label="Rotation">
              <NumberField label="Rotation" value={shown!.rotation} onCommit={(rotation) => setRest({ rotation }, 'rot')} suffix="°" />
            </Row>
            <Row label="Scale">
              <NumberField label="Scale X" value={shown!.scaleX * 100} digits={1} onCommit={(v) => setRest({ scaleX: v / 100 }, 'sx')} suffix="%" />
              <NumberField label="Scale Y" value={shown!.scaleY * 100} digits={1} onCommit={(v) => setRest({ scaleY: v / 100 }, 'sy')} suffix="%" />
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
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          />
          <span className="value">{opacity === null ? 'mixed' : `${Math.round(opacity * 100)}%`}</span>
        </Row>
        {single?.kind === 'image' && single.image && <ImageHint loc={locs[0]!} />}
      </Section>
      {single?.kind === 'switch' && <SwitchSection part={single} />}
      {single && <EffectsSection part={single} />}
      {single && mode === 'build' && <JointSection loc={locs[0]!} />}
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
          <GradientFields shapes={shapes} commit={(fn, key) => commitParts(shapes.map((p) => p.id), fn, key)} />
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

/** Joint settings for one part (docs/DESIGN.md R2, R4, R5, R6). */
function JointSection({ loc }: { loc: PartLocation }) {
  const part = loc.part;
  const joint = part.joint;
  const scene = applyToPoint(restWorldMatrix(loc), joint.pivot);
  const setJoint = (patch: Partial<Part['joint']>, key: string) => {
    const next = { ...joint, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    commitParts([part.id], (p) => ({ ...p, joint: next }), key);
  };
  const limited = joint.minAngle !== undefined || joint.maxAngle !== undefined;
  const rotation = part.rest.rotation;
  return (
    <Section title="Joint">
      <Row label="Position">
        <NumberField label="Joint X" value={scene.x} onCommit={(x) => store.commit(setPivotAtScene(store.getState().project, part.id, { x, y: scene.y }), {}, 'jx')} suffix="x" />
        <NumberField label="Joint Y" value={scene.y} onCommit={(y) => store.commit(setPivotAtScene(store.getState().project, part.id, { x: scene.x, y }), {}, 'jy')} suffix="y" />
      </Row>
      <Row label="Chain root">
        <input type="checkbox" aria-label="Chain root" checked={joint.chainRoot === true} onChange={(e) => setJoint({ chainRoot: e.target.checked || undefined }, 'chainRoot')} />
        <span className="value">IK stops at this joint</span>
      </Row>
      <Row label="Limits">
        <input
          type="checkbox"
          aria-label="Limit rotation"
          checked={limited}
          onChange={(e) =>
            setJoint(e.target.checked ? { minAngle: Math.round(rotation - 90), maxAngle: Math.round(rotation + 90) } : { minAngle: undefined, maxAngle: undefined }, 'limits')
          }
        />
        {limited ? (
          <>
            <NumberField label="Minimum angle" value={joint.minAngle ?? null} digits={0} onCommit={(minAngle) => setJoint({ minAngle }, 'min')} suffix="°" />
            <NumberField label="Maximum angle" value={joint.maxAngle ?? null} digits={0} onCommit={(maxAngle) => setJoint({ maxAngle }, 'max')} suffix="°" />
          </>
        ) : (
          <span className="value">Turns freely</span>
        )}
      </Row>
      {limited && <p className="hint">Now at {Math.round(rotation)}°. IK keeps this part's rotation between the two angles.</p>}
      <Row label="Bends">
        <select
          aria-label="Bend direction"
          value={joint.bendDirection ?? 1}
          onChange={(e) => setJoint({ bendDirection: Number(e.target.value) as 1 | -1 }, 'bend')}
        >
          <option value={1}>Clockwise when straight</option>
          <option value={-1}>Counter-clockwise when straight</option>
        </select>
      </Row>
    </Section>
  );
}

function kindLabel(p: Part): string {
  return { group: 'Group', shape: 'Shape', switch: 'Switch layer', image: 'Image' }[p.kind];
}

/** Selected pose marks on the timeline: their easing (docs/DESIGN.md A9). */
function PoseMarks() {
  const project = useEditor((s) => s.project);
  const marks = useEditor((s) => s.timeline.marks);
  if (!marks.length) return null;
  const ease = poseEaseAt(project, markTargets(project, marks));
  const value = typeof ease === 'string' ? ease : ease ? 'custom' : 'smooth';
  const frames = [...new Set(marks.map((m) => m.frame + 1))].sort((a, b) => a - b);
  return (
    <Section title={marks.length === 1 ? `Pose · frame ${frames[0]}` : `${marks.length} poses`}>
      <Row label="Motion out">
        <select aria-label="Pose easing" value={value} onChange={(e) => setSelectedMarksEase(e.target.value as Ease)}>
          <option value="smooth">Smooth (flows through)</option>
          <option value="easeInOut">Ease in and out</option>
          <option value="easeIn">Ease in (start slow)</option>
          <option value="easeOut">Ease out (end slow)</option>
          <option value="linear">Linear (steady)</option>
          <option value="hold">Hold (jump at the next pose)</option>
          {value === 'custom' && <option value="custom" disabled>Custom curve</option>}
        </select>
      </Row>
      <p className="hint">How the motion travels from this pose to the next one. Drag the mark to retime it (Shift: move everything after it too; Option or Ctrl: copy it).</p>
      <Row label="">
        <button onClick={deleteSelectedMarks}>Delete pose{marks.length > 1 ? 's' : ''}</button>
      </Row>
    </Section>
  );
}

export function Properties() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const mode = useEditor((s) => s.mode);
  const locs = selection.map((id) => locatePart(project, id)).filter((l): l is PartLocation => !!l);
  const layerRoot = locs.length === 1 && !locs[0]!.parent ? locs[0] : null;
  const clip = useEditor((s) => s.project.scene.audio.find((c) => c.id === s.selectedClip));
  const camera = useEditor((s) => s.cameraSelected && s.mode === 'animate');
  return (
    <div className="properties" data-testid="properties">
      <div className="panel-header">
        <h2>Properties</h2>
      </div>
      <div className="properties-body">
        {clip && <AudioClipSection clip={clip} />}
        {mode === 'animate' && <PoseMarks />}
        {camera && <CameraSection />}
        {locs.length === 0 && !camera && <SceneProperties project={project} />}
        {layerRoot && <LayerSections loc={layerRoot} />}
        {locs.length > 0 && !layerRoot && <PartProperties locs={locs.filter((l) => l.parent)} />}
      </div>
    </div>
  );
}
