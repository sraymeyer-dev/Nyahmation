# Nyahmation — Design Document

> **Status:** v0.7. Requirements baseline for the MVP. Phase 0 is built and phase 1 (drawing) is in progress; see §16.
> **Last updated:** 2026-09-25

---

## 1. Vision

Nyahmation is a **desktop app for making character-animated videos**. You draw or import a character as vector parts and connect the parts at joints. Then you pose the character at the moments that matter, and Nyahmation fills in every frame between those poses. Dialogue is built in: mouth shapes come from a named library, and you assign them by sound, frame by frame, against the voice track. The output is video.

This is **purpose-built, not generic**. Every tool assumes you are animating characters for a video. General-purpose tools make you think in keyframes, properties and curves. Nyahmation asks you to think in **poses, joints and sounds**.

### 1.1 Design principles

1. **Pose, don't keyframe.** Any change you make on any frame is a pose. There is no key button and no record mode to switch on.
2. **Always in-between.** When anything has two poses, Nyahmation interpolates between them. The only exceptions are things that can't be blended, such as which mouth drawing is showing.
3. **Rig once, reuse forever.** Characters, mouth sets and shapes live in named libraries.
4. **Video is the product.** The preview matches the export exactly. Export renders every frame and never drops one.
5. **Personal and local.** One user, files on disk. No server, no account, no database, and it works offline.

### 1.2 Non-goals

- Web, cloud or SaaS versions, accounts, databases, collaboration.
- Non-video outputs such as GIF, Lottie or game sprite sheets.
- Frame-by-frame raster drawing.
- Bending or deforming parts (mesh deformation). Parts are rigid for now.
- Video editing: cutting shots together, titles, music mixing. A video editor such as DaVinci Resolve does that.
- Several shots in one project. Each project is one scene, and becomes one video.
- 3D, physics, particles.

---

## 2. Core workflows

**A. Build a character**
1. Draw parts with the pen and shape tools, or import SVG art.
2. Drag parts onto each other in the outliner to parent them (`Torso → UpperArm → Forearm → Hand`).
3. Place each **joint**, the point where a part attaches to its parent (shoulder, elbow, wrist).
4. Set joint limits, for example so an elbow can't bend backwards.
5. Add **switch layers** (mouth, eyes, hands) and assign drawing sets from the library.
6. Save the character to the library.

**B. Animate**
1. Create a project, which is one scene (resolution, frame rate). Place characters and a background. Import the dialogue audio.
2. Go to a frame and drag parts into a pose. Dragging a hand bends the elbow and swings the shoulder.
3. Go to another frame and pose again. Nyahmation in-betweens automatically.
4. Scrub and play. Retime by dragging pose marks, and adjust easing where the motion feels wrong.

**C. Lip sync**
1. Select the character's mouth. A lip-sync lane appears under the audio waveform.
2. Scrub through the dialogue. At the frame where each sound starts, press its key (or click its thumbnail).
3. That mouth shape holds until the next sound. Play back to check.

**D. Export**
1. Choose a preset (such as MP4 1080p 24 fps). Nyahmation renders every frame and writes a video file with the audio.

---

## 3. Core concepts

| Concept | What it is |
|---|---|
| **Project** | One file on disk holding **exactly one scene**: its characters, audio and images. One project becomes one exported video. |
| **Library** | A folder on disk of reusable, named items: shapes, drawing sets (such as mouth sets) and whole characters. |
| **Character** | A tree of parts connected at joints. A puppet. |
| **Part** | A node in the tree. It is a **group**, a **shape** or a **switch layer**. Each part has a transform and a joint. |
| **Shape** | One or more vector paths with fill and stroke. |
| **Joint** | Where a part attaches to its parent: a pivot point, optional rotation limits, and an optional "chain root" flag for IK. |
| **Switch layer** | A part that shows exactly one drawing at a time, chosen from a named drawing set. A mouth is a switch layer. |
| **Drawing set** | A named collection of drawings, such as a mouth set (one drawing per sound), an eye set or a hand set. |
| **Scene** | The stage inside a project: resolution, frame rate, duration, background, characters and audio. |
| **Pose** | The state of a part at a frame where the animator set it. |
| **In-between** | Any frame the animator didn't pose. Nyahmation computes it. |

> **Note on terminology.** Under the hood, a pose is stored as a keyframe, and the engine does standard keyframe interpolation. What is different is the workflow. The animator never creates, arms or manages keys; they just pose. The timeline still shows small **pose marks**, because retiming needs something to grab.

### 3.1 Sketch of the data shape

> The code in `src/engine/types.ts` is now the source of truth for the data model; this sketch shows the idea.
> - A part's `x`/`y` is **where its joint sits in the parent**, and rotation and scale happen around the joint.
> - Frames are whole numbers starting at 0 inside the app. The timeline displays them starting at 1.

