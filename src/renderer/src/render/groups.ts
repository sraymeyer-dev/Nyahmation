import type { ResolvedPart } from '../../../engine/evaluate';
import { drawingItemsBounds, findDrawing } from '../../../engine/drawingItems';
import { EMPTY_BOUNDS, isEmptyBounds, pathsBounds, unionBounds, type Bounds } from '../../../engine/geometry';
import { applyToPoint, DEG_TO_RAD, IDENTITY, multiply, type Mat2D } from '../../../engine/math';
import type { Effect, Project } from '../../../engine/types';
import { compositeFor, drawPart, type ImageLookup } from './primitives';

// Off-screen group rendering (docs/DESIGN.md §8b, FX2, D12, D-55).
//
// A part with effects, or one that clips its children, is drawn as a unit:
// the part and everything inside it are painted (in their own draw order)
// into an off-screen picture, the effects are applied to that picture, and
// the result is placed where the part itself sits in the draw order. So a
// shadow on a character's root is one shadow of the whole character, not a
// darker patch wherever its parts overlap.
//
// Order of effects on a unit: haze, then blur, then shadows and glows are
// drawn behind the result (in the order listed).
//
// Finished units are kept (FX6): when a unit looks exactly the same as on the
// last frame (most scenery), its picture is reused instead of redrawn.

export interface GroupOptions {
  /** Apply effects (off for onion skins, which only need outlines). Clipping always applies. */
  effects: boolean;
  /** Finished units by key, for reuse; null to always redraw. */
  cache: Map<string, CachedUnit> | null;
  /** Distinguishes copies of a repeating layer in the cache. */
  keyPrefix: string;
}

export interface CachedUnit {
  signature: string;
  canvas: OffscreenCanvas;
}

type Ctx2D = CanvasRenderingContext2D;

interface Env {
  project: Project;
  images: ImageLookup;
  options: GroupOptions;
  parentOf: Map<string, string | undefined>;
}

// ---- Scratch canvases ------------------------------------------------------------

const pool: { canvas: OffscreenCanvas; busy: boolean }[] = [];

/** A cleared scratch canvas at least w × h; only the top-left w × h is used. */
function acquire(w: number, h: number): OffscreenCanvas {
  let slot = pool.find((s) => !s.busy && s.canvas.width >= w && s.canvas.height >= h) ?? pool.find((s) => !s.busy);
  if (!slot) pool.push((slot = { canvas: new OffscreenCanvas(w, h), busy: false }));
  const c = slot.canvas;
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w);
    c.height = Math.max(c.height, h);
  }
  slot.busy = true;
  const g = context(c);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.filter = 'none';
  g.clearRect(0, 0, w, h);
  return c;
}

function release(c: OffscreenCanvas): void {
  const slot = pool.find((s) => s.canvas === c);
  if (slot) slot.busy = false;
}

const context = (c: OffscreenCanvas) => c.getContext('2d') as unknown as Ctx2D;

/** Copies the top-left w × h of `src` onto `dst` at (x, y), with the current alpha, filter and blending. */
function blit(dst: Ctx2D, src: OffscreenCanvas, w: number, h: number, x = 0, y = 0): void {
  dst.drawImage(src, 0, 0, w, h, x, y, w, h);
}

// ---- Bounds ------------------------------------------------------------------------

const localBoundsCache = new WeakMap<object, Bounds>();

