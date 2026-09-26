// The words of the user manual. `figure(name, caption)` inserts an annotated
// screenshot captured by capture.mjs. Keep this in step with the app: when a
// feature changes, change it here and run `npm run manual`.

const k = (...keys) => keys.map((key) => `<kbd>${key}</kbd>`).join('+');

const CHAPTERS = [
  ['welcome', 'Welcome', 'What Nyahmation does, and the big idea'],
  ['start', 'Getting started', 'Installing, opening, and the demo puppet'],
  ['workspace', 'The workspace', 'A tour of the window and the menus'],
  ['drawing', 'Drawing', 'Shapes, points, colours and importing art'],
  ['layers', 'Layers and parts', 'Characters, backgrounds and the part tree'],
  ['rigging', 'Rigging a character', 'Joints, chain roots, limits and posing'],
  ['library', 'The library', 'Reusing characters and shapes'],
  ['animating', 'Animating', 'Poses, the timeline and playback'],
  ['timing', 'Timing', 'Retiming, easing, on twos, onion skin and pins'],
  ['sound', 'Sound', 'Adding dialogue and music'],
  ['lipsync', 'Mouths and lip sync', 'Making a mouth and syncing it to speech'],
  ['export', 'Exporting video', 'MP4 and PNG sequences'],
  ['files', 'Saving and files', 'Projects, the library folder, and safety'],
  ['shortcuts', 'Keyboard shortcuts', 'Every key in one place'],
  ['help', 'Troubleshooting', 'When something goes wrong'],
  ['glossary', 'Glossary', 'Animation words used in this manual'],
];

const chapter = (id, body) => {
  const i = CHAPTERS.findIndex((c) => c[0] === id);
  const [, title, lede] = CHAPTERS[i];
  return `<section class="chapter" id="${id}"><p class="chapter-num">Chapter ${i + 1}</p><h1>${title}</h1><p class="lede">${lede}</p>${body}</section>`;
};