```ts
type Part = {
  id: string;
  name: string;
  kind: "group" | "shape" | "switch";
  rest: Transform;               // position/rotation/scale in parent space
  joint: {
    pivot: Vec2;                 // where this part attaches to its parent
    minAngle?: number;           // rotation limits (degrees)
    maxAngle?: number;
    chainRoot?: boolean;         // IK stops here
  };
  opacity: number;
  children: Part[];
  paths?: VectorPath[];          // shapes
  drawingSet?: DrawingSetRef;    // switch layers
};

// One animated property of one part.
type Track = {
  partId: string;
  channel: "x" | "y" | "rotation" | "scaleX" | "scaleY" | "opacity"   // continuous
         | "drawing" | "visible" | "drawOrder" | "pin";                // discrete
  poses: Pose[];                 // sorted by frame
};

type Pose = {
  frame: number;                 // integer frame
  value: number | string | boolean;
  ease?: Ease;                   // optional override; default is "smooth"
};
```

---

## 4. Drawing tools

### 4.1 Must have
- **D1** Canvas with pan and zoom, a grid, and snapping.
- **D2** **Pen tool**: click to place corner points, drag to place curve points, click the first point to close.
- **D3** **Primitives**: rectangle, rounded rectangle, ellipse, polygon or star, line. They are created as ordinary paths, so you can edit their points right away.
- **D4** **Point editing**: select and move points; add a point anywhere on a segment; delete points; switch a point between corner and smooth; break or join a point's handles; drag a segment to bend it.
- **D5** Fill and stroke: solid color, stroke width, line caps and joins.
- **D6** Compound paths with holes, needed for things like an eye with a pupil cut-out, and for imported art.
- **D7** Select, move, rotate and scale with on-canvas handles.
- **D8** Outliner panel: rename, reorder, show or hide, lock, and parent parts by dragging.
- **D9** Undo and redo for everything.

### 4.2 Should have
- **D10** Linear and radial gradients.
- **D11** Boolean operations (union, subtract, intersect).
- **D12** Clipping masks (for example, pupils clipped to the eye).
- **D13** Color swatches per project, and an eyedropper.

---

## 5. Import

| # | Format | Priority | Notes |
|---|---|---|---|
| **I1** | SVG | Must | Paths, basic shapes, groups, transforms, fills and strokes. **The group structure is kept**, so art drawn in layers elsewhere arrives as a parts tree ready to rig. |
| **I2** | PNG (with transparency) / JPG | Must | For drawings in drawing sets (mouths, hands, eyes; see S5), backgrounds and tracing reference. |

**SVG is the only vector format.** Art from other apps (Illustrator, Affinity, Inkscape and so on) comes in by exporting SVG from that app. PDF, AI and EPS import are out of scope.

---

## 6. Rigging

### 6.1 Requirements
- **R1 Parenting (forward kinematics).** Children inherit their parent's transform. Move or rotate a parent and every child follows.
- **R2 Joints.** Each part rotates around its joint. You set the joint by dragging its marker on the canvas.
- **R3 Drag-to-pose (inverse kinematics).** Dragging a part pulls it toward the cursor by **rotating its ancestors at their joints**: the elbow bends and the shoulder swings to reach.
- **R4 Chain roots.** A joint can be marked as a chain root, and IK stops there. For example, shoulders and hips are chain roots, so dragging a hand never tilts the torso. The character's root part is never moved by IK.
- **R5 Joint limits.** Minimum and maximum angle per joint. IK respects them.
- **R6 Bend direction.** A two-part limb remembers which way it bends (knees forward, elbows back).
- **R7 Drag modes.** Plain drag poses with IK. Alt/Option-drag moves the part itself, offsetting it from its joint. The rotate handle (or `R`) rotates the part at its own joint only.
- **R8 Pins** (Must). Pin a part so it stays fixed in place, for example a foot planted on the ground. Dragging the body then bends the legs instead of dragging the feet along. Pins hold across frames, not just while dragging. See §6.3.
- **R9 Draw-order swaps** (Should). A part can move in front of or behind a sibling from one pose to the next, such as an arm swinging behind the body.
- **R10 Draw order is separate from the parent/child tree.** Each part has a stacking number within its character. The tree decides what moves with what; the stacking number decides what's in front. This is how a far arm can be a child of the torso (so it moves with it) and still be drawn behind it. The same approach is used by professional cutout tools such as Spine.

### 6.2 Proposed: IK is a posing tool, not a live constraint
When you drag, the IK solver works out the joint angles and **writes them into the pose as ordinary rotations**. The in-betweens then blend those angles, so limbs swing in natural arcs, the way real joints move.

The trade-off: between two poses a hand travels in an arc, not a straight line, and a planted foot can slide slightly. You fix that by adding a pose in between, or by pinning the foot (§6.3).

**Solver:** for two-part limbs (arms and legs), an exact geometric solution, which is stable and respects bend direction. For longer chains (tails, tentacles), an iterative solver (FABRIK or CCD). Both are deterministic: the same drag always gives the same pose.

