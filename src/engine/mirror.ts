import { channelValueAt, recordValue, type PartChannel } from './access';
import { locatePart, walkParts } from './edit';
import type { Part, Project } from './types';

// Mirrored poses (docs/DESIGN.md A13, MR1–MR4).
//
// Parts come in pairs by name: left/right, front/back, or a single L/R
// ("Arm L", "leg_R"). Parts inside a pair's parts pair up in order too, so
// "Hand" inside "Forearm (front)" pairs with "Hand (back)" inside
// "Forearm (back)".
//   Mirror      the pose flipped side to side: each paired part takes its
//               partner's pose, turned the other way; unpaired parts (torso,
//               head) turn the other way themselves. For front-facing rigs.
//   Swap sides  paired parts exchange poses as they are; unpaired parts stay.
//               For the second half of a walk seen from the side.
// Changes are measured from the rest pose, so rigs whose two sides aren't
// drawn identically still come out right. The top part keeps its place on
// the stage, so the character doesn't jump.

export type MirrorMode = 'mirror' | 'swap';

const WORDS: [RegExp, Record<string, string>][] = [
  [/\b(left|right)\b/i, { left: 'right', right: 'left' }],
  [/\b(front|back)\b/i, { front: 'back', back: 'front' }],
];

function matchCase(word: string, like: string): string {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] === like[0]!.toUpperCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

/** The name of a part's partner on the other side, or null if its name doesn't say. */
export function counterpartName(name: string): string | null {
  for (const [re, swap] of WORDS) {
    const m = re.exec(name);
    if (m) return name.slice(0, m.index) + matchCase(swap[m[1]!.toLowerCase()]!, m[1]!) + name.slice(m.index + m[1]!.length);
  }
  // A lone L or R, not part of a word: "Arm L", "leg_R", "L_hand".
  const single = /(^|[^A-Za-z])([LlRr])(?=$|[^A-Za-z])/.exec(name);
  if (single) {
    const at = single.index + single[1]!.length;
    const c = single[2]!;
    const other = { L: 'R', R: 'L', l: 'r', r: 'l' }[c]!;
    return name.slice(0, at) + other + name.slice(at + 1);
  }
  return null;
}

/** Pairs of parts (both ways) among `root` and everything inside it. */
export function pairParts(root: Part): Map<string, string> {
  const pairs = new Map<string, string>();
  const byName = new Map<string, Part>();
  for (const p of walkParts(root)) if (!byName.has(p.name)) byName.set(p.name, p);
  const link = (a: Part, b: Part) => {
    if (pairs.has(a.id) || pairs.has(b.id) || a === b) return;
    pairs.set(a.id, b.id);
    pairs.set(b.id, a.id);
    // Children pair in order when both sides have the same number.
    if (a.children.length === b.children.length) a.children.forEach((c, i) => link(c, b.children[i]!));
  };
  for (const p of walkParts(root)) {
    const other = counterpartName(p.name);
    const partner = other ? byName.get(other) : undefined;
    if (partner) link(p, partner);
  }
  return pairs;
}

const CHANNELS: readonly PartChannel[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'];
type Values = Record<PartChannel, number>;

function restValues(p: Part): Values {
  return { x: p.rest.x, y: p.rest.y, rotation: p.rest.rotation, scaleX: p.rest.scaleX, scaleY: p.rest.scaleY, opacity: p.opacity };
}

/**
 * The mirrored (or swapped) values for `roots` and everything inside them on
 * `frame`, as they should become. Only parts inside the roots take part.
 */
export function mirroredValues(project: Project, roots: readonly string[], frame: number, mode: MirrorMode): Map<string, Values> {
  const out = new Map<string, Values>();
  for (const rootId of roots) {
    const root = locatePart(project, rootId)?.part;
    if (!root) continue;
    const pairs = pairParts(root);
    const parts = new Map([...walkParts(root)].map((p) => [p.id, p]));
    const now = (id: string) => Object.fromEntries(CHANNELS.map((c) => [c, channelValueAt(project, id, c, frame)!])) as Values;
    for (const p of parts.values()) {
      const partnerId = pairs.get(p.id);
      if (!partnerId && mode === 'swap') continue;
      const q = parts.get(partnerId ?? p.id)!;
      const src = now(q.id);
      const qRest = restValues(q);
      const pRest = restValues(p);
      const flip = mode === 'mirror' ? -1 : 1;
      const v: Values = {
        x: pRest.x + flip * (src.x - qRest.x),
        y: pRest.y + (src.y - qRest.y),
        rotation: pRest.rotation + flip * (src.rotation - qRest.rotation),
        scaleX: src.scaleX,
        scaleY: src.scaleY,
        opacity: src.opacity,
      };
      if (p.id === rootId) {
        // The top part stays where it is on the stage.
        const own = now(p.id);
        v.x = own.x;
        v.y = own.y;
      }
      out.set(p.id, v);
    }
  }
  return out;
}

/** Records values as poses on a frame, only where they change (with the first-pose rule). Returns how many parts changed. */
export function recordValues(project: Project, frame: number, values: ReadonlyMap<string, Values>): { project: Project; changed: number } {
  let next = project;
  let changed = 0;
  for (const [id, v] of values) {
    let touched = false;
    for (const c of CHANNELS) {
      const cur = channelValueAt(next, id, c, frame);
      if (cur === undefined || Math.abs(cur - v[c]) < 1e-9) continue;
      next = recordValue(next, id, c, frame, v[c]);
      touched = true;
    }
    if (touched) changed++;
  }
  return { project: next, changed };
}

/** Mirrors or swaps the pose of `roots` on `frame`, recording poses. */
export function mirrorPose(project: Project, roots: readonly string[], frame: number, mode: MirrorMode): { project: Project; changed: number; pairs: number } {
  const values = mirroredValues(project, roots, frame, mode);
  let pairs = 0;
  for (const id of roots) {
    const root = locatePart(project, id)?.part;
    if (root) pairs += pairParts(root).size / 2;
  }
  return { ...recordValues(project, frame, values), pairs };
}
