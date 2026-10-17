import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { MenuCommand } from '../preload/api';
import { clearRecentProjects, recentProjects } from './recent';

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

/** The illustrated user manual: bundled with the app, or in docs/ when running from the source. */
function manualPath(): string {
  const name = 'Nyahmation-User-Manual.pdf';
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'docs', 'manual', name);
}

export function openManual(): void {
  const path = manualPath();
  if (!existsSync(path)) {
    dialog.showErrorBox("Couldn't find the user manual", `It should be at ${path}.`);
    return;
  }
  void shell.openPath(path).then((error) => {
    if (error) dialog.showErrorBox("Couldn't open the user manual", error);
  });
}

/** File → Open Recent: each project by name (with its folder when two share a name), then Clear Menu. */
function recentMenu(openRecent: (path: string) => void): MenuItemConstructorOptions[] {
  const paths = recentProjects();
  if (!paths.length) return [{ label: 'No Recent Projects', enabled: false }];
  const names = paths.map((p) => basename(p));
  return [
    ...paths.map((path, i): MenuItemConstructorOptions => ({
      label: names.indexOf(names[i]!) !== names.lastIndexOf(names[i]!) ? `${names[i]} — ${basename(dirname(path))}` : names[i]!,
      click: () => openRecent(path),
    })),
    { type: 'separator' },
    { label: 'Clear Menu', click: clearRecentProjects },
  ];
}

/** Builds the menu bar; call again when the recent projects change. */
export function buildMenu(openRecent: (path: string) => void): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        item('New', 'new', 'CmdOrCtrl+N'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: recentMenu(openRecent) },
        item('Open Demo Puppet', 'openDemo'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'saveAs', 'Shift+CmdOrCtrl+S'),
        { type: 'separator' },
        item('Import Art or Sound…', 'import', 'CmdOrCtrl+I'),
        item('Record Dialogue…', 'recordDialogue', 'Shift+CmdOrCtrl+R'),
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
        item('Cut', 'cut', 'CmdOrCtrl+X'),
        item('Copy', 'copy', 'CmdOrCtrl+C'),
        item('Paste', 'paste', 'CmdOrCtrl+V'),
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
        {
          label: 'Shape Tools',
          submenu: [
            item('Union (merge into one)', 'boolUnion', 'Alt+CmdOrCtrl+U'),
            item('Subtract (cut front from back)', 'boolSubtract', 'Alt+CmdOrCtrl+S'),
            item('Intersect (keep the overlap)', 'boolIntersect', 'Alt+CmdOrCtrl+K'),
            item('Exclude (remove the overlap)', 'boolExclude', 'Alt+CmdOrCtrl+E'),
          ],
        },
        item('Make Switch Layer (Mouth, Eyes…)', 'makeSwitchLayer', 'Shift+CmdOrCtrl+M'),
        { type: 'separator' },
        item('Bring Forward', 'bringForward', 'CmdOrCtrl+]'),
        item('Send Backward', 'sendBackward', 'CmdOrCtrl+['),
        item('Bring to Front', 'bringToFront', 'Shift+CmdOrCtrl+]'),
        item('Send to Back', 'sendToBack', 'Shift+CmdOrCtrl+['),
        { type: 'separator' },
        item('New Character Layer', 'newCharacterLayer'),
        item('New Background Layer', 'newBackgroundLayer'),
        { type: 'separator' },
        item('Mirror Pose (flip left and right)', 'mirrorPose', 'Alt+CmdOrCtrl+M'),
        item('Swap Sides (for walks)', 'swapSides', 'Alt+Shift+CmdOrCtrl+M'),
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
        item('Measure Preview Speed', 'measurePreview'),
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Nyahmation User Manual', click: openManual },
        item('Keyboard Shortcuts', 'shortcuts', 'CmdOrCtrl+/'),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