### 6.3 Pins
A pin nails a part to a spot on the stage for a stretch of frames. Think of a foot planted on the floor during a step: the body moves over it, and the leg has to bend to keep the foot where it is.

- **P1** Select a part and press **Pin** (or `P`). It is pinned at its current position from this frame on.
- **P2** Press **Unpin** on a later frame to release it. A walk becomes: pin the left foot, move the body, unpin the left foot, swing it forward, pin it again.
- **P3** **While posing**, dragging anything keeps pinned parts in place by bending the joints between the pin and the chain root (for a foot: knee and hip).
- **P4** **During playback and export**, pins are enforced **on every in-between frame**, not only on posed frames. After the normal interpolation, Nyahmation re-solves the pinned chain so the pinned part stays exactly where it was pinned. This is what stops feet sliding.
- **P5** If a pin can't be reached (the body moved too far away), the limb straightens as far as it can, and the pin marker turns red on the canvas and the timeline.
- **P6** On the timeline, a pin shows as a bar under the part's row from pin to unpin. Dragging the bar's ends retimes the pin.

This refines §6.2: IK is a posing tool **except** for pinned chains, which are corrected on every frame while the pin is active. It is still deterministic.

---

## 7. Libraries

- **L1** The library is a **folder on disk** (default: `Documents/Nyahmation Library`). Each item is a file, so the library can be backed up or synced like any other folder.
- **L2** Item kinds: **Shape** (any drawing), **Drawing set** (mouths, eyes, hands, brows), **Character** (a full rig), **Background** (a set of background layers).
- **L3** Every item has a name, tags and a thumbnail. The library panel is searchable. Drag an item onto the canvas, or onto a switch layer.
- **L4** Subfolders for organizing, such as `Mouths/Round style` or `Hands/Cartoon`.
- **L5** Proposed: when you use a library item, the **project gets its own copy**. The project never breaks if the library changes later. An "update from library" command could come later.

---

## 8. Switch layers and lip sync

### 8.1 Switch layers
- **S1** A switch layer shows one drawing at a time from its drawing set. Parent it to the head and it moves with the head.
- **S2** Each drawing in a set keeps its own alignment to the layer's anchor, so swapping drawings doesn't make the part jump.
- **S3** Which drawing is showing is a **discrete** channel: it holds until the next change and is never blended. The layer's own position, rotation and scale still interpolate normally.
- **S4** Uses: mouths, eyes (open, half, closed), hands (fist, open, point), brows, and alternate head angles.
- **S5** A drawing in a set can be **vector** (drawn in Nyahmation or imported SVG) or a **PNG image** (with transparency). The two kinds can be mixed in one set.
- **S6** PNGs have a fixed number of pixels, so they look soft if they're shown bigger than their own size. For example, a mouth that is 200 pixels wide in the PNG but 400 pixels wide on screen in a 4K export will look blurry. Before exporting, Nyahmation **warns you about any PNG that will be enlarged beyond its own size**, and says which one. Vector drawings stay sharp at any size.

### 8.2 Mouth sets
A mouth set is a drawing set whose entries are named by sound. The proposed default is 9 shapes, following the classic cartoon set that the open-source Rhubarb Lip Sync tool also uses:

| Key | Mouth | Sounds |
|---|---|---|
| **A** | Closed | M, B, P |
| **B** | Slightly open, teeth together | K, S, T, EE and most consonants |
| **C** | Open | EH, AE |
| **D** | Wide open | AA (as in "father") |
| **E** | Slightly rounded | AO, ER |
| **F** | Puckered | OO, W |
| **G** | Upper teeth on lower lip | F, V |
| **H** | Tongue raised | L |
| **X** | Rest | Silence |

Custom sets are allowed, for example the 10-shape Preston Blair set.

### 8.3 The lip-sync lane
- **LS1** The timeline shows the audio **waveform**, and under it a lane for each switch layer (Mouth, Eyes and so on).
- **LS2** **Audio scrubbing**: stepping or dragging the playhead plays the sound under it, so you can hear each frame.
- **LS3** **Fast entry**: press a sound's key (A–H, X) or click its thumbnail. The mouth is set at the current frame and **holds until the next change**, so you mark where each sound starts, not every frame.
- **LS3a** **Auto-advance**: after each sound key, the playhead **moves forward one frame automatically** and plays that frame's audio, so you can keep your hands on the keys and listen as you go. Pressing the same key again just extends the shape. The step size can be changed (1 frame by default; 2 if you lip sync on twos). `Backspace` steps back one frame and undoes the entry there.
- **LS4** The lane shows labelled blocks with thumbnails. Drag block edges to retime them.
- **LS5** Select a phrase and nudge it earlier or later. Lip sync often reads better 1–2 frames ahead of the audio.
- **LS6** Proposed: **the lane stores sounds, not drawings.** The mouth set maps each sound to a drawing, so you can change a character's mouth art, or switch to a side-view mouth set, without redoing the lip sync.
- **LS7** (Could) **Automatic lip sync**: run Rhubarb Lip Sync (offline, open source) on the audio, optionally with the script, to fill the lane. Then fix it by hand.

