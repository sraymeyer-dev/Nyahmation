import { cameraAt, recordCamera } from '../../../../engine/camera';
import { applyToPoint, DEG_TO_RAD, invert } from '../../../../engine/math';
import type { CameraState, Project, Vec2 } from '../../../../engine/types';
import { fromScreen, throughCamera, toScreen } from '../screen';
import { store } from '../store';
import { ACCENT } from './common';
import type { OverlayContext, Tool, ToolPointer } from './types';

// Camera tool (Animate mode, docs/DESIGN.md CAM2): poses the camera on the
// current frame, like posing a part.
//   drag         pan: through the camera you drag the picture; on the stage
//                you drag the camera's frame
//   Shift-drag   turn the camera around the middle of the picture
//   Alt-drag     zoom: drag up to zoom in, down to zoom out

type Mode = 'pan' | 'turn' | 'zoom';

let drag: { mode: Mode; base: Project; start: ToolPointer; camera: CameraState; through: boolean; grab: Vec2 } | null = null;

function modeFor(p: ToolPointer): Mode {
  if (p.alt) return 'zoom';
  if (p.shift) return 'turn';
  return 'pan';
}

const angle = (c: Vec2, p: Vec2) => Math.atan2(p.y - c.y, p.x - c.x) / DEG_TO_RAD;

function cameraFor(p: ToolPointer): Partial<CameraState> {
  const d = drag!;
  const s = store.getState();
  const cam = d.camera;
  switch (d.mode) {
    case 'pan': {
      if (!d.through) {
        // Move the frame with the mouse, on the stage.
        return { x: cam.x + p.scene.x - d.start.scene.x, y: cam.y + p.scene.y - d.start.scene.y };
      }
      // Keep the grabbed stage point under the mouse: solve for the camera's centre.
      const { zoom, panX, panY } = s.view;
      const picture = { x: (p.screen.x - panX) / zoom, y: (p.screen.y - panY) / zoom };
      const { width: W, height: H } = s.project.scene;
      const r = cam.rotation * DEG_TO_RAD;
      const dx = (picture.x - W / 2) / cam.zoom;
      const dy = (picture.y - H / 2) / cam.zoom;
      // Undo the picture's turn (which is the opposite of the camera's).
      const ux = Math.cos(r) * dx - Math.sin(r) * dy;
      const uy = Math.sin(r) * dx + Math.cos(r) * dy;
      return { x: d.grab.x - ux, y: d.grab.y - uy };
    }
    case 'turn': {
      // Around the stage point the camera looks at: the middle of the picture.
      const c = toScreen(s, { x: cam.x, y: cam.y });
      let swept = angle(c, p.screen) - angle(c, d.start.screen);
      swept = ((((swept + 180) % 360) + 360) % 360) - 180;
      // Through the camera the picture follows the mouse, so the camera turns the other way.
      return { rotation: cam.rotation + (d.through ? -swept : swept) };
    }
    case 'zoom': {
      const zoom = cam.zoom * Math.exp(-(p.screen.y - d.start.screen.y) / 200);
      return { zoom: Math.min(20, Math.max(0.05, zoom)) };
    }
  }
}

export const cameraTool: Tool = {
  cursor: () => (drag?.mode === 'pan' ? 'grabbing' : 'move'),

  down(p) {
    const s = store.getState();
    const camera = cameraAt(s.project, s.frame);
    store.set({ selection: [], cameraSelected: true });
    store.beginGesture();
    drag = { mode: modeFor(p), base: s.project, start: p, camera, through: throughCamera(s), grab: fromScreen(s, p.screen) };
  },

  move(p, dragging) {
    if (!dragging || !drag) return;
    const change = cameraFor(p);
    const project = recordCamera(drag.base, store.getState().frame, change);
    const c = { ...drag.camera, ...change };
    store.preview(project, { status: `Camera: ${Math.round(c.zoom * 100)}% · ${Math.round(c.rotation)}° · centre ${Math.round(c.x)}, ${Math.round(c.y)}` });
  },

  up() {
    if (!drag) return;
    drag = null;
    store.endGesture();
  },

  finish() {
    if (drag) store.endGesture();
    drag = null;
  },

  drawOverlay(o: OverlayContext) {
    // A crosshair where the camera looks.
    const { ctx, resolved } = o;
    const centre = o.toScreen(applyToPoint(invert(resolved.cameraMatrix), { x: o.s.project.scene.width / 2, y: o.s.project.scene.height / 2 }));
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centre.x - 9, centre.y);
    ctx.lineTo(centre.x + 9, centre.y);
    ctx.moveTo(centre.x, centre.y - 9);
    ctx.lineTo(centre.x, centre.y + 9);
    ctx.stroke();
    ctx.restore();
  },
};
