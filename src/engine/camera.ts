import { evaluateContinuous } from './interpolate';
import { type Mat2D, DEG_TO_RAD } from './math';
import { findTrack, setPartPose } from './tracks';
import { CAMERA_ID, type CameraState, type Project, type Scene } from './types';

// The camera (docs/DESIGN.md §9.3, D-48). It only changes what you see: the
// characters, their poses and their pins stay in stage coordinates, and the
// camera decides which part of the stage fills the picture. It is animated
// with poses like a part (on the pseudo-part CAMERA_ID) and always moves on
// ones, even when characters are on twos (ST4).

export const CAMERA_CHANNELS = ['x', 'y', 'zoom', 'rotation'] as const;
export type CameraChannel = (typeof CAMERA_CHANNELS)[number];

/** The camera with no poses: the whole scene, centred, not zoomed or turned. */
export function defaultCamera(scene: Pick<Scene, 'width' | 'height'>): CameraState {
  return { x: scene.width / 2, y: scene.height / 2, zoom: 1, rotation: 0 };
}

export function cameraAt(project: Project, frame: number): CameraState {
  const cam = defaultCamera(project.scene);
  for (const channel of CAMERA_CHANNELS) {
    const track = findTrack(project.scene.tracks, CAMERA_ID, channel);
    if (track) cam[channel] = evaluateContinuous(track.poses, frame, cam[channel]);
  }
  return cam;
}

export function isCameraAnimated(project: Project): boolean {
  return project.scene.tracks.some((t) => t.partId === CAMERA_ID);
}

/** Stage coordinates → picture coordinates (0..width, 0..height of the video). */
export function cameraMatrix(cam: CameraState, width: number, height: number): Mat2D {
  const r = cam.rotation * DEG_TO_RAD;
  const a = cam.zoom * Math.cos(r);
  const b = -cam.zoom * Math.sin(r);
  const c = cam.zoom * Math.sin(r);
  const d = cam.zoom * Math.cos(r);
  return [a, b, c, d, width / 2 - (a * cam.x + c * cam.y), height / 2 - (b * cam.x + d * cam.y)];
}

/**
 * The camera a layer at `depth` sees (parallax, docs/DESIGN.md BG4): its pan
 * is scaled by the depth, its zoom raised to the depth, and it turns fully
 * from depth 1 up and not at all at depth 0. Depth 0 is fixed to the camera.
 */
export function cameraForDepth(cam: CameraState, home: CameraState, depth: number): CameraState {
  if (depth === 1) return cam;
  return {
    x: home.x + (cam.x - home.x) * depth,
    y: home.y + (cam.y - home.y) * depth,
    zoom: Math.pow(cam.zoom, depth),
    rotation: cam.rotation * Math.min(depth, 1),
  };
}

/**
 * Records camera values on a frame, only for the channels that changed. The
 * first camera pose after frame 0 also records where the camera was on frame
 * 0, so the move starts from there (A2a).
 */
export function recordCamera(project: Project, frame: number, change: Partial<CameraState>): Project {
  const now = cameraAt(project, frame);
  const home = defaultCamera(project.scene);
  let next = project;
  for (const channel of CAMERA_CHANNELS) {
    const value = change[channel];
    if (value === undefined || !Number.isFinite(value) || Math.abs(value - now[channel]) < 1e-9) continue;
    const track = findTrack(next.scene.tracks, CAMERA_ID, channel);
    if ((!track || track.poses.length === 0) && frame > 0) next = setPartPose(next, CAMERA_ID, channel, 0, home[channel]);
    next = setPartPose(next, CAMERA_ID, channel, frame, value);
  }
  return next;
}

/**
 * The most the camera ever magnifies a layer at `depth`: poses never
 * overshoot, so it is the largest posed zoom (1 with no zoom poses).
 */
export function maxZoomForDepth(project: Project, depth: number): number {
  const track = findTrack(project.scene.tracks, CAMERA_ID, 'zoom');
  const zooms = track?.poses.length ? track.poses.map((p) => p.value) : [1];
  return Math.max(...zooms.map((z) => Math.pow(z, depth)));
}

/** Removes every camera pose: back to showing the whole scene. */
export function resetCamera(project: Project): Project {
  return { ...project, scene: { ...project.scene, tracks: project.scene.tracks.filter((t) => t.partId !== CAMERA_ID) } };
}