---

## 8a. Scene layers and backgrounds

A scene is a **stack of layers**, like sheets of glass in a traditional animation camera stand: the sky at the back, then hills, then the room, then the characters, then foreground props that pass in front of them.

### 8a.1 Must have (phase 1)
- **BG1** A scene holds an ordered stack of **layers**. Each layer is either a **character** (a rig) or a **background** (scenery). Background layers can sit behind, between or in front of characters.
- **BG2** A background layer holds anything a character can: vector shapes, SVG imports and images, grouped and named. Its parts can be animated the same way, such as a swaying tree or a flickering sign.
- **BG3** Layers can be renamed, reordered, hidden and locked. A locked layer can't be selected on the canvas, so you don't bump the scenery while posing a character.

### 8a.2 Should have (phase 5)
- **BG4** **Parallax depth** per layer. When the camera (A11) pans or zooms, distant layers move less and foreground layers move more, which gives a sense of depth. Depth 0 is fixed to the camera (a sky), 1 moves with the world, and above 1 is foreground.
- **BG5** **Scrolling and tiling.** A layer can repeat horizontally and scroll at a set speed, for walk cycles on a "treadmill" and scenery passing a car window.
- **BG6** **Atmosphere.** Per-layer blur (depth of field) and haze (fading distant layers toward the sky color).
- **BG7** **Gradient skies** and fills (with D10 gradients).
- **BG8** **Background library items** (L2): save a set of background layers and reuse it in other projects.

## 8b. Effects: glow and shadow (phase 5)

- **FX1** Each part, group or layer can have an **effects stack**:
  - **Drop shadow**: color, opacity, offset (angle and distance), blur.
  - **Outer glow**: color, opacity, size, strength.
  - (Could) **Inner shadow** and **inner glow**.
- **FX2** **Effects on a group apply to the group as a whole.** A shadow on a character's root casts one shadow of the whole character. If each part cast its own shadow, the shadows would double up and look darker wherever parts overlap, such as the arm over the torso. Technically, the group is drawn to an off-screen image first and the effect is applied to that image.
- **FX3** Effect settings are **animatable** like any other value, such as a glow that pulses or a shadow that lengthens.
- **FX4** **Blend modes** per part or layer: Normal, Multiply (for shading), Screen and Add (for light and glows), Overlay.
- **FX5** (Could) A **contact shadow** preset: a soft ellipse on the ground that follows a character's feet.
- **FX6** **Performance.** Blur is the most expensive thing Nyahmation will draw, especially on the reference machine. Effects follow the preview quality setting (N9), and the results for parts that don't change (most scenery) are cached. The export always renders effects at full quality.

## 9. Animation

### 9.0 Build mode and Animate mode
Nyahmation has two modes:
- **Build**: draw shapes, edit points, arrange parts, and later set joints. Changes here edit the character itself (its rest pose and drawings), on every frame.
- **Animate**: pose the character on the timeline. Changes here are poses (A2).

Without this split, dragging a part would be ambiguous: does it mean "this arm is attached here" or "on this frame, move the arm"? Spine, a professional cutout animation tool, uses the same two modes (it calls them Setup and Animate). This is not a keyframe record mode: in Animate mode every change is still simply a pose.

### 9.1 Must have
- **A1** **Timeline**: frame ruler, playhead, one row per part (collapsible into a single character row), pose marks, audio waveform and lip-sync lanes.
- **A2** **Posing anywhere creates a pose.** Moving, rotating or switching anything on any frame records a pose for that part at that frame. There is no auto-key toggle and no key button.
- **A2a** **The first pose on a part also remembers where it started.** A part with only one pose holds that pose for the whole scene. So the first time you change a part on a frame after frame 0, Nyahmation also records the part's previous state on frame 0. Otherwise, raising the arm on frame 24 would make it raised from frame 0.
- **A3** **Editing an in-between** creates a new pose on that frame (a "breakdown"). The motion on either side adjusts around it.
- **A4** **Always interpolate** between a part's poses (see §10).
- **A5** **Hold.** Because Nyahmation always interpolates, staying still means having the same pose twice. A "Hold until frame N" command copies the pose forward for you.
- **A6** **Retiming**: drag pose marks. Select a range and stretch or squash its timing. Dragging a mark on the character row moves every part's pose on that frame together.
- **A7** **Playback** with audio: play and pause, loop a range, step one frame at a time. If the preview can't keep up, it skips displayed frames but keeps audio in sync.
- **A8** **Onion skinning**: faint copies of the previous and next poses or frames.
- **A9** **Easing** per pose: Smooth (default), Linear, Ease in, Ease out, Ease in-out, Hold.

