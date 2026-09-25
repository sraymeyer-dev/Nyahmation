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
  /** Rotation limits in degrees, used by IK (phase 2). */
  minAngle?: number;
  maxAngle?: number;
  /** IK stops at this joint (phase 2). */
  chainRoot?: boolean;
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

export interface ShapeStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  fillRule: 'nonzero' | 'evenodd';
}

export type PartKind = 'group' | 'shape' | 'switch';

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
  /** The un-animated pose. Tracks override these values over time. */
  rest: Transform;
  joint: Joint;
  opacity: number;
  visible: boolean;
  /**
   * Stacking order within the whole character (higher draws on top).
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
}

/** How a character's motion is sampled: every frame, every 2nd or every 3rd. */
export type Stepping = 1 | 2 | 3;

export interface Character {
  id: string;
  name: string;
  root: Part;
  /** Overrides the scene's stepping for this character. */
  stepping?: Stepping;
}

// ---- Animation ---------------------------------------------------------------

export type EasePreset = 'smooth' | 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut';
/** A custom timing curve, same meaning as CSS cubic-bezier(x1, y1, x2, y2). */
export interface EaseCurve {
  bezier: [number, number, number, number];
}
export type Ease = EasePreset | EaseCurve;

export type ContinuousChannel = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity';
export type DiscreteChannel = 'drawing' | 'visible' | 'drawOrder';
export type Channel = ContinuousChannel | DiscreteChannel;

export type ChannelValue<C extends Channel> = C extends ContinuousChannel
  ? number
  : C extends 'drawing'
    ? string
    : C extends 'visible'
      ? boolean
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

export interface Track<C extends Channel = Channel> {
  partId: string;
  channel: C;
  /** Sorted by frame, at most one pose per frame. */
  poses: Pose<ChannelValue<C>>[];
}

// ---- Drawing sets ------------------------------------------------------------

export type DrawingContent =
  | { kind: 'vector'; paths: VectorPath[]; style: ShapeStyle }
  | { kind: 'image'; assetId: string; width: number; height: number };

export interface Drawing {
  /** The name a switch layer refers to, e.g. a mouth sound "A". */
  key: string;
  name: string;
  content: DrawingContent;
  /** Aligns the drawing to the switch layer's origin. */
  offset: Vec2;
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
  stepping: Stepping;
  /** Drawn in list order: later characters are on top. */
  characters: Character[];
  tracks: Track[];
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
