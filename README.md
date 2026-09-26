# Nyahmation

A desktop studio for making character-animated videos: draw or import a vector character, rig its parts at joints, pose it on the frames that matter, and Nyahmation fills in every frame between. Lip sync uses mouth shapes from a named library. The output is video.

The full requirements and decisions are in [docs/DESIGN.md](docs/DESIGN.md).

## Status

- **Phase 0 (foundations):** done. Animation engine and `.nyah` project files.
- **Phase 1 (drawing):** done. Build mode with drawing tools, point editing, layers, fill and stroke, undo, and SVG/PNG/JPEG import.
- **Phase 2 (rigging):** done. Joints, chain roots, joint limits, drag-to-pose (inverse kinematics), and a library of reusable characters and shapes.
- **Phase 3 (animating):** done. Posing on any frame, the timeline with retiming (ripple and copy), pins, onion skin, a loop range, and MP4 / PNG-sequence export.
- **Phase 4 (dialogue):** done. Sound import with waveforms and scrubbing, switch layers and mouth sets (vector or PNG), lip sync by typing letters, and MP4 export with the sound. **This completes the MVP.**
- **Phase 4.5 (hardening):** done. Autosave with crash recovery, a preview quality setting for slower computers, a speed check, and "View on ones".
- Next: phase 5a (camera, parallax backgrounds, gradients), then 5b (glow, shadow, blend modes) and 5c (draw-order swaps, easing editor, ProRes). See the roadmap in the design document.

## Running it on a Mac (step by step)

These steps work on both Intel Macs (like a 2020 MacBook Air) and Apple Silicon Macs. You only do steps 1–3 once.

