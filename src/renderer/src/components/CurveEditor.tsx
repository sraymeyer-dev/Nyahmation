import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { cubicBezierEase } from '../../../engine/easing';
import { NumberField } from './fields';

// Custom easing curve (docs/DESIGN.md A10): a timing curve from the pose (bottom
// left) to the next pose (top right). Across is time, up is how far the
// motion has got. Drag the two handles; a curve that rises above the top
// overshoots and settles back (a bounce into the pose).

export type Bezier = [number, number, number, number];

const SIZE = 150;
const PAD = 26;
/** Up/down room for overshoot: y from -0.5 to 1.5 fits in the box. */
const Y_MIN = -0.5;
const Y_MAX = 1.5;

const toX = (x: number) => PAD + x * SIZE;
const toY = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * SIZE * 1.4;
const HEIGHT = PAD * 2 + SIZE * 1.4;

export const CURVE_PRESETS: { label: string; bezier: Bezier }[] = [
  { label: 'Gentle', bezier: [0.42, 0, 0.58, 1] },
  { label: 'Snappy', bezier: [0.2, 0, 0, 1] },
  { label: 'Slow start', bezier: [0.7, 0, 0.9, 0.6] },
  { label: 'Overshoot', bezier: [0.3, 0, 0.3, 1.35] },
  { label: 'Anticipate', bezier: [0.5, -0.4, 0.6, 1] },
];

export function CurveEditor({ value, onChange }: { value: Bezier; onChange: (b: Bezier, key: string) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [x1, y1, x2, y2] = value;

  const drag = (which: 1 | 2) => (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = svg.current!.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * (SIZE + PAD * 2);
      const sy = ((ev.clientY - r.top) / r.height) * HEIGHT;
      const x = Math.min(1, Math.max(0, (sx - PAD) / SIZE));
      const y = Math.min(Y_MAX, Math.max(Y_MIN, Y_MAX - ((sy - PAD) / (SIZE * 1.4)) * (Y_MAX - Y_MIN)));
      const round = (v: number) => Math.round(v * 100) / 100;
      const next: Bezier = which === 1 ? [round(x), round(y), x2, y2] : [x1, y1, round(x), round(y)];
      onChange(next, 'curve');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const samples = Array.from({ length: 41 }, (_, i) => i / 40);
  const path = samples.map((u, i) => `${i ? 'L' : 'M'}${toX(u).toFixed(1)},${toY(cubicBezierEase(value, u)).toFixed(1)}`).join(' ');
  const field = (i: 0 | 1 | 2 | 3, label: string) => (
    <NumberField
      label={label}
      value={value[i]}
      digits={2}
      step={0.05}
      min={i % 2 === 0 ? 0 : Y_MIN}
      max={i % 2 === 0 ? 1 : Y_MAX}
      onCommit={(v) => {
        const next = value.slice() as Bezier;
        next[i] = v;
        onChange(next, `curve${i}`);
      }}
    />
  );

  return (
    <div className="curve-editor" data-testid="curve-editor">
      <svg ref={svg} viewBox={`0 0 ${SIZE + PAD * 2} ${HEIGHT}`} width={SIZE + PAD * 2} height={HEIGHT} role="img" aria-label="Easing curve">
        <rect x={toX(0)} y={toY(1)} width={SIZE} height={toY(0) - toY(1)} className="curve-box" />
        <text x={toX(0)} y={toY(0) + 16} className="curve-label">this pose</text>
        <text x={toX(1)} y={toY(1) - 8} className="curve-label" textAnchor="end">next pose</text>
        <line x1={toX(0)} y1={toY(0)} x2={toX(x1)} y2={toY(y1)} className="curve-arm" />
        <line x1={toX(1)} y1={toY(1)} x2={toX(x2)} y2={toY(y2)} className="curve-arm" />
        <path d={path} className="curve-line" />
        <circle cx={toX(x1)} cy={toY(y1)} r={7} className="curve-handle" onPointerDown={drag(1)} data-testid="curve-handle-1" />
        <circle cx={toX(x2)} cy={toY(y2)} r={7} className="curve-handle" onPointerDown={drag(2)} data-testid="curve-handle-2" />
      </svg>
      <div className="curve-fields">
        <span className="curve-field-label">Handle 1 (lower left): time, amount</span>
        {field(0, 'Curve handle 1 time')}
        {field(1, 'Curve handle 1 amount')}
        <span className="curve-field-label">Handle 2 (upper right): time, amount</span>
        {field(2, 'Curve handle 2 time')}
        {field(3, 'Curve handle 2 amount')}
      </div>
      <div className="curve-presets">
        {CURVE_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onChange(p.bezier, 'curvePreset')}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
