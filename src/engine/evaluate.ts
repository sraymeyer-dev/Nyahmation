import { cameraAt, cameraForDepth, cameraMatrix, defaultCamera } from './camera';
import { locatePart, restWorldMatrix, subtreeBounds, walkParts } from './edit';
import { isEmptyBounds } from './geometry';
import { chainFromAncestors, solveIk, type IkLink } from './ik';
import { evaluateContinuous, evaluateDiscrete, evaluateDiscreteFrom } from './interpolate';
import { applyToPoint, IDENTITY, invert, localMatrix, multiply, type Mat2D } from './math';
import { collectAnchors, steppedFrame } from './stepping';
import { isContinuousChannel } from './tracks';
import type {
  CameraState,
  Channel,
  ImageRef,
  Layer,
  Part,
  PartKind,
  PinValue,
  Pose,
  Project,
  ShapeStyle,
  Stepping,
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
  /**
   * Drawing coordinates → scene (stage) coordinates. For a parallax layer or
   * one fixed to the camera, this is where the part effectively appears on
   * the stage under this frame's camera (see ResolvedScene.layerMatrices).
   */
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
  /** The joint point in the part's drawing coordinates. */
  pivot: Vec2;
}

export interface ResolvedScene {
  frame: number;
  width: number;
  height: number;
  background: string;
  /** In paint order: first is furthest back. */
  parts: ResolvedPart[];
  camera: CameraState;
  /** Stage → picture: what the camera shows (docs/DESIGN.md §9.3). Identity when the camera hasn't moved. */
  cameraMatrix: Mat2D;
  /**
   * Layer space → stage, for layers the camera moves differently (parallax
   * depth, fixed to the camera, following a part). Missing means identity.
   * Poses and pins are stored in layer space.
   */
  layerMatrices: ReadonlyMap<string, Mat2D>;
  /**
   * Repeating layers (BG5): extra stage-space matrices, one per copy beside
   * the original, covering what the camera sees. Draw the layer's parts once
   * more through each (multiply(copy, part.world)).
   */
  repeats: ReadonlyMap<string, readonly Mat2D[]>;
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

export interface EvaluateOptions {
  /**
   * Ignore twos and threes and show every frame's in-between: the editor's
   * "View on ones" (docs/DESIGN.md ST6). Never used for export.
   */
  onOnes?: boolean;
}

/**
 * The single source of truth for what is on screen: preview, scrubbing, onion
 * skinning and export all call this. It is pure and deterministic.
 * See docs/DESIGN.md §10.4.
 */
export function evaluateScene(project: Project, frame: number, options: EvaluateOptions = {}): ResolvedScene {
  const { scene } = project;
  const tracks = indexTracks(scene.tracks);
  const byLayer = scene.layers.map((layer) => evaluateLayer(layer, frame, options.onOnes ? 1 : (layer.stepping ?? scene.stepping), tracks));

  // The camera (on ones) and how it moves each layer.
  const camera = cameraAt(project, frame);
  const home = defaultCamera(scene);
  const toPicture = cameraMatrix(camera, scene.width, scene.height);
  const toStage = invert(toPicture);
  const layerMatrices = new Map<string, Mat2D>();
  const repeats = new Map<string, Mat2D[]>();
  const moveLayer = (i: number, pictureMatrix: Mat2D) => {
    const scrolled = scrollLayer(project, scene.layers[i]!, frame, pictureMatrix);
    const m = multiply(toStage, scrolled.pictureMatrix);
    if (scrolled.copies.length) repeats.set(scene.layers[i]!.id, scrolled.copies.map((c) => multiply(multiply(m, c), invert(m))));
    if (isIdentity(m)) return;
    layerMatrices.set(scene.layers[i]!.id, m);
    for (const part of byLayer[i]!) {
      part.world = multiply(m, part.world);
      if (part.pin) part.pin = { ...part.pin, at: applyToPoint(m, part.pin.at) };
    }
  };
  const followers: number[] = [];
  scene.layers.forEach((layer, i) => {
    const depth = layer.depth ?? 1;
    if (depth === 0 && layer.follow) followers.push(i);
    else moveLayer(i, depth === 1 ? toPicture : cameraMatrix(cameraForDepth(camera, home, depth), scene.width, scene.height));
  });
  // Layers fixed to the camera that follow a part (docs/DESIGN.md CAM6): the
  // layer keeps its size and angle on screen, and its middle keeps its place
  // relative to the part's joint, that distance growing as the part is shown
  // bigger (so a bubble above a head stays above it when the camera zooms in).
  if (followers.length) {
    const resolved = new Map(byLayer.flat().map((p) => [p.id, p]));
    const followerIds = new Set(followers.map((i) => scene.layers[i]!.id));
    for (const i of followers) {
      const layer = scene.layers[i]!;
      const target = resolved.get(layer.follow!.partId);
      const loc = target && !followerIds.has(target.layerId) ? locatePart(project, target.id) : undefined;
      if (!target || !loc) {
        moveLayer(i, IDENTITY);
        continue;
      }
      const restWorld = restWorldMatrix(loc);
      const shown = multiply(toPicture, target.world);
      const now = applyToPoint(shown, target.pivot);
      const rest = applyToPoint(restWorld, target.pivot);
      const k = Math.sqrt(Math.abs(det(shown)) / (Math.abs(det(restWorld)) || 1));
      const middle = layerMiddle(project, layer);
      // Where the layer's middle goes, and how far that is from where it was drawn.
      const x = now.x + k * (middle.x - rest.x);
      const y = now.y + k * (middle.y - rest.y);
      moveLayer(i, [1, 0, 0, 1, x - middle.x, y - middle.y]);
    }
  }

  return {
    frame,
    width: scene.width,
    height: scene.height,
    background: scene.background,
    parts: byLayer.flat(),
    camera,
    cameraMatrix: toPicture,
    layerMatrices,
    repeats,
  };
}

const MAX_COPIES = 200;

/**
 * Slides a scrolling layer (docs/DESIGN.md BG5) and, if it repeats, lists
 * the copies (as layer-space shifts) needed to fill the picture. The
 * original copy is kept nearest its drawn place, so it can still be clicked.
 */
function scrollLayer(project: Project, layer: Layer, frame: number, pictureMatrix: Mat2D): { pictureMatrix: Mat2D; copies: Mat2D[] } {
  const scroll = layer.scroll;
  if (!scroll || scroll.speed === 0) return { pictureMatrix, copies: [] };
  const travelled = (scroll.speed * frame) / project.scene.fps;
  const bounds = layerBounds(project, layer);
  const period = bounds ? bounds.maxX - bounds.minX : 0;
  if (!scroll.repeat || !bounds || period < 1) return { pictureMatrix: multiply(pictureMatrix, [1, 0, 0, 1, travelled, 0]), copies: [] };
  const offset = travelled - period * Math.round(travelled / period);
  // What the picture shows, across the layer (before sliding).
  const toLayer = invert(pictureMatrix);
  const { width: W, height: H } = project.scene;
  const xs = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: 0, y: H },
    { x: W, y: H },
  ].map((c) => applyToPoint(toLayer, c).x);
  const from = Math.ceil((Math.min(...xs) - bounds.maxX - offset) / period);
  const to = Math.floor((Math.max(...xs) - bounds.minX - offset) / period);
  const copies: Mat2D[] = [];
  for (let k = Math.max(from, -MAX_COPIES); k <= Math.min(to, MAX_COPIES); k++) if (k !== 0) copies.push([1, 0, 0, 1, k * period, 0]);
  return { pictureMatrix: multiply(pictureMatrix, [1, 0, 0, 1, offset, 0]), copies };
}

