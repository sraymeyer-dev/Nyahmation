import { useEffect, useState, type ReactNode } from 'react';

// Small form controls for the panels. Number fields commit on Enter or when
// they lose focus; arrow keys step by 1 (Shift: 10).

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="row">
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

const format = (v: number, digits: number) => String(Number(v.toFixed(digits)));

export function NumberField({
  value,
  onCommit,
  digits = 2,
  min,
  max,
  step = 1,
  suffix,
  label,
}: {
  value: number | null;
  onCommit: (v: number) => void;
  digits?: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  label?: string;
}) {
  const shown = value === null ? '' : format(value, digits);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(v)) setText(shown);
    else if (clamp(v) !== value) onCommit(clamp(v));
  };
  return (
    <span className="number-field">
      <input
        aria-label={label}
        value={text}
        placeholder={value === null ? 'mixed' : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          else if (e.key === 'Escape') {
            setText(shown);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onCommit(clamp((value ?? 0) + delta));
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

/** A color swatch plus an on/off switch (off = no fill or no stroke). */
export function PaintField({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label: string }) {
  const [last, setLast] = useState(value ?? '#000000');
  useEffect(() => {
    if (value) setLast(value);
  }, [value]);
  return (
    <span className="paint-field">
      <input type="checkbox" aria-label={`${label} on`} checked={value !== null} onChange={(e) => onChange(e.target.checked ? toHex(last) : null)} />
      <input type="color" aria-label={label} value={toHex(value ?? last)} disabled={value === null} onChange={(e) => onChange(e.target.value)} />
      <span className="paint-text">{value ?? 'None'}</span>
    </span>
  );
}

/** The color picker only understands #rrggbb; drop any transparency for display. */
export function toHex(css: string): string {
  if (/^#[0-9a-f]{6}$/i.test(css)) return css;
  if (/^#[0-9a-f]{3}$/i.test(css)) return '#' + [...css.slice(1)].map((c) => c + c).join('');
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(css);
  if (m) return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  return '#000000';
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
