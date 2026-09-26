import { updatePart } from '../../../engine/edit';
import { addEffect, EFFECT_NAMES, effectValueAt, recordEffectValue, removeEffect, updateEffect } from '../../../engine/effects';
import type { BlendMode, Effect, EffectKind, Part } from '../../../engine/types';
import { store, useEditor } from '../editor/store';
import { NumberField, Row, Section, toHex } from './fields';

// Effects, blend mode and clipping for a part or a whole layer
// (docs/DESIGN.md §8b, D12). In Animate mode, number settings record poses
// on the current frame, so a glow can pulse or a shadow lengthen (FX3).

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply (shading)' },
  { value: 'screen', label: 'Screen (light)' },
  { value: 'add', label: 'Add (bright light)' },
  { value: 'overlay', label: 'Overlay (contrast)' },
];

interface Setting {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Shown ×100 as a percentage. */
  percent?: boolean;
}

const SETTINGS: Record<EffectKind, Setting[]> = {
  shadow: [
    { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 5, suffix: '%', percent: true },
    { key: 'angle', label: 'Direction', step: 15, suffix: '° (90 = down)' },
    { key: 'distance', label: 'Distance', min: 0, step: 2, suffix: 'px' },
    { key: 'softness', label: 'Softness', min: 0, step: 2, suffix: 'px' },
  ],
  glow: [
    { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 5, suffix: '%', percent: true },
    { key: 'size', label: 'Size', min: 0, step: 2, suffix: 'px' },
    { key: 'strength', label: 'Strength', min: 0, max: 4, step: 0.5, suffix: '(1 = normal, up to 4)' },
  ],
  blur: [{ key: 'amount', label: 'Amount', min: 0, step: 1, suffix: 'px' }],
  haze: [{ key: 'amount', label: 'Amount', min: 0, max: 100, step: 5, suffix: '%', percent: true }],
};

export function EffectsSection({ part, title = 'Effects' }: { part: Part; title?: string }) {
  const mode = useEditor((s) => s.mode);
  const frame = useEditor((s) => s.frame);
  const project = useEditor((s) => s.project);
  const animate = mode === 'animate';
  const effects = part.effects ?? [];
  const commit = (fn: (p: typeof project) => typeof project, key?: string) => store.commit(fn(store.getState().project), {}, key);

  const setNumber = (effect: Effect, setting: Setting, shown: number) => {
    const value = setting.percent ? shown / 100 : shown;
    if (animate) commit((p) => recordEffectValue(p, part.id, effect.id, setting.key, store.getState().frame, value), `fx-${effect.id}-${setting.key}`);
    else commit((p) => updateEffect(p, part.id, effect.id, { [setting.key]: value }), `fx-${effect.id}-${setting.key}`);
  };

  return (
    <Section title={title}>
      <Row label="Blend">
        <select
          aria-label="Blend mode"
          value={part.blend ?? 'normal'}
          onChange={(e) =>
            commit((p) =>
              updatePart(p, part.id, (q) => {
                const { blend: _b, ...rest } = q;
                const blend = e.target.value as BlendMode;
                return blend === 'normal' ? rest : { ...rest, blend };
              }),
            )
          }
        >
          {BLENDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </Row>
      {part.kind !== 'group' && part.children.length > 0 && (
        <Row label="Clip">
          <label className="check" title="Parts inside this one only show where this part's own artwork is: pupils that stay inside the eye.">
            <input
              type="checkbox"
              aria-label="Clip children"
              checked={!!part.clipChildren}
              onChange={(e) =>
                commit((p) =>
                  updatePart(p, part.id, (q) => {
                    const { clipChildren: _c, ...rest } = q;
                    return e.target.checked ? { ...rest, clipChildren: true } : rest;
                  }),
                )
              }
            />
            Parts inside only show on this shape
          </label>
        </Row>
      )}
      {effects.map((effect) => (
        <div key={effect.id} className="effect" data-testid={`effect-${effect.kind}`}>
          <div className="effect-head">
            <strong>{EFFECT_NAMES[effect.kind]}</strong>
            <button aria-label={`Remove ${EFFECT_NAMES[effect.kind]}`} title="Remove this effect and its animation" onClick={() => commit((p) => removeEffect(p, part.id, effect.id))}>
              ×
            </button>
          </div>
          {'color' in effect && (
            <Row label="Colour">
              <input
                type="color"
                aria-label={`${EFFECT_NAMES[effect.kind]} colour`}
                value={toHex(effect.color)}
                onChange={(e) => commit((p) => updateEffect(p, part.id, effect.id, { color: e.target.value }), `fx-${effect.id}-color`)}
              />
            </Row>
          )}
          {SETTINGS[effect.kind].map((setting) => {
            const value = animate ? effectValueAt(project, part.id, effect, setting.key, frame) : (effect as unknown as Record<string, number>)[setting.key]!;
            return (
              <Row key={setting.key} label={setting.label}>
                <NumberField
                  label={`${EFFECT_NAMES[effect.kind]} ${setting.label.toLowerCase()}`}
                  value={setting.percent ? value * 100 : value}
                  digits={setting.percent ? 0 : 1}
                  min={setting.min}
                  max={setting.max}
                  step={setting.step}
                  suffix={setting.suffix}
                  onCommit={(v) => setNumber(effect, setting, v)}
                />
              </Row>
            );
          })}
        </div>
      ))}
      <Row label="Add">
        <select
          aria-label="Add effect"
          value=""
          onChange={(e) => {
            const kind = e.target.value as EffectKind;
            if (kind) commit((p) => addEffect(p, part.id, kind).project);
          }}
        >
          <option value="">Add an effect…</option>
          {(Object.keys(EFFECT_NAMES) as EffectKind[]).map((k) => (
            <option key={k} value={k}>
              {EFFECT_NAMES[k]}
            </option>
          ))}
        </select>
      </Row>
      {effects.length > 0 && (
        <p className="hint">
          {animate
            ? `Changing a number records it on frame ${frame + 1}, so effects can animate. Colours apply to every frame.`
            : 'Effects apply to this part and everything inside it as one picture. In Animate mode, changing a number animates it.'}
        </p>
      )}
    </Section>
  );
}
