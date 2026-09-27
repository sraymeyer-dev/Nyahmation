import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { locatePart, restWorldMatrix, walkParts } from '../../engine/edit';
import { evaluateScene } from '../../engine/evaluate';
import { pathsBounds } from '../../engine/geometry';
import { applyToPoint } from '../../engine/math';
import { store } from './editor/store';
import { zoomToFit } from './editor/actions';
import { parseProject } from '../../engine/project';
import { channelValueAt } from '../../engine/access';
import { groupStats } from './render/groups';
import { toScreen } from './editor/screen';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A handle for end-to-end tests and debugging from the developer tools.
function findPart(name: string) {
  for (const layer of store.getState().project.scene.layers) {
    for (const p of walkParts(layer.root)) if (p.name === name) return locatePart(store.getState().project, p.id);
  }
  return undefined;
}
(window as unknown as { __nyah: unknown }).__nyah = {
  store,
  /** Screen position (CSS px, relative to the canvas) of a point in a part's drawing, in the rest pose. */
  partScreen(name: string, local = { x: 0, y: 0 }) {
    const loc = findPart(name);
    return loc ? toScreen(store.getState(), applyToPoint(restWorldMatrix(loc), local)) : null;
  },
  jointScreen(name: string) {
    const loc = findPart(name);
    return loc ? toScreen(store.getState(), applyToPoint(restWorldMatrix(loc), loc.part.joint.pivot)) : null;
  },
  /** Like partScreen, but as drawn on the current frame (Animate mode). */
  framePartScreen(name: string, local = { x: 0, y: 0 }) {
    const loc = findPart(name);
    const s = store.getState();
    const p = loc && evaluateScene(s.project, s.frame).parts.find((x) => x.id === loc.part.id);
    return p ? toScreen(s, applyToPoint(p.world, local)) : null;
  },
  part(name: string) {
    return findPart(name)?.part ?? null;
  },
  /** Screen position of the first selected part's origin, in the rest pose. */
  selectedScreen() {
    const s = store.getState();
    const loc = s.selection[0] ? locatePart(s.project, s.selection[0]) : undefined;
    return loc ? toScreen(s, applyToPoint(restWorldMatrix(loc), { x: 0, y: 0 })) : null;
  },
  /** A part's own value of a channel on a frame (its poses, ignoring stepping and pins). */
  channelValue(id: string, channel: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity', frame: number) {
    return channelValueAt(store.getState().project, id, channel, frame);
  },
  /** Names of a layer's parts in paint order (back to front) on a frame; the rest pose in Build mode. */
  paintOrder(layerName: string, frame: number) {
    const s = store.getState();
    const layer = s.project.scene.layers.find((l) => l.name === layerName);
    const scene = s.mode === 'animate' ? evaluateScene(s.project, frame) : evaluateScene({ ...s.project, scene: { ...s.project.scene, tracks: [] } }, 0);
    return scene.parts.filter((p) => p.layerId === layer?.id && p.id !== layer?.root.id).map((p) => p.name);
  },
  /** Opens a project from its JSON (tests). */
  loadProjectJson(json: unknown) {
    store.load(parseProject(json), new Map(), null);
    zoomToFit();
  },
  groupStats,
  /** Screen position of a stage point. */
  stageScreen(p: { x: number; y: number }) {
    return toScreen(store.getState(), p);
  },
  /** How many extra copies of a repeating layer are drawn on the current frame. */
  repeatCount(layerName: string) {
    const s = store.getState();
    const layer = s.project.scene.layers.find((l) => l.name === layerName);
    return layer ? (evaluateScene(s.project, s.frame).repeats.get(layer.id)?.length ?? 0) : 0;
  },
  nameOf(id: string) {
    return locatePart(store.getState().project, id)?.part.name ?? null;
  },
  /** The camera on the current frame. */
  camera() {
    const s = store.getState();
    return evaluateScene(s.project, s.frame).camera;
  },
  /** Screen position of the middle of a shape's outline, as drawn on the current frame. */
  frameMiddleScreen(name: string) {
    const loc = findPart(name);
    if (!loc?.part.paths) return null;
    const b = pathsBounds(loc.part.paths);
    const s = store.getState();
    const p = evaluateScene(s.project, s.frame).parts.find((x) => x.id === loc.part.id);
    return p ? toScreen(s, applyToPoint(p.world, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })) : null;
  },
  /** Screen pixels per drawing unit for a part, as drawn on the current frame. */
  frameScreenScale(name: string) {
    const loc = findPart(name);
    const s = store.getState();
    const p = loc && evaluateScene(s.project, s.frame).parts.find((x) => x.id === loc.part.id);
    if (!p) return null;
    const a = toScreen(s, applyToPoint(p.world, { x: 0, y: 0 }));
    const b = toScreen(s, applyToPoint(p.world, { x: 100, y: 0 }));
    return Math.hypot(b.x - a.x, b.y - a.y) / 100;
  },
};
