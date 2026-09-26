import { cameraAt, defaultCamera, isCameraAnimated, recordCamera, resetCamera } from '../../../engine/camera';
import { updateLayer, walkParts } from '../../../engine/edit';
import type { CameraState, Layer, Part } from '../../../engine/types';
import { store, useEditor } from '../editor/store';
import { NumberField, Row, Section } from './fields';

// Properties for the camera (docs/DESIGN.md §9.3), and for how a layer moves
// when the camera moves: parallax depth, fixed to the camera, following a part.

export function CameraSection() {
  const project = useEditor((s) => s.project);
  const frame = useEditor((s) => s.frame);
  const cameraView = useEditor((s) => s.cameraView);
  const cam = cameraAt(project, frame);
  const set = (change: Partial<CameraState>, key: string) => store.commit(recordCamera(store.getState().project, store.getState().frame, change), {}, key);
  return (
    <Section title={`Camera · frame ${frame + 1}`}>
      <Row label="Centre X">
        <NumberField label="Camera X" value={cam.x} digits={1} onCommit={(x) => set({ x }, 'camx')} />
      </Row>
      <Row label="Centre Y">
        <NumberField label="Camera Y" value={cam.y} digits={1} onCommit={(y) => set({ y }, 'camy')} />
      </Row>
      <Row label="Zoom">
        <NumberField label="Camera zoom" value={cam.zoom * 100} digits={0} min={5} max={2000} step={5} suffix="%" onCommit={(z) => set({ zoom: z / 100 }, 'camzoom')} />
      </Row>
      <Row label="Turn">
        <NumberField label="Camera rotation" value={cam.rotation} digits={1} suffix="°" onCommit={(rotation) => set({ rotation }, 'camrot')} />
      </Row>
      <Row label="View">
        <label className="check">
          <input type="checkbox" checked={cameraView} onChange={(e) => store.set({ cameraView: e.target.checked })} />
          Look through the camera
        </label>
      </Row>
      <p className="hint">
        Changing a value records a camera pose on this frame, and the camera moves smoothly between poses. With the Camera tool (C): drag to pan, Shift-drag to turn, Option/Alt-drag up or down to zoom. The camera only changes what you see: characters and pins stay where they are on the stage.
      </p>
      <Row label="">
        <button onClick={() => store.commit(recordCamera(project, frame, defaultCamera(project.scene)), { status: `Camera shows the whole scene on frame ${frame + 1}.` })}>
          Whole scene on this frame
        </button>
      </Row>
      {isCameraAnimated(project) && (
        <Row label="">
          <button onClick={() => store.commit(resetCamera(project), { status: 'Removed every camera move.' })}>Remove all camera moves</button>
        </Row>
      )}
    </Section>
  );
}

/** Parts a fixed layer can follow: those in layers that aren't fixed to the camera themselves. */
function followTargets(layers: readonly Layer[], self: Layer): { layer: Layer; parts: { part: Part; depth: number }[] }[] {
  return layers
    .filter((l) => l !== self && (l.depth ?? 1) !== 0)
    .map((layer) => {
      const parts: { part: Part; depth: number }[] = [];
      const visit = (p: Part, depth: number) => {
        for (const c of p.children) {
          parts.push({ part: c, depth });
          visit(c, depth + 1);
        }
      };
      visit(layer.root, 0);
      return { layer, parts };
    })
    .filter((g) => g.parts.length);
}

export function LayerCameraSection({ layer }: { layer: Layer }) {
  const project = useEditor((s) => s.project);
  const depth = layer.depth ?? 1;
  const fixed = depth === 0;
  const update = (fn: (l: Layer) => Layer, key?: string) => store.commit(updateLayer(store.getState().project, layer.id, fn), {}, key);
  const setDepth = (d: number) =>
    update((l) => {
      const { depth: _d, follow: _f, ...rest } = l;
      if (d === 1) return rest;
      return d === 0 && l.follow ? { ...rest, depth: 0, follow: l.follow } : { ...rest, depth: d };
    }, 'depth');
  const setFollow = (partId: string) =>
    update((l) => {
      const { follow: _f, ...rest } = l;
      return partId ? { ...rest, follow: { partId } } : rest;
    });
  const targets = fixed ? followTargets(project.scene.layers, layer) : [];
  const followMissing = layer.follow && !project.scene.layers.some((l) => [...walkParts(l.root)].some((p) => p.id === layer.follow!.partId));
  const scroll = layer.scroll ?? { speed: 0, repeat: false };
  const setScroll = (next: { speed: number; repeat: boolean }, key: string) =>
    update((l) => {
      const { scroll: _s, ...rest } = l;
      return next.speed === 0 && !next.repeat ? rest : { ...rest, scroll: next };
    }, key);
  return (
    <Section title="Camera and scrolling">
      <Row label="Fixed">
        <label className="check" title="Stays in the same place on screen, the same size, whatever the camera does: titles, speech bubbles, a narrator in the corner.">
          <input type="checkbox" aria-label="Fixed to camera" checked={fixed} onChange={(e) => setDepth(e.target.checked ? 0 : 1)} />
          Fixed to the camera
        </label>
      </Row>
      {fixed ? (
        <>
          <Row label="Follows">
            <select aria-label="Follows part" value={followMissing ? '' : (layer.follow?.partId ?? '')} onChange={(e) => setFollow(e.target.value)}>
              <option value="">Nothing (stays put on screen)</option>
              {targets.map((g) => (
                <optgroup key={g.layer.id} label={g.layer.name}>
                  {g.parts.map(({ part, depth: d }) => (
                    <option key={part.id} value={part.id}>
                      {'\u00a0'.repeat(d * 2)}
                      {part.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Row>
          <p className="hint">
            {layer.follow && !followMissing
              ? 'Rides along with that part, keeping its own size and angle on screen: a name tag or speech bubble. Draw it where it should sit next to the part in Build mode; when the camera zooms in, it stays that far from the part, measured at the new size.'
              : 'Pick a part for this layer to ride along with, such as a head for a speech bubble.'}
          </p>
        </>
      ) : (
        <>
          <Row label="Depth">
            <NumberField label="Layer depth" value={depth} digits={2} min={0.05} max={5} step={0.1} onCommit={setDepth} />
          </Row>
          <p className="hint">How much the layer moves when the camera pans or zooms. 1 is the stage; less is further away and moves less (0.3 for far hills); more is foreground and moves more.</p>
        </>
      )}
      <Row label="Scroll">
        <NumberField label="Scroll speed" value={scroll.speed} digits={0} step={10} suffix="px a second" onCommit={(speed) => setScroll({ ...scroll, speed }, 'scroll')} />
      </Row>
      <Row label="Repeat">
        <label className="check">
          <input type="checkbox" aria-label="Repeat sideways" checked={scroll.repeat} onChange={(e) => setScroll({ ...scroll, repeat: e.target.checked }, 'repeat')} />
          Repeat sideways
        </label>
      </Row>
      <p className="hint">Scrolling slides the layer sideways as the scene plays (negative: to the left), for scenery passing a window or a walk on the spot. Repeat puts copies side by side so it never runs out.</p>
    </Section>
  );
}
