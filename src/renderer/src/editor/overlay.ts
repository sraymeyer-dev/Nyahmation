import type { ResolvedScene } from '../../../engine/evaluate';
import { applyToPoint, multiply, type Mat2D } from '../../../engine/math';
import type { Vec2 } from '../../../engine/types';
import { compoundPath2D } from '../render/paths';
import type { EditorState } from './store';
import { ACCENT } from './tools/common';
import type { OverlayContext } from './tools/types';

// Editor overlays drawn on top of the scene, in screen space: the area
// outside the scene, the grid, selection outlines and joints.

export function makeOverlayContext(ctx: CanvasRenderingContext2D, s: EditorState, resolved: ResolvedScene): OverlayContext {
  const { zoom, panX, panY } = s.view;
  const view: Mat2D = [zoom, 0, 0, zoom, panX, panY];
  return {
    ctx,
    s,
    resolved,
    toScreen: (p: Vec2) => ({ x: p.x * zoom + panX, y: p.y * zoom + panY }),
    toScreenMatrix: (world: Mat2D) => multiply(view, world),
  };
}

export function drawOutsideScene(o: OverlayContext, width: number, height: number): void {
  const { ctx, s } = o;
  const a = o.toScreen({ x: 0, y: 0 });
  const b = o.toScreen({ x: s.project.scene.width, y: s.project.scene.height });
  ctx.save();
  ctx.fillStyle = 'rgba(20, 21, 24, 0.55)';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(a.x) - 0.5, Math.round(a.y) - 0.5, Math.round(b.x - a.x) + 1, Math.round(b.y - a.y) + 1);
  ctx.restore();
}

export function drawGrid(o: OverlayContext): void {
  const { ctx, s } = o;
  const { width: W, height: H } = s.project.scene;
  let step = s.grid.size;
  // Skip lines when they'd be closer than 6 px apart.
  while (step * s.view.zoom < 6) step *= 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(79, 140, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += step) {
    const p = o.toScreen({ x, y: 0 });
    const q = o.toScreen({ x, y: H });
    ctx.moveTo(Math.round(p.x) + 0.5, p.y);
    ctx.lineTo(Math.round(q.x) + 0.5, q.y);
  }
  for (let y = 0; y <= H; y += step) {
    const p = o.toScreen({ x: 0, y });
    const q = o.toScreen({ x: W, y });
    ctx.moveTo(p.x, Math.round(p.y) + 0.5);
    ctx.lineTo(q.x, Math.round(q.y) + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

/** Outlines selected parts and marks their joints. */
export function drawSelection(o: OverlayContext): void {
  const { ctx, s, resolved } = o;
  if (!s.selection.length) return;
  const selected = new Set(s.selection);
  ctx.save();
  for (const part of resolved.parts) {
    if (!selected.has(part.id)) continue;
    const m = o.toScreenMatrix(part.world);
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    ctx.save();
    ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([...m])));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / scale;
    if (part.paths?.length) ctx.stroke(compoundPath2D(part.paths));
    else if (part.image) ctx.strokeRect(0, 0, part.image.width, part.image.height);
    ctx.restore();
  }
  // Joints: where each selected part attaches to its parent.
  for (const part of resolved.parts) {
    if (!selected.has(part.id)) continue;
    const pivot = pivotOf(s, part.id);
    if (!pivot) continue;
    const j = o.toScreen(applyToPoint(part.world, pivot));
    ctx.beginPath();
    ctx.arc(j.x, j.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#e0457b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

// The resolved scene doesn't carry pivots; look them up in the tree.
function pivotOf(s: EditorState, id: string): Vec2 | null {
  const stack = s.project.scene.layers.map((l) => l.root);
  while (stack.length) {
    const p = stack.pop()!;
    if (p.id === id) return p.joint.pivot;
    stack.push(...p.children);
  }
  return null;
}

// ---- Skeleton (joints and bones) -------------------------------------------------

export interface JointInfo {
  pivot: Vec2;
  /** The parent part, or null when the parent is the layer itself. */
  parentId: string | null;
  chainRoot: boolean;
}

const jointCache = new WeakMap<object, Map<string, JointInfo>>();

/** Joint facts for every part (except layer roots), keyed by part id. */
export function jointIndex(project: EditorState['project']): Map<string, JointInfo> {
  let index = jointCache.get(project);
  if (index) return index;
  index = new Map();
  for (const layer of project.scene.layers) {
    const visit = (p: typeof layer.root, parentId: string | null) => {
      for (const c of p.children) {
        index!.set(c.id, { pivot: c.joint.pivot, parentId, chainRoot: c.joint.chainRoot === true });
        visit(c, c.id);
      }
    };
    visit(layer.root, null);
  }
  jointCache.set(project, index);
  return index;
}

/**
 * Scene position of each visible, unlocked part's joint. Skeletons belong to
 * characters, so background parts only show a joint while selected.
 */
export function jointPositions(o: Pick<OverlayContext, 's' | 'resolved'>): Map<string, Vec2> {
  const index = jointIndex(o.s.project);
  const characterLayers = new Set(o.s.project.scene.layers.filter((l) => l.kind === 'character').map((l) => l.id));
  const selected = new Set(o.s.selection);
  const out = new Map<string, Vec2>();
  for (const part of o.resolved.parts) {
    const info = index.get(part.id);
    if (!info || !part.visible || part.locked) continue;
    if (!characterLayers.has(part.layerId) && !selected.has(part.id)) continue;
    out.set(part.id, applyToPoint(part.world, info.pivot));
  }
  return out;
}

/**
 * Draws bones (parent joint → child joint) and joints. Chain roots are
 * squares. `highlight` marks joints that will turn (the IK chain).
 */
export function drawSkeleton(o: OverlayContext, options: { highlight?: ReadonlySet<string>; faint?: boolean } = {}): void {
  const { ctx, s } = o;
  const index = jointIndex(s.project);
  const joints = jointPositions(o);
  const selected = new Set(s.selection);
  ctx.save();
  ctx.globalAlpha = options.faint ? 0.55 : 1;
  ctx.lineWidth = 2;
  for (const [id, pos] of joints) {
    const parentId = index.get(id)!.parentId;
    const parentPos = parentId ? joints.get(parentId) : undefined;
    if (!parentPos) continue;
    const a = o.toScreen(parentPos);
    const b = o.toScreen(pos);
    ctx.strokeStyle = options.highlight?.has(parentId!) ? ACCENT : 'rgba(224, 69, 123, 0.75)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const [id, pos] of joints) {
    const p = o.toScreen(pos);
    const info = index.get(id)!;
    const hot = selected.has(id) || options.highlight?.has(id);
    ctx.beginPath();
    if (info.chainRoot) ctx.rect(p.x - 5, p.y - 5, 10, 10);
    else ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = hot ? ACCENT : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = hot ? '#ffffff' : '#e0457b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}
