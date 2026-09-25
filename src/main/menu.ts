import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../preload/api';

// The native menu. Items send a command to the focused window; the renderer
// decides what it means (e.g. Undo inside a text field undoes the typing).

function send(command: MenuCommand) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command);
}

const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
  label,
  accelerator,
  click: () => send(command),
});

export function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        item('New', 'new', 'CmdOrCtrl+N'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        item('Open Demo Puppet', 'openDemo'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'saveAs', 'Shift+CmdOrCtrl+S'),
        { type: 'separator' },
        item('Import SVG or Image…', 'import', 'CmdOrCtrl+I'),
        item('Export Video…', 'export', 'CmdOrCtrl+E'),
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        item('Duplicate', 'duplicate', 'CmdOrCtrl+D'),
        item('Select All', 'selectAll', 'CmdOrCtrl+A'),
        item('Deselect', 'deselect', 'Shift+CmdOrCtrl+A'),
      ],
    },
    {
      label: 'Object',
      submenu: [
        item('Group', 'group', 'CmdOrCtrl+G'),
        item('Ungroup', 'ungroup', 'Shift+CmdOrCtrl+G'),
        item('Combine Shapes', 'combine', 'CmdOrCtrl+8'),
        { type: 'separator' },
        item('Bring Forward', 'bringForward', 'CmdOrCtrl+]'),
        item('Send Backward', 'sendBackward', 'CmdOrCtrl+['),
        item('Bring to Front', 'bringToFront', 'Shift+CmdOrCtrl+]'),
        item('Send to Back', 'sendToBack', 'Shift+CmdOrCtrl+['),
        { type: 'separator' },
        item('New Character Layer', 'newCharacterLayer'),
        item('New Background Layer', 'newBackgroundLayer'),
        { type: 'separator' },
        item('Mark Branch Joints as Chain Roots', 'autoChainRoots'),
        item('Save Selection to Library…', 'saveToLibrary', 'Shift+CmdOrCtrl+L'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Zoom In', 'zoomIn', 'CmdOrCtrl+='),
        item('Zoom Out', 'zoomOut', 'CmdOrCtrl+-'),
        item('Fit Scene', 'zoomFit', 'CmdOrCtrl+0'),
        item('Actual Size', 'zoom100', 'CmdOrCtrl+1'),
        { type: 'separator' },
        item('Show Grid', 'toggleGrid', "CmdOrCtrl+'"),
        item('Snap to Grid', 'toggleSnap', "Shift+CmdOrCtrl+'"),
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
