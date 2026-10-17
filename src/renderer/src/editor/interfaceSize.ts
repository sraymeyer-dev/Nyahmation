import { store } from './store';

// View → Interface Size: everything in the window (text, buttons, panels)
// drawn bigger or smaller, for a small screen or eyes that like bigger text.
// A per-computer preference, like the preview quality; the scene itself is
// zoomed separately.

export const INTERFACE_SIZES = { smaller: 0.9, normal: 1, larger: 1.15, largest: 1.3 } as const;
export type InterfaceSize = keyof typeof INTERFACE_SIZES;

const KEY = 'nyah.interfaceSize';
const NAMES: Record<InterfaceSize, string> = { smaller: 'Smaller', normal: 'Normal', larger: 'Larger', largest: 'Largest' };

export function setInterfaceSize(size: InterfaceSize, announce = true): void {
  window.nyah?.setInterfaceSize(INTERFACE_SIZES[size]);
  try {
    localStorage.setItem(KEY, size);
  } catch {
    // Not remembered; it still applies now.
  }
  if (announce) store.set({ status: `Interface size: ${NAMES[size]}.` });
}

/** Applies the size chosen last time on this computer. */
export function restoreInterfaceSize(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    return;
  }
  if (saved && saved in INTERFACE_SIZES && saved !== 'normal') setInterfaceSize(saved as InterfaceSize, false);
}