export function manualHtml({ figure, icon, version }) {
  return `
<section class="cover">
  <img src="${icon}" alt="">
  <h1>Nyahmation</h1>
  <div class="sub">User Manual</div>
  <div class="meta">Version ${version} · the first complete version (the MVP) · September 2026</div>
</section>

<section class="toc">
  <h1>Contents</h1>
  <ol>${CHAPTERS.map(([id, title, d], i) => `<li><span class="n">${i + 1}</span><a href="#${id}">${title}</a><span class="d">${d}</span></li>`).join('')}</ol>
  <div class="note" style="margin-top:18pt"><b>About the pictures.</b> The screenshots in this manual are of the real app. Numbered pink circles point at the parts of the screen that the list under each picture explains. Keyboard shortcuts are shown for a Mac: on Windows, use <kbd>Ctrl</kbd> wherever this manual says <kbd>⌘</kbd>, and <kbd>Alt</kbd> for <kbd>⌥ Option</kbd>.</div>
</section>

${chapter('welcome', `
<p>Nyahmation is a studio for making cartoons. You draw a character (or import one), connect its parts at joints like a paper puppet, pose it on the frames that matter, and Nyahmation fills in every frame in between. Add a voice, type the mouth shapes along with it, and export a video you can play anywhere.</p>

<h2>The big idea: poses, not drawings</h2>
<p>Think of a flip book. Drawing every page by hand is a lot of work. In Nyahmation you only set up the important pages, called <b>poses</b>: the arm down on frame 1, the arm up on frame 12. Nyahmation draws the 10 pages in between for you, smoothly. Want the move faster? Slide the second pose closer to the first. That's the whole trick, and the rest of this manual builds on it.</p>
<p>There is no difference between a "keyframe" and a normal frame: you can pose on any frame at any time, and only the parts you actually move get a pose. If you wave a hand on frame 20, the legs aren't affected.</p>

<h2>Three steps to a cartoon</h2>
<ol class="steps">
  <li><b>Build.</b> Draw your character as separate parts (head, body, arms, legs) and set up where each part bends. This is Build mode.</li>
  <li><b>Animate.</b> Switch to Animate mode, pick a frame, and pose. Add sound and lip sync.</li>
  <li><b>Export.</b> Save it as an MP4 video, with the sound.</li>
</ol>
<div class="tip"><b>Try it first.</b> Choose <span class="ui">File → Open Demo Puppet</span>. It opens Pip, a ready-made character who waves and talks. Poke around: you can't break anything, and <kbd>⌘</kbd>+<kbd>Z</kbd> undoes any change.</div>
<p>Have fun, and make something that makes someone laugh.</p>
`)}

${chapter('start', `
<h2>Opening Nyahmation</h2>
<p>Once Nyahmation is installed in <span class="ui">Applications</span>, open it like any other app: from Launchpad, the Dock, or by double-clicking it. Double-clicking a saved project (a <code>.nyah</code> file) opens it too.</p>

<h2>Installing it on a Mac (for grown-ups)</h2>
<p>Nyahmation isn't in the App Store; you make the app from its source code once. You need <b>Node.js</b> (the LTS version from nodejs.org) and a copy of the code (from GitHub: pick the branch, then <span class="ui">Code → Download ZIP</span>). Then, in Terminal, inside the Nyahmation folder:</p>
<pre>npm install
npm run dist:mac</pre>
<p>After 5–10 minutes a Finder window shows <code>Nyahmation-0.0.1.dmg</code>. Double-click it and drag Nyahmation onto <span class="ui">Applications</span>. That's it: from now on nobody needs Terminal.</p>
<div class="note"><b>If macOS blocks it</b> the first time ("can't check it for malicious software"), click <span class="ui">Done</span>, then open <span class="ui">System Settings → Privacy &amp; Security</span>, scroll down, and click <span class="ui">Open Anyway</span>. This happens because the app isn't signed with a paid Apple developer account; it's only needed once.</div>
<p>To try it without installing, run <code>npm run dev</code> in the same folder instead. The app opens and runs until you close Terminal.</p>

<h2>Several people on one Mac</h2>
<p>Apps in Applications are shared by every account on the Mac, so each person finds Nyahmation in their own Launchpad. Each person's projects and library stay in their own account. The first time someone saves to the library, macOS asks whether Nyahmation may use their <span class="ui">Documents</span> folder: click <span class="ui">Allow</span>.</p>

<h2>What you need</h2>
<ul>
  <li>A Mac with a recent version of macOS (Intel or Apple Silicon), or a Windows 10/11 PC. A 2020 MacBook Air is plenty.</li>
  <li>No internet connection, account or subscription. Everything stays on your computer.</li>
</ul>
`)}

${chapter('workspace', `
<p>Here is the whole window, with Pip the demo puppet open in Build mode and one part selected.</p>
${figure('workspace', 'The Nyahmation window in Build mode.')}

<h2>Two modes</h2>
<table class="wrap keep">
  <tr><th style="width:22%">Mode</th><th>What it's for</th></tr>
  <tr><td>Build</td><td>Drawing, arranging and rigging. Changes here are the character's <i>resting</i> look: how it looks when nothing is animated.</td></tr>
  <tr><td>Animate</td><td>Posing on the timeline, sound and lip sync. Every change you make is recorded as a pose on the current frame. The timeline appears at the bottom.</td></tr>
</table>

<h2>The menus</h2>
<p>On a Mac the menus are in the menu bar at the top of the screen.</p>
<div class="two-col">
<table class="keys">
  <tr><th colspan="2">File</th></tr>
  <tr><td>New</td><td>${k('⌘', 'N')}</td></tr>
  <tr><td>Open…</td><td>${k('⌘', 'O')}</td></tr>
  <tr><td>Open Demo Puppet</td><td></td></tr>
  <tr><td>Save</td><td>${k('⌘', 'S')}</td></tr>
  <tr><td>Save As…</td><td>${k('⇧', '⌘', 'S')}</td></tr>
  <tr><td>Import Art or Sound…</td><td>${k('⌘', 'I')}</td></tr>
  <tr><td>Export Video…</td><td>${k('⌘', 'E')}</td></tr>
  <tr><th colspan="2">Edit</th></tr>
  <tr><td>Undo</td><td>${k('⌘', 'Z')}</td></tr>
  <tr><td>Redo</td><td>${k('⇧', '⌘', 'Z')}</td></tr>
  <tr><td>Duplicate</td><td>${k('⌘', 'D')}</td></tr>
  <tr><td>Select All</td><td>${k('⌘', 'A')}</td></tr>
  <tr><td>Deselect</td><td>${k('⇧', '⌘', 'A')}</td></tr>
  <tr><th colspan="2">View</th></tr>
  <tr><td>Zoom In</td><td>${k('⌘', '=')}</td></tr>
  <tr><td>Zoom Out</td><td>${k('⌘', '−')}</td></tr>
  <tr><td>Fit Scene</td><td>${k('⌘', '0')}</td></tr>
  <tr><td>Actual Size</td><td>${k('⌘', '1')}</td></tr>
  <tr><td>Show Grid</td><td>${k('⌘', "'")}</td></tr>
  <tr><td>Snap to Grid</td><td>${k('⇧', '⌘', "'")}</td></tr>
</table>
<table class="keys">
  <tr><th colspan="2">Object</th></tr>
  <tr><td>Group</td><td>${k('⌘', 'G')}</td></tr>
  <tr><td>Ungroup</td><td>${k('⇧', '⌘', 'G')}</td></tr>
  <tr><td>Combine Shapes</td><td>${k('⌘', '8')}</td></tr>
  <tr><td>Make Switch Layer</td><td>${k('⇧', '⌘', 'M')}</td></tr>
  <tr><td>Bring Forward</td><td>${k('⌘', ']')}</td></tr>
  <tr><td>Send Backward</td><td>${k('⌘', '[')}</td></tr>
  <tr><td>Bring to Front</td><td>${k('⇧', '⌘', ']')}</td></tr>
  <tr><td>Send to Back</td><td>${k('⇧', '⌘', '[')}</td></tr>
  <tr><td>New Character Layer</td><td></td></tr>
  <tr><td>New Background Layer</td><td></td></tr>
  <tr><td>Mark Branch Joints as Chain Roots</td><td></td></tr>
  <tr><td>Save Selection to Library…</td><td>${k('⇧', '⌘', 'L')}</td></tr>
</table>
</div>

<h2>Moving around the canvas</h2>
<ul>
  <li><b>Pan:</b> scroll, or hold <kbd>Space</kbd> and drag, or use the Hand tool (<kbd>H</kbd>).</li>
  <li><b>Zoom:</b> pinch on the trackpad, or hold <kbd>⌘</kbd> and scroll. <span class="ui">Fit</span> shows the whole scene.</li>
  <li>The white rectangle is the <b>scene</b>: exactly what ends up in the video. You can draw outside it, but that won't be exported.</li>
</ul>
`)}

${chapter('drawing', `
<p>Everything in Nyahmation is drawn with <b>vector</b> shapes: outlines made of points and curves. They stay perfectly sharp at any size, and you can reshape them at any time.</p>
${figure('drawing', 'Three shapes drawn with the Ellipse, Star and Rectangle tools. The rectangle is selected.')}

<h2>The drawing tools</h2>
<table class="wrap">
  <tr><th style="width:24%">Tool</th><th style="width:8%">Key</th><th>How to use it</th></tr>
  <tr><td>Select</td><td><kbd>V</kbd></td><td>Click a part to select it, and drag to move it. Drag the square handles to resize (<kbd>⇧</kbd> keeps the proportions, <kbd>⌥</kbd> resizes from the centre) and the round handle to rotate (<kbd>⇧</kbd> snaps to 15°). Drag on an empty spot to select everything in a box. Double-click a shape to edit its points.</td></tr>
  <tr><td>Points</td><td><kbd>A</kbd></td><td>Reshape a shape by moving its points, their handles, or the curves between them.</td></tr>
  <tr><td>Pen</td><td><kbd>P</kbd></td><td>Click to place corner points; click and drag to make curves. Click the first point to close the shape. <kbd>Enter</kbd> or a double-click finishes an open line; <kbd>Backspace</kbd> removes the last point.</td></tr>
  <tr><td>Rectangle</td><td><kbd>M</kbd></td><td>Drag out a rectangle. Set rounded corners in the tool options.</td></tr>
  <tr><td>Ellipse</td><td><kbd>L</kbd></td><td>Drag out an oval. Hold <kbd>⇧</kbd> for a circle.</td></tr>
  <tr><td>Polygon</td><td><kbd>Y</kbd></td><td>Drag out a shape with equal sides. Choose how many sides in the tool options.</td></tr>
  <tr><td>Star</td><td><kbd>S</kbd></td><td>Drag out a star. Choose the number of points and how deep the dents are.</td></tr>
  <tr><td>Line</td><td><kbd>\\</kbd></td><td>Drag a straight line. <kbd>⇧</kbd> keeps it at 45° steps.</td></tr>
  <tr><td>Hand</td><td><kbd>H</kbd></td><td>Drag to move your view of the canvas.</td></tr>
</table>
<p>For all the shape tools, hold <kbd>⇧</kbd> to keep the shape even (a square, a circle) and <kbd>⌥</kbd> to draw from the centre out.</p>

<h2>Colours and outlines</h2>
<p>With a shape selected, the <span class="ui">Fill &amp; stroke</span> section in Properties sets its colours. Untick <span class="ui">Fill</span> or <span class="ui">Stroke</span> to leave it out. The settings you choose are also used for the next shapes you draw. <span class="ui">Holes</span> decides what happens where a shape overlaps itself (for example, the middle of a letter O).</p>

<h2>Editing points</h2>
${figure('points', 'Editing the star’s points with the Points tool.')}
<ul>
  <li>Drag a point, a curve, or a point's handles to reshape the shape.</li>
  <li>Double-click a curve to add a point; double-click a point to switch it between <b>smooth</b> (a round curve through it) and <b>sharp</b> (a corner).</li>
  <li>Hold <kbd>⌥</kbd> while dragging a handle to bend just one side of a smooth point.</li>
  <li><kbd>Delete</kbd> removes the selected points. <kbd>Esc</kbd> stops editing.</li>
</ul>

<h2>Arranging</h2>
<ul>
  <li><b>In front or behind:</b> <span class="ui">Object → Bring Forward / Send Backward</span> (${k('⌘', ']')} / ${k('⌘', '[')}).</li>
  <li><b>Group</b> (${k('⌘', 'G')}) keeps several parts together so they move as one. <b>Combine Shapes</b> (${k('⌘', '8')}) melts selected shapes into a single shape.</li>
  <li><b>Nudge</b> the selection with the arrow keys (add <kbd>⇧</kbd> for 10 pixels at a time).</li>
</ul>

<h2>Importing art</h2>
<p><span class="ui">File → Import Art or Sound…</span> (${k('⌘', 'I')}) brings in:</p>
<ul>
  <li><b>SVG files</b> from other drawing apps (Inkscape, Illustrator, Affinity, Figma…). Each layer or group in the file becomes a part, with its name, so a character drawn elsewhere arrives ready to rig. Things Nyahmation can't use, such as text, are listed in a message.</li>
  <li><b>PNG and JPEG pictures.</b> PNGs can have see-through backgrounds. Pictures have a fixed number of pixels, so they look soft if you blow them up; Nyahmation warns you when you export.</li>
  <li><b>Sounds</b>: see Chapter 10.</li>
</ul>
`)}

${chapter('layers', `
<p>A scene is a stack of <b>layers</b>. Each layer holds parts, and parts can hold other parts. The <span class="ui">Layers</span> panel shows all of it, front to back.</p>
${figure('layers', 'The Layers panel with the demo puppet.')}

<h2>Two kinds of layer</h2>
<table class="wrap">
  <tr><th style="width:26%">Layer</th><th>Use it for</th></tr>
  <tr><td>Character (C)</td><td>One character per layer. Its parts can be rigged and posed, and the whole character can be saved to the library.</td></tr>
  <tr><td>Background (B)</td><td>Scenery: sky, hills, a room. It sits behind the characters (drag it up the list to put it in front, for things like a table the character stands behind).</td></tr>
</table>

<h2>The part tree</h2>
<p>A part inside another part moves with it, like a hand attached to a forearm attached to an upper arm. This is what makes a puppet: move the upper arm and everything below it comes along.</p>
<ul>
  <li><b>Put a part inside another:</b> drag its row onto the other part's row.</li>
  <li><b>Reorder:</b> drag a row onto the top or bottom edge of another row.</li>
  <li><b>Rename:</b> double-click a name. Good names help: they appear on the timeline, and mouth shapes are recognised by their names.</li>
  <li><b>Hide</b> with the eye, <b>lock</b> with the padlock. A locked part can't be selected, and nothing can be drawn on a locked layer.</li>
  <li><b>Select the parent</b> of the selected part with ${k('⇧', 'Enter')}.</li>
</ul>
<div class="tip"><b>Tip.</b> Clicking on the canvas selects the exact part under the mouse (the hand, not the whole arm). Use the Layers panel, or ${k('⇧', 'Enter')}, to select something bigger.</div>

<h2>What's in front</h2>
<p>Inside a character, which part is drawn in front is separate from the part tree. That means a back arm can be inside the torso (so it moves with it) and still be drawn behind it. Use <span class="ui">Bring Forward</span> and <span class="ui">Send Backward</span> to change it.</p>
`)}

${chapter('rigging', `
<p><b>Rigging</b> means telling Nyahmation where each part bends: the shoulder, the elbow, the knee. It takes a few minutes and then posing is a matter of dragging.</p>
${figure('joints', 'The Joints tool shows the skeleton of the demo puppet.')}

<h2>Rigging a character, step by step</h2>
<ol class="steps">
  <li>Put the character on a <b>character layer</b>, drawn as separate parts: head, torso, upper arm, forearm, hand, and so on.</li>
  <li>In the Layers panel, build the tree: drag each hand onto its forearm, each forearm onto its upper arm, each upper arm onto the torso, and the head onto the torso.</li>
  <li>Choose the <b>Joints</b> tool (<kbd>J</kbd>) and drag each part's joint to where it attaches: the shoulder, elbow, wrist, neck, hips and knees. The drawing stays put; only the turning point moves.</li>
  <li>Select the character's layer and click <span class="ui">Mark branch joints as chain roots</span> in Properties (or use the Object menu). This stops a dragged hand from tipping the whole body over.</li>
  <li>Try it with the <b>Pose</b> tool.</li>
</ol>

<h2>Joint settings</h2>
<table class="wrap">
  <tr><th style="width:26%">Setting</th><th>What it does</th></tr>
  <tr><td>Joint X / Y</td><td>The exact position of the joint.</td></tr>
  <tr><td>Chain root</td><td>Posing stops at this joint. Double-clicking a joint with the Joints tool does the same; chain roots are drawn as squares.</td></tr>
  <tr><td>Limits</td><td>Stop a joint turning too far, so an elbow can't bend backwards. Set the smallest and largest angle.</td></tr>
  <tr><td>Bends</td><td>Which way a straight arm or leg bends first when you pull on it (clockwise, counter-clockwise, or either).</td></tr>
</table>

<h2>Posing with the Pose tool</h2>
${figure('pose', 'Dragging the hand upward: the elbow bends and the shoulder swings to follow.')}
<p>With the Pose tool (<kbd>K</kbd>), drag any part and the parts it's attached to bend to follow, the way a real arm does. This is called <b>inverse kinematics</b> (IK). Hover over a part first to see which joints will turn. In Build mode, posing sets the character's resting pose; in Animate mode, it records a pose on the current frame.</p>
<table class="wrap">
  <tr><th style="width:30%">Drag with…</th><th>What happens</th></tr>
  <tr><td>Nothing held</td><td>The parents bend to follow (the elbow and shoulder turn when you drag the hand).</td></tr>
  <tr><td><kbd>⇧</kbd> Shift</td><td>The part turns at its own joint only (just the hand turns at the wrist).</td></tr>
  <tr><td><kbd>⌥</kbd> Option</td><td>The part moves away from its joint.</td></tr>
  <tr><td><kbd>⌘</kbd> Command</td><td>The whole character moves.</td></tr>
</table>
`)}

${chapter('library', `
<p>The <b>library</b> is your collection of reusable characters, backgrounds and shapes, shared by all your projects. It's a folder of files in <code>Documents/Nyahmation Library</code>.</p>
${figure('library', 'The Library tab, with the demo puppet saved.')}
<h2>Saving to the library</h2>
<ol class="steps">
  <li>Select a character's layer (click its row in the Layers panel), or some parts.</li>
  <li>Open the <span class="ui">Library</span> tab and click <span class="ui">Save to library…</span>.</li>
  <li>Give it a name and some tags (words to find it by, separated by commas), and click <span class="ui">Save</span>. A picture is made automatically.</li>
</ol>
<h2>Using a library item</h2>
<p>Click <span class="ui">Add</span>. The project gets its own copy, so you can change it freely without changing the library, and you can add the same item as many times as you like (a crowd of Pips!). Shapes land where they were when you saved them.</p>
<div class="tip"><b>Organising.</b> Click <span class="ui">Folder</span> to open the library in Finder. Make subfolders there, such as <code>Mouths</code> or <code>Characters/Animals</code>, and move items into them; the Library tab shows the folders. Click ↻ after making changes in Finder.</div>
`)}

${chapter('animating', `
<p>Switch to <b>Animate</b> mode with the button at the top. The timeline appears at the bottom of the window.</p>
${figure('animate', 'Animate mode: the timeline at the bottom, with a row for every part.')}

<h2>Making your first animation</h2>
<ol class="steps">
  <li>Open the demo puppet, or your own rigged character, and switch to <b>Animate</b>.</li>
  <li>Click frame 12 on the timeline's number row (or press <kbd>→</kbd> eleven times).</li>
  <li>Choose the <b>Pose</b> tool (<kbd>K</kbd>) and drag the hand up. A ◆ appears on the rows of the parts that moved, on frame 12.</li>
  <li>The first time a part moves, its starting position is also kept on frame 1 automatically, so the arm moves from where it was.</li>
  <li>Press <kbd>Space</kbd> to play. The arm rises smoothly from frame 1 to frame 12.</li>
  <li>Go to frame 24 and pose the hand down again. Now it waves up and down.</li>
</ol>

<h2>How poses work</h2>
<ul>
  <li>Only the parts you change get a pose. The rest keep doing whatever they were doing.</li>
  <li>Between two poses, the motion is <b>smooth</b>: it speeds up and slows down naturally and flows through poses instead of stopping at each one.</li>
  <li>You can also pose by typing numbers in Properties (position, rotation, scale, opacity), or with the Select tool. Any change on a frame becomes a pose.</li>
</ul>

<h2>The timeline rows</h2>
<table class="wrap">
  <tr><th style="width:22%">Row</th><th>What its ◆ marks are</th></tr>
  <tr><td>Scene</td><td>Every frame that has a pose on it anywhere. Dragging a mark here retimes everything on that frame.</td></tr>
  <tr><td>Layer (Pip)</td><td>Every pose of one character. Click the triangle to show or hide its parts.</td></tr>
  <tr><td>Part rows</td><td>Just that part's poses.</td></tr>
  <tr><td>Sound</td><td>Your sound clips, with their waveforms (Chapter 10).</td></tr>
</table>

<h2>Playing it back</h2>
<ul>
  <li><kbd>Space</kbd> plays and pauses. <kbd>←</kbd> <kbd>→</kbd> step one frame; ${k('⇧', '←')} ${k('⇧', '→')} jump to the previous or next pose. <kbd>Home</kbd> and <kbd>End</kbd> go to the start and end (on a MacBook keyboard: ${k('Fn', '←')} and ${k('Fn', '→')}).</li>
  <li><b>Loop range:</b> press <kbd>I</kbd> on the first frame and <kbd>O</kbd> on the last. Playback repeats just that part, which is handy while you polish one move.</li>
  <li>Drag the top edge of the timeline to make it taller, and use <span class="ui">−</span> / <span class="ui">+</span> to zoom it.</li>
</ul>

<h2>Scene settings</h2>
<p>With nothing selected (press <kbd>Esc</kbd>), Properties shows the scene: its size in pixels (1920 × 1080 is standard HD video), the <b>frame rate</b> (24, 25, 30 or 60 frames a second; 24 is the classic cartoon rate), the length in frames, and the background colour.</p>
`)}

${chapter('timing', `
<h2>Retiming: making moves faster or slower</h2>
${figure('retime', 'A selected pose, and the easing choices for it in Properties.')}
<p>Timing is what makes animation feel alive, and in Nyahmation it's just dragging:</p>
<ul>
  <li><b>Drag a ◆</b> to another frame. A pose on frame 10 dragged to frame 5 makes that move twice as fast.</li>
  <li><b>${k('⇧')}-drag</b> moves the pose <i>and everything after it</i> on that row, so the timing of the rest of the scene is kept.</li>
  <li><b>${k('⌥')}-drag</b> (or ${k('Ctrl')}-drag) <b>copies</b> the pose to another frame. Two copies of the same pose make a <b>hold</b>: the character stays still between them.</li>
  <li>Click a ◆ to select it (${k('⇧')}-click for more), then press <kbd>Delete</kbd> to remove it.</li>
  <li>Which row you drag on decides what moves: the Scene row moves every part's pose on that frame, a layer row moves one character's, and a part row moves just that part's.</li>
</ul>
<div class="note"><b>Lip sync stays put.</b> Dragging on the Scene or a layer row never moves the mouth shapes, because the voice they match doesn't move. To shift the mouth, drag on the Mouth's own row.</div>

<h2>Easing: how a move starts and stops</h2>
<p>Select a pose and choose <span class="ui">Motion out</span> in Properties. It decides how the move from this pose to the next one travels:</p>
<table class="wrap">
  <tr><th style="width:26%">Choice</th><th>Looks like</th></tr>
  <tr><td>Smooth</td><td>The default. Flows naturally through the poses.</td></tr>
  <tr><td>Ease in and out</td><td>Starts slowly, speeds up, and settles gently. Good for a move that starts and stops.</td></tr>
  <tr><td>Ease in</td><td>Starts slowly, ends fast. Good for a fall or a throw.</td></tr>
  <tr><td>Ease out</td><td>Starts fast, ends slowly. Good for landing or coming to rest.</td></tr>
  <tr><td>Linear</td><td>The same speed all the way. Mechanical things.</td></tr>
  <tr><td>Hold</td><td>Doesn't move at all, then jumps to the next pose. Snappy, cartoony changes.</td></tr>
</table>

<h2>On ones, twos and threes</h2>
<p>Classic hand-drawn cartoons often show each drawing for two frames ("on twos"), which gives a lively, drawn feel. Set <span class="ui">Animate on</span> in the scene's Properties to Ones, Twos or Threes, or change it for just one character in its layer's Properties. Mouths always stay on ones, so lip sync stays accurate.</p>

<h2>Onion skin</h2>
${figure('onion', 'Onion skin shows faint copies of the frames before and after this one.')}
<p>Tick <span class="ui">Onion skin</span> on the timeline to see faint copies of nearby frames: red for earlier, green for later. It shows the path a movement takes, so you can check that an arm swings in a nice arc.</p>

<h2>Pins: feet that stay on the floor</h2>
${figure('pins', 'The left foot pinned from frame 6.')}
<p>When a character walks or crouches, its feet should stay planted instead of sliding. That's what <b>pins</b> are for.</p>
<ol class="steps">
  <li>Go to the frame where the foot touches the ground.</li>
  <li>Choose the <b>Pin</b> tool (<kbd>P</kbd>) and click the foot. It's pinned from this frame on.</li>
  <li>Move the body in later frames: the foot stays exactly where it is, and the leg bends to reach it.</li>
  <li>On the frame where the foot should lift, click it again with the Pin tool to release it.</li>
</ol>
<p>The yellow bar on the part's row shows the frames where it's pinned.</p>
`)}

${chapter('sound', `
<p>Add a voice recording, sound effects or music. Nyahmation plays it in time with the picture and puts it in the exported video.</p>
${figure('sound', 'A voice recording on the Sound row, selected, with its properties.')}

<h2>Adding a sound</h2>
<ol class="steps">
  <li>In Animate mode, go to the frame where the sound should start.</li>
  <li>Choose <span class="ui">File → Import Art or Sound…</span> (${k('⌘', 'I')}) and pick a sound file: WAV, MP3, M4A, AAC, OGG or FLAC.</li>
  <li>It appears on the <b>Sound</b> row with its waveform (the wiggly shape of the sound: tall where it's loud, flat where it's quiet). If the sound is longer than the scene, the scene gets longer to fit it.</li>
</ol>

<h2>Working with sounds</h2>
<ul>
  <li><b>Move</b> a sound by dragging it along the Sound row.</li>
  <li><b>Click</b> it to see its properties: name, start frame, volume (up to 200%) and mute. Press <kbd>Delete</kbd> to remove it.</li>
  <li><b>Sound while scrubbing</b> (a checkbox on the timeline, on by default) plays a tiny slice of sound for each frame as you step with the arrow keys or drag along the number row. This is how you find exactly where each word starts.</li>
  <li>During playback the picture follows the sound, so they never drift apart, even on a slow computer.</li>
</ul>
<div class="tip"><b>Recording tip.</b> Record dialogue with your phone's voice memo app or QuickTime Player (<span class="ui">File → New Audio Recording</span>), in a quiet room, and save or share it to the Mac. Speak a little more clearly and slowly than normal; it makes lip sync easier.</div>
`)}

${chapter('lipsync', `
<p>A talking character swaps between a handful of mouth drawings, one for each group of sounds. In Nyahmation the mouth is a <b>switch layer</b>: a part that shows one drawing at a time. You type the letter of each mouth shape as you hear the dialogue.</p>

<h2>The nine mouth shapes</h2>
<p>These are the classic cartoon mouth shapes. Draw one of each for your character (you can start with just A, C, D and X and add the rest later).</p>
<div class="mouths">
  <div><b style="background:#e5484d">A</b><span>Closed</span><small>M, B, P ("<span class="hl">m</span>um", "<span class="hl">b</span>ig")</small></div>
  <div><b style="background:#f5a524">B</b><span>Slightly open, teeth together</span><small>K, S, T, EE and most consonants</small></div>
  <div><b style="background:#e8d44d">C</b><span>Open</span><small>EH, AE ("b<span class="hl">e</span>d", "c<span class="hl">a</span>t")</small></div>
  <div><b style="background:#46c37b">D</b><span>Wide open</span><small>AA ("f<span class="hl">a</span>ther")</small></div>
  <div><b style="background:#3fb7c9">E</b><span>Slightly rounded</span><small>AO, ER ("b<span class="hl">ir</span>d", "<span class="hl">o</span>ff")</small></div>
  <div><b style="background:#4f8cff">F</b><span>Puckered</span><small>OO, W ("t<span class="hl">oo</span>", "<span class="hl">w</span>e")</small></div>
  <div><b style="background:#9b6cf0">G</b><span>Teeth on lower lip</span><small>F, V ("<span class="hl">f</span>un", "<span class="hl">v</span>an")</small></div>
  <div><b style="background:#e36bc4">H</b><span>Tongue raised</span><small>L ("<span class="hl">l</span>ook")</small></div>
  <div><b style="background:#8a8f99">X</b><span>Rest</span><small>Silence, between words</small></div>
</div>

<h2>Making a mouth</h2>
<ol class="steps">
  <li>In Build mode, draw each mouth shape. A mouth can be several shapes (lips, teeth, tongue); group each mouth's pieces with ${k('⌘', 'G')}.</li>
  <li><b>Name each one after its letter</b> (double-click the name in the Layers panel): <code>A</code>, <code>C</code>, <code>D</code>, <code>X</code>… Names like <code>rest</code>, <code>MBP</code>, <code>FV</code> or <code>mouth_D</code> work too.</li>
  <li>Select all the mouth shapes and choose <span class="ui">Object → Make Switch Layer</span> (${k('⇧', '⌘', 'M')}). They become one part called <b>Mouth</b>.</li>
  <li>In the Layers panel, drag the Mouth onto the head, so it moves with the head. Use the Joints tool to place its joint in the middle of the mouth.</li>
</ol>
<p><b>Using PNG pictures instead?</b> Name the files <code>A.png</code>, <code>D.png</code> and so on, select the Mouth, and click <span class="ui">Add drawings from files…</span> in Properties. Each file lands on its letter.</p>
${figure('mouth-set', 'The Mouth’s drawings in Properties (Build mode).')}
<p>Properties also lists any of the nine shapes that are still missing. Clicking a drawing in Build mode makes it the <b>rest</b> mouth: the one shown when nothing is animated.</p>

<h2>Lip syncing</h2>
${figure('lipsync', 'Lip syncing: the mouth palette, the Mouth row’s coloured blocks, and the dialogue on the Sound row.')}
<ol class="steps">
  <li>Import the dialogue (Chapter 10) and switch to Animate mode.</li>
  <li>Click the <b>Mouth</b> row's name on the timeline. The mouth palette appears above the timeline.</li>
  <li>Go to the frame where the first word starts. Step with <kbd>→</kbd> and listen: you'll hear each frame.</li>
  <li><b>Type the letter</b> of the mouth shape for the sound you hear. The mouth changes on this frame and the playhead moves on one frame, so you can keep listening and typing.</li>
  <li>If the sound hasn't changed, just press <kbd>→</kbd> to move on. A mouth stays until the next letter you type.</li>
  <li>Made a mistake? <kbd>Backspace</kbd> steps back and clears that frame.</li>
  <li>Press <kbd>Space</kbd> to watch it with the sound.</li>
</ol>
<div class="tip"><b>Tips from animators.</b> Mouths usually look best a frame or two <i>before</i> the sound. To nudge a whole phrase, select its ◆ marks on the Mouth row and ${k('⇧')}-drag. Don't try to show every letter: hit the big, visible sounds (M/B/P closing, wide vowels) and let the rest go.</div>
<div class="note"><b>Letters beat tool keys.</b> While the Mouth is selected in Animate mode, the letter keys set mouth shapes (so <kbd>H</kbd> sets the H mouth instead of choosing the Hand tool). Press <kbd>Esc</kbd> to deselect the Mouth and get the tool keys back.</div>

<h2>Other switch layers</h2>
<p>Switch layers aren't just for mouths: make one for eyes (open, half, closed, for blinks), hands (fist, open, pointing) or eyebrows. If the drawings aren't named after mouth letters, press <kbd>1</kbd>–<kbd>9</kbd> to pick them, or click them in the palette. The playhead doesn't move on for these.</p>
<p>A character's frames remember <i>letters</i>, not pictures. You can redraw a mouth, or swap in a different drawing set with <span class="ui">Drawing set</span>, and all the lip sync follows.</p>
`)}

${chapter('export', `
${figure('export', 'The Export window.')}
<ol class="steps">
  <li>Choose <span class="ui">File → Export Video…</span> (${k('⌘', 'E')}), or click <span class="ui">Export…</span> on the timeline.</li>
  <li>Pick a format, a size and which frames.</li>
  <li>Click <span class="ui">Export…</span> and choose where to save. A progress bar shows each frame; <span class="ui">Cancel</span> stops it.</li>
</ol>
<table class="wrap">
  <tr><th style="width:26%">Format</th><th>Best for</th></tr>
  <tr><td>MP4 video (H.264)</td><td>Watching and sharing: plays on phones, computers, YouTube and messaging apps. Includes the sound.</td></tr>
  <tr><td>PNG image sequence</td><td>One picture per frame, for video editing apps. Can have a see-through background, to put a character over other footage. The sound is saved beside the pictures as <code>soundtrack.wav</code>.</td></tr>
</table>
<ul>
  <li><b>Size:</b> the scene size, or 720p up to 4K. Bigger is sharper but takes longer and makes a bigger file. 1080p is a good choice.</li>
  <li><b>Frames:</b> the whole scene, or only the loop range you set with <kbd>I</kbd> and <kbd>O</kbd>.</li>
  <li>Every frame is drawn at full quality, even on a slow computer; it just takes a little longer.</li>
  <li>If a PNG picture in the scene will be shown bigger than its own pixels, the Export window lists it, because it may look soft. Pick a smaller size, or use a bigger picture.</li>
</ul>
`)}

${chapter('files', `
<h2>Projects</h2>
<p>A project is one scene, saved as one <code>.nyah</code> file. The file holds everything: the drawings, the animation, pictures and sounds, so you can copy it to another computer or back it up in one piece.</p>
<ul>
  <li><span class="ui">Save</span> (${k('⌘', 'S')}) and <span class="ui">Save As…</span> (${k('⇧', '⌘', 'S')}). A dot after the project's name means there are unsaved changes.</li>
  <li>Nyahmation asks before closing, or opening another project, if there are unsaved changes.</li>
  <li>Saving is safe: the new file is written completely before it replaces the old one, so a crash can't damage your project.</li>
  <li>Double-click a <code>.nyah</code> file in Finder, or drop it on Nyahmation's Dock icon, to open it.</li>
</ul>
<h2>The library folder</h2>
<p>Library items are <code>.nyahitem</code> files in <code>Documents/Nyahmation Library</code>. They are ordinary files: you can back them up, share them, or organise them in folders.</p>
<h2>Undo</h2>
<p>Almost everything can be undone with ${k('⌘', 'Z')} and redone with ${k('⇧', '⌘', 'Z')}, including drawing, posing, retiming and lip sync.</p>
`)}

${chapter('shortcuts', `
<div class="two-col">
<div>
<h3>Tools</h3>
<table class="keys">
  <tr><td>Select</td><td><kbd>V</kbd></td></tr>
  <tr><td>Points</td><td><kbd>A</kbd></td></tr>
  <tr><td>Joints</td><td><kbd>J</kbd></td></tr>
  <tr><td>Pose</td><td><kbd>K</kbd></td></tr>
  <tr><td>Pen (Build) / Pin (Animate)</td><td><kbd>P</kbd></td></tr>
  <tr><td>Rectangle</td><td><kbd>M</kbd></td></tr>
  <tr><td>Ellipse</td><td><kbd>L</kbd></td></tr>
  <tr><td>Polygon</td><td><kbd>Y</kbd></td></tr>
  <tr><td>Star</td><td><kbd>S</kbd></td></tr>
  <tr><td>Line</td><td><kbd>\\</kbd></td></tr>
  <tr><td>Hand</td><td><kbd>H</kbd> or hold <kbd>Space</kbd></td></tr>
</table>
<h3>Build mode</h3>
<table class="keys">
  <tr><td>Nudge</td><td>Arrow keys (${k('⇧')} = 10 px)</td></tr>
  <tr><td>Delete selection</td><td><kbd>Delete</kbd></td></tr>
  <tr><td>Deselect / stop editing points</td><td><kbd>Esc</kbd></td></tr>
  <tr><td>Select parent</td><td>${k('⇧', 'Enter')}</td></tr>
  <tr><td>Finish a pen line</td><td><kbd>Enter</kbd></td></tr>
</table>
</div>
<div>
<h3>Animate mode</h3>
<table class="keys">
  <tr><td>Play / pause</td><td><kbd>Space</kbd></td></tr>
  <tr><td>Previous / next frame</td><td><kbd>←</kbd> <kbd>→</kbd></td></tr>
  <tr><td>Previous / next pose</td><td>${k('⇧', '←')} ${k('⇧', '→')}</td></tr>
  <tr><td>First / last frame</td><td><kbd>Home</kbd> <kbd>End</kbd></td></tr>
  <tr><td>Loop in / out</td><td><kbd>I</kbd> <kbd>O</kbd></td></tr>
  <tr><td>Delete selected poses or sound</td><td><kbd>Delete</kbd></td></tr>
  <tr><td>Deselect everything</td><td><kbd>Esc</kbd></td></tr>
</table>
<h3>Lip sync (Mouth selected)</h3>
<table class="keys">
  <tr><td>Set a mouth shape</td><td><kbd>A</kbd>–<kbd>H</kbd>, <kbd>X</kbd></td></tr>
  <tr><td>Pick drawing 1–9</td><td><kbd>1</kbd>–<kbd>9</kbd></td></tr>
  <tr><td>Step back and clear</td><td><kbd>Backspace</kbd></td></tr>
</table>
<h3>Timeline dragging</h3>
<table class="keys">
  <tr><td>Retime a pose</td><td>drag ◆</td></tr>
  <tr><td>Retime and shift the rest</td><td>${k('⇧')} drag</td></tr>
  <tr><td>Copy a pose (hold)</td><td>${k('⌥')} drag</td></tr>
  <tr><td>Select more poses</td><td>${k('⇧')} click</td></tr>
</table>
</div>
</div>
<p>On a MacBook keyboard, <kbd>Home</kbd> is ${k('Fn', '←')} and <kbd>End</kbd> is ${k('Fn', '→')}. The menu shortcuts (${k('⌘', 'S')}, ${k('⌘', 'Z')} and so on) are listed in Chapter 3.</p>
`)}

${chapter('help', `
<table class="wrap">
  <tr><th style="width:34%">Problem</th><th>What to do</th></tr>
  <tr><td>Nothing happens when I draw</td><td>The layer may be locked or hidden (check the padlock and eye in the Layers panel), or you may be in Animate mode, where the drawing tools aren't available.</td></tr>
  <tr><td>Dragging the hand tips the whole body over</td><td>Select the character's layer and click <span class="ui">Mark branch joints as chain roots</span>, or double-click the shoulder joint with the Joints tool to make it a chain root.</td></tr>
  <tr><td>An arm bends the wrong way</td><td>Select the forearm and change <span class="ui">Bends</span> in its joint settings, or set joint limits.</td></tr>
  <tr><td>A part spins around the wrong point</td><td>Its joint is in the wrong place. Move it with the Joints tool (<kbd>J</kbd>).</td></tr>
  <tr><td>Letter keys change tools instead of mouths</td><td>Select the Mouth first (click its row on the timeline), and make sure you're in Animate mode.</td></tr>
  <tr><td>Typing a letter doesn't change the mouth</td><td>The mouth set has no drawing with that letter. Check the Mouth's drawings in Properties.</td></tr>
  <tr><td>I can't hear anything</td><td>Check the Mac's volume, that the sound isn't muted in its properties, and that <span class="ui">Sound while scrubbing</span> is ticked.</td></tr>
  <tr><td>The feet slide while walking</td><td>Pin them (Chapter 9).</td></tr>
  <tr><td>A picture looks blurry in the video</td><td>It's being shown bigger than its own pixels. Export at a smaller size, or import a bigger PNG. Vector drawings are always sharp.</td></tr>
  <tr><td>macOS says the app can't be opened</td><td><span class="ui">System Settings → Privacy &amp; Security → Open Anyway</span> (see Chapter 2).</td></tr>
  <tr><td>"Electron uninstall" when running <code>npm run dev</code></td><td>Run <code>npm run setup</code> in the Nyahmation folder; it downloads the parts that newer versions of npm skip.</td></tr>
</table>
`)}

${chapter('glossary', `
<table class="wrap">
  <tr><th style="width:24%">Word</th><th>Meaning</th></tr>
  <tr><td>Chain root</td><td>A joint where posing stops. Dragging a hand turns the arm, but not past a chain root at the shoulder.</td></tr>
  <tr><td>Easing</td><td>How a movement speeds up and slows down between two poses.</td></tr>
  <tr><td>Frame</td><td>One picture of the animation. At 24 frames per second, 24 frames make one second of video.</td></tr>
  <tr><td>Frame rate (fps)</td><td>How many frames are shown each second.</td></tr>
  <tr><td>Hold</td><td>A pause: the same pose on two frames, so nothing moves between them.</td></tr>
  <tr><td>IK (inverse kinematics)</td><td>Dragging the end of a limb (a hand) and letting the joints above it (elbow, shoulder) work out how to bend.</td></tr>
  <tr><td>In-betweens</td><td>The frames between two poses, which Nyahmation fills in for you.</td></tr>
  <tr><td>Joint</td><td>The point a part turns around, where it attaches to its parent.</td></tr>
  <tr><td>Layer</td><td>A level of the scene: a character or a background.</td></tr>
  <tr><td>Lip sync</td><td>Matching a character's mouth shapes to the words it says.</td></tr>
  <tr><td>Loop range</td><td>A stretch of frames that playback repeats, set with <kbd>I</kbd> and <kbd>O</kbd>.</td></tr>
  <tr><td>On twos</td><td>Showing each pose for two frames, for a hand-drawn feel.</td></tr>
  <tr><td>Onion skin</td><td>Faint copies of the frames before and after, to see a movement's path.</td></tr>
  <tr><td>Parent / child</td><td>A child part is inside its parent and moves with it (the hand is a child of the forearm).</td></tr>
  <tr><td>Pin</td><td>Fixing a part to a spot in the scene from a certain frame, so it stays put while the rest moves.</td></tr>
  <tr><td>Pose</td><td>A position of a part recorded on a frame, shown as ◆ on the timeline.</td></tr>
  <tr><td>Rest pose</td><td>How a character looks when nothing is animated; set in Build mode.</td></tr>
  <tr><td>Rig</td><td>A character's joints and part tree, which make it posable like a puppet.</td></tr>
  <tr><td>Scrubbing</td><td>Dragging the playhead back and forth to see (and hear) the frames.</td></tr>
  <tr><td>Switch layer</td><td>A part that shows one drawing at a time from a set, such as mouth shapes.</td></tr>
  <tr><td>Vector</td><td>Artwork made of points and curves, which stays sharp at any size.</td></tr>
</table>
`)}
`;
}
