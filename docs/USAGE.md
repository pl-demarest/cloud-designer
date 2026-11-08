# Cloud Designer usage guide

Cloud Designer builds a wireframe cloud from four kinds of primitive (spheres, one base, one
tail and any number of spirals) plus a generated flow cloud, then merges them into one wireframe
with Cut & Glue. That wireframe is exported as a binary glTF (GLB) file for the landing page
([README](../README.md#the-cloud-glb-githublandings-input)). This guide describes every control
as the code implements it.

- [Layout](#layout)
- [The viewport](#the-viewport)
- [Toolbar](#toolbar)
- [Spheres](#spheres)
- [Base](#base)
- [Tail](#tail)
- [Spirals](#spirals)
- [Flow Cloud](#flow-cloud)
- [What Regenerate, Cut & Glue and the surface mesh produce](#what-regenerate-cut--glue-and-the-surface-mesh-produce)
- [Undo and redo](#undo-and-redo)
- [Keyboard](#keyboard)
- [Import and export](#import-and-export)
- [Autosave](#autosave)
- [Known limitations](#known-limitations)

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Cloud name] [Undo][Redo] [Edit][Preview] [Axes][Grid][Fit]          [Reset] │
├────────────────────────────────────────────────────────┬─────────────────────┤
│ notice                                                 │ Spheres (3)       ▲ │
│                                                        │ Base              ▼ │
│                 viewport (three.js canvas)             │ Tail              ▼ │
│                                                        │ Spirals (0)       ▼ │
│          drop a preset JSON file here to import it     │ Flow Cloud        ▲ │
│                                                        │ Export            ▼ │
└────────────────────────────────────────────────────────┴─────────────────────┘
```

- The toolbar runs across the top.
- The viewport fills the rest of the window left of the sidebar. Notices (an import's outcome,
  the autosave restore, the snippet copy) appear at its top left; a new notice replaces the one
  shown, and × dismisses it.
- The sidebar on the right holds six collapsible sections. Spheres and Flow Cloud start open.
  Each section header is a button: click it, or press Enter or Space while it has focus, to open
  or close the section. The Spheres and Spirals headers show how many items there are.

The editor opens on the default preset: three spheres (radius 1.2 at the origin, 1.0 at
(1.6, 0.3, 0), 0.9 at (−1.6, 0.2, 0)), an open oval base through four control points from
(−2.5, −0.8, 0) to (2.5, −0.8, 0), a three-setpoint tail attached to the base's end, no spirals,
and flow-cloud settings for spiral mode at resolution 64. Nothing is generated until you click
Regenerate. A preset saved by [autosave](#autosave) opens instead, if there is one.

## The viewport

### Camera

| Action | Mouse | Touch |
|---|---|---|
| Orbit | Left-drag on empty space | One-finger drag |
| Pan | Right-drag, or Ctrl, Cmd or Shift with left-drag | Two-finger drag |
| Zoom | Scroll wheel, or middle-drag | Pinch |

The camera starts at (0, 4, 10) looking at the origin, with damping (it glides briefly after a
drag). The keyboard does not move the camera.

### Handles

Handles are drawn in Edit mode only. Press on a handle and drag: the item moves on the plane that
faces the camera through the point you grabbed, and keeps the offset you grabbed it at. The drag
ends when you release the button, also outside the canvas, or when the browser cancels the
pointer. Where handles overlap, the one nearest the camera under the pointer wins. A drag that
moved something is one undo step.

| Handle | Moves |
|---|---|
| Blue box | A sphere's centre |
| Green ball | A base control point |
| Red ball | A tail setpoint. The first setpoint of an attached tail sits on the base and does not move. |
| Orange box | A spiral's position |
| Teal box | The flow cloud's position. It appears after the first Regenerate. |
| Blue ball "F", red ball "B", grey arrow F to B | The front and back anchors of the flow-line axis ([Flow Cloud](#flow-cloud)). They are drawn over everything. |

### Edit and Preview

- **Edit** shows the scaffold (the sphere, base, tail and spiral wireframes) with their handles,
  the F/B anchors, and the flow cloud unless it is hidden (Hide in the Flow Cloud section).
- **Preview** shows the Cut & Glue result and nothing of the scaffold: the clipped wireframe, or,
  with the Surface Mesh box checked, the surface mesh plus any flat spirals (the surface mesh holds
  only thick ones). Before the first Cut & Glue run Preview shows nothing but the grid and axes.

The grid and the axes helper follow the Axes and Grid buttons in both modes.

### Fit

Fit points the camera at what the viewport shows, without handles, the F/B anchors, the grid or
the axes: in Edit the scaffold and the flow cloud, in Preview the Cut & Glue result. The camera
looks from above and in front, at the distance where the bounding sphere of that content fits the
narrower of the horizontal and vertical fields of view. With nothing shown the camera stays where
it is.

## Toolbar

| Control | What it does |
|---|---|
| Cloud name | The preset's name; exported files are named after it ([file names](#file-names)). A rename is one undo step, recorded when you press Enter or leave the field. |
| Undo, Redo | Step back and forward through the history ([Undo and redo](#undo-and-redo)). Each is disabled when there is nothing to step to. |
| Edit, Preview | Switch between the two modes. |
| Axes | Show or hide the axes helper: red X, green Y and blue Z lines, 1 unit long, at the origin. |
| Grid | Show or hide the ground grid: 20 × 20 units in 1-unit squares, at y = −1. |
| Fit | Frame the shown content ([Fit](#fit)). |
| Reset | Ask for confirmation, then replace the cloud with the default preset as one undo step. The page does not reload: the history, the view and any generated result stay. |

## Spheres

The section header shows the number of spheres. **+ Add** appends a sphere of radius 1 and
falloff 0.5, 1.2 units right (+x) of the last sphere, or at the origin when there is none. Each
sphere has a header bar: its name ("Sphere 2 (ellipsoid)") is a button that shows or hides its
controls, which start hidden, and × removes it.

| Control | Range (step) | Effect |
|---|---|---|
| Shape | Sphere, Ellipsoid | Ellipsoid scales the sphere by Scale X, Y and Z. |
| Pos X, Y, Z | X −8 to 8, Y and Z −4 to 4 (0.05) | The centre. Dragging the handle can move it past these ranges. |
| Radius | 0.1 to 3 (0.05) | The radius of the drawn sphere, of its clip volume and of its part of the surface mesh. |
| Falloff | 0.5 to 5 (0.1) | The sphere's weight in the flow cloud's field. It changes nothing else. |
| Half | on, off | Keep only the upper dome, above the sphere's own y = 0 plane (which turns with Rotate), in the wireframe, the clip volume and the surface mesh. The flow cloud's field still counts the whole sphere. |
| Rotate X, Y, Z | −180° to 180° (0.01 rad, shown in degrees) | Euler angles in three.js's default order XYZ, as an object's rotation, for the wireframe, the clip volume, the surface mesh and the field alike. |
| Scale X, Y, Z | 0.2 to 3 (0.05) | Shown for an ellipsoid only. |

## Base

The base is a tube along a smooth curve through its control points: a uniform Catmull-Rom curve
(tension 0.5), the same curve in the editor and in the workers. **+ Point** appends a control
point 1 unit along +x from the last one.

| Control | Range (step) | Effect |
|---|---|---|
| Shape | Oval, Rect | The cross-section. |
| Width | 0.1 to 4 (0.05) | The cross-section's extent along the curve's Frenet binormal. On the default base that is horizontal, across the curve. |
| Height | 0.05 to 2 (0.05) | The cross-section's extent along the curve's Frenet normal. On the default base that is vertical. |
| Ring Density | 6 to 32 (1) | Vertices per cross-section ring of the wireframe. |
| Length Density | 8 to 48 (1) | Equal arc-length steps along the curve; the wireframe has a ring at each end of each step. The clip volume and the surface mesh are built from the same rings. |
| Closed | on, off | Close the curve into a loop through the first control point. An open base's clip volume and surface mesh end in flat caps in the planes of its first and last rings. |
| P0, P1, … X, Y, Z | any number (0.1) | A control point's coordinates. Type a value, then press Enter or leave the field ([number fields](#keyboard)). |
| × beside a point | | Remove that point. Disabled while the base has two. |

## Tail

The tail is a tube of varying radius along an open Catmull-Rom curve (tension 0.5) through its
setpoints. A setpoint's width is the tube's radius at that setpoint; between setpoints the radius
changes linearly with the curve parameter, so each setpoint's own width is met exactly.

The section's first line shows the number of setpoints ("Tail (3 pts)"). **+ Point** adds a
setpoint after the last: 0.8 units along +x and 0.4 along +y from it, with 0.6 times its width.

| Control | Range (step) | Effect |
|---|---|---|
| Start radius | 0.05 to 1.5 (0.01) | The first setpoint's width. |
| End radius | 0.05 to 1.5 (0.01) | The last setpoint's width. |
| Curl | 0 to 2π (0.05 rad, shown as a multiple of π) | Turns the wireframe's rings about the curve over the last 20 % of its length, from 0 at 80 % to the full angle at the tip, so the lengthwise wires twist there. The curve, the clip volume and the surface mesh do not change. |
| Radial Density | 4 to 24 (1) | Vertices per ring of the wireframe. |
| Length Density | 8 to 64 (1) | Equal arc-length steps along the curve; the clip volume and the surface mesh use the same rings. |
| Attach | None, Base Start, Base End | Put the tail's first setpoint on the base (below). |
| Attach Offset | 0 to 1 (0.01) | Shown while the tail is attached. |
| SP 0, SP 1, … X, Y, Z | any number (0.1) | A setpoint's position. |
| w | 0.05 to 1.5 (0.05) | A setpoint's width. |
| + beside a setpoint | | Insert a setpoint after it, halfway to the next one with the average width (after the last: as **+ Point** does). |
| × beside a setpoint | | Remove it. Disabled while the tail has two. |

### Attaching the tail to the base

An attached tail starts on the base's centre line, at an arc-length fraction of the base:

- **Base End** puts the first setpoint at fraction Attach Offset, measured from the base's first
  control point: offset 1 is the base's last control point, 0.5 the middle of the curve, 0 its
  first control point.
- **Base Start** measures from the other end, at fraction 1 − Attach Offset: offset 1 is the base's
  first control point, 0 its last.

In both cases offset 1 is the end the option names, and smaller offsets move the tail along the
base towards the other end. On a closed base, fraction 1 is the point where the loop closes, which
is the first control point, so Base End at offset 1 attaches there.

While the tail is attached, the first setpoint's stored position is not used: its handle sits on
the base and does not follow a drag, and its X, Y and Z fields edit the stored position, which
takes effect when Attach is set to None. The attachment point follows every edit of the base.

A version-1 preset (saved before Base Start was fixed to measure from its own end) keeps its tail
where version 1 drew it: on import its Base Start offset becomes 1 − offset.

## Spirals

Spirals are decorative coils: two copies of a spiral curve, joined by rungs (flat), or a coil with
a rectangular cross-section (thick). The section header shows the number of spirals. **+ Add**
places a golden spiral of two turns, thickness 0.15 and corner radius 0.04 at
(0.5 × the number of spirals, 3, 0). Each spiral has a header bar like a sphere's
("Spiral 1 (golden)").

| Control | Range (step) | Effect |
|---|---|---|
| Type | Golden (logarithmic), Archimedean (equal spacing) | How the radius grows with the angle: exponentially (golden) or linearly (Archimedean). |
| Inner Radius | 0.01 to 2 (0.01) | The radius at the centre, angle 0. |
| Outer Radius | 0.1 to 6 (0.05) | The radius after the last turn. |
| Turns | 0.25 to 6 (0.25) | Full revolutions. |
| Separation | 0 to 2 (0.01) | The distance between the two copies of the curve, perpendicular to the spiral's plane, at the outer radius. |
| Taper Power | 0 to 4 (0.05; 0 shows "uniform") | The separation at radius r is Separation × (r / Outer Radius)^Taper Power: 0 keeps it constant, 1 tapers it linearly, 2 or more give a snail-shell taper. |
| Rung Density | 1 to 32 per turn (1) | Rungs between the two curves (flat), or cross-section rings (thick), per turn. |
| Thickness | 0 to 2 (0.01; 0 shows "flat") | 0 draws a flat ribbon. Above 0 the spiral is a coil whose cross-section is Thickness wide in the radial direction and the separation high. |
| Corner Rnd | 0 to 1 (0.01) | Shown for a thick spiral. Rounds the corners of the cross-section rings, limited to half the thickness and half the separation. The four lengthwise wires stay at the sharp corners; the surface mesh rounds them. |
| Pos X, Y, Z | X −8 to 8, Y and Z −4 to 4 (0.05) | The spiral's centre. |
| Rotate X, Y, Z | −180° to 180° (0.01 rad, shown in degrees) | Euler angles in three.js's default order XYZ; they tilt the spiral's plane. |

Spirals cut nothing in Cut & Glue; the spheres, the base and the tail cut them. Only thick spirals
are part of the surface mesh.

## Flow Cloud

The flow cloud is a surface generated around the spheres ([what Regenerate produces](#regenerate-the-flow-cloud)).
Its controls, from the top of the section:

| Control | Effect |
|---|---|
| Hide, Show | Hide or show the flow cloud. Hidden, it is also left out of Cut & Glue's clipped wireframe and surface mesh. This is view state: it is not saved and not in the history. |
| Regenerate | Compute the flow cloud from the current preset. The button reads "Working..." and is disabled while the job runs. If it fails, "Regenerate failed: <reason>" appears under the header until the next run. |
| Reset to Default | The same as the toolbar's Reset. |
| Cut & Glue | Compute the clipped wireframe and the surface mesh ([Cut & Glue](#cut--glue-the-clipped-wireframe)). The button reads "Generating..." and is disabled while either job runs. A failure shows "Cut & Glue failed: <reason>" under it. |
| Surface Mesh | Show the surface mesh instead of the clipped wireframe in Preview. Disabled until a Cut & Glue run has produced a surface mesh. View state, like Hide. |
| Mesh Density | The surface mesh's grid in cells per axis: "32 (fast)", "64 (balanced)", "96 (fine)", "128 (dense)", "192 ⚠ slow", "256 ⚠ very slow". Applies at the next Cut & Glue. |
| Position X, Y, Z | −20 to 20 (0.1). Moves the shown flow cloud at once, as dragging the teal handle does. Cut & Glue, and so the Cloud GLB, takes the flow cloud at its position when it runs. |
| Resolution | The flow cloud's grid in cells per axis: "32 (fast)", "64 (balanced)", "128 ⚠ slow". |
| Threshold | 0.5 to 2 (0.05). The field value the surface is drawn at: lower values give a larger, more merged surface. |
| Mode | Edges: draw the surface's crease edges. Spiral: draw flow lines and, optionally, bands. |

In Spiral mode these controls follow:

| Control | Effect |
|---|---|
| Generate Bands | Compute bands at the next Regenerate. Off, no bands exist in the result. |
| Show Bands | Shown while Generate Bands is on. Shows or hides the bands of the shown result at once. |
| Show Flow Lines | Shows or hides the flow lines of the shown result at once. A Regenerate with it off computes no flow lines. |
| Bands | 4 to 20 (1), shown while Generate Bands is on. Bands + 1 contours, at u = 0, 1/Bands, …, 1. |
| Flow Lines | 4 to 24 (1). The number of flow lines, evenly spaced in angle. |
| Spiral Twist | 0 to 4π (0.05 rad, shown as a multiple of π). How far a flow line turns about the axis from u = 0 to u = 1. |
| Front, Back | Any number (0.1) in each of X, Y and Z: the F and B anchors' coordinates. Type a value, then press Enter or leave the field ([number fields](#keyboard)), or drag the anchors in the viewport. |
| Snap Back → Tail | Move B to where the tail starts: its first setpoint, or for an attached tail the point on the base where it meets it. One undo step. |

The F/B anchors, Resolution, Threshold, Mode, Generate Bands, Bands, Flow Lines and Spiral Twist,
like every sphere and tail edit, take effect at the next Regenerate. Position, Hide and Show, Show
Bands and Show Flow Lines change the shown result at once.

## What Regenerate, Cut & Glue and the surface mesh produce

All three compute in Web Workers, off the editor's main thread. A request made while the same job
is computing waits and runs when it finishes; of several waiting requests only the newest runs.
None of the results follows later edits: they change only when their job runs again.

### Regenerate: the flow cloud

Regenerate waits 50 ms for further clicks, then reads the preset and sends the spheres, the base,
the tail and the flow-cloud settings to the flow-cloud worker.

- **The field.** Each sphere adds falloff × radius² / d², where d is the distance from the sphere's
  centre measured in its rotated frame (divided by Scale for an ellipsoid). The tail adds
  tailStrength × w² / d² for its nearest spine point (w the width there) only when the preset's
  `flowCloud.tailStrength` is above 0; no control sets it, and the default is 0
  ([Known limitations](#known-limitations)).
- **The surface.** Marching cubes extracts the surface where the field equals Threshold, on a grid
  of Resolution cells per axis over the box the surface can reach, padded by 0.5. Each axis of the
  box is divided into the same number of cells, so the cells are boxes rather than cubes, and the
  detail differs between axes. The mesh's vertices are shared between neighbouring cells, and its
  triangles face outward.
- **Edges mode** draws the mesh's crease edges: the edges where neighbouring triangles meet at more
  than 15°.
- **Spiral mode** traces lines over the mesh. Each vertex gets an axial coordinate u and an angle
  about the axis from F towards B. Measured along the axis, u is 0 at the front of the frontmost
  sphere and 1 at the tail's first setpoint (where an attached tail meets the base); when that
  setpoint lies less than 0.001 past the front, u is 1 at the front plus the F-to-B distance. u is
  clamped to 0 to 1, so vertices past the tail's first setpoint count as u = 1. Flow lines follow
  constant angle + Spiral Twist × u; bands are contours of constant u.

The result appears at the flow cloud's Position, with the teal handle in Edit mode.

### Cut & Glue: the clipped wireframe

Cut & Glue takes every wire the editor draws now, in world coordinates, and removes the parts that
lie inside another primitive's solid:

| Wires | Cut by |
|---|---|
| Each sphere's | the other spheres, the tail and the base |
| The tail's | the spheres and the base |
| The base's | the spheres and the tail |
| The spirals' | the spheres, the tail and the base |
| The flow cloud's (those shown) | the spheres, the tail and the base |

The solids are the shapes the editor draws: each sphere or ellipsoid with its Half setting and
rotation; the base tube between its rings, oval or rectangular, with flat end caps when open; the
tail tube between its rings, circular, with flat end caps. Spirals and the flow cloud have no
solid. A primitive never cuts its own wires: where two primitives overlap, the wires of each run up
to the other's surface.

The flow-cloud wires that take part are the ones shown: none when the flow cloud is hidden or the
editor is in Preview, and no bands or flow lines that Show Bands or Show Flow Lines hides. The
result is what Preview shows and what Export Cloud GLB writes.

### The surface mesh

The same Cut & Glue click starts a second job: one triangle mesh of the union of the solids, from
marching cubes on their combined signed distance field, on a grid of Mesh Density cells per axis
over the box that holds them all. The union holds the spheres (radius, Half and rotation; the
falloff plays no part), the base, the tail, every thick spiral (its rounded-rectangle
cross-section swept along the spiral), and the flow cloud: the one the viewport shows, computed
from the inputs of the Regenerate that produced it, at the current Position. The flow cloud is
left out before the first Regenerate and while it is hidden. Flat spirals have no volume, so
Preview draws them beside the surface mesh.

Preview shows the surface mesh as the wireframe of its triangles when Surface Mesh is checked. No
export writes it.

## Undo and redo

The history holds snapshots of the preset. Each of these is one undo step:

- a choice in a drop-down list, a click on any checkbox but Surface Mesh, and every + Add,
  + Point, insert and remove button;
- a slider: a pointer drag from press to release, or a step key from press to release (a held key
  repeats within one step), or a change made by assistive technology;
- a number field's value, applied on Enter or when you leave the field;
- a rename, recorded on Enter or when you leave the name field;
- a viewport drag that moved something;
- Reset, Reset to Default, Import, Discard (autosave) and Snap Back → Tail.

An edit that changes nothing records nothing. Undo first records an edit not yet recorded, then
steps back; a new edit after an undo discards the steps you could have redone. The history keeps
50 snapshots, so up to 49 edits can be undone. It opens on the preset the editor starts with.

The history holds only the preset. The view (Edit or Preview, Axes, Grid, Hide or Show, the Surface
Mesh box, which sections are open) is not part of it, and neither are the generated results: after
Undo, Reset, Import or Discard the flow cloud and the Cut & Glue result stay on screen as they were
until their jobs run again.

## Keyboard

| Keys | Action |
|---|---|
| Ctrl+Z, Cmd+Z | Undo |
| Ctrl+Shift+Z, Cmd+Shift+Z | Redo |
| Ctrl+Y, Cmd+Y | Redo |

- The letter's case does not matter (Caps Lock), and on a non-Latin keyboard layout the physical Z
  and Y keys work. With Alt (AltGr) held the keys do nothing.
- While focus is in the cloud name or a drop-down list, the keys are the browser's: in the name
  they undo and redo the typing. In a number field, Ctrl+Z drops what you have typed; with nothing
  typed, the keys undo and redo the preset (the browser's own undo there could change another
  field). On a slider, a checkbox or a button they undo and redo the preset.
- Tab and Shift+Tab move between controls; the control with keyboard focus has an outline. Every
  control is a button, a slider, a checkbox, a drop-down list or a text field, and has a name for
  screen readers.
- A focused slider steps with the arrow keys, Page Up and Page Down, Home and End.
- A number field changes only when you press Enter or leave it. An empty or non-numeric entry is
  refused and the field shows the stored value again; a number outside the field's range is
  clamped to it (setpoint width 0.05 to 1.5); Escape drops what you typed.

## Import and export

### Import

**Import JSON Preset** (Export section) opens a file picker for `.json` files. Dropping a file on
the viewport imports it too (the first file of a drop); the viewport shows a dashed outline while a
file is dragged over it.

A file imports when it holds a JSON object with at least one of `spheres`, `base`, `tail`,
`spirals` or `flowCloud` (or `swirls` and `merge`, the names of the first version). It is then
completed and corrected to a version-2 preset:

- version 1, and a file without a version, migrate ([attach offsets](#attaching-the-tail-to-the-base));
- a missing or invalid field (wrong type, a number that is not finite, an unknown option) gets its
  default, a missing base or tail the default one, missing sphere and spiral lists are empty, and
  unknown fields are dropped;
- segment counts, rung density and the band and flow-line counts are rounded and clamped to their
  sliders' ranges, and the two resolutions become the nearest value their lists offer;
- base cross-section sizes, ellipsoid scales and tail widths are at least 0.001.

A file is refused, and the preset left as it was, when it is not valid JSON, is not an object,
holds none of the fields above, or ends up with a base of fewer than two control points or a tail
of fewer than two setpoints. The notice says which ("Could not import <file>: …"); a successful
import shows "Imported <file>.". An import is one undo step. It does not regenerate anything.

### Export

| Button | Writes | Needs |
|---|---|---|
| Export JSON Preset | `<name>-preset.json`: the preset as version-2 JSON, indented. Import reads it back. | — |
| Export Cloud GLB | `<name>-cloud.glb`: the clipped wireframe of the last Cut & Glue run, the landing page's input ([contract](../README.md#the-cloud-glb-githublandings-input)). | A Cut & Glue run; otherwise an alert says so. |
| Export Scaffold GLB | `<name>-scaffold.glb`: the sphere and base wireframes, under nodes `scaffold`, `spheres` and `base`. | — |
| Export Wireframe GLB | `<name>-wireframe.glb`: the flow cloud as `body`, then `tail` and `spirals`, under `cloud-wireframe`. | A generated flow cloud; otherwise an alert says to Regenerate. |
| Export Both (Full) | `<name>-full.glb`: `scaffold` (spheres, base), `tail`, `spirals` and the flow cloud as `wireframe`, under `cloud`, each part when it has content. | — |
| Copy CloudLayer Snippet | Copies the landing page's loader call for `<name>-cloud.glb` to the clipboard. | Clipboard access (a secure context such as localhost or HTTPS); a notice reports the outcome. |

Every GLB holds lines only. Drag handles, the F/B anchors, the grid and the axes helper are never
exported. Each part is exported whether the viewport shows it or not (the scaffold in Preview, the
flow cloud after Hide), but within a part an object hidden at export time is left out, such as the
bands while Show Bands is off. The parts keep their positions: the flow cloud's node carries its
Position.

### File names

`<name>` is the cloud's name made safe: accents dropped, lower case, every run of characters other
than a–z, 0–9, `-` and `_` replaced by one `-`, no `-` at either end, at most 80 characters, and
`cloud` when nothing is left. "Default Cloud" gives `default-cloud`.

## Autosave

The preset is saved in the browser's localStorage under the key `cloud-designer/autosave/v1`, one
second after the last change, or at once when the page is hidden or closed with a change waiting.
The default preset is not saved: reaching it removes the save.

When the editor opens and a save exists, it opens on the saved preset with the notice "Restored the
cloud from autosave (saved <date and time>)." and a **Discard** button. Discard goes back to the
default preset as one undo step and removes the save. A save that does not read as a preset is
removed. Where the browser blocks localStorage, as some private windows do, nothing is saved.

The save holds the preset only, not the generated results: after a reload, Regenerate and Cut &
Glue again.

## Known limitations

- `flowCloud.tailStrength`, the tail's weight in the flow cloud's field, has no control. It can be
  set only in a preset file, then imported.
- Show Flow Lines off during a Regenerate means no flow lines are computed: turning it on later
  shows none until the next Regenerate. Generate Bands works the same way, as its tooltip says.
- In Preview the flow cloud is hidden, so a Cut & Glue run started there leaves the flow-cloud
  wires out of the clipped wireframe, although the surface mesh includes the flow cloud. Run Cut &
  Glue in Edit mode.
- Undo, Reset, Import and Discard leave the generated flow cloud and Cut & Glue result on screen;
  they show the old preset until the next Regenerate or Cut & Glue. Export Cloud GLB writes that
  last result.
