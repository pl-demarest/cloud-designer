# Cloud Designer -- Usage Guide

A complete guide to using the Cloud Designer tool for creating wireframe cloud assets.

## Table of Contents

- [UI Layout](#ui-layout)
- [Primitives](#primitives)
- [Controls](#controls)
- [Workflow](#workflow)
- [Flow Cloud](#flow-cloud)
- [Cut & Glue](#cut--glue)
- [Surface Mesh](#surface-mesh)
- [Export](#export)
- [Tips & Troubleshooting](#tips--troubleshooting)

---

## UI Layout

The interface has four main areas:

```
┌──────────────────────────────────────────────────┐
│  Toolbar: [Name] [Undo][Redo] [Edit][Preview]    │
│           [Axes][Grid][Fit] [Reset]               │
├────────────┬─────────────────────────────────────┤
│  Sidebar   │                                     │
│            │                                     │
│  Spheres   │         3D Viewport                 │
│  Base      │                                     │
│  Tail      │     (Three.js canvas with           │
│  Spirals   │      OrbitControls)                 │
│  Flow Cloud│                                     │
│  Export    │                                     │
│            │                                     │
├────────────┴─────────────────────────────────────┤
└──────────────────────────────────────────────────┘
```

### Toolbar

| Control | Function |
|---------|----------|
| **Name field** | Editable name for the current cloud preset |
| **Undo / Redo** | Step through the history stack (Ctrl+Z / Ctrl+Shift+Z) |
| **Edit / Preview** | Toggle between edit mode (handles visible) and preview mode (clean wireframe only) |
| **Axes** | Toggle the 3D axis helper |
| **Grid** | Toggle the ground grid |
| **Fit** | Zoom camera to fit all geometry |
| **Reset** | Reload the page to reset to defaults |

### Sidebar Panels

Each panel in the sidebar is collapsible. Click the panel header to expand/collapse. The panels correspond to the five primitive types plus export options.

---

## Primitives

Cloud Designer provides five primitive types that combine to form a cloud shape.

### Spheres (Metaballs)

Hemisphere dome wireframes that serve as the cloud's body lobes. In the flow cloud, these define the metaball scalar field for isosurface generation.

| Property | Range | Description |
|----------|-------|-------------|
| Position X/Y/Z | unbounded | World-space position |
| Radius | 0.1 -- 5.0 | Size of the hemisphere |
| Falloff | 0.1 -- 5.0 | Metaball field strength multiplier |
| Shape | sphere / ellipsoid | Uniform or non-uniform scaling |
| Scale X/Y/Z | 0.1 -- 5.0 | Non-uniform scale (ellipsoid mode) |
| Half | on/off | Top hemisphere only |
| Rotation X/Y/Z | -180 -- 180 | Euler rotation in degrees |

**Drag handles:** Blue boxes. Drag to reposition spheres in the viewport.

**Add/Remove:** Use the "+ Add Sphere" button in the Spheres panel. Select a sphere and click its remove button to delete.

### Base (Spline Extrusion)

An extruded shape along a CatmullRom spline curve. Forms the cloud's structural foundation or body.

| Property | Range | Description |
|----------|-------|-------------|
| Control Points | 2+ points | Drag the green sphere handles to shape the curve |
| Cross-Section Width | 0.1 -- 5.0 | Width of the extruded cross-section |
| Cross-Section Height | 0.1 -- 5.0 | Height of the extruded cross-section |
| Cross-Section Shape | oval / rect | Shape of the cross-section |
| Closed | on/off | Whether the spline forms a closed loop |
| Ring Segments | 4 -- 64 | Vertices per cross-section ring (wireframe density) |
| Length Segments | 4 -- 128 | Number of rings along the path (wireframe density) |

**Drag handles:** Green spheres at each control point.

### Tail (Variable-Radius Tube)

A tube that tapers from thick to thin, following a CatmullRom curve through setpoints. Each setpoint has its own width, allowing precise radius control along the length.

| Property | Range | Description |
|----------|-------|-------------|
| Setpoints | 2+ points | Position and width at each point along the tail |
| Curl Amount | 0 -- 6.28 | Radians of curl applied to the last 20% of the tail |
| Attach to Base | start / end / none | Anchor the tail to the base spline |
| Attach Offset | 0 -- 1 | Position along the base spline for attachment |
| Radial Segments | 3 -- 32 | Vertices per cross-section ring (wireframe density) |
| Length Segments | 4 -- 128 | Number of rings along the path (wireframe density) |

**Drag handles:** Red spheres at each setpoint. Drag to reposition; adjust width per setpoint in the panel.

### Spirals

Decorative spiral ribbon elements. Can be flat (2D ribbon) or thickened (3D rectangular cross-section coil).

| Property | Range | Description |
|----------|-------|-------------|
| Spiral Type | archimedean / golden | Growth function for the spiral radius |
| Start Radius | 0.01 -- 10 | Inner radius of the spiral |
| End Radius | 0.1 -- 20 | Outer radius of the spiral |
| Turns | 0.5 -- 10 | Number of full rotations |
| Separation | 0.01 -- 2 | Gap between the two ribbon copies |
| Taper Power | 0 -- 3 | 0 = uniform gap, 1 = linear taper, 2+ = snail-shell taper |
| Rung Density | 1 -- 30 | Connecting rungs per turn |
| Thickness | 0 -- 2 | Depth of rectangular cross-section (0 = flat ribbon) |
| Corner Radius | 0 -- 1 | Rounding at cross-section corners (when thickness > 0) |
| Position X/Y/Z | unbounded | World-space position |
| Rotation X/Y/Z | -180 -- 180 | Euler rotation in degrees |

**Drag handles:** Orange boxes. Drag to reposition spirals.

### Flow Cloud (Generated Isosurface)

Not a primitive you place directly -- this is the generated isosurface from the marching cubes merge of all sphere metaballs. It produces the organic, flowing cloud body shape.

See [Flow Cloud](#flow-cloud) section below for details.

---

## Controls

### Mouse Controls

| Action | Input |
|--------|-------|
| **Orbit camera** | Left-click + drag on empty space |
| **Pan camera** | Right-click + drag, or middle-click + drag |
| **Zoom** | Scroll wheel |
| **Drag primitive** | Left-click + drag on a handle |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Ctrl+Z** | Undo |
| **Ctrl+Shift+Z** | Redo |

### Handle Colors

Each primitive type has a distinct drag handle color for easy identification:

| Color | Primitive |
|-------|-----------|
| Blue boxes | Spheres |
| Green spheres | Base control points |
| Red spheres | Tail setpoints |
| Orange boxes | Spirals |
| Teal box | Flow cloud position |
| Blue/Red spheres | Axis gizmo (F/B direction anchors) |

---

## Workflow

A typical cloud creation workflow:

### 1. Place Spheres

Add sphere primitives to define the main body mass of the cloud. Position and scale them to create overlapping lobes. The metaball fields from these spheres will merge when you generate the flow cloud.

### 2. Shape the Base

Adjust the base spline control points to create the cloud's structural spine. The base forms an extruded tube that the tail can attach to.

### 3. Attach and Shape the Tail

Position tail setpoints to create a sweeping, tapering tail. Set "Attach to Base" to anchor the tail's start to the base spline. Adjust the curl amount for a decorative tip curl.

### 4. Add Spirals (Optional)

Place spiral primitives for decorative swirl elements. Adjust type (golden vs archimedean), turns, separation, and taper. For 3D spirals, increase the thickness and tune corner radius.

### 5. Generate Flow Cloud

Open the Flow Cloud panel and click **Regenerate**. This runs marching cubes on the metaball field from your spheres, producing the isosurface wireframe. Adjust:
- **Resolution** (32/64/128) for detail level
- **Threshold** for surface tightness
- **Wireframe mode** (edges or spiral flow lines)

### 6. Cut & Glue

Click **Cut & Glue** in the Flow Cloud panel. This clips all primitive edges against each other to produce a single unified wireframe with clean intersections. Switch to **Preview** mode to see the result.

### 7. Preview and Adjust

Toggle to Preview mode to see the final wireframe without handles, grid, or helper geometry. Iterate on primitive placement and regenerate as needed.

### 8. Export

Choose an export format from the Export panel (see [Export](#export) section).

---

## Flow Cloud

The flow cloud is the marching cubes isosurface generated from the metaball scalar field of all sphere primitives.

### Regeneration

Click **Regenerate** in the Flow Cloud panel to compute the isosurface. This runs in a web worker and does not block the UI. The flow cloud appears in the viewport after computation completes.

### Settings

| Setting | Range | Description |
|---------|-------|-------------|
| Resolution | 32 / 64 / 128 | Marching cubes grid resolution. Higher = more detail, slower |
| Threshold | 0.1 -- 5.0 | Isosurface value. Lower = tighter surface around spheres |
| Wireframe Mode | edges / spiral | Display mode for the generated geometry |

### Spiral Wireframe Mode

When set to "spiral", the flow cloud extracts flow lines that spiral across the isosurface. This produces the distinctive Eastern cloud aesthetic.

| Setting | Description |
|---------|-------------|
| Num Flow Lines | Number of spiral flow lines (4--24) |
| Spiral Twist | Total twist radians from front to back |
| Show Flow Lines | Toggle visibility of flow lines |
| Generate Bands | Enable band ring extraction (requires Regenerate) |
| Show Bands | Toggle band visibility (only when generated) |

### Axis Gizmo

The **F** (front, blue) and **B** (back, red) draggable spheres define the flow direction for spiral wireframe extraction. Drag them to change the spiral orientation on the isosurface.

### Position

The flow cloud is a movable object. Drag its teal handle or use the Position X/Y/Z sliders in the panel to reposition it independently of the source spheres.

---

## Cut & Glue

Cut & Glue performs a boolean union of all primitives:

1. Each primitive's wireframe edges are collected
2. Each primitive's edges are clipped against every OTHER primitive's volume (per-primitive self-exclusion prevents a primitive from clipping itself)
3. The result is a single unified wireframe with clean seams at intersections

The output appears in **Preview mode** and is what gets exported via "Export Cloud GLB".

### Surface Mesh

Enable **Surface Mesh** in the Flow Cloud panel to generate a unified triangle mesh via SDF-based marching cubes. This evaluates the signed distance field of all solid primitives (spheres, base, tail, flow cloud, thick spirals) and produces a clean triangulated surface.

| Setting | Range | Description |
|---------|-------|-------------|
| Mesh Density | 32 / 64 / 128 / 256 | Resolution of the SDF marching cubes grid |

The surface mesh is displayed as a wireframe overlay in Preview mode.

---

## Export

The Export panel offers six export options:

| Button | Output | Use Case |
|--------|--------|----------|
| **Export JSON Preset** | `.json` file | Save/load presets, share configurations |
| **Export Cloud GLB** | `.glb` file | Unified wireframe from Cut & Glue -- **primary export for integration** |
| **Export Scaffold GLB** | `.glb` file | Sphere + base primitives only |
| **Export Wireframe GLB** | `.glb` file | Flow cloud + tail + spirals |
| **Export Both (Full)** | `.glb` file | All geometry combined |
| **Copy CloudLayer Snippet** | clipboard | Integration code for a Three.js scene |

### Recommended Export Workflow

For highest quality output:
1. Place and tune all primitives
2. Generate the flow cloud
3. Click Cut & Glue
4. Switch to Preview to verify
5. Click **Export Cloud GLB** -- this exports the unified boolean-union wireframe

---

## Tips & Troubleshooting

### Resolution vs Quality

- **Flow cloud resolution 32**: Fast preview, coarse surface. Good for quick iteration.
- **Flow cloud resolution 64**: Default. Good balance of quality and speed.
- **Flow cloud resolution 128**: High detail. Use for final exports.

### Thin Spirals and Surface Mesh

At very low spiral thickness values, the spiral cross-section may span fewer than 2 voxels in the SDF marching cubes grid. Increase the Mesh Density to 128 or 256 for thin spirals to appear in the surface mesh.

### Wireframe Density

Base and tail primitives have adjustable wireframe density via Ring/Length and Radial/Length segment sliders. Higher values produce denser wireframes in the Cut & Glue output. Start with defaults and increase if the unified wireframe looks too sparse.

### Performance

- Marching cubes and Cut & Glue run in web workers and do not block the UI
- Resolution 128+ may take a few seconds to compute
- SDF surface mesh at density 256 is computationally heavy -- use for final exports only

### Undo Limitations

The undo system captures preset state snapshots. It does not undo flow cloud regeneration or Cut & Glue operations (these are derived from the preset and can be re-run).
