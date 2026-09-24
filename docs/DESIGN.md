# Nyahmation — Design Document

> **Status:** Draft v0.1 — a first sketch of requirements, meant to be refined.
> **Last updated:** 2026-09-24

---

## 1. Vision

Nyahmation is a simple studio for **designing vector characters and animating them with keyframes**. You build a character out of vector parts (head, torso, arms…), set a few key poses on a timeline, and the app fills in the frames between them.

The guiding idea: **an animation is a function of time.** A project stores a handful of key values; the app computes every other frame from them. Most of the design below follows from keeping that function simple, predictable, and fast.

### 1.1 Goals

- Make it easy to build a character from vector shapes arranged in a parent/child hierarchy (a "puppet").
- Animate that character with keyframes and good interpolation (linear, hold, eased curves).
- Preview in real time, scrub the timeline, and export the result.
- Keep the tool **simple**: a small set of well-made features over a large set of half-made ones.

### 1.2 Non-goals (for now)

- Frame-by-frame raster drawing (Krita and Toon Boom already do this).
- 3D, physics, particle systems.
- Full skeletal mesh deformation (bones that bend a single continuous shape). Could come later.
- Multi-user collaboration in real time.
- Audio editing beyond maybe a single reference track (see Open Questions).

---

## 2. Target users and core workflows

**Primary user:** a hobbyist or indie creator who wants to make short character animations (loops, stickers, explainer bits, game sprites) without learning a professional suite.

### Workflow A — Design a character
1. Create a new project (canvas size, frame rate).
2. Draw or import vector parts.
3. Group parts into a hierarchy (e.g. `Body → UpperArm → Forearm → Hand`).
4. Set each part's **pivot point** (the shoulder for the upper arm, the elbow for the forearm).
5. Save the character so it can be reused.

### Workflow B — Animate a character
1. Place the character in a scene.
2. Move the playhead to a frame and pose the character — this creates keyframes.
3. Repeat for other frames.
4. Adjust timing and easing; scrub and play to check.
5. Export.

---

## 3. Core concepts (domain model)

| Concept | What it is |
|---|---|
| **Project** | Top-level file: settings, assets, characters, scenes. |
| **Character** | A reusable tree of nodes (a puppet). |
| **Node** | An item in the tree: a **Group** (container) or a **Shape** (drawable). Every node has a local transform and a pivot. |
| **Shape** | A vector path (or primitive: rect, ellipse, polygon) with fill and stroke. |
| **Transform** | Position, rotation, scale, skew, plus a pivot (anchor) point. Children inherit their parent's transform. |
| **Scene** | A stage with a size, a frame rate, a duration, and one or more character instances. |
| **Timeline** | The time axis of a scene, measured in frames. |
| **Track** | The animation of a single property on a single node (e.g. `LeftForearm.rotation`). |
| **Keyframe** | A `(time, value, easing)` entry on a track. |
| **Easing** | How the value travels from one keyframe to the next (see §5). |

### 3.1 Sketch of the data shape

```ts
type Project = {
  version: number;          // file format version, for migrations
  settings: { fps: number; width: number; height: number };
  characters: Character[];
  scenes: Scene[];
};

type Node = {
  id: string;
  name: string;
  kind: "group" | "shape";
  transform: Transform;     // rest pose
  pivot: Vec2;
  opacity: number;
  visible: boolean;
  zIndex: number;
  children?: Node[];        // groups only
  geometry?: PathData;      // shapes only
  style?: { fill: Paint; stroke: Paint; strokeWidth: number };
};

type Track<T> = {
  nodeId: string;
  property: string;         // "rotation", "position", "fill", ...
  keyframes: Keyframe<T>[]; // kept sorted by time
};

type Keyframe<T> = {
  frame: number;
  value: T;
  easing: Easing;           // governs the segment *leaving* this key
};
```

The **rest pose** lives on the node; tracks store the animated overrides. A property with no track just uses its rest value.

---

## 4. Functional requirements — Character design

### 4.1 Must have (MVP)
- **D1** Canvas with pan and zoom, plus optional grid and snapping.
- **D2** Primitive shapes: rectangle, ellipse, polygon, line.
- **D3** Pen tool for Bézier paths: add, move, and delete points; edit handles; close a path.
- **D4** Fill and stroke: solid color, stroke width, line cap and join.
- **D5** Select, move, rotate, and scale with on-canvas handles.
- **D6** Layers/outliner panel: rename, reorder (z-order), show/hide, lock.
- **D7** Grouping and nesting to build the part hierarchy.
- **D8** Editable pivot point per node, shown and dragged on the canvas.
- **D9** Import SVG (at least basic paths, groups, and fills).
- **D10** Undo/redo for every edit.

### 4.2 Should have
- **D11** Gradients (linear/radial).
- **D12** Boolean path operations (union, subtract).
- **D13** Clipping masks (e.g. pupils clipped to the eye).
- **D14** Character library: save a character and reuse it across scenes.
- **D15** Color palette/swatches per project.

