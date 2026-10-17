import { locatePart, isLayerRoot } from '../../../engine/edit';
import type { Vec2 } from '../../../engine/types';
import type { ContextMenuItem } from '../../../preload/api';
import { arrange, deleteSelection, duplicate, group, resolvedScene, select, selectAll, selectParent, ungroup, importFile } from './actions';
import { mirrorSelected, openBlinks } from './animate';
import { clipboardContents, copy, cut, paste } from './clipboard';
import { hitTopPart } from './hitTest';
import { openLibrarySave } from './library';
import { makeSwitchLayerFromSelection } from './lipsync';
import { store } from './store';
import { GRAB_PX, pixel } from './tools/common';
import { togglePin } from './tools/pin';
import { activePin } from '../../../engine/pins';

// Right-click on the canvas: the part under the mouse is selected (unless
// it's already part of the selection), and the menu offers what makes
// sense for it in this mode. Everything here is also in the menu bar.

const sep = { separator: true } as const;

export async function canvasContextMenu(scene: Vec2): Promise<void> {
  const api = window.nyah;
  if (!api) return;
  const s = store.getState();
  const hit = hitTopPart(s.project, resolvedScene(s), scene, GRAB_PX * pixel());
  if (hit && !s.selection.includes(hit.id)) select([hit.id]);
  const selection = store.getState().selection;
  const parts = selection.map((id) => locatePart(s.project, id)).filter((l) => l?.parent);
  const single = parts.length === 1 ? parts[0]!.part : null;
  const hasParent = !!parts[0]?.parent && !isLayerRoot(s.project, parts[0]!.parent!.id);
  const clip = clipboardContents();
  const arrangeItems: ContextMenuItem[] = [
    { id: 'front', label: 'Bring to Front' },
    { id: 'forward', label: 'Bring Forward' },
    { id: 'backward', label: 'Send Backward' },
    { id: 'back', label: 'Send to Back' },
  ];

  let items: ContextMenuItem[];
  if (s.mode === 'animate') {
    const pinned = hit && activePin(s.project, hit.id, s.frame);
    items = selection.length
      ? [
          { id: 'copy', label: 'Copy Pose' },
          { id: 'paste', label: 'Paste Pose', enabled: clip.pose > 0 },
          sep,
          { id: 'mirror', label: 'Mirror Pose' },
          { id: 'swap', label: 'Swap Sides' },
          ...(selection.length === 1 && parts.length === 1 ? [{ id: 'blinks', label: 'Add Blinks…' }] : []),
          ...(hit ? [sep, { id: 'pin', label: pinned ? `Unpin from Frame ${s.frame + 1}` : `Pin Here from Frame ${s.frame + 1}` }] : []),
          sep,
          ...arrangeItems.map((i) => ({ ...i, label: `${(i as { label: string }).label} from Here` })),
          ...(hasParent ? [sep, { id: 'parent', label: 'Select Parent' }] : []),
        ]
      : [{ id: 'mirror', label: 'Mirror Pose' }, { id: 'swap', label: 'Swap Sides' }];
  } else {
    items = selection.length
      ? [
          { id: 'cut', label: 'Cut' },
          { id: 'copy', label: 'Copy' },
          { id: 'paste', label: 'Paste', enabled: clip.parts > 0 },
          { id: 'duplicate', label: 'Duplicate' },
          sep,
          { id: 'group', label: 'Group' },
          ...(parts.some((l) => l!.part.kind === 'group') ? [{ id: 'ungroup', label: 'Ungroup' }] : []),
          ...(parts.length >= 2 ? [{ id: 'switch', label: 'Make Switch Layer (Mouth, Eyes…)' }] : []),
          sep,
          ...arrangeItems,
          sep,
          ...(single?.kind === 'shape' ? [{ id: 'points', label: 'Edit Points' }] : []),
          ...(hasParent ? [{ id: 'parent', label: 'Select Parent' }] : []),
          { id: 'library', label: 'Save to Library…' },
          sep,
          { id: 'delete', label: 'Delete' },
        ]
      : [
          { id: 'paste', label: 'Paste', enabled: clip.parts > 0 },
          { id: 'all', label: 'Select All' },
          sep,
          { id: 'import', label: 'Import Art or Sound…' },
        ];
  }

  const chosen = await api.showContextMenu(items);
  switch (chosen) {
    case 'cut':
      return cut();
    case 'copy':
      return void copy();
    case 'paste':
      return paste();
    case 'duplicate':
      return duplicate();
    case 'group':
      return group();
    case 'ungroup':
      return ungroup();
    case 'switch':
      return makeSwitchLayerFromSelection();
    case 'front':
    case 'forward':
    case 'backward':
    case 'back':
      return arrange(chosen);
    case 'points':
      return store.set({ tool: 'points' });
    case 'parent':
      return selectParent();
    case 'library':
      return openLibrarySave();
    case 'delete':
      return deleteSelection();
    case 'all':
      return selectAll();
    case 'import':
      return void importFile();
    case 'mirror':
      return mirrorSelected('mirror');
    case 'swap':
      return mirrorSelected('swap');
    case 'blinks':
      return openBlinks();
    case 'pin':
      if (hit) togglePin(hit, scene);
      return;
  }
}