### 9.1a Decided: poses belong to parts, not to the whole character
When you change something on a frame, which parts get a pose recorded on that frame? There are two options.

**Example.** On frame 1 you set up the character: arm down, head facing forward. On frame 24 you raise the arm, and nothing else. Later you go to frame 12 and turn the head to the left.

| | **Part poses** (proposed) | **Whole-character poses** |
|---|---|---|
| What frame 24 records | Only the arm (plus any joints IK moved to get it there, such as the shoulder). | Every part: arm raised, and also head forward, legs, everything. |
| What the head does | Turns left from frames 1 to 12, then stays turned. | Turns left from frames 1 to 12, then **turns back to forward by 24**, because frame 24 "remembers" the head facing forward. |
| Feels like | Each part keeps its own diary and writes an entry only when you touch it. | Taking a photo of the whole puppet every time you touch any part. |

**Why part poses (chosen):** you can give different parts different timing, such as the head turning first and the arm following a few frames later ("overlapping action"). Adding a pose to one part never quietly locks every other part in place. To move a whole moment at once, the **character row** on the timeline shows a mark wherever any part has a pose. Dragging that mark moves all the parts' poses on that frame together.

**Rule:** a pose is recorded for every part whose value changed because of your edit. When you drag a hand with IK, that means the hand, forearm and upper arm (and the legs, if pins made them bend).

### 9.1b Animating on ones, twos and threes
Hand-drawn animation often changes the picture only every 2nd frame ("on twos"): 12 new positions per second in a 24 fps video. It looks less smooth, but more hand-made and punchy. Nyahmation can do the same with its in-betweens.

- **ST1** Scene setting **Animate on: 1s / 2s / 3s** (default 1s).
- **ST2** **Per-character override**, so one character can be on twos while another is on ones.
- **ST3** **What steps:** a character's motion (position, rotation, scale, opacity, and pinned limbs).
- **ST4** **What doesn't step:** mouths and other switch layers stay on ones, so lip sync timing stays exact. The camera stays on ones by default, because a stepped camera move judders the whole picture. The audio never steps.
- **ST5** **Steps restart at every pose on any part of the character**, so every pose you set is shown exactly on the frame you set it, and the whole character changes picture on the same frames, as a hand-drawn drawing would. For example, on twos with poses on frames 1 and 8, the part shows new positions on frames 1, 3, 5, 7 and then exactly the pose on 8. Without this rule, an odd-numbered pose could be skipped.
- **ST6** (Should) A **View on ones** toggle for checking the motion while you work. It affects only the preview, never the export.
- **ST7** (Could) Change the stepping over time, such as ones during a fast action and twos elsewhere.

### 9.2 Should have
- **A10** Custom easing curve editor.
- **A11** **Camera**: pan, zoom and rotate the view, animated like any part.
- **A12** Multiple characters per scene (the layer stack, §8a).
- **A13** Copy and paste poses between frames and characters. Mirror a pose (swap left and right).

---

## 10. Interpolation engine

### 10.1 Two kinds of channel
- **Continuous** (x, y, rotation, scale, opacity, camera) are interpolated between poses.
- **Discrete** (switch-layer drawing, visibility, draw order) hold their value until the next pose.

### 10.2 Default easing: "Smooth"
- **Linear** makes sharp, robotic corners at every pose.
- **Ease in-out on every pose** makes the character stop dead at every pose.
- **Smooth** draws a curve through all of a part's poses. It eases in and out at the first and last poses and where a motion reverses, and flows through the poses in between. It never overshoots a posed value. Technically, it is a cubic Hermite spline with auto-clamped tangents, the same approach Blender uses by default.

```
evaluate(track, f):
  if no poses:            return restValue
  if f <= first.frame:    return first.value
  if f >= last.frame:     return last.value
  find p0, p1 with p0.frame <= f < p1.frame
  if channel is discrete: return p0.value
  u = (f - p0.frame) / (p1.frame - p0.frame)
  switch p0.ease:
    hold:    return p0.value
    linear:  return lerp(p0.value, p1.value, u)
    preset:  return lerp(p0.value, p1.value, cubicBezier(u))   // ease in/out/in-out/custom
    smooth:  return hermite(p0, p1, tangent(p0), tangent(p1), u)
```

`tangent(p)` is zero at the first and last poses and at turning points (where a value reverses direction). Everywhere else it is the slope between the neighbouring poses, clamped so the curve never overshoots.

### 10.3 Rotation
Angles are interpolated as plain numbers, so multi-turn spins (0° → 720°) work. Because IK writes joint angles (§6.2), limbs swing in arcs.

### 10.4 Scene evaluation
`evaluate(scene, frame) → resolvedScene`: evaluate every track (for a stepped character, at the start of the current step, §9.1b), then combine transforms from the root down (parent × child, around each joint), then **apply active pins** (re-solve each pinned chain so the pinned part stays put, §6.3), then sort by draw order. The renderer draws only the resolved scene. **Preview, scrubbing, onion skinning and export all call this same function.**

