// The Nyahmation document model. Plain JSON-compatible data only: no classes,
// no functions, no cycles, so a project can be saved with JSON.stringify and
// compared or copied freely. See docs/DESIGN.md §3.

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * A part's placement in its parent's space.
 * `x`/`y` is where the part's joint sits in the parent; rotation (degrees,
 * clockwise on screen) and scale are applied around the joint.
 */
export interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface Joint {
  /** The joint point in the part's own drawing coordinates. */
  pivot: Vec2;
  /** Rotation limits in degrees (on the part's own rotation), respected by IK. */
  minAngle?: number;
  maxAngle?: number;
  /**
   * IK stops at this joint: dragging a part below it never rotates anything
   * above it, and dragging this part itself only rotates it at its joint.
   */
  chainRoot?: boolean;
  /**
   * Which way a two-part limb bends when it starts out perfectly straight
   * (1 = clockwise on screen, -1 = counter-clockwise). Otherwise IK keeps
   * the bend it already has.
   */
  bendDirection?: 1 | -1;
}

/** A path point. Handles are offsets from the anchor; absent means a sharp corner. */
export interface PathPoint {
  anchor: Vec2;
  handleIn?: Vec2;
  handleOut?: Vec2;
}

export interface VectorPath {
  points: PathPoint[];
  closed: boolean;
}

/**
 * A gradient fill (docs/DESIGN.md D10), in the shape's drawing coordinates.
 * Linear: colours run from `from` to `to`. Radial: from the centre `from`
 * out to the circle through `to`.
 */
export interface Gradient {
  kind: 'linear' | 'radial';
  from: Vec2;
  to: Vec2;
  /** Sorted by offset, 0..1. */
  stops: { offset: number; color: string }[];
}

export interface ShapeStyle {
  /** Solid fill. With a gradient, kept as its first colour (used where a gradient can't be). */
  fill: string | null;
  /** Replaces the solid fill when set (and `fill` isn't null). */
  fillGradient?: Gradient;
  stroke: string | null;
  strokeWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  fillRule: 'nonzero' | 'evenodd';
}

export type PartKind = 'group' | 'shape' | 'switch' | 'image';

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
  /** The un-animated pose. Tracks override these values over time. */
  rest: Transform;
  joint: Joint;
  opacity: number;
  visible: boolean;
  /** Locked parts (and their children) can't be selected on the canvas. */
  locked?: boolean;
  /**
   * Stacking order within the whole layer (higher draws on top).
   * Independent of the parent/child tree, so a child can sit behind its parent.
   */
  drawOrder: number;
  children: Part[];
  /** kind === 'shape' */
  paths?: VectorPath[];
  style?: ShapeStyle;
  /** kind === 'switch' */
  drawingSetId?: string;
  restDrawing?: string;
  /** kind === 'image': drawn with its top-left corner at the part's (0, 0). */
  image?: ImageRef;
}

export interface ImageRef {
  assetId: string;
  width: number;
  height: number;
}

/** How a layer's motion is sampled: every frame, every 2nd or every 3rd. */
export type Stepping = 1 | 2 | 3;

export type LayerKind = 'character' | 'background';

/**
 * One sheet in the scene's stack (docs/DESIGN.md §8a): a character rig or a
 * piece of scenery. Its root part is a group; hiding or locking the root
 * hides or locks the layer.
 */
export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  root: Part;
  /** Overrides the scene's stepping for this layer. */
  stepping?: Stepping;
  /**
   * How the layer moves when the camera moves (docs/DESIGN.md BG4). 1 (the
   * default) is the stage itself; below 1 is further away and moves less (a
   * distant hill); above 1 is foreground and moves more. 0 is fixed to the
   * camera: it stays put on screen, the same size, whatever the camera does.
   */
  depth?: number;
  /**
   * Only for a layer fixed to the camera (depth 0): it rides along with this
   * part (a name tag or speech bubble following a head), keeping its size and
   * angle on screen. It sits where it was drawn relative to the part's joint
   * in the rest pose (docs/DESIGN.md CAM6).
   */
  follow?: { partId: string };
  /**
   * Scrolling and repeating (docs/DESIGN.md BG5): the layer slides sideways
   * at `speed` stage pixels a second (negative: to the left), always on
   * ones; with `repeat`, copies of it sit side by side so it never runs out
   * (a treadmill of scenery, the view from a car window).
   */
  scroll?: { speed: number; repeat: boolean };
}