### 4.3 Could have
- **D16** Swappable parts ("drawing substitution"): several mouth shapes for one slot, switched by keyframes. Very useful for lip sync and expressions.
- **D17** Simple bones/IK for limbs (drag the hand, and the arm follows).

---

## 5. Functional requirements — Animation

### 5.1 Must have (MVP)
- **A1** Timeline panel: frame ruler, playhead, a row per node, and diamonds for keyframes.
- **A2** Playback: play/pause, loop, step forward/back one frame, go to start/end.
- **A3** Scrubbing: drag the playhead and the canvas updates live.
- **A4** **Auto-key mode**: changing a property at the current frame creates or updates a keyframe.
- **A5** Manual keyframe insert/delete for selected nodes and properties.
- **A6** Select, move, copy, and paste keyframes (including across nodes).
- **A7** Animatable properties: position, rotation, scale, opacity, visibility.
- **A8** Interpolation modes per keyframe segment:
  - **Hold / step** — value jumps at the next key.
  - **Linear.**
  - **Eased** — presets (ease-in, ease-out, ease-in-out) defined as cubic Béziers.
- **A9** Configurable scene FPS (default 24) and duration.
- **A10** Onion skinning: ghost the previous and next N frames.

### 5.2 Should have
- **A11** Custom easing via a curve editor (edit the cubic Bézier handles directly).
- **A12** Graph editor: see a property's value over time as a curve.
- **A13** Animatable fill/stroke color and stroke width.
- **A14** Motion paths: show and edit a node's position trail on the canvas.
- **A15** Additional presets: back, elastic, bounce.

### 5.3 Could have
- **A16** Shape morphing (animate the path points themselves). See §6.4 for why this is hard.
- **A17** Animation clips/actions: reusable named cycles ("walk", "blink") that can be placed and looped.
- **A18** Reference audio track with waveform display, for timing.

---

## 6. Interpolation engine

This is the core of the app, so it's defined precisely.

### 6.1 Evaluating one track at time `t`

```
if no keyframes:              return restValue
if t <= first.frame:          return first.value
if t >= last.frame:           return last.value
find k0, k1 such that k0.frame <= t < k1.frame
u      = (t - k0.frame) / (k1.frame - k0.frame)   // 0..1 progress
eased  = k0.easing(u)                             // 0..1, reshaped by easing
return interpolate(k0.value, k1.value, eased)     // type-specific blend
```

The easing sets the *timing* (how fast `u` advances). `interpolate` sets *what to blend* (how two values mix). Keeping the two separate means any easing works with any value type.

### 6.2 Easing functions
- `hold(u) = 0` (then jumps to 1 at the next key)
- `linear(u) = u`
- `cubicBezier(x1, y1, x2, y2)(u)` — the same model as CSS `cubic-bezier()`, solved for `x = u` and returning `y`. Presets are named instances of this.
- Easings may overshoot (`y` outside 0..1) for back/elastic effects.

### 6.3 Value interpolation by type
| Type | Rule |
|---|---|
| Number (opacity, scale, stroke width) | `a + (b - a) * e` |
| Vec2 (position, scale x/y) | component-wise lerp |
| Rotation (degrees) | Plain lerp of the stored angle. This allows multi-turn spins (0° → 720°). "Shortest path" can be an option later. |
| Color | Lerp in a perceptual space (e.g. OKLab) so a blend doesn't pass through muddy grey; store as sRGB. |
| Boolean (visibility) / enum (swapped part) | Always step/hold. |
| Path (morphing) | Point-wise lerp — **only** when both paths have the same structure (see 6.4). |

### 6.4 Shape morphing is hard — here's why
Two keyframed paths blend point by point, so both need the **same number of points in a compatible order**. Freehand drawings almost never meet that. Options: (a) require compatible paths and warn otherwise, (b) resample both paths automatically, or (c) let the user map corresponding points. This is why morphing is a "Could have" and the MVP relies on **transform-based (cutout) animation**, which covers most character motion.

### 6.5 Scene evaluation
`evaluate(scene, t) → resolvedTree`: for every node, evaluate its tracks, then combine the transforms from the root down (parent × child, around each pivot). The renderer draws only the resolved tree. That makes playback, scrubbing, onion skinning, and export all the same operation: evaluate at time `t`, then draw.

---

## 7. Export and file format

### 7.1 Project file
- **Must:** a JSON-based project file (`.nyah`?) with a `version` field and migrations between versions.
- **Must:** autosave plus manual save/load.

### 7.2 Export targets
| Format | Priority | Notes |
|---|---|---|
| PNG image sequence | Must | Simplest, lossless, works with any video tool. |
| Animated GIF | Must | Handy for sharing; limited palette. |
| Static SVG (current frame) | Must | For using a character design elsewhere. |
| MP4/WebM video | Should | Via browser `MediaRecorder`/WebCodecs or ffmpeg. |
| Sprite sheet + JSON | Should | For game developers. |
| Lottie JSON | Could | Great for web/app use, but maps only partly onto our model. |
| Animated SVG (SMIL/CSS) | Could | |