/** A part's own artwork in its drawing coordinates (strokes included). */
function localBounds(project: Project, p: ResolvedPart): Bounds {
  if (p.kind === 'image' && p.image) return { minX: 0, minY: 0, maxX: p.image.width, maxY: p.image.height };
  if (p.kind === 'switch') {
    const drawing = findDrawing(project, p.drawingSetId, p.drawing);
    if (!drawing) return EMPTY_BOUNDS;
    let b = localBoundsCache.get(drawing.items);
    if (!b) {
      b = drawingItemsBounds(drawing.items, IDENTITY);
      const stroke = Math.max(0, ...drawing.items.map((i) => (i.kind === 'shape' && i.style.stroke ? i.style.strokeWidth : 0)));
      b = grow(b, stroke);
      localBoundsCache.set(drawing.items, b);
    }
    return b;
  }
  if (p.kind === 'shape' && p.paths?.length) {
    let b = localBoundsCache.get(p.paths);
    if (!b) localBoundsCache.set(p.paths, (b = pathsBounds(p.paths)));
    // Miter corners can poke out further than half the stroke.
    return grow(b, p.style?.stroke ? p.style.strokeWidth * 2 : 0);
  }
  return EMPTY_BOUNDS;
}

const grow = (b: Bounds, d: number): Bounds => (isEmptyBounds(b) ? b : { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });

