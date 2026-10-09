import type { ToolId } from '../editor/store';

// Simple line icons (24×24 grid, drawn with currentColor).

const P: Record<ToolId, string> = {
  select: 'M6 3 L6 19 L10 15 L13 21 L15.5 20 L12.5 14 L18 14 Z',
  points: 'M4 18 C 8 4, 16 4, 20 18 M2.5 16.5 h3 v3 h-3 Z M18.5 16.5 h3 v3 h-3 Z M10.5 5 h3 v3 h-3 Z',
  joint: 'M5 19 L11 11 L19 5 M11 11 m-2.5 0 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 M5 19 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0',
  pose: 'M12 5 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M12 7 V14 M12 14 L8 21 M12 14 L16 21 M12 9 L7 12 M12 9 L17 5',
  pin: 'M9 3 H15 L14 9 L17 12 H7 L10 9 Z M12 12 V21',
  camera: 'M3 8 H15 V17 H3 Z M15 11 L21 8 V17 L15 14 M6 5.5 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0',
  pen: 'M12 3 L17 12 L14 20 L10 20 L7 12 Z M12 3 L12 13 M10 20 L14 20',
  rect: 'M4 6 H20 V18 H4 Z',
  ellipse: 'M12 5 C 17 5, 21 8, 21 12 C 21 16, 17 19, 12 19 C 7 19, 3 16, 3 12 C 3 8, 7 5, 12 5 Z',
  polygon: 'M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z',
  star: 'M12 3 L14.5 9 L21 9.5 L16 13.5 L17.5 20 L12 16.5 L6.5 20 L8 13.5 L3 9.5 L9.5 9 Z',
  line: 'M5 19 L19 5',
  hand: 'M8 13 V6 a1.5 1.5 0 0 1 3 0 V11 V4.5 a1.5 1.5 0 0 1 3 0 V11 V6 a1.5 1.5 0 0 1 3 0 V14 C17 18, 15 21, 11.5 21 C 9 21, 7.5 19.5, 6 17 L4.5 14 a1.5 1.5 0 0 1 2.5 -1.5 Z',
};

export function ToolIcon({ tool }: { tool: ToolId }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={P[tool]} />
    </svg>
  );
}

export function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12 C 5 6, 19 6, 22 12 C 19 18, 5 18, 2 12 Z" />
      {open ? <circle cx="12" cy="12" r="3" /> : <path d="M4 20 L20 4" />}
    </svg>
  );
}

export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d={locked ? 'M8 11 V7 a4 4 0 0 1 8 0 V11' : 'M8 11 V7 a4 4 0 0 1 7.5 -2'} />
    </svg>
  );
}
