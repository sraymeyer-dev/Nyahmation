import { CAMERA_ID, type PinValue, type Pose, type Project, type Track } from './types';

// Changing the scene's size (docs/DESIGN.md E5). The picture is cut from the
// stage around its middle, so a new size keeps what was in the middle there:
// everything on the stage moves by half the change, the way a canvas grows
// or shrinks evenly on every side.

/**
 * Moves everything on the stage by (dx, dy): each layer (its root's rest
 * position and position poses), every pin's anchor and the camera's posed
 * position. Nothing changes relative to anything else, so poses, pins,
 * cycles, followers and parallax all stay as they were.
 */
export function moveStage(project: Project, dx: number, dy: number): Project {
  if (dx === 0 && dy === 0) return project;
  const roots = new Set(project.scene.layers.map((l) => l.root.id));
  const layers = project.scene.layers.map((l) => ({ ...l, root: { ...l.root, rest: { ...l.root.rest, x: l.root.rest.x + dx, y: l.root.rest.y + dy } } }));
  const tracks = project.scene.tracks.map((track): Track => {
    const moved = roots.has(track.partId) || track.partId === CAMERA_ID;
    if (moved && (track.channel === 'x' || track.channel === 'y')) {
      const d = track.channel === 'x' ? dx : dy;
      return { ...track, poses: (track.poses as Pose<number>[]).map((p) => ({ ...p, value: p.value + d })) } as Track;
    }
    if (track.channel === 'pin') {
      const poses = (track.poses as Pose<PinValue | null>[]).map((p) => (p.value ? { ...p, value: { ...p.value, at: { x: p.value.at.x + dx, y: p.value.at.y + dy } } } : p));
      return { ...track, poses } as Track;
    }
    return track;
  });
  return { ...project, scene: { ...project.scene, layers, tracks } };
}

/** A new scene size, with what was in the middle of the picture still in the middle. */
export function resizeScene(project: Project, width: number, height: number): Project {
  const { scene } = project;
  if (width === scene.width && height === scene.height) return project;
  const moved = moveStage(project, (width - scene.width) / 2, (height - scene.height) / 2);
  return { ...moved, scene: { ...moved.scene, width, height } };
}

/** Common video shapes for the scene, with where they're used. */
export const SCENE_SIZES: readonly { width: number; height: number; name: string }[] = [
  { width: 1920, height: 1080, name: 'Widescreen (YouTube, TV)' },
  { width: 1080, height: 1920, name: 'Tall (Shorts, Reels, TikTok)' },
  { width: 1080, height: 1080, name: 'Square' },
  { width: 1080, height: 1350, name: 'Portrait 4:5 (Instagram)' },
  { width: 1440, height: 1080, name: '4:3 (classic TV)' },
  { width: 3840, height: 2160, name: '4K widescreen' },
];