---

## 8. Non-functional requirements

- **N1 Performance:** 60 fps playback preview for a character of about 100 nodes on a mid-range laptop.
- **N2 Responsiveness:** scrubbing updates the canvas within one frame.
- **N3 Reliability:** every edit is undoable. No data loss on crash (autosave).
- **N4 Determinism:** evaluating the same project at the same time always gives the same result (needed for export and tests).
- **N5 Testability:** the interpolation engine and the data model are pure logic with no UI dependencies, and are unit-tested.
- **N6 Accessibility:** keyboard shortcuts for all core actions; UI usable at 100–200% zoom.

---

## 9. Proposed architecture (sketch)

```
┌──────────────┐   commands    ┌──────────────────┐
│   UI layer   │ ────────────▶ │  Document store  │  (project data + undo stack)
│ canvas, time-│ ◀──────────── │                  │
│ line, panels │   state       └────────┬─────────┘
└──────┬───────┘                        │ project
       │ time t                         ▼
       │                       ┌──────────────────┐
       └─────────────────────▶ │    Evaluator     │  pure: (project, t) → resolved tree
                               └────────┬─────────┘
                                        ▼
                               ┌──────────────────┐
                               │     Renderer     │  draws resolved tree (SVG / Canvas)
                               └────────┬─────────┘
                                        ▼
                               ┌──────────────────┐
                               │    Exporters     │  loop t over frames → files
                               └──────────────────┘
```

- **Command pattern for edits:** every change is a command with `do`/`undo`. This gives undo/redo, and later maybe collaboration, almost for free.
- **Evaluator is pure:** no DOM, no side effects. It's the most-tested module.
- **Renderer is swappable:** start with SVG (easy hit-testing and export). Move to Canvas2D/WebGL only if N1 needs it.

### 9.1 Proposed tech stack (to confirm)
- **Platform:** web app (runs in a browser; can be wrapped with Tauri/Electron later for desktop).
- **Language:** TypeScript.
- **UI:** React (or Svelte) for panels; direct SVG for the canvas.
- **Build/test:** Vite + Vitest.
- **Storage:** local files via the File System Access API, IndexedDB for autosave.

---

## 10. Phased roadmap

| Phase | Theme | Scope |
|---|---|---|
| **0** | Foundations | Repo setup, data model, evaluator + interpolation engine with unit tests (no UI yet). |
| **1** | Static puppet | Canvas, primitives, select/transform, hierarchy + pivots, outliner, undo, save/load, SVG import. |
| **2** | Motion | Timeline, keyframes, auto-key, linear/hold/ease presets, playback, scrubbing, onion skin. |
| **3** | Ship it | PNG sequence, GIF, and SVG export. First end-to-end "make a waving character" demo. |
| **4** | Polish | Pen tool refinements, curve/graph editor, color animation, swappable parts, video export. |
| **5+** | Stretch | Bones/IK, shape morphing, animation clips, Lottie, audio. |

**MVP = Phases 0–3.** Success test: *a new user can import or build a simple character, make it wave for 2 seconds with eased motion, and export a GIF, in under 15 minutes.*

---

## 11. Open questions

1. **Platform:** Browser-first web app, or native desktop from day one? (The draft assumes web.)
2. **Draw vs. import:** How much drawing should Nyahmation do itself? A full pen tool is a big project. An alternative MVP: basic shapes plus strong SVG import, and let people draw in Inkscape/Illustrator/Figma.
3. **Deformation model:** Is cutout/puppet animation (rigid parts that rotate at pivots) enough, or are bending limbs (bones/mesh deform) essential early on?
4. **Time units:** Keyframes on integer frames only (simpler, classic animation), or sub-frame/seconds-based times (smoother retiming)?
5. **Primary output:** What will people most often do with the result — share as GIF/video, use in games (sprite sheets), or use on the web (Lottie/SVG)? This decides export priorities.
6. **Lip sync / expressions:** Should swappable parts (D16) move up to the MVP?
7. **Audio:** Is a reference audio track needed early for timing?
8. **Name of the file extension** and whether projects should be one file or a folder (for embedded assets).

---

## 12. Glossary

- **Keyframe:** a frame where you explicitly set a value.
- **Tween / in-between:** a frame computed between keyframes.
- **Interpolation:** the math that computes in-between values.
- **Easing:** the timing curve of an interpolation (e.g. start slow, end fast).
- **Pivot / anchor:** the point a part rotates and scales around.
- **Cutout animation:** animating a character made of separate rigid parts, like a paper puppet with pinned joints.
- **Onion skinning:** showing faint copies of nearby frames to judge motion.
- **Rest pose:** a character's default, un-animated arrangement.
