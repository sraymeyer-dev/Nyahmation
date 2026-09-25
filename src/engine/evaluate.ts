import { walkParts } from './edit';
import { evaluateContinuous, evaluateDiscrete } from './interpolate';
import { IDENTITY, localMatrix, multiply, type Mat2D } from './math';
import { collectAnchors, steppedFrame } from './stepping';
import { isContinuousChannel } from './tracks';
import type {
  Channel,
  ImageRef,
  Layer,
  Part,
  PartKind,
  Pose,
  Project,
  ShapeStyle,
  Track,
  Transform,
  VectorPath,
} from './types';

/** A part as it appears on one frame, with everything worked out. */
export interface ResolvedPart {
  id: string;
  name: string;
  kind: PartKind;
  layerId: string;
  /** Drawing coordinates → scene coordinates. */
  world: Mat2D;
  /** The animated local transform (useful for editing tools). */
  local: Transform;
  /** Includes every ancestor's opacity. */
  opacity: number;
  /** False if this part or any ancestor is hidden. */
  visible: boolean;
  /** True if this part or any ancestor is locked. */
  locked: boolean;
  drawOrder: number;
  paths?: VectorPath[];
  style?: ShapeStyle;
  drawingSetId?: string;
  /** The drawing key a switch layer shows on this frame. */
  drawing?: string;
  image?: ImageRef;
}

export interface ResolvedScene {
  frame: number;
  width: number;
  height: number;
  background: string;
  /** In paint order: first is furthest back. */
  parts: ResolvedPart[];
}

type TrackIndex = Map<string, Map<Channel, Track>>;

function indexTracks(tracks: readonly Track[]): TrackIndex {
  const index: TrackIndex = new Map();
  for (const track of tracks) {
    let byChannel = index.get(track.partId);
    if (!byChannel) index.set(track.partId, (byChannel = new Map()));
    byChannel.set(track.channel, track);
  }
  return index;
}

/**
 * The single source of truth for what is on screen: preview, scrubbing, onion
 * skinning and export all call this. It is pure and deterministic.
 * See docs/DESIGN.md §10.4.
 */
export function evaluateScene(project: Project, frame: number): ResolvedScene {
  const { scene } = project;
  const tracks = indexTracks(scene.tracks);
  const parts: ResolvedPart[] = [];
  for (const layer of scene.layers) {
    parts.push(...evaluateLayer(layer, frame, scene.stepping, tracks));
  }
  return { frame, width: scene.width, height: scene.height, background: scene.background, parts };
}

/** The scene with no animation applied: what Build mode shows (docs/DESIGN.md §9.0). */
export function evaluateRestPose(project: Project): ResolvedScene {
  return evaluateScene({ ...project, scene: { ...project.scene, tracks: [] } }, 0);
}

function evaluateLayer(
  layer: Layer,
  frame: number,
  sceneStepping: Project['scene']['stepping'],
  tracks: TrackIndex,
): ResolvedPart[] {
  // Motion is sampled at the stepped frame; discrete channels (mouths,
  // visibility, draw order) always use the real frame, so they stay on ones.
  const stepping = layer.stepping ?? sceneStepping;
  let motionFrame = frame;
  if (stepping !== 1) {
    const poseLists: Pose<unknown>[][] = [];
    for (const part of walkParts(layer.root)) {
      for (const track of tracks.get(part.id)?.values() ?? []) {
        if (isContinuousChannel(track.channel)) poseLists.push(track.poses);
      }
    }
    motionFrame = steppedFrame(frame, stepping, collectAnchors(poseLists));
  }

  const out: ResolvedPart[] = [];
  const visit = (part: Part, parentWorld: Mat2D, parentOpacity: number, parentVisible: boolean, parentLocked: boolean) => {
    const partTracks = tracks.get(part.id);
    const cont = (channel: Channel, rest: number) => {
      const track = partTracks?.get(channel);
      return track ? evaluateContinuous(track.poses as Pose<number>[], motionFrame, rest) : rest;
    };
    const disc = <T>(channel: Channel, rest: T): T => {
      const track = partTracks?.get(channel);
      return track ? evaluateDiscrete(track.poses as Pose<T>[], frame, rest) : rest;
    };

    const local: Transform = {
      x: cont('x', part.rest.x),
      y: cont('y', part.rest.y),
      rotation: cont('rotation', part.rest.rotation),
      scaleX: cont('scaleX', part.rest.scaleX),
      scaleY: cont('scaleY', part.rest.scaleY),
    };
    const world = multiply(parentWorld, localMatrix(local, part.joint.pivot));
    const opacity = parentOpacity * Math.min(Math.max(cont('opacity', part.opacity), 0), 1);
    const visible = parentVisible && disc('visible', part.visible);
    const locked = parentLocked || part.locked === true;

    const resolved: ResolvedPart = {
      id: part.id,
      name: part.name,
      kind: part.kind,
      layerId: layer.id,
      world,
      local,
      opacity,
      visible,
      locked,
      drawOrder: disc('drawOrder', part.drawOrder),
    };
    if (part.kind === 'shape') {
      resolved.paths = part.paths ?? [];
      if (part.style) resolved.style = part.style;
    } else if (part.kind === 'switch') {
      if (part.drawingSetId) resolved.drawingSetId = part.drawingSetId;
      const drawing = disc<string | undefined>('drawing', part.restDrawing);
      if (drawing !== undefined) resolved.drawing = drawing;
    } else if (part.kind === 'image' && part.image) {
      resolved.image = part.image;
    }
    out.push(resolved);
    for (const child of part.children) visit(child, world, opacity, visible, locked);
  };
  visit(layer.root, IDENTITY, 1, true, false);

  // Stable sort: equal draw orders keep tree order (parents before children).
  return out.sort((a, b) => a.drawOrder - b.drawOrder);
}
