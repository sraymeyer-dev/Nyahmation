import { walkParts } from './edit';
import { chainFromAncestors, solveIk, type IkLink } from './ik';
import { evaluateContinuous, evaluateDiscrete, evaluateDiscreteFrom } from './interpolate';
import { applyToPoint, IDENTITY, localMatrix, multiply, type Mat2D } from './math';
import { collectAnchors, steppedFrame } from './stepping';
import { isContinuousChannel } from './tracks';
import type {
  Channel,
  ImageRef,
  Layer,
  Part,
  PartKind,
  PinValue,
  Pose,
  Project,
  ShapeStyle,
  Track,
  Transform,
  Vec2,
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
  /** Set while the part is pinned; `reached` is false if the limb can't reach the pin. */
  pin?: { at: Vec2; reached: boolean };
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
  // visibility, draw order, pins) always use the real frame, so they stay on ones.
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

  const cont = (part: Part, channel: Channel, rest: number) => {
    const track = tracks.get(part.id)?.get(channel);
    return track ? evaluateContinuous(track.poses as Pose<number>[], motionFrame, rest) : rest;
  };
  const disc = <T>(part: Part, channel: Channel, rest: T): T => {
    const track = tracks.get(part.id)?.get(channel);
    return track ? evaluateDiscrete(track.poses as Pose<T>[], frame, rest) : rest;
  };

  // 1. Every part's animated local transform.
  const locals = new Map<string, Transform>();
  const ancestorsOf = new Map<string, Part[]>();
  const pinned: { part: Part; pin: PinValue }[] = [];
  const gather = (part: Part, ancestors: Part[]) => {
    locals.set(part.id, {
      x: cont(part, 'x', part.rest.x),
      y: cont(part, 'y', part.rest.y),
      rotation: cont(part, 'rotation', part.rest.rotation),
      scaleX: cont(part, 'scaleX', part.rest.scaleX),
      scaleY: cont(part, 'scaleY', part.rest.scaleY),
    });
    ancestorsOf.set(part.id, ancestors);
    const pinTrack = tracks.get(part.id)?.get('pin');
    const pin = pinTrack ? evaluateDiscreteFrom(pinTrack.poses as Pose<PinValue | null>[], frame, null) : null;
    if (pin && ancestors.length > 0) pinned.push({ part, pin });
    for (const child of part.children) gather(child, [...ancestors, part]);
  };
  gather(layer.root, []);

  // 2. Pins: re-solve each pinned part's chain so its pinned point stays put
  // (docs/DESIGN.md P4). Two passes let pins that share joints settle.
  const worldOf = (part: Part): Mat2D => {
    let m = IDENTITY;
    for (const p of [...ancestorsOf.get(part.id)!, part]) m = multiply(m, localMatrix(locals.get(p.id)!, p.joint.pivot));
    return m;
  };
  const pinReached = new Map<string, boolean>();
  for (let pass = 0; pass < (pinned.length > 1 ? 2 : pinned.length); pass++) {
    for (const { part, pin } of pinned) {
      const ancestors = ancestorsOf.get(part.id)!;
      const chain = chainFromAncestors(part, ancestors);
      const links = (chain.length ? [...chain].reverse() : [part]).map((p): IkLink => {
        const l: IkLink = { transform: locals.get(p.id)!, pivot: p.joint.pivot };
        if (p.joint.minAngle !== undefined) l.minAngle = p.joint.minAngle;
        if (p.joint.maxAngle !== undefined) l.maxAngle = p.joint.maxAngle;
        if (p.joint.bendDirection !== undefined) l.bendDirection = p.joint.bendDirection;
        return l;
      });
      const top = chain.length ? chain[chain.length - 1]! : part;
      const topAncestors = ancestorsOf.get(top.id)!;
      const base = worldOf(topAncestors[topAncestors.length - 1]!);
      const effector = chain.length ? applyToPoint(localMatrix(locals.get(part.id)!, part.joint.pivot), pin.point) : pin.point;
      const rotations = solveIk(base, links, effector, pin.at);
      (chain.length ? [...chain].reverse() : [part]).forEach((p, i) => {
        locals.set(p.id, { ...locals.get(p.id)!, rotation: rotations[i]! });
      });
      const reached = applyToPoint(worldOf(part), pin.point);
      pinReached.set(part.id, Math.hypot(reached.x - pin.at.x, reached.y - pin.at.y) < 0.5);
    }
  }
  const pinOf = new Map(pinned.map((p) => [p.part.id, p.pin]));

  // 3. World matrices, opacity, visibility; resolve each part.
  const out: ResolvedPart[] = [];
  const visit = (part: Part, parentWorld: Mat2D, parentOpacity: number, parentVisible: boolean, parentLocked: boolean) => {
    const local = locals.get(part.id)!;
    const world = multiply(parentWorld, localMatrix(local, part.joint.pivot));
    const opacity = parentOpacity * Math.min(Math.max(cont(part, 'opacity', part.opacity), 0), 1);
    const visible = parentVisible && disc(part, 'visible', part.visible);
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
      drawOrder: disc(part, 'drawOrder', part.drawOrder),
    };
    const pin = pinOf.get(part.id);
    if (pin) resolved.pin = { at: pin.at, reached: pinReached.get(part.id) ?? false };
    if (part.kind === 'shape') {
      resolved.paths = part.paths ?? [];
      if (part.style) resolved.style = part.style;
    } else if (part.kind === 'switch') {
      if (part.drawingSetId) resolved.drawingSetId = part.drawingSetId;
      const drawing = disc<string | undefined>(part, 'drawing', part.restDrawing);
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
