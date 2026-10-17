import { TOOL_INFO } from '../editor/tools';
import { store, useEditor } from '../editor/store';

// Help → Keyboard Shortcuts: every shortcut on one sheet, with the keys
// named as this computer names them.

const isMac = navigator.platform.toLowerCase().includes('mac');

/** A Cmd/Ctrl shortcut as this computer writes it: ⌥⇧⌘S on a Mac, Ctrl+Alt+Shift+S elsewhere. */
function cmd(key: string, { shift = false, alt = false } = {}): string {
  if (isMac) return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}⌘${key}`;
  return `Ctrl+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`;
}
const SHIFT = isMac ? '⇧' : 'Shift+';

type Entry = [keys: string, what: string];

const SECTIONS: { title: string; entries: Entry[] }[] = [
  {
    title: 'Files',
    entries: [
      [cmd('N'), 'New project'],
      [cmd('O'), 'Open'],
      [cmd('S'), 'Save'],
      [cmd('S', { shift: true }), 'Save as'],
      [cmd('I'), 'Import art or sound (or drag files onto the window)'],
      [cmd('R', { shift: true }), 'Record dialogue from the microphone'],
      [cmd('E'), 'Export video'],
    ],
  },
  {
    title: 'Editing',
    entries: [
      [cmd('Z'), 'Undo'],
      [isMac ? '⇧⌘Z' : 'Ctrl+Y', 'Redo'],
      [`${cmd('X')}  ${cmd('C')}  ${cmd('V')}`, 'Cut, copy, paste (in Animate mode: copy and paste a pose)'],
      [cmd('D'), 'Duplicate'],
      [cmd('A'), 'Select all'],
      ['Delete', 'Delete the selection (in Animate mode: the selected poses)'],
      ['Arrow keys', 'Nudge 1 px (Shift: 10 px), Build mode'],
      [`${SHIFT}Enter`, 'Select the parent part'],
      ['Escape', 'Deselect'],
    ],
  },
  {
    title: 'Arranging',
    entries: [
      [`${cmd('G')}  ${cmd('G', { shift: true })}`, 'Group, ungroup'],
      [`${cmd(']')}  ${cmd('[')}`, 'Bring forward, send backward (add Shift: to front, to back)'],
      [cmd('8'), 'Combine shapes'],
      [`${cmd('U', { alt: true })}  S  K  E`, 'Union, subtract, intersect, exclude'],
      [cmd('M', { shift: true }), 'Make a switch layer (mouth, eyes…)'],
      [cmd('M', { alt: true }), 'Mirror pose (add Shift: swap sides)'],
      [cmd('L', { shift: true }), 'Save selection to the library'],
    ],
  },
  {
    title: 'Animate mode',
    entries: [
      ['Space', 'Play and pause'],
      ['← →', 'Previous and next frame (add Shift: previous and next pose)'],
      ['Home  End', 'First and last frame'],
      ['I  O', 'Loop range in and out'],
      ['A–H, X', 'With a mouth selected: set the mouth shape, then move on'],
      ['1–9', 'With a switch layer selected: show that drawing'],
      ['Backspace', 'While lip syncing: step back and clear'],
    ],
  },
  {
    title: 'View',
    entries: [
      [`${cmd('=')}  ${cmd('-')}`, 'Zoom in and out (or pinch, or scroll with ' + (isMac ? '⌘' : 'Ctrl') + ')'],
      [cmd('0'), 'Fit the scene'],
      [cmd('1'), 'Actual size'],
      [`${cmd("'")}  ${cmd("'", { shift: true })}`, 'Grid, snap to grid'],
      ['Space-drag', 'Pan (Build mode; or the middle mouse button)'],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useEditor((s) => s.shortcutsOpen);
  if (!open) return null;
  const close = () => store.set({ shortcutsOpen: false });
  const tools = (mode: 'build' | 'animate') =>
    TOOL_INFO.filter((t) => t.modes.includes(mode))
      .map((t) => `${t.label} ${t.key}`)
      .join(' · ');
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal shortcuts" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2>Keyboard shortcuts</h2>
        <div className="shortcut-columns">
          <section>
            <h3>Tools</h3>
            <p className="hint">Build: {tools('build')}</p>
            <p className="hint">Animate: {tools('animate')}</p>
          </section>
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <table>
                <tbody>
                  {section.entries.map(([keys, what]) => (
                    <tr key={what}>
                      <td className="keys">{keys}</td>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="buttons">
          <button className="primary" autoFocus onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