---

## 11. Export (video)

| # | Output | Priority | Use |
|---|---|---|---|
| **E1** | **MP4 (H.264) + AAC audio** | Must | Plays everywhere. YouTube, social media, sharing. |
| **E2** | **PNG sequence (with transparency) + WAV** | Must | Lossless fallback. Works with any editor. |
| **E3** | **MOV (ProRes 4444, with transparency)** | Should | For layering characters over footage in a video editor. |
| **E4** | WebM (VP9), H.265/HEVC | Could | |

- **E5** Resolution presets 720p, 1080p, 1440p and 4K; vertical 1080×1920; custom sizes. Frame rates 24 (default), 25, 30 and 60.
- **E6** Export renders **offline, frame by frame, at full quality**, so frames are never dropped however slow the computer is. The output is deterministic.
- **E7** Export the whole scene or a marked range, with a progress bar and a cancel button.
- **E8** The audio is combined into the video file (muxed) with correct sync.

---

## 12. Files and storage

- **F1** A project is **one scene in one `.nyah` file**: a zip bundle holding `project.json` plus the embedded audio and images. It is easy to move and back up. Characters move between projects through the library.
- **F2** The file format has a version number, and old files are migrated when opened.
- **F3** **Autosave** to a recovery file every minute or so, with an offer to restore after a crash.
- **F4** The library is a plain folder (§7).
- **F5** No server, no database, no account, no network needed.

---

## 13. Non-functional requirements

- **N1** Runs on **macOS (both Apple Silicon and older Intel Macs)** and **Windows 10/11** from one codebase. The Mac app is a universal build (it contains both Apple Silicon and Intel code), and FFmpeg is bundled for both.
- **N2** Real-time preview (24–60 fps) for a 1080p scene with about 2 characters of about 50 parts each, **measured on the reference machine (see N8)**. On slower machines, export only takes longer; it never loses quality.
- **N3** The preview looks exactly like the export: one renderer does both.
- **N4** Every edit can be undone. Autosave means no lost work.
- **N5** Deterministic: the same project always renders the same frames.
- **N6** The engine (model, interpolation, IK, evaluation) is pure code with no UI dependencies, and it is unit-tested.
- **N7** Keyboard-first: shortcuts for tools, frame stepping and lip-sync entry.
- **N8** **Reference machine:** 2020 MacBook Air (Intel, 1.2 GHz quad-core i7, integrated Intel Iris Plus graphics, macOS 15 Sequoia). This is the slowest machine Nyahmation targets. Performance goals are measured on it, and every phase is checked on it.
- **N9** **Preview quality setting** (Full / Half / Quarter resolution). If playback can't keep up on the reference machine, the preview can be drawn at lower resolution to stay smooth. Export always renders at full quality.
- **N10** Minimum OS: whatever the chosen Electron version supports (currently about macOS 12 and Windows 10). macOS 15 on the reference machine is well within that.

---

## 14. Technology recommendation

### 14.1 Recommendation: Electron + TypeScript

| Need | How this stack meets it |
|---|---|
| Mac + PC, one codebase | Electron builds `.dmg` (Mac) and `.exe` (Windows) installers from the same code. |
| Identical output on both machines | Electron **ships its own Chromium engine**, so drawing and anti-aliasing are the same on Mac and PC. |
| Vector drawing and Bézier rendering | Canvas 2D has native, fast, anti-aliased Bézier paths, and one code path serves preview and export. |
| SVG import | The embedded browser engine already parses SVG. We convert its tree into Nyahmation parts. |
| Complex editor UI (timeline, outliner, library) | Web UI tooling (React) is the most productive option for panel-heavy apps. |
| Audio scrubbing and waveform | The Web Audio API handles decoding, playback and precise timing. |
| Video export | A bundled **FFmpeg** takes the rendered frames and the audio and writes MP4/MOV/PNG. |
| Local files, no server | Electron's Node.js side reads and writes files directly. |

### 14.2 Stack
| Layer | Choice |
|---|---|
| App shell | Electron (built with electron-vite, packaged with electron-builder) |
| Language | TypeScript everywhere |
| UI panels | React |
| State and undo | Immutable project data; undo keeps a list of earlier snapshots, which share all unchanged data so they cost little memory (D-31) |
| Rendering | Canvas 2D with `Path2D`, plus a separate overlay canvas for handles, joints and onion skins |
| Geometry | Our own Bézier and IK code. Libraries (such as bezier-js or paper.js) are evaluated for the hard parts: boolean operations and path offsetting. |
| Video | FFmpeg binary bundled per platform, driven as a child process |
| Tests | Vitest (engine unit tests), Playwright (end-to-end tests; it can drive Electron) |