const boundsCache = new WeakMap<Layer, { minX: number; minY: number; maxX: number; maxY: number } | null>();
/** A layer's artwork in the rest pose, in layer space (null if empty). */
function layerBounds(project: Project, layer: Layer) {
  if (!boundsCache.has(layer)) {
    const b = subtreeBounds(project, layer.root, localMatrix(layer.root.rest, layer.root.joint.pivot));
    boundsCache.set(layer, isEmptyBounds(b) ? null : b);
  }
  return boundsCache.get(layer)!;
}

const det = (m: Mat2D) => m[0] * m[3] - m[1] * m[2];

const middles = new WeakMap<Layer, Vec2>();
/** The middle of a layer's artwork in the rest pose (its origin if it has none). */
function layerMiddle(project: Project, layer: Layer): Vec2 {
  let m = middles.get(layer);
  if (!m) {
    const b = layerBounds(project, layer);
    m = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : applyToPoint(localMatrix(layer.root.rest, layer.root.joint.pivot), layer.root.joint.pivot);
    middles.set(layer, m);
  }
  return m;
}

function isIdentity(m: Mat2D): boolean {
  return Math.abs(m[0] - 1) < 1e-12 && Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12 && Math.abs(m[3] - 1) < 1e-12 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9;
}

/** The scene with no animation applied: what Build mode shows (docs/DESIGN.md §9.0). */
export function evaluateRestPose(project: Project): ResolvedScene {
  return evaluateScene({ ...project, scene: { ...project.scene, tracks: [] } }, 0);
}

function evaluateLayer(layer: Layer, frame: number, stepping: Stepping, tracks: TrackIndex): ResolvedPart[] {
  // Motion is sampled at the stepped frame; discrete channels (mouths,
  // visibility, draw order, pins) always use the real frame, so they stay on ones.
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
      pivot: part.joint.pivot,
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