**1. Install Node.js.** Go to [nodejs.org](https://nodejs.org), download the **LTS** version (22 or newer) as the **macOS Installer (.pkg)**, and run it. Then open **Terminal** (Applications → Utilities → Terminal) and check it worked:

```sh
node -v    # should print v22.something or higher
```

**2. Get the code.** The easiest way, with no Git needed: on GitHub, open the repository, pick the branch **`claude/busy-rubin-8k13jp`** from the branch menu, then **Code → Download ZIP**. Double-click the ZIP in Downloads to unpack it.

(If you use Git: `git clone -b claude/busy-rubin-8k13jp https://github.com/sraymeyer-dev/Nyahmation.git`. The first time you run `git`, macOS may offer to install the Command Line Tools; say yes.)

**3. Install the app's parts.** In Terminal, go into the folder. Type `cd ` (with a space), drag the unpacked folder from Finder onto the Terminal window, and press Return. Then:

```sh
npm install
```

This takes a few minutes the first time: it downloads Electron (about 100 MB), FFmpeg (for video export) and the other parts.

Newer versions of npm print warnings like `npm warn allow-scripts … not yet covered by allowScripts` and `npm warn deprecated …`. They are harmless: Nyahmation downloads Electron and FFmpeg itself and doesn't need those steps approved. If a download is interrupted, run `npm run setup` to finish it.

**4. Start Nyahmation.**

```sh
npm run dev
```

The app window opens. Leave Terminal open while you use it; closing Terminal (or pressing Ctrl+C in it) quits the app. Next time, just open Terminal, `cd` into the folder again, and run `npm run dev`.

Try **File → Open Demo Puppet**, then press **K** (Pose tool) and drag Pip's hand.

The first time you save to the library, macOS may ask whether Nyahmation can use your **Documents** folder. Allow it: the library lives in `Documents/Nyahmation Library`.

### Make it a normal app you click to open (recommended)

Do this once and nobody needs Terminal again: Nyahmation gets an icon in Applications and the Dock like any other app, for every account on the Mac.

**1. Build the app.** In Terminal, in the Nyahmation folder:

```sh
npm run dist:mac
```

It takes 5–10 minutes. When it's done, a Finder window opens showing `Nyahmation-0.0.1.dmg` (on an Apple Silicon Mac: `Nyahmation-0.0.1-arm64.dmg`).

**2. Install it.** Double-click the `.dmg`. In the window that appears, drag the **Nyahmation** cat icon onto the **Applications** folder. Then eject the disk image (the ⏏ button next to it in Finder's sidebar). You can now delete the `release` folder if you like.

**3. Open it.** Open **Applications** (or Launchpad) and double-click **Nyahmation**. To keep it handy, drag it from Applications onto the **Dock**, or right-click its Dock icon while it's open and choose **Options → Keep in Dock**.

If macOS says it can't check the app for malicious software (the app isn't signed with a paid Apple Developer ID), click **Done**, go to **System Settings → Privacy & Security**, scroll down to the message about Nyahmation, click **Open Anyway**, and confirm with your password. This is needed only once.

Once it's installed, double-clicking a saved project (a `.nyah` file) in Finder opens it in Nyahmation, and you can drop one onto the Dock icon too.

**For a child's own account:** apps in Applications are shared by every account on the Mac, so after you install it she'll find Nyahmation in her Applications and Launchpad too; add it to her Dock from her account. Her projects and her library (`Documents/Nyahmation Library`) are kept in her own account. The first time she saves to the library, macOS asks whether Nyahmation may use her **Documents** folder; click **Allow**.

**Updating the app later:** get the new code (below), run `npm run dist:mac` again, and drag the new version onto Applications, choosing **Replace**. Projects and the library aren't touched.

### Getting updates

Download the ZIP again (or `git pull` if you used Git), then run `npm install` and `npm run dev` as before, or `npm run dist:mac` to rebuild the clickable app. Your projects and library are separate files, so they're not affected.

## Running it on Windows or for development

You need [Node.js](https://nodejs.org) 22 LTS or newer.

```sh
npm install      # first time only
npm run dev      # opens the app with live reload
```

**File → Open Demo Puppet** loads a small waving character with a background layer.

## Using the editor

The app has two modes (top bar). **Build** is for drawing and arranging. **Animate** is for posing on the timeline, sound and lip sync.

| Tool | Key | What it does |
|---|---|---|
| Select | V | Click a part to select it; drag to move. Drag the square handles to scale (Shift keeps proportions, Alt scales from the centre) and the round handle to rotate (Shift snaps to 15°). Drag on empty canvas to select with a box. Double-click a shape to edit its points. |
| Points | A | Drag points, handles or curves. Double-click a curve to add a point; double-click a point to make it smooth or sharp. Alt-drag a handle to break a smooth point. Delete removes points. |
| Joints | J | Shows the skeleton. Drag a joint (the dot where a part attaches) to move it; the drawing stays put. Double-click a joint to make it a **chain root** (square): posing stops there. |
| Pose | K | Drag a part and its parents bend to follow (the elbow bends and the shoulder swings when you drag the hand). Shift-drag turns a part at its own joint; Alt-drag moves it away from its joint; Cmd/Ctrl-drag moves the whole character. Hover to see which joints will turn. In Build mode this sets the character's resting pose. |
| Pen | P | Click for corners, drag for curves. Click the first point to close the shape; Enter or double-click finishes an open line. Backspace removes the last point. |
| Rectangle, Ellipse, Polygon, Star, Line | M, L, Y, S, \ | Drag out a shape. Shift keeps it square (or the line at 45°); Alt draws from the centre. |
| Hand | H | Drag to pan. Space-drag or the middle mouse button pans with any tool. |

Other shortcuts (Cmd on Mac, Ctrl on Windows): Undo Cmd+Z, Redo Shift+Cmd+Z (Ctrl+Y on Windows), Duplicate Cmd+D, Group Cmd+G, Ungroup Shift+Cmd+G, Combine shapes Cmd+8, Bring forward / send backward Cmd+] / Cmd+[ (add Shift for front/back), Import Cmd+I, Zoom Cmd+= / Cmd+-, Fit Cmd+0, Actual size Cmd+1, Grid Cmd+', Snap Shift+Cmd+'. Arrow keys nudge (Shift: 10 px). Shift+Enter selects the parent of the selected part. Pinch or Cmd+scroll zooms; scroll pans.

**Animating (Animate mode):**
- Go to a frame (click the timeline, or ← / →), then pose with the **Pose** tool (K) or the **Select** tool (V). Every change is recorded as a pose on that frame; Nyahmation fills in the frames between poses. The first time you change a part, its starting position is kept on frame 1 automatically.
- **Timeline:** each ◆ is a pose. The **Scene** row covers everything, each **layer** row covers a character, and each part has its own row.
  - **Drag a ◆** to retime it. Pulling the pose on frame 10 to frame 5 makes that move twice as fast.
  - **Shift-drag** moves the ◆ and everything after it on that row, so the rest of the timing is kept.
  - **Option-drag** (Mac) or **Ctrl-drag** copies the pose to another frame: a hold.
  - Click a ◆ to select it (Shift-click for more). **Delete** removes it. Properties sets how the motion leaves it: Smooth, Ease in/out, Linear or Hold.
  - Mouth sounds only move from the mouth's own row, so lip sync stays matched to the dialogue.
- **Pin tool** (P): click a foot to pin it to the floor from this frame; click it again on a later frame to release it. The leg bends to keep the foot planted while the body moves.
- **Playback:** Space plays and pauses. Shift+← / → jumps between poses. **I** and **O** set a loop range. **Onion skin** shows nearby frames in red (before) and green (after).
- **Export** (Cmd+E, or the button on the timeline): MP4 video or a PNG image sequence (optionally see-through), at the scene size or 720p–4K, for the whole scene or the loop range. The sound goes into the MP4; a PNG export saves it next to the frames as `soundtrack.wav`. If a PNG drawing will be enlarged (and look soft), the Export window says which.

**Dialogue and lip sync:**
1. **Record or get the line** as a WAV, MP3, M4A, OGG or FLAC file. In Animate mode, go to the frame where it should start and **Import Art or Sound…** (Cmd+I). It appears on the **Sound** row with its waveform. Drag it to line it up; click it to set its volume or mute it. The scene gets longer if the sound needs it.
2. **Make the mouth** (Build mode). Draw each mouth shape, or import them, and **name each one after its shape**: `A` (M, B, P), `B` (K, S, T, EE), `C` (EH, AE), `D` (AA), `E` (AO, ER), `F` (OO, W), `G` (F, V), `H` (L) and `X` (rest). Names like `rest`, `MBP`, `FV` or `mouth_D` work too. A mouth can be several shapes grouped together (lips, teeth, tongue).
3. Select all the shapes and choose **Object → Make Switch Layer** (Shift+Cmd+M). They become one **Mouth** layer that shows one shape at a time. Put it inside the head in the Layers panel so it moves with the head, and use the Joints tool to place it. PNG mouths: select the Mouth, then **Add drawings from files…** in Properties; files named `A.png`, `D.png` and so on land on the right letter.
4. **Lip sync** (Animate mode): click the **Mouth** row on the timeline, go to where the line starts, and **type the letter** for each sound as you hear it. **Sound while scrubbing** plays each frame as you step. After each letter the playhead moves on one frame (or two, from the menu above the timeline), so you only type where the mouth changes; a shape holds until the next one. **Backspace** steps back and clears. You can also click the thumbnails.
5. Coloured blocks on the Mouth row show which shape is on. Drag a ◆ on that row to nudge a change; Shift-drag moves a whole phrase. Lip sync often reads better a frame or two before the sound.
6. Other switch layers (eyes, hands) work the same way with any names; press 1–9 or click a thumbnail to switch drawings.

While a switch layer is selected in Animate mode, the mouth letters take priority over tool shortcuts (so H sets the H mouth rather than picking the Hand tool). Press Escape to deselect it and get the tool keys back.

**Rigging a character:**
1. Put the character on a **character layer**. Build the parent/child tree in the Layers panel: drag the forearm onto the upper arm, the hand onto the forearm, and so on.
2. With the **Joints** tool, drag each part's joint to where it attaches: shoulder, elbow, wrist, hips, neck.
3. Select the layer and click **Mark branch joints as chain roots** (or double-click joints yourself). This stops a dragged hand from tilting the whole body.
4. Optionally, select a part and turn on **Limits** in its Joint settings (for example, so an elbow can't bend backwards).
5. Try it with the **Pose** tool.

**Autosave and recovery:** while you have unsaved changes, Nyahmation keeps a copy of your work, updated about once a minute. If the app or the computer crashes, the next time Nyahmation starts it offers the work back: click **Restore**, then **Save** to keep it. The copy is deleted when you save or choose to discard your changes, so it never replaces saving.

**If playback stutters:** choose **Preview → Half** (or Quarter) in the top bar. The canvas is drawn at lower resolution while you work; exported videos are always full quality. While playing, the timeline shows how many frames a second you're really seeing ("Showing 17 of 24 fps"; orange means frames are being skipped). **View → Measure Preview Speed** times the open scene at each quality and recommends one for this computer.

**View on ones:** for characters animated on twos or threes, tick **View on ones** on the timeline to see every in-between while you check the motion. It only changes the preview; the export still uses twos and threes.

**Library tab:** select a character layer (click its row in Layers) or some parts, then **Save to library…** and give it a name and tags. **Add** puts a fresh copy into the current project. Items are files in `Documents/Nyahmation Library`; **Folder** opens it in Finder, where you can make subfolders to organise them.

**Layers panel:** layers are listed front to back. Drag a row onto another to put it inside; drag onto its top or bottom edge to place it in front of or behind. Double-click a name to rename it. The eye hides; the lock stops a layer or part from being selected (and a locked layer can't be drawn on).

## Checks

```sh
npm run check     # type-check + unit tests
npm run test:e2e  # builds the app and drives it with Playwright (on Linux, run under xvfb-run)
```

## Building an installer

Run on the machine for that platform:

```sh
npm run dist:mac  # macOS .dmg for this Mac's chip (Intel or Apple Silicon), in release/
npm run dist:win  # Windows installer, in release/
```

See "Make it a normal app you click to open" above for opening an unsigned app on macOS Sequoia.