// ---- Animation ---------------------------------------------------------------

export type EasePreset = 'smooth' | 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut';
/** A custom timing curve, same meaning as CSS cubic-bezier(x1, y1, x2, y2). */
export interface EaseCurve {
  bezier: [number, number, number, number];
}
export type Ease = EasePreset | EaseCurve;

export type ContinuousChannel = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity' | 'zoom';
export type DiscreteChannel = 'drawing' | 'visible' | 'drawOrder' | 'pin';

/**
 * A pin (docs/DESIGN.md §6.3): from its frame on, `point` (in the part's
 * drawing) is held at `at` (scene coordinates) by turning the part's IK chain.
 * A null value ends the pin.
 */
export interface PinValue {
  point: Vec2;
  at: Vec2;
}
export type Channel = ContinuousChannel | DiscreteChannel;

export type ChannelValue<C extends Channel> = C extends ContinuousChannel
  ? number
  : C extends 'drawing'
    ? string
    : C extends 'visible'
      ? boolean
      : C extends 'pin'
        ? PinValue | null
        : number;

/**
 * A value the animator set on a frame. Frames are integers starting at 0.
 * `ease` shapes the motion from this pose to the next (default 'smooth').
 */
export interface Pose<T> {
  frame: number;
  value: T;
  ease?: Ease;
}

/**
 * The camera's tracks use this in place of a part id, with the channels x, y
 * (the stage point at the centre of the picture), zoom and rotation
 * (docs/DESIGN.md §9.3).
 */
export const CAMERA_ID = 'camera';

/** What the camera sees on one frame. */
export interface CameraState {
  /** Stage point shown at the centre of the picture. */
  x: number;
  y: number;
  /** 2 shows everything twice as big. */
  zoom: number;
  /** Degrees, clockwise: the picture turns the other way. */
  rotation: number;
}

export interface Track<C extends Channel = Channel> {
  /** A part id, or CAMERA_ID. */
  partId: string;
  channel: C;
  /** Sorted by frame, at most one pose per frame. */
  poses: Pose<ChannelValue<C>>[];
}

// ---- Drawing sets ------------------------------------------------------------

/**
 * One piece of a drawing, in the switch layer's drawing space. A drawing can
 * mix several (a mouth: lips, teeth, tongue), painted in order.
 */
export type DrawingItem =
  | { kind: 'shape'; paths: VectorPath[]; style: ShapeStyle }
  | { kind: 'image'; assetId: string; x: number; y: number; width: number; height: number };

export interface Drawing {
  /** The name a switch layer refers to, e.g. a mouth sound "A". */
  key: string;
  name: string;
  items: DrawingItem[];
}

export interface DrawingSet {
  id: string;
  name: string;
  vocabulary: 'mouth' | 'custom';
  drawings: Drawing[];
}

// ---- Project -----------------------------------------------------------------

export interface Scene {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  background: string;
  /** A sky behind everything instead of the plain background: top colour fading to bottom colour, fixed to the picture (BG7). */
  sky?: { top: string; bottom: string };
  stepping: Stepping;
  /** Drawn in list order: later layers are on top. */
  layers: Layer[];
  tracks: Track[];
  /** Dialogue and other sound, mixed together (docs/DESIGN.md §8.3). */
  audio: AudioClip[];
}

/** A sound file placed on the timeline. */
export interface AudioClip {
  id: string;
  assetId: string;
  name: string;
  /** The frame where the sound starts (can be negative to trim its beginning). */
  startFrame: number;
  /** Length of the sound in seconds. */
  duration: number;
  /** 0 to 1. */
  volume: number;
  muted?: boolean;
}

export interface AssetRef {
  id: string;
  name: string;
  mimeType: string;
}

/** One project = one scene = one exported video. */
export interface Project {
  format: 'nyahmation';
  version: number;
  scene: Scene;
  drawingSets: DrawingSet[];
  assets: AssetRef[];
}