### 14.3 Alternatives considered
| Option | Why not (for now) |
|---|---|
| **Tauri** (web UI + Rust) | Much smaller app. But it uses the operating system's own web engine (Safari's WebKit on Mac, Edge's on Windows), so rendering can differ between machines. It also means a second language (Rust). A good fallback if app size ever matters. |
| **Qt** (C++ or Python/PySide) | Excellent vector engine (`QPainterPath`). But building UI is slower, and packaging Python apps is awkward. |
| **Godot** | Has 2D skeletons and IK. But it is a game engine: vector path editing and SVG are weak, and it isn't made for editor-style apps. |
| **Native** (Swift + C#) | Two separate codebases. |

### 14.4 Known costs
- An Electron app is large (about 150–250 MB) and uses a fair amount of memory. That's fine for a personal tool.
- **macOS Gatekeeper**: without an Apple Developer ID ($99/yr), the Mac shows a warning the first time the app is opened. Right-click → Open gets past it.
- **Intel Mac minimum macOS version**: Electron supports the same macOS versions as Chrome, currently about macOS 12 or newer. The reference Mac runs macOS 15 Sequoia, so this is fine. Sequoia is the last macOS version this model can install, but Chrome and Electron normally keep supporting a macOS version for several years after that.
- **Universal Mac build** is roughly twice the size, since it contains code for both kinds of processor.
- **FFmpeg licensing**: the H.264 encoder (x264) is GPL-licensed. That's fine for personal use; revisit if Nyahmation is ever distributed.

---

## 15. Architecture

```
┌──────────────── Renderer process (TypeScript UI) ────────────────┐
│  Panels (React): outliner · library · timeline · lip-sync lane   │
│  Canvas view: Canvas2D render + edit overlays                    │
│         │ commands                          ▲ state              │
│         ▼                                   │                    │
│  Document store ──────────────────────▶  Engine (pure, tested)   │
│  (project + undo)                        · evaluate(scene,frame) │
│                                          · interpolation         │
│                                          · IK solver             │
└───────────────┬──────────────────────────────────────────────────┘
                │ IPC: open/save, library, export frame buffers
┌───────────────▼────────── Main process (Node.js) ────────────────┐
│  File system: .nyah projects · library folder · autosave         │
│  FFmpeg child process: frames + audio → MP4 / MOV / PNG          │
└──────────────────────────────────────────────────────────────────┘
```

Source layout (follows electron-vite's conventions):
```
src/
  engine/          model, interpolation, stepping, evaluate (later: IK)   no UI imports, unit-tested
  io/              .nyah project files (later: SVG/PNG import, library)
  main/            Electron main process: windows, files (later: FFmpeg)
  preload/         the small, safe API the UI uses to reach the main process
  renderer/src/    the UI: React panels, Canvas2D renderer (later: editor tools)
e2e/               Playwright tests that launch the real app
```

---

## 16. Phased roadmap

Each phase ends with something usable. Video export arrives early so the full pipeline is proven from the start.

| Phase | Theme | Scope |
|---|---|---|
| **0** ✅ | Foundations | Electron skeleton; engine (data model, Smooth interpolation, stepping, parent/child evaluation) with unit tests; save/load `.nyah`; demo puppet test harness. |
| **1** | Draw | Build mode; canvas, pen tool, primitives, point editing, fill and stroke, layers (background and character) and outliner, undo; SVG and PNG import. |
| **2** | Rig | Parenting, joints, drag-to-pose IK with limits and chain roots; save characters to the library. |
| **3** | Move | Timeline, pose-anywhere (part poses), holds, retiming, playback, onion skin, **pins**, **on ones/twos/threes**; **silent MP4 export**. |
| **4** | Talk | Audio import, waveform and scrubbing; switch layers; mouth sets (vector and PNG); lip-sync lane with auto-advance; **MP4 with audio**. |
| **5** | Polish | Camera; parallax, scrolling and atmosphere for backgrounds (BG4–BG8); glow, shadow and blend modes (FX1–FX6); draw-order swaps; ProRes/PNG export; easing curve editor. |
| **6+** | Stretch | Automatic lip sync (Rhubarb), mirror poses, animation cycles, gradients and boolean operations. |

**MVP = Phases 0–4.** Success test: *make a 10-second clip of a character who takes a few steps without the feet sliding, waves, and speaks one line of dialogue, lip-synced, exported as MP4 with audio.*

---

## 17. Decisions log

| # | Decision | Status |
|---|---|---|
| D-1 | Desktop app for Mac and Windows; local files; no server or database | **Decided** |
| D-2 | Output is video only | **Decided** |
| D-3 | Rigid puppet parts; no mesh deformation for now | **Decided** |
| D-4 | Drawing tools in the app (pen, editable primitives) plus import | **Decided** |
| D-5 | No keyframe/frame distinction for the user; always interpolate between poses | **Decided** |
| D-6 | Mouths are switch layers, driven by a named library and per-frame sound assignment | **Decided** |
| D-7 | Electron + TypeScript | **Decided** |
| D-8 | IK is a posing tool that writes joint rotations; only pinned chains are corrected on every frame | Proposed |
| D-9 | Default interpolation is Smooth (auto-clamped Hermite) | Proposed |
| D-10 | Poses sit on integer frames | Proposed |
| D-11 | The lip-sync lane stores sounds, not drawings | Proposed |
| D-12 | Library items are copied into projects | Proposed |
| D-13 | Primitives become plain paths when created | Proposed |
| D-14 | Default mouth set is 9 shapes (A–H, X) | Proposed |
| D-15 | Pins are in the MVP and hold on every frame they're active | **Decided** |
| D-16 | Each project is exactly one scene | **Decided** |
| D-17 | Poses are recorded per part (only the parts that changed), not for the whole character | **Decided** |
| D-18 | SVG is the only vector import format; PNG/JPG for images | **Decided** |
| D-19 | Animating on ones/twos/threes, per scene with per-character override | **Decided** |
| D-20 | Mouths and the camera stay on ones even when a character is on twos; steps restart at every pose | **Decided** |
| D-21 | Lip-sync entry auto-advances the playhead (1 frame by default) | **Decided** |
| D-22 | Drawing sets can contain PNG images as well as vector drawings, with a warning for enlarged PNGs | **Decided** |
| D-23 | Support older Intel Macs (universal Mac build) as well as Apple Silicon and Windows | **Decided** |
| D-24 | 2020 Intel MacBook Air (macOS 15) is the reference machine for performance | **Decided** |
| D-25 | Draw order is a stacking number per character, separate from the parent/child tree (R10) | **Decided** |
| D-26 | Stepping restarts at any pose of any part of the character (ST5) | **Decided** |
| D-27 | A part's first pose after frame 0 also records its previous state on frame 0 (A2a) | **Decided** |
| D-28 | A scene is a stack of character and background layers (§8a) | **Decided** |
| D-29 | Glow and shadow effects on groups apply to the group as a whole (FX2) | Proposed |
| D-30 | Separate Build and Animate modes (§9.0) | Proposed |
| D-31 | Undo keeps snapshots of the (immutable) project, which share unchanged data, instead of Immer patches | Proposed |

---

## 18. Open questions

None right now. New questions will be added here as implementation raises them.

---

## 19. Glossary

- **Pose:** a part's state on a frame where you set it by hand.
- **In-between:** a frame Nyahmation computes between poses.
- **Breakdown:** a pose added between two others to shape the motion.
- **Hold:** a stretch of frames where a part keeps the same pose.
- **Easing / spacing:** how motion speeds up and slows down between poses.
- **Joint / pivot:** the point a part rotates around, where it attaches to its parent.
- **Forward kinematics (FK):** rotate a parent and its children follow.
- **Inverse kinematics (IK):** drag a child and the parents rotate to reach it.
- **Chain root:** the joint where IK stops (such as a shoulder).
- **Pin:** a part held in place while the rest of the rig moves.
- **Switch layer:** a part that shows one drawing at a time from a set.
- **Phoneme / mouth shape:** a speech sound, and the mouth drawing that shows it.
- **On twos:** changing the picture every 2nd frame (12 positions per second at 24 fps) for a hand-drawn feel.
- **Onion skinning:** faint copies of nearby frames, used to judge motion.
- **Muxing:** combining separate video and audio streams into one file.

---

## Revision history

- **v0.7 (2026-09-25):** Added scene layers and backgrounds (§8a), glow and shadow effects (§8b), and Build/Animate modes (§9.0). D-25 to D-27 confirmed.
- **v0.6 (2026-09-25):** Phase 0 built. Recorded decisions from implementation: joint-based positions, draw order separate from the tree (R10), character-wide step restarts (ST5), and the first-pose rule (A2a). Updated the source layout.
- **v0.5 (2026-09-25):** Reference machine set (2020 Intel MacBook Air, macOS 15). Added a preview quality setting (N9). Mouths and camera on ones confirmed. No open questions left.
- **v0.4 (2026-09-25):** Part poses decided. SVG-only vector import (PDF/AI/EPS dropped); PNG import now a Must. Added on ones/twos/threes (§9.1b), lip-sync auto-advance (LS3a), PNG drawings in sets with an enlargement warning (S5–S6), and Intel Mac support.
- **v0.3 (2026-09-25):** Electron confirmed. Pins moved into the MVP and specified (§6.3). One scene per project. Pose scope explained with an example (§9.1a).
- **v0.2 (2026-09-25):** Retargeted to a desktop, video-only character animation tool. Added rigging with FK/IK, libraries, switch layers and lip sync, the pose-based "no keyframes" workflow, Smooth interpolation, video export, the Electron + TypeScript recommendation, and a decisions log.
- **v0.1 (2026-09-24):** First sketch.
