import { locatePart, updatePart } from './edit';
import { evaluateContinuous } from './interpolate';
import { effectChannel, findTrack, setPartPose } from './tracks';
import { EFFECT_SETTINGS, type Effect, type EffectKind, type Part, type Project } from './types';

// Effects on parts and layers (docs/DESIGN.md §8b): editing the list, and
// animating their settings with poses like any other value (FX3).

export const EFFECT_NAMES: Record<EffectKind, string> = {
  shadow: 'Drop shadow',
  glow: 'Outer glow',
  blur: 'Blur',
  haze: 'Haze',
};

/** A new effect with settings that look reasonable on a 1080p character. */
export function createEffect(kind: EffectKind, id: string, background = '#ffffff'): Effect {
  switch (kind) {
    case 'shadow':
      return { id, kind, color: '#000000', opacity: 0.45, angle: 60, distance: 14, softness: 10 };
    case 'glow':
      return { id, kind, color: '#ffe680', opacity: 0.9, size: 18, strength: 1.5 };
    case 'blur':
      return { id, kind, amount: 6 };
    case 'haze':
      return { id, kind, color: background, amount: 0.35 };
  }
}

/** A short id not yet used by the part's effects. */
export function nextEffectId(part: Part): string {
  const used = new Set((part.effects ?? []).map((e) => e.id));
  let n = 1;
  while (used.has(`e${n}`)) n++;
  return `e${n}`;
}

export function isAnimatableSetting(effect: Effect, setting: string): boolean {
  return (EFFECT_SETTINGS[effect.kind] as readonly string[]).includes(setting);
}

export function addEffect(project: Project, partId: string, kind: EffectKind): { project: Project; effectId: string | null } {
  const part = locatePart(project, partId)?.part;
  if (!part) return { project, effectId: null };
  const effect = createEffect(kind, nextEffectId(part), project.scene.sky?.bottom ?? project.scene.background);
  return { project: updatePart(project, partId, (p) => ({ ...p, effects: [...(p.effects ?? []), effect] })), effectId: effect.id };
}

/** Changes an effect's base settings (Build mode; also colours, which don't animate). */
export function updateEffect(project: Project, partId: string, effectId: string, change: Partial<Record<string, number | string>>): Project {
  return updatePart(project, partId, (p) => ({
    ...p,
    effects: (p.effects ?? []).map((e) => (e.id === effectId ? ({ ...e, ...change, id: e.id, kind: e.kind } as Effect) : e)),
  }));
}

/** Removes an effect and its animation. */
export function removeEffect(project: Project, partId: string, effectId: string): Project {
  const next = updatePart(project, partId, (p) => {
    const effects = (p.effects ?? []).filter((e) => e.id !== effectId);
    const { effects: _old, ...rest } = p;
    return effects.length ? { ...rest, effects } : rest;
  });
  const prefix = `fx:${effectId}:`;
  const tracks = next.scene.tracks.filter((t) => !(t.partId === partId && t.channel.startsWith(prefix)));
  return { ...next, scene: { ...next.scene, tracks } };
}

/** An effect setting's value on a frame (its pose, or its base setting). */
export function effectValueAt(project: Project, partId: string, effect: Effect, setting: string, frame: number): number {
  const base = (effect as unknown as Record<string, number>)[setting] ?? 0;
  const track = findTrack(project.scene.tracks, partId, effectChannel(effect.id, setting));
  return track ? evaluateContinuous(track.poses as { frame: number; value: number }[], frame, base) : base;
}

/**
 * Records an effect setting on a frame (Animate mode). The first pose after
 * frame 0 also records the base value on frame 0 (A2a), so a glow set to
 * pulse on frame 24 grows from where it was.
 */
export function recordEffectValue(project: Project, partId: string, effectId: string, setting: string, frame: number, value: number): Project {
  const effect = locatePart(project, partId)?.part.effects?.find((e) => e.id === effectId);
  if (!effect || !isAnimatableSetting(effect, setting)) return project;
  const channel = effectChannel(effectId, setting);
  const track = findTrack(project.scene.tracks, partId, channel);
  let next = project;
  if ((!track || track.poses.length === 0) && frame > 0) {
    next = setPartPose(next, partId, channel, 0, (effect as unknown as Record<string, number>)[setting]!);
  }
  return setPartPose(next, partId, channel, frame, value);
}
