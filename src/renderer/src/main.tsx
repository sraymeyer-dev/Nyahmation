import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { locatePart, restWorldMatrix, walkParts } from '../../engine/edit';
import { evaluateScene } from '../../engine/evaluate';
import { applyToPoint } from '../../engine/math';
import { store } from './editor/store';
import { sceneToScreen } from './editor/view';
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
    return loc ? sceneToScreen(store.getState().view, applyToPoint(restWorldMatrix(loc), local)) : null;
  },
  jointScreen(name: string) {
    const loc = findPart(name);
    return loc ? sceneToScreen(store.getState().view, applyToPoint(restWorldMatrix(loc), loc.part.joint.pivot)) : null;
  },
  /** Like partScreen, but as drawn on the current frame (Animate mode). */
  framePartScreen(name: string, local = { x: 0, y: 0 }) {
    const loc = findPart(name);
    const s = store.getState();
    const p = loc && evaluateScene(s.project, s.frame).parts.find((x) => x.id === loc.part.id);
    return p ? sceneToScreen(s.view, applyToPoint(p.world, local)) : null;
  },
  part(name: string) {
    return findPart(name)?.part ?? null;
  },
};
