import { pathCommands } from '../../../engine/geometry';
import type { VectorPath } from '../../../engine/types';

// Path2D objects built from (immutable) paths are cached and reused.

const single = new WeakMap<VectorPath, Path2D>();
const compound = new WeakMap<readonly VectorPath[], Path2D>();

export function toPath2D(path: VectorPath): Path2D {
  let p = single.get(path);
  if (p) return p;
  p = new Path2D();
  for (const c of pathCommands(path)) {
    if (c.op === 'M') p.moveTo(c.x, c.y);
    else if (c.op === 'L') p.lineTo(c.x, c.y);
    else if (c.op === 'C') p.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.x, c.y);
    else p.closePath();
  }
  single.set(path, p);
  return p;
}

/** All of a shape's paths as one Path2D, so holes work with the even-odd rule. */
export function compoundPath2D(paths: readonly VectorPath[]): Path2D {
  let p = compound.get(paths);
  if (p) return p;
  p = new Path2D();
  for (const path of paths) p.addPath(toPath2D(path));
  compound.set(paths, p);
  return p;
}
