# Nyahmation

A desktop studio for making character-animated videos: draw or import a vector character, rig its parts at joints, pose it on the frames that matter, and Nyahmation fills in every frame between. Lip sync uses mouth shapes from a named library. The output is video.

The full requirements and decisions are in [docs/DESIGN.md](docs/DESIGN.md).

## Status

- **Phase 0 (foundations):** done. Animation engine and `.nyah` project files.
- **Phase 1 (drawing):** done. Build mode with drawing tools, point editing, layers, fill and stroke, undo, and SVG/PNG/JPEG import.
- Next: phase 2 (rigging: joints and drag-to-pose).

## Running it

You need [Node.js](https://nodejs.org) 22 LTS or newer.

```sh
npm install      # first time only
npm run dev      # opens the app with live reload
```

**File → Open Demo Puppet** loads a small waving character with a background layer.

## Using the editor

The app has two modes (top bar). **Build** is for drawing and arranging. **Animate** previews the animation; posing on the timeline arrives in phase 3.

| Tool | Key | What it does |
|---|---|---|
| Select | V | Click a part to select it; drag to move. Drag the square handles to scale (Shift keeps proportions, Alt scales from the centre) and the round handle to rotate (Shift snaps to 15°). Drag on empty canvas to select with a box. Double-click a shape to edit its points. |
| Points | A | Drag points, handles or curves. Double-click a curve to add a point; double-click a point to make it smooth or sharp. Alt-drag a handle to break a smooth point. Delete removes points. |
| Pen | P | Click for corners, drag for curves. Click the first point to close the shape; Enter or double-click finishes an open line. Backspace removes the last point. |
| Rectangle, Ellipse, Polygon, Star, Line | M, L, Y, S, \ | Drag out a shape. Shift keeps it square (or the line at 45°); Alt draws from the centre. |
| Hand | H | Drag to pan. Space-drag or the middle mouse button pans with any tool. |

Other shortcuts (Cmd on Mac, Ctrl on Windows): Undo Cmd+Z, Redo Shift+Cmd+Z (Ctrl+Y on Windows), Duplicate Cmd+D, Group Cmd+G, Ungroup Shift+Cmd+G, Combine shapes Cmd+8, Bring forward / send backward Cmd+] / Cmd+[ (add Shift for front/back), Import Cmd+I, Zoom Cmd+= / Cmd+-, Fit Cmd+0, Actual size Cmd+1, Grid Cmd+', Snap Shift+Cmd+'. Arrow keys nudge (Shift: 10 px). Shift+Enter selects the parent of the selected part. Pinch or Cmd+scroll zooms; scroll pans.

**Layers panel:** layers are listed front to back. Drag a row onto another to put it inside; drag onto its top or bottom edge to place it in front of or behind. Double-click a name to rename it. The eye hides; the lock stops a layer or part from being selected (and a locked layer can't be drawn on).

## Checks

```sh
npm run check     # type-check + unit tests
npm run test:e2e  # builds the app and drives it with Playwright (on Linux, run under xvfb-run)
```

## Building an installer

Run on the machine for that platform:

```sh
npm run dist:mac  # macOS universal .dmg (Intel + Apple Silicon), in release/
npm run dist:win  # Windows installer, in release/
```

The app isn't signed with an Apple Developer ID, so the first time you open it on a Mac, right-click it and choose **Open**.