function deviceBounds(project: Project, p: ResolvedPart, m: Mat2D): Bounds {
  const b = localBounds(project, p);
  if (isEmptyBounds(b)) return b;
  const t = multiply(m, p.world);
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((c) => applyToPoint(t, c));
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

/** How far (in stage pixels) an effect can reach beyond the artwork. */
function effectReach(e: Effect): number {
  switch (e.kind) {
    case 'shadow':
      return Math.abs(e.distance) + Math.max(0, e.softness) * 1.5;
    case 'glow':
      return Math.max(0, e.size) * 1.5;
    case 'blur':
      return Math.max(0, e.amount) * 1.5;
    case 'haze':
      return 0;
  }
}

const scaleOf = (m: Mat2D) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

// ---- Units -------------------------------------------------------------------------

function isUnit(p: ResolvedPart, env: Env): boolean {
  return p.visible && ((env.options.effects && !!p.effects?.length) || !!p.clipChildren);
}

/** True if `id` is inside the part `ancestor` (not the part itself). */
function isInside(id: string, ancestor: string, env: Env): boolean {
  for (let q = env.parentOf.get(id); q !== undefined; q = env.parentOf.get(q)) if (q === ancestor) return true;
  return false;
}

/**
 * The outermost unit containing `p` (itself included) below `scope`, which
 * is where `p` gets drawn; null if `p` is drawn directly in this scope.
 */
function outermostUnit(p: ResolvedPart, scope: string | null, byId: Map<string, ResolvedPart>, env: Env): ResolvedPart | null {
  let found: ResolvedPart | null = null;
  for (let id: string | undefined = p.id; id !== undefined && id !== scope; id = env.parentOf.get(id)) {
    const q = byId.get(id);
    if (q && isUnit(q, env)) found = q;
  }
  return found;
}

/** Draws parts (paint order) into `ctx`, turning units into off-screen pictures. `scope` is the unit being built, if any. */
function drawSequence(ctx: Ctx2D, members: readonly ResolvedPart[], scope: string | null, m: Mat2D, env: Env): void {
  const byId = new Map(members.map((p) => [p.id, p]));
  for (const p of members) {
    const unit = p.id === scope ? null : outermostUnit(p, scope, byId, env);
    if (!unit) drawPart(ctx, env.project, p, m, env.images, { blend: p.id !== scope });
    else if (unit === p) drawUnit(ctx, p, members.filter((q) => q === p || isInside(q.id, p.id, env)), m, env);
  }
}

const refIds = new WeakMap<object, number>();
let nextRef = 1;
function ref(o: object | undefined): number {
  if (!o) return 0;
  let id = refIds.get(o);
  if (id === undefined) refIds.set(o, (id = nextRef++));
  return id;
}
const num = (v: number) => (Math.round(v * 1e4) / 1e4).toString();

/** Everything that decides how a unit looks: equal signatures draw identical pixels. */
function signature(members: readonly ResolvedPart[], m: Mat2D, box: number[], env: Env): string {
  const parts = members.map((p) => {
    let art = '';
    if (p.kind === 'image' && p.image) art = `${p.image.assetId}:${env.images(p.image.assetId) ? 1 : 0}`;
    else if (p.kind === 'switch') {
      const drawing = findDrawing(env.project, p.drawingSetId, p.drawing);
      art = `${ref(drawing)}:${(drawing?.items ?? []).map((i) => (i.kind === 'image' ? (env.images(i.assetId) ? 1 : 0) : '')).join('')}`;
    } else art = `${ref(p.paths)}:${ref(p.style)}`;
    const effects = env.options.effects && p.effects ? JSON.stringify(p.effects) : '';
    return [p.id, p.visible ? 1 : 0, num(p.opacity), p.world.map(num).join(','), art, p.blend ?? '', p.clipChildren ? 1 : 0, effects].join('|');
  });
  return [m.map(num).join(','), box.join(','), ...parts].join(';');
}

const CACHE_LIMIT = 64;

/** Counters for tests and the speed check: units drawn, and units reused from the cache. */
export const groupStats = { drawn: 0, reused: 0 };

/** Draws a unit at its place: off-screen, with clipping and effects, then composited with its blend mode. */
function drawUnit(target: Ctx2D, unit: ResolvedPart, members: readonly ResolvedPart[], m: Mat2D, env: Env): void {
  const k = scaleOf(m);
  let reach = 0;
  for (const p of members) if (env.options.effects && p.effects) for (const e of p.effects) reach += effectReach(e);
  let b = EMPTY_BOUNDS;
  for (const p of members) if (p.visible && p.opacity > 0) b = unionBounds(b, deviceBounds(env.project, p, m));
  if (isEmptyBounds(b)) return;
  const pad = Math.ceil(reach * k) + 2;
  const x = Math.max(0, Math.floor(b.minX) - pad);
  const y = Math.max(0, Math.floor(b.minY) - pad);
  const w = Math.min(target.canvas.width, Math.ceil(b.maxX) + pad) - x;
  const h = Math.min(target.canvas.height, Math.ceil(b.maxY) + pad) - y;
  if (w <= 0 || h <= 0) return;

  const cache = env.options.cache;
  const key = `${env.options.keyPrefix}:${unit.id}`;
  const sig = cache ? signature(members, m, [x, y, w, h], env) : '';
  const hit = cache?.get(key);
  if (hit && hit.signature === sig) {
    cache!.delete(key);
    cache!.set(key, hit); // most recently used
    composite(target, hit.canvas, unit, w, h, x, y);
    groupStats.reused++;
    return;
  }
  groupStats.drawn++;

  // 1. The unit's artwork, clipped if asked.
  const base = multiply([1, 0, 0, 1, -x, -y], m);
  const content = acquire(w, h);
  const c = context(content);
  if (unit.clipChildren) {
    const own = members.indexOf(unit);
    const clipped = (list: readonly ResolvedPart[]) => {
      if (!list.length) return;
      const layer = acquire(w, h);
      const l = context(layer);
      drawSequence(l, list, unit.id, base, env);
      // Keep only what lies on the part's own artwork.
      drawPart(l, env.project, unit, base, env.images, { composite: 'destination-in', opacity: 1 });
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.globalCompositeOperation = 'source-over';
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      blit(c, layer, w, h);
      release(layer);
    };
    clipped(members.slice(0, own));
    drawPart(c, env.project, unit, base, env.images, { blend: false });
    clipped(members.slice(own + 1));
  } else {
    drawSequence(c, members, unit.id, base, env);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';

  // 2. Effects.
  let result = content;
  const effects = env.options.effects ? (unit.effects ?? []) : [];
  if (effects.length) result = applyEffects(content, effects, w, h, k);

  // 3. Keep it for next time, and place it.
  if (cache) {
    let entry = hit;
    if (!entry) entry = { signature: sig, canvas: new OffscreenCanvas(w, h) };
    if (entry.canvas.width !== w || entry.canvas.height !== h) {
      entry.canvas.width = w;
      entry.canvas.height = h;
    }
    const e = context(entry.canvas);
    e.setTransform(1, 0, 0, 1, 0, 0);
    e.globalAlpha = 1;
    e.globalCompositeOperation = 'copy';
    blit(e, result, w, h);
    e.globalCompositeOperation = 'source-over';
    entry.signature = sig;
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  composite(target, result, unit, w, h, x, y);
  if (result !== content) release(result);
  release(content);
}

function composite(target: Ctx2D, src: OffscreenCanvas, unit: ResolvedPart, w: number, h: number, x: number, y: number): void {
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = 1;
  target.globalCompositeOperation = compositeFor(unit.blend);
  blit(target, src, w, h, x, y);
  target.restore();
}

/**
 * Applies a unit's effects to its picture. Returns a scratch canvas with the
 * finished picture (the caller releases it if it isn't `content`).
 * `k` is canvas pixels per stage pixel.
 */
function applyEffects(content: OffscreenCanvas, effects: readonly Effect[], w: number, h: number, k: number): OffscreenCanvas {
  const c = context(content);
  // Haze: fade the artwork toward a colour (distant scenery, BG6).
  for (const e of effects) {
    if (e.kind !== 'haze' || e.amount <= 0) continue;
    c.globalCompositeOperation = 'source-atop';
    c.globalAlpha = Math.min(1, e.amount);
    c.fillStyle = e.color;
    c.fillRect(0, 0, w, h);
  }
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;

  // Blur (depth of field, BG6).
  let picture = content;
  for (const e of effects) {
    if (e.kind !== 'blur' || e.amount <= 0) continue;
    const next = acquire(w, h);
    const n = context(next);
    n.filter = `blur(${(e.amount * k) / 2}px)`;
    blit(n, picture, w, h);
    n.filter = 'none';
    if (picture !== content) release(picture);
    picture = next;
  }

  const behind = effects.filter((e) => (e.kind === 'shadow' || e.kind === 'glow') && e.opacity > 0);
  if (!behind.length) return picture;

  // Shadows and glows: a tinted, blurred copy of the silhouette behind the picture.
  const out = acquire(w, h);
  const o = context(out);
  const silhouette = acquire(w, h);
  const s = context(silhouette);
  for (const e of behind) {
    if (e.kind !== 'shadow' && e.kind !== 'glow') continue;
    s.globalCompositeOperation = 'copy';
    blit(s, picture, w, h);
    s.globalCompositeOperation = 'source-in';
    s.fillStyle = e.color;
    s.fillRect(0, 0, w, h);
    s.globalCompositeOperation = 'source-over';
    const radius = ((e.kind === 'shadow' ? e.softness : e.size) * k) / 2;
    o.filter = radius > 0.1 ? `blur(${radius}px)` : 'none';
    if (e.kind === 'shadow') {
      o.globalAlpha = Math.min(1, e.opacity);
      const a = e.angle * DEG_TO_RAD;
      blit(o, silhouette, w, h, Math.cos(a) * e.distance * k, Math.sin(a) * e.distance * k);
    } else {
      // Strength: whole passes at full opacity, then a partial one.
      const strength = Math.min(4, Math.max(0, e.strength));
      for (let pass = 0; pass < Math.ceil(strength); pass++) {
        o.globalAlpha = Math.min(1, e.opacity) * Math.min(1, strength - pass);
        blit(o, silhouette, w, h);
      }
    }
  }
  release(silhouette);
  o.filter = 'none';
  o.globalAlpha = 1;
  blit(o, picture, w, h);
  if (picture !== content) release(picture);
  return out;
}

/**
 * Draws one layer's parts (already in paint order) through `m`.
 * Parts without effects or clipping are drawn straight onto `ctx`.
 */
export function drawLayerParts(ctx: Ctx2D, project: Project, parts: readonly ResolvedPart[], m: Mat2D, images: ImageLookup, options: GroupOptions): void {
  const env: Env = { project, images, options, parentOf: new Map(parts.map((p) => [p.id, p.parentId])) };
  drawSequence(ctx, parts, null, m, env);
  ctx.globalCompositeOperation = 'source-over';
}
