import { pathsBounds } from '../../../engine/geometry';
import { gradientAngle, gradientForBounds } from '../../../engine/gradients';
import type { Gradient, Part } from '../../../engine/types';
import { NumberField, Row, toHex } from './fields';

// Fill type for selected shapes: solid, or a linear or radial gradient
// (docs/DESIGN.md D10). Each shape's gradient is fitted to its own size.

type Kind = 'solid' | Gradient['kind'];

export function GradientFields({ shapes, commit }: { shapes: Part[]; commit: (fn: (p: Part) => Part, key: string) => void }) {
  const first = shapes[0]!.style!;
  if (first.fill === null) return null;
  const g = first.fillGradient;
  const kind: Kind = g?.kind ?? 'solid';
  const stops = g?.stops.length ? g.stops : [{ offset: 0, color: first.fill }, { offset: 1, color: '#ffffff' }];
  const angle = g && g.kind === 'linear' ? gradientAngle(g) : 90;

  /** Refits every selected shape's gradient with these settings. */
  const apply = (next: Kind, nextStops: Gradient['stops'], nextAngle: number, key: string) =>
    commit((p) => {
      if (!p.style) return p;
      if (next === 'solid') {
        const { fillGradient: _g, ...style } = p.style;
        return { ...p, style };
      }
      const b = pathsBounds(p.paths ?? []);
      const fillGradient = gradientForBounds(next, b, nextStops, nextAngle);
      return { ...p, style: { ...p.style, fill: nextStops[0]!.color, fillGradient } };
    }, key);
  const setStop = (i: number, color: string) => apply(kind, stops.map((s, j) => (j === i ? { ...s, color } : s)), angle, `stop${i}`);

  return (
    <>
      <Row label="Fill type">
        <select aria-label="Fill type" value={kind} onChange={(e) => apply(e.target.value as Kind, stops, angle, 'fillType')}>
          <option value="solid">Solid colour</option>
          <option value="linear">Gradient (straight)</option>
          <option value="radial">Gradient (round)</option>
        </select>
      </Row>
      {kind !== 'solid' && (
        <>
          <Row label={kind === 'radial' ? 'Middle' : 'From'}>
            <input type="color" aria-label="Gradient start colour" value={toHex(stops[0]!.color)} onChange={(e) => setStop(0, e.target.value)} />
          </Row>
          <Row label={kind === 'radial' ? 'Edge' : 'To'}>
            <input type="color" aria-label="Gradient end colour" value={toHex(stops.at(-1)!.color)} onChange={(e) => setStop(stops.length - 1, e.target.value)} />
          </Row>
          {stops.length > 2 && <p className="hint">This gradient has {stops.length} colours (from an SVG); the pickers change the first and last.</p>}
          {kind === 'linear' && (
            <Row label="Angle">
              <NumberField label="Gradient angle" value={angle} digits={0} step={15} suffix="° (90 = top to bottom)" onCommit={(a) => apply(kind, stops, a, 'gradAngle')} />
            </Row>
          )}
        </>
      )}
    </>
  );
}
