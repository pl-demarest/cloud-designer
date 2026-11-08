# Cloud Designer

An interactive 3D wireframe cloud designer for sculpting Eastern-style auspicious cloud assets.
Built with React, three.js and TypeScript, it composes a cloud from parametric primitives, merges
their wireframes into one with Cut & Glue, and exports the result as a binary glTF (GLB) file for
three.js scenes.

It is the companion tool of [pl-demarest.github.io](https://github.com/pl-demarest/pl-demarest.github.io),
whose landing page draws the exported clouds as drifting wireframes
([the Cloud GLB](#the-cloud-glb-githublandings-input)).

## Features

- **Spheres**: spheres or ellipsoids, optionally only their upper dome, rotated, each with a
  metaball falloff for the flow cloud.
- **Base**: an oval or rectangular tube along a Catmull-Rom curve through draggable control points,
  open or closed.
- **Tail**: a tube of varying radius along its own curve, attachable anywhere along the base,
  measured from either end, with a twist of its wires at the tip (Curl).
- **Spirals**: golden (logarithmic) or Archimedean, as flat ribbons or as thick coils with rounded
  corners.
- **Flow cloud**: Regenerate builds a marching-cubes surface from the spheres' metaball field and
  draws it as crease edges, or as flow lines that spiral along an axis set by two draggable
  anchors, with optional bands across it.
- **Cut & Glue**: clips every wireframe against the other primitives' solids into one unified
  wireframe and, in the same run, meshes the union of all solids into one surface mesh.
- **Edit and Preview** modes: the scaffold with its handles, or the Cut & Glue result.
- **Undo and redo**: one step per edit, slider drag or viewport drag; Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
  and Ctrl/Cmd+Y.
- **Import** a JSON preset, from a file picker or by dropping it on the viewport; presets of every
  earlier version migrate.
- **Export** the preset as JSON, the Cloud, Scaffold, Wireframe and Full GLB files, and a
  copy-paste loader snippet for the landing page.
- **Autosave** to the browser's localStorage, restored on the next visit with a Discard option.
- The flow cloud, Cut & Glue and the surface mesh run in three Web Workers, on a geometry kernel
  (`src/geometry`) that also builds the editor's base, tail and spiral wireframes.
- Every toolbar and panel control can be reached and used from the keyboard and has an accessible
  name.

[docs/USAGE.md](docs/USAGE.md) describes every control.

## Getting started

Requirements: Node.js and npm (continuous integration uses Node 22), and Google Chrome for the
browser tests.

```bash
git clone https://github.com/pl-demarest/cloud-designer.git
cd cloud-designer
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check (`tsc -b`), then build for production into `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run typecheck` | Type-check the app, the tests and the configuration (`tsc -b`). |
| `npm run lint` | Run ESLint on the repository. |
| `npm test` | Run the Vitest suites once: unit, golden, parity and property tests. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:e2e` | Run the Playwright browser suite, screenshots included, with the system Chrome. |
| `npm run check` | Type-check, lint, test and build, the steps continuous integration runs. |
| `node scripts/bench.mjs [--runs 7] [--json file]` | Time the three worker cores on fixed cases and print the median, minimum and maximum. |

`.github/workflows/ci.yml` runs the type-check, lint, Vitest and the build on every push and pull
request (Ubuntu, Node 22). The browser suite runs locally only, because its screenshot baselines
are macOS renders. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#test-layers) describes the test
layers and how to update their baselines.

For GitHub Pages, `BASE_PATH=/cloud-designer/ npm run build` builds with that base path
(`vite.config.ts` reads `BASE_PATH`). `.github/workflows/deploy.yml` runs that build and deploys
`dist/`; it runs only when started by hand from the Actions tab.

## Tech stack

| Technology | Version | Role |
|---|---|---|
| Vite | 8 (Rolldown) | Dev server and production build; bundles each worker as its own chunk |
| React | 19 | The toolbar, panels and controls, rendered in StrictMode |
| TypeScript | 6 | Strict type-checking |
| three.js | r183 | Rendering, OrbitControls, GLB export (GLTFExporter, loaded on first export) |
| Zustand | 5 | The preset, history and UI stores, with selector subscriptions |
| Vitest | 5 | Unit, golden, parity and property tests (Node and happy-dom) |
| Playwright | 1.65 | Browser and screenshot tests in the system Chrome |

## Source tree

```
src/
├── main.tsx                     entry: restores the autosave, renders <App> in StrictMode
├── index.css                    every style of the editor
├── model/                       the preset data model; imports nothing outside model/
│   ├── types.ts                 CloudPreset and the primitive definitions, every field required
│   ├── defaults.ts              DEFAULT_PRESET, PRESET_VERSION (2), one factory per primitive
│   ├── normalize.ts             normalizePreset: any version or partial preset to a complete one
│   └── presetFile.ts            reading a preset from JSON, with the reason when it is refused
├── geometry/                    the kernel the workers run and the base, tail and spiral views draw from
│   ├── vec3.ts                  vector operations, computed as three.js's Vector3 does
│   ├── mat3.ts                  the Euler XYZ rotation matrix, as three.js's Matrix4 computes it
│   ├── catmullRom.ts            the Catmull-Rom curve with arc-length parametrisation (three r183)
│   ├── frames.ts                Frenet frames along a curve (three r183)
│   ├── path.ts                  points and frames at equal arc-length steps
│   ├── bounds.ts                boxes, the flow cloud's grid bounds, lower-bound slack
│   ├── arrayBuilder.ts          growable Float32Array and Uint32Array builders
│   ├── clip.ts                  clipping segment sets against an inside test (Cut & Glue)
│   ├── flowField.ts             the metaball field; bands and flow lines over the flow-cloud mesh
│   ├── marchingCubes/
│   │   ├── tables.ts            EDGE_PAIRS and TRI_TABLE (three.js's triTable)
│   │   └── polygonise.ts        the grid, the field fill, welded outward-facing marching cubes
│   └── primitives/
│       ├── sphere.ts            sphere frame, signed distance, inside test, metaball term
│       ├── base.ts              base curve and path, attachment point, BaseVolume
│       ├── tail.ts              attachment, width profile, tail path and spine, TailVolume
│       └── spiral.ts            spiral samples, the wire SpiralMesh draws, SpiralVolume
├── workers/
│   ├── protocol.ts              request and response types of the three workers
│   ├── core/                    each worker's computation, a pure function of its request
│   │   ├── flowCloud.ts         generateFlowCloud
│   │   ├── cutAndGlue.ts        cutAndGlue
│   │   └── surfaceMesh.ts       generateSurfaceMesh
│   ├── marchingCubes.worker.ts  the flow-cloud worker shell
│   ├── cutAndGlue.worker.ts     the Cut & Glue worker shell
│   └── surfaceMesh.worker.ts    the surface-mesh worker shell
├── engine/                      the editor's three.js side
│   ├── EditorEngine.ts          owns the viewport, views, drag controller and workers; dispose()
│   ├── useEditorEngine.ts       mounts one engine per canvas
│   ├── Viewport.ts              renderer, scene, camera, OrbitControls, scene groups, Fit
│   ├── DragController.ts        the one pointer pipeline for every drag handle
│   ├── WorkerClient.ts          a typed worker client: one request in flight, the latest wins
│   ├── workers.ts               the worker factory
│   ├── visibility.ts            computeVisibility: what the viewport shows
│   ├── materials.ts             one shared material per role
│   ├── KeyedMeshSet.ts          per-id objects for the sphere and spiral lists
│   ├── sameValue.ts             structural equality for preset data
│   └── views/
│       ├── SphereMesh.ts        sphere wireframes and handles
│       ├── BaseMesh.ts          the base wireframe and its control-point handles
│       ├── TailMesh.ts          the tail wireframe and its setpoint handles
│       ├── SpiralMesh.ts        spiral wireframes and handles
│       ├── FlowCloud.ts         the flow-cloud worker's result and its handle
│       ├── CutGlueResult.ts     the clipped wireframe and the surface mesh
│       └── AxisGizmo.ts         the F and B anchors of the flow-line axis
├── store/
│   ├── cloudStore.ts            the preset, its actions, history (commit, gestures, undo, redo)
│   ├── historyStore.ts          the snapshot stack (50 snapshots)
│   ├── uiStore.ts               view flags, worker job states, the notice
│   └── autosave.ts              the localStorage save and restore
├── ui/
│   ├── App.tsx                  the layout: toolbar, viewport, sidebar sections
│   ├── Toolbar.tsx              name, undo and redo, Edit and Preview, Axes, Grid, Fit, Reset
│   ├── ViewportArea.tsx         the viewport's frame, a drop target for preset files
│   ├── ViewportCanvas.tsx       the canvas the engine mounts on
│   ├── NoticeBar.tsx            the notice over the viewport
│   ├── EngineContext.ts         the engine's ref, for event handlers
│   ├── importPreset.ts          Import JSON: one undo step and a notice
│   ├── resetPreset.ts           Reset: asks, then one undo step
│   ├── shortcuts.ts             the undo and redo keys, and which targets keep their own
│   ├── controls/
│   │   ├── SliderRow.tsx        a labelled slider; each drag or key press is one undo step
│   │   ├── NumberField.tsx      a number input applied on Enter or blur, never NaN
│   │   ├── Vec3Field.tsx        three SliderRows for a vector
│   │   ├── vec3.ts              axis names and withAxis
│   │   ├── FieldRow.tsx         a label and a select or checkbox
│   │   ├── Accordion.tsx        a collapsible sidebar section
│   │   ├── ItemHeader.tsx       a list item's toggle and remove buttons
│   │   └── format.ts            degree and multiple-of-π formats
│   ├── hooks/
│   │   ├── useHistoryShortcuts.ts  the window listener for the undo and redo keys
│   │   └── useToggleSet.ts      a set of open items
│   └── panels/
│       ├── SpherePanel.tsx
│       ├── BasePanel.tsx
│       ├── TailPanel.tsx
│       ├── SpiralPanel.tsx
│       ├── FlowCloudPanel.tsx   flow cloud, Regenerate, Cut & Glue, surface mesh
│       └── ExportPanel.tsx      import and every export
└── export/
    ├── scenes.ts                the GLB scenes, built from copies without editor-only objects
    ├── glb.ts                   writeGlb: GLTFExporter, loaded on first use
    └── download.ts              downloadBlob and safeFileName
```

The tests live in `tests/`: `unit/`, `golden/` (with `__baselines__/`), `e2e/` (with the
screenshot baselines), `fixtures/` and `helpers/`. Benchmarks: `scripts/bench.mjs`.

In brief: the model defines the preset; the geometry kernel computes paths, volumes and meshes
from it without three.js; the workers run the kernel off the main thread; the engine draws the
preset with three.js and runs the worker jobs; the stores hold the preset, its history and the UI
state; the UI is React; export writes files. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers
the dependency rules, the data flow, the worker protocol, the kernel's invariants and the tests.

## The Cloud GLB (githubLanding's input)

The landing page's input is the file **Export Cloud GLB** writes (`cloudScene` in
`src/export/scenes.ts`):

- **When:** after a Cut & Glue run. The file holds that run's clipped wireframe, also when the
  preset has changed since; without a run the button refuses with an alert.
- **File name:** `<name>-cloud.glb`, where `<name>` is the cloud's name made safe (lower case,
  accents dropped, other characters replaced by `-`, at most 80 characters; `cloud` when nothing
  is left).
- **Content:** one root node named `cloud` holding exactly one `THREE.LineSegments`, a glTF mesh
  with one primitive of mode 1 (`LINES`). Its vertices are the clipped segments in pairs, in the
  editor's world coordinates and units.
- **Excluded:** drag handles, the F/B anchors, the grid and the axes helper (everything flagged
  `userData.editorOnly`), the unclipped scaffold, the surface mesh (no export writes it; the
  Surface Mesh checkbox does not change this file), and any triangle mesh.

githubLanding's `loadCloudLayer(scene, url, options)` (`src/scene/CloudLayer.ts` in that
repository) loads the file with `GLTFLoader` and merges every line primitive into one
`LineSegments` buffer: `LINES` as they are, `LINE_STRIP` and `LINE_LOOP` converted to segment
pairs. It ignores the file's material and rejects a file without lines. **Copy CloudLayer Snippet**
copies the call for the current name; for the default cloud it reads:

```typescript
import { loadCloudLayer } from './scene/CloudLayer';

// Put default-cloud-cloud.glb (Export Cloud GLB) in public/, then in your scene init:
const clouds = await loadCloudLayer(scene, `${import.meta.env.BASE_URL}default-cloud-cloud.glb`);

// In your animation loop:
clouds.update(deltaTime);
```

The Wireframe and Full GLB files also hold lines only: a spiral-mode flow cloud's flow lines as
`THREE.Line` (`LINE_STRIP`), everything else as `LineSegments`. `tests/e2e/export.spec.ts` pins
the Cloud GLB's node types: it loads the downloaded file with `GLTFLoader` and expects one
`LineSegments` under `cloud` and nothing editor-only.

## Documentation

- [docs/USAGE.md](docs/USAGE.md): every control, the keyboard shortcuts, import and export,
  autosave, and what Regenerate, Cut & Glue and the surface mesh produce.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the layers and their dependency rules, the data
  flow, the worker protocol, the kernel's invariants and the test layers.

## License

MIT
