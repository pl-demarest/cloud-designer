# Cloud Designer architecture

How the code is divided, how an edit travels from a control to the screen and to a worker, what
the workers exchange with the editor, which properties the geometry kernel keeps, and how the
tests pin all of it. The file tree is in the [README](../README.md#source-tree); what each control
does is in [USAGE.md](USAGE.md).

- [Layers and dependency rules](#layers-and-dependency-rules)
- [From a slider to the screen](#from-a-slider-to-the-screen)
- [From a button to a worker job](#from-a-button-to-a-worker-job)
- [Dragging, visibility and lifecycle](#dragging-visibility-and-lifecycle)
- [Worker protocol](#worker-protocol)
- [Kernel invariants](#kernel-invariants)
- [Test layers](#test-layers)

## Layers and dependency rules

| Layer | Folder | Holds | Imports from `src/` | Packages |
|---|---|---|---|---|
| Model | `src/model` | The preset types (`CloudPreset`, every field required), `DEFAULT_PRESET` and one factory per primitive, `normalizePreset`, and `presetFromJson` / `parsePresetJson` for files people supply | nothing | none |
| Geometry kernel | `src/geometry` | Vectors and rotations, the Catmull-Rom curve and Frenet frames, each primitive's path and volume, the metaball field and the flow lines, marching cubes, clipping, bounds | model (types) | none |
| Workers | `src/workers` | `protocol.ts` (message types), three pure cores in `core/`, three thin worker shells | model, geometry | none |
| Engine | `src/engine` | `EditorEngine`, which owns the `Viewport`, a view per primitive in `views/`, the `DragController` and a `WorkerClient` per worker | model, geometry, store, workers | three, zustand, react (only `useEditorEngine`) |
| Store | `src/store` | `cloudStore` (the preset, its actions, the history API), `historyStore` (the snapshot stack), `uiStore` (view flags, job states, the notice), `autosave` | model, four leaf modules of engine (below) | zustand |
| UI | `src/ui` | React components: `App`, `Toolbar`, the panels, the controls and hooks, import, reset and the keyboard shortcuts | model, geometry (`resolveTailSetpoints`, for Snap Back), store, engine, export | react, three (one type) |
| Export | `src/export` | The GLB scenes, the GLB writer, the download helper | nothing | three |

The rules the code follows today:

1. **The kernel, the workers and the model import nothing from three.js.** The editor's views and
   the workers run the same source, and the three worker chunks stay at 11 to 25 kB in the
   production build. Check: `grep -rn "from 'three" src/geometry src/workers src/model` prints
   nothing.
2. **A worker core is a pure function of its request.** `generateFlowCloud`, `cutAndGlue` and
   `generateSurfaceMesh` leave the request unchanged and return a new result; a shell adds only
   the message handling (`tests/unit/workerCores.test.ts`).
3. **The stores hold no three.js objects.** The preset is plain data. The store imports four
   modules of `src/engine` that import no store: `sameValue.ts`, and the types and constants of
   `WorkerClient.ts` (`JobState`, `IDLE_JOB`), `visibility.ts` (`ViewFlags`) and `workers.ts`
   (`WorkerKind`).
4. **three.js objects live in the engine**, and in `src/export`, which builds its scenes from
   copies of the engine's groups.
5. **The UI reaches the engine through `EngineContext`**, a ref that event handlers read; no
   component reads it while rendering. A panel rendered without the provider gets `null` and does
   nothing for engine actions (the unit tests render panels that way).
6. **`normalizePreset` is the one place defaults are filled in.** `cloudStore.loadPreset` passes
   every preset through it, so code past the store reads every field without a fallback.

ESLint does not enforce these rules; the grep in rule 1 and the import lists above are the check.

## From a slider to the screen

Take a sphere's Radius slider:

1. `SliderRow`'s input event calls the panel's `onChange`, which calls
   `cloudStore.updateSphere(id, { radius })`. Every action replaces the preset immutably: a new
   preset object, a new `spheres` array, a new object for that sphere, and every other branch
   shared with the old preset.
2. The store uses zustand's `subscribeWithSelector`. Each view subscribes to its slice:
   `SphereMesh` to `preset.spheres`, `BaseMesh` to `preset.base`, `TailMesh` to
   `[preset.tail, preset.base]` (shallow, because an attached tail starts on the base),
   `SpiralMesh` to `preset.spirals`, `FlowCloud` to `preset.flowCloud.wireframe` and `.position`,
   `AxisGizmo` to `preset.flowCloud.wireframe`. Only the listeners whose slice changed identity
   run.
3. A view compares the new definition with the one it shows by value (`sameValue`) and rebuilds
   only what changed: a radius change rebuilds that sphere's wire, a move sets the object's
   position, an unchanged sphere is skipped (`KeyedMeshSet` keeps one entry per id for the sphere
   and spiral lists). `tests/unit/viewRebuilds.test.ts` counts the rebuilds per action.
4. The viewport draws every animation frame (`renderer.setAnimationLoop`), so the new wire shows
   on the next frame. React components re-render through their own selectors.
5. History: the slider's `pointerdown` with the primary button takes the focus from any other
   field, then calls `beginGesture()`; the release (a `pointerup` or `pointercancel` on the
   window, the input's `lostpointercapture`, or a window `blur`, whichever comes first) calls
   `endGesture()`, which calls `commit()`, which pushes a snapshot onto `historyStore` unless it
   equals the newest one. The focus leaves first so that a field that records its edit on blur (a
   number field, the name) records it as a step of its own before the gesture opens. Step keys
   open a gesture from `keydown` to `keyup`; the native `change` event also commits, which
   records a change made by assistive technology. Discrete controls call `commit()` after their
   action.
6. Autosave: its subscription to `preset` writes to localStorage one second after the last change.

Generated geometry does not follow edits. The flow cloud, the clipped wireframe and the surface
mesh change only when their jobs run.

## From a button to a worker job

**Regenerate.**

1. The Flow Cloud panel calls `engine.regenerate()`, which waits 50 ms for further calls (each one
   restarts the wait; a replaced call resolves `superseded`), then reads `spheres`, `base`, `tail`
   and `flowCloud` from the store and calls `flowCloudJob.request(...)`.
2. The `WorkerClient` gives the request the next id. With no request in flight it posts the
   message; otherwise the request waits, replacing any request already waiting. It sets
   `uiStore.jobs.flowCloud` to `running` with the new id.
3. The worker shell `src/workers/marchingCubes.worker.ts` (the flow-cloud worker) calls
   `generateFlowCloud` and posts the result with every buffer in the transfer list, or `{ error }`.
4. The client takes the reply. If a newer request is waiting, the reply is stale: it is dropped and
   the waiting request is posted. An `{ error }` reply sets the job to `failed` with its message.
   Otherwise `onResult` runs: `FlowCloud.show(result)` replaces the shown geometry (drawn in the
   wireframe mode current at that moment) and the engine keeps the request as `shownFlowCloud`.
   The job becomes `done`.
5. The panel reads `uiStore.jobs.flowCloud`: "Working..." while it runs, the error text when it
   failed.

**Cut & Glue.**

1. `engine.cutAndGlue()` collects the views' wires in world coordinates:
   `spheres.getEdgesGrouped()` (one buffer per sphere, for self-exclusion), `base.getEdges()`,
   `tail.getEdges()`, `spirals.getEdges()`, and `flowCloud.getEdges()`, which takes only visible
   objects and expands each `THREE.Line` polyline into segment pairs.
2. It sends two requests at once: a `CutGlueRequest` to the Cut & Glue worker and a
   `SurfaceMeshRequest` to the surface-mesh worker, with `includeFlowCloud` (Show/Hide shows the
   flow cloud and one has been generated) and `flowCloudInput` (`shownFlowCloud`).
3. The results go to `CutGlueResult`: `update(clippedEdges)` for the wireframe,
   `updateSurfaceMesh(positions, indices)` for the mesh, and `uiStore.hasSurfaceMesh`, which
   enables the Surface Mesh checkbox.

## Dragging, visibility and lifecycle

**Dragging.** Every view that has handles is a `DragSource` registered with the one
`DragController`. On `pointerdown` it takes the focus from any field (as the browser does a moment
later), so a number field or the name records its edit before a drag's gesture opens. It then
raycasts the handles that are visible with all their ancestors (three's raycaster ignores
visibility) and takes the nearest hit, passing over the flow-cloud handle (a source with
`yieldsPress`) when another handle is under the pointer. Only a primary-button press is
considered; the others go to OrbitControls. It drags the item on the plane through the hit point
that faces the camera, keeping the grab offset; it disables OrbitControls, captures the pointer
and calls `beginGesture()`. Each `pointermove` calls the item's `moveTo`, which calls a store
action. `pointerup` (on the canvas or the window), `pointercancel`, `lostpointercapture` and a
window `blur` end the drag, enable OrbitControls again and call `endGesture()`, so a drag that
moved something is one undo step.

**Visibility.** `computeVisibility` (`src/engine/visibility.ts`) is a pure function from the view
flags in `uiStore` (mode, Axes, Grid, Show/Hide, Surface Mesh) and whether any spiral is flat, to
the visibility of each scene group. `EditorEngine.applyVisibility()` applies it whenever a flag or
the spiral list changes, and nothing else sets the visibility of the viewport's groups. Inside the
flow cloud's group, Show Bands and Show Flow Lines hide or show the bands and the flow lines.

**Lifecycle.** `useEditorEngine` builds one `EditorEngine` per canvas in a layout effect whose
cleanup calls `dispose()`. A layout effect, because OrbitControls removes its keydown listener from
`canvas.getRootNode()`, which is the document only while the canvas is attached. `dispose()`
releases everything the constructor acquired, in this order: the resize observer, the store
subscriptions, the drag controller's listeners, each view's geometries and textures, the three
workers (terminated), and the viewport's render loop, controls, helpers, lights, shared materials
and renderer; it then resets the job states in `uiStore`. The app renders in `React.StrictMode`,
whose second mount must find nothing left over (`tests/unit/engineLifecycle.test.tsx` counts
geometries, materials, textures, workers and listeners). The second renderer gets the canvas's
WebGL context back, so the viewport also resets the two unpack flags three's texture uploads set. The views draw with one material per
role (`src/engine/materials.ts`), owned and disposed by the viewport.

## Worker protocol

`src/workers/protocol.ts` defines the messages. Every response is the result type or
`WorkerError`, `{ error: string }`.

| Worker shell | Request | Result | Transferred |
|---|---|---|---|
| `marchingCubes.worker.ts` (flow cloud) | `FlowCloudRequest`: `spheres`, `base`, `tail`, `flowCloud` | `FlowCloudResult`: `vertices`, `indices`, `bands[]`, `flowLines[]` | every buffer |
| `surfaceMesh.worker.ts` | `SurfaceMeshRequest`: `spheres`, `base`, `tail`, `flowCloud`, `spirals`, `resolution`, `includeFlowCloud`, `flowCloudInput` | `SurfaceMeshResult`: `positions`, `indices` | both buffers |
| `cutAndGlue.worker.ts` | `CutGlueRequest`: `spheres`, `base`, `tail`, `sphereEdgeGroups[]` (`sphereId`, `edges`), `baseEdges`, `tailEdges`, `spiralEdges`, `flowCloudEdges` | `CutGlueResult`: `clippedEdges` | the buffer |

Conventions:

- Edge buffers are `Float32Array`s of world-space segments as `x,y,z,x,y,z` pairs. Meshes are
  `Float32Array` positions (three per vertex) and `Uint32Array` indices (three per triangle,
  counter-clockwise seen from outside). `bands` holds one array of segment pairs per contour
  level; `flowLines` one polyline (three floats per point) per connected piece of a line, from low
  to high u.
- Requests carry the preset's own definitions; `postMessage` copies them. The cores resolve an
  attached tail against the base themselves (`attachedTail`).
- `SurfaceMeshRequest.flowCloud` is the live settings, whose `position` places the flow cloud;
  `flowCloudInput` is the request of the Regenerate whose result the viewport shows, or `null`, and
  the core evaluates the flow cloud's field from it, so the union holds the flow cloud on screen.
- A worker answers each message with one reply, in order. The request ids live in `WorkerClient`,
  not in the messages: with one request in flight per worker, the next reply belongs to it.
- **Latest wins.** At most one request is in flight and one waiting per worker. A new request
  replaces the waiting one, which resolves `superseded`; a reply that arrives while a newer request
  waits is dropped. Each `request()` resolves with `{ status: 'done', result }`,
  `{ status: 'failed', error }` or `{ status: 'superseded' }`.
- **Errors.** Each shell catches what its core throws and replies `{ error: String(err) }`. The
  client also turns the worker's `error` event into a failed job: the flow-cloud shell reads the
  message's fields outside its `try`, so a `null` or `undefined` message reaches that path. An
  error reply is logged with `console.error`, and the failure is kept in `uiStore.jobs[kind]`
  until the next request.
- The worker goldens record each result's keys and transfer list, so a change to a message's shape
  shows in `tests/golden/__baselines__/worker-*.json`.

## Kernel invariants

1. **Base and tail have one implementation each.** `BaseMesh` and `TailMesh` draw their rings from
   `sampleBasePath` and `sampleTailPath`; the cores build `BaseVolume` and `TailVolume` from the
   same samples (same segment count, ring centres, Frenet frames and widths), joined by straight
   pieces as the wire's lengthwise lines are. `resolveTailSetpoints` attaches the tail for
   `TailMesh` and all three cores; `basePointAt` serves `BaseMesh.getPointAt` and the attachment.
   `tests/unit/workerParity.test.ts` reads the real views and checks that points 5 % inside the
   drawn rings are inside the workers' volumes and points 5 % outside are outside.
2. **Spheres reproduce the drawn transform.** `SphereMesh` draws three.js's `SphereGeometry`
   (12 × 8 segments; the upper half for Half; scaled for an ellipsoid) with the object's position
   and rotation. `primitives/sphere.ts` takes a point into that frame with `eulerXYZ`
   (`src/geometry/mat3.ts`), which computes `Matrix4.makeRotationFromEuler`'s terms in the same
   order and equals three's matrix to the bit on 1,000 random angle triples
   (`tests/unit/sphereFrame.test.ts`). `sphereSDF` and `insideSphere` use the geometric radius;
   `sphereFieldTerm`, the metaball term, uses the falloff and counts the whole sphere, half or not.
3. **Spirals are sampled once.** `sampleSpiral` (`primitives/spiral.ts`) samples every spiral's
   path, flat or thick, at `SPIRAL_SAMPLES_PER_TURN` (64) samples per turn: each sample in the
   spiral's own frame (path point, radial direction, separation) and in world space (the
   section's centre and radial direction, its half-sizes, and its corner radius, which is 0, a
   sharp corner, below `MIN_CORNER_RADIUS`, 0.001). `SpiralMesh` draws `spiralWire(def, samples)`,
   and the surface-mesh core builds a thick spiral's volume from the same samples. Both place
   points with `eulerXYZ` and the operations of three's `Vector3.applyMatrix4` and `add`, so the
   wire equals, bit for bit, the one three's `Matrix4.makeRotationFromEuler` gives
   (`tests/unit/spiralParity.test.ts`, 12 rotations, flat and thick). The volume sweeps its
   rounded-rectangle section at right angles to the smoothed tangent, while a drawn ring lies in
   the plane of the radial direction and the spiral's axis, so the two agree within a tolerance:
   at the default proportions (thickness 0.15) points 5 % inside the drawn rings are inside the
   volume and points 5 % outside are outside, and the drawn ring vertices lie up to 0.003 off the
   volume's surface (0.024 at thickness 0.3, 0.054 at 0.6).
4. **The curve port equals three.js r183 to the bit, except on open two-point curves.**
   `CatmullRomCurve` (`catmullRom.ts`) and `computeFrenetFrames` (`frames.ts`) port
   `CatmullRomCurve3` (curve type `'catmullrom'`, tension 0.5), `Curve`'s arc-length table
   (200 divisions), `getUtoTmapping`, `getTangent` (step 0.0001) and `computeFrenetFrames`
   operation for operation, including additions of zero that turn −0 into 0.
   `tests/unit/kernelProperties.test.ts` compares every component with `Object.is` against fresh
   three.js curves: open and closed curves of three or more points, the closed two-point curve,
   and edge cases (coincident points, zero length, a curve that doubles back, signed zeros). The
   open two-point curve differs on purpose: three keeps both phantom end points in one module-level
   vector, so the second overwrites the first and the curve leaves P0 backwards; the port gives
   each end its own phantom point, and the curve is the straight segment from P0 to P1.
5. **Volumes are prepared once per job.** `sphereFrame`, `buildBaseVolume`, `buildTailVolume` and
   `buildSpiralVolume` pack what the distance functions need into typed arrays; the functions that
   run at every grid node read those arrays.
6. **Lower bounds never change a result.** `baseSDF`, `tailSDF` and `spiralSDF` take a `cap`. A
   piece, a segment or the whole primitive is skipped only when its lower bound exceeds the smaller
   of `cap` and the minimum so far by more than `BOUND_SLACK` (1e-9). The result is exact wherever
   the exact value is below `cap`, so `min(cap, result)` equals `min(cap, exact)`, and the
   surface-mesh union does not depend on the skips (`tests/unit/sdfBounds.test.ts`).
7. **Marching cubes is welded and faces outward.** `TRI_TABLE` is three.js's `triTable` row by row,
   and a unit test asserts it. `polygonise` gives each crossed grid edge one vertex, shared by every
   cube that uses the edge, and winds triangles counter-clockwise seen from outside.
   `tests/unit/kernelProperties.test.ts` checks, for the flow-cloud and surface meshes of the
   default preset and 60 random ones, that every edge lies in two triangles traversed in opposite
   directions, that the enclosed volume is positive and that every position is finite. The grid
   divides each axis of the padded box into `res` cells, so cells are boxes, not cubes.
8. **The flow cloud's grid holds its whole surface.** With n field terms, `expandFlowCloudBounds`
   pads each sphere's centre by r·s·√(n·falloff / threshold), r its radius and s its largest scale
   for an ellipsoid (1 for a sphere), and at least by r times its largest scale plus 1.5; when
   `tailStrength` > 0 it pads each tail spine sample by w·√(n·tailStrength / threshold), w the
   width there (`tests/unit/gridBounds.test.ts`, at the sliders' limits).
9. **Presets are normalized at the store's door.** Import, the autosave restore, undo and redo
   all go through `loadPreset`, which stores `normalizePreset(raw)`: version 2, every field set,
   counts rounded into their sliders' ranges (`COUNT_RANGES`), resolutions taken from the offered
   lists, sizes at least `MIN_DIMENSION` (0.001). `normalizePreset` is idempotent
   (`kernelProperties.test.ts`: 3,000 mutated presets, the fixtures and two old exports), and
   `tests/unit/presetLimits.test.tsx` reads the panels to hold `COUNT_RANGES` and the resolution
   lists equal to the controls.

## Test layers

| Layer | Files | What it pins |
|---|---|---|
| Goldens | `tests/golden/workers.test.ts`, `tests/golden/editor.test.ts`; baselines in `tests/golden/__baselines__/` (8 suites) | Every output of the three workers for the 12 fixture presets of `tests/fixtures/presets.ts`, each view's wireframe and scene graph, the Cut & Glue worker fed with the views' real edge buffers, the `CutGlueResult` scene, and the workers' error replies. Arrays are stored as digests (`tests/helpers/digest.ts`): type, length, NaN and infinity counts, min, max, sum, sum of squares and a SHA-256 of the bytes. The worker shells run in-process (`tests/helpers/workerHarness.ts`). |
| Parity | `tests/unit/workerParity.test.ts`, `tests/unit/spiralParity.test.ts`, `tests/unit/workerCores.test.ts` | The workers' base, tail, sphere and spiral volumes against what the views draw, and the spiral wire against three.js's rotation; the cores' purity, and that each shell posts its core's result. |
| Properties | `tests/unit/kernelProperties.test.ts` | Seeded random inputs checked against references that do not share the kernel's code: three.js for rotations, curves and frames (bit for bit), mesh invariants (closed, outward, finite) for marching cubes, step bounds for the flow lines, idempotence and two old exports (`tests/fixtures/exports/`) for `normalizePreset`. |
| Kernel and model | `baseVolume`, `tailProfile`, `sphereFrame`, `sdfBounds`, `gridBounds`, `marchingCubes`, `flowField`, `clip`, `normalizePreset`, `presetFile` and `presetLimits` in `tests/unit/` | Each kernel module on its own (volumes, the width profile, lower bounds, grid bounds, meshing, level sets, clipping), and the preset's normalization, file reading and limits. |
| Behaviour | the other files in `tests/unit/` | The stores and the history API, the controls, shortcuts, import, autosave, export, the engine's lifecycle, jobs, drag and visibility, `WorkerClient`, resource leaks and view rebuilds. The `knownBugs.*` files started as expected failures (`it.fails`) asserting the correct behaviour; each fix commit flipped its test to `it`, and none is left. |
| Net gaps | `tests/unit/net-gaps/*.test.ts(x)` with Vitest snapshots in `__snapshots__/`; `tests/e2e/net-gaps/mode.spec.ts` | Behaviour that mutation testing found unpinned, among it every panel control's store mapping, worker branches the fixtures miss, each view's drag and Fit. The expectations pin today's behaviour; one that pins a defect changes in the commit that fixes it. |
| Browser | `tests/e2e/*.spec.ts` (Playwright) | The app in Chrome: boot without console errors or deprecation warnings, every panel, Regenerate, Cut & Glue, Preview, undo and redo by button and key, drags, import, export (the GLB files parsed and loaded with `GLTFLoader`), autosave, and keyboard-only use. Every test fails on an uncaught page error or a `console.error` (`tests/e2e/helpers.ts`). |
| Screenshots | `tests/e2e/visual.spec.ts`; 12 baselines in `tests/e2e/visual.spec.ts-snapshots/` | The canvas and the full page at 1280 × 800 in six states: initial, after Regenerate, Preview after Cut & Glue, Preview with the surface mesh, a thick spiral, and a thick spiral in the surface mesh. Threshold 0.1, `maxDiffPixelRatio` 0.002. |

### Running them

- `CI=1 npm run check` runs the type-check, ESLint, Vitest and the production build. With `CI` set,
  Vitest fails on a missing snapshot instead of writing it; continuous integration
  (`.github/workflows/ci.yml`, Ubuntu, Node 22) runs the same four steps.
- `npx playwright test` (or `npm run test:e2e`) runs the browser suite with the system Chrome
  (`channel: 'chrome'`, no browser download), headless, one worker, against a Vite server on
  `127.0.0.1:5174`. Without `CI` it reuses a server already listening on that port, so make sure
  nothing else listens there. The screenshot baselines are macOS renders (`*-darwin.png`), so the
  browser suite runs locally, not in CI.
- `node scripts/bench.mjs [--runs 7] [--json file]` times the three cores on the default preset at
  resolution 64, the thick-spiral fixture at 64 and the default at 128 (median, minimum and maximum
  of `--runs` runs after one warm-up). It loads the TypeScript through Vite's SSR loader, as Vitest
  does, where each read of an imported binding goes through a getter, so a hot loop that reads an
  imported constant can time slower than in the production bundle.

### Changing a baseline deliberately

A refactor or performance commit changes no baseline. A fix or feature commit changes only the
baselines it must, says in its message which behaviour changed, and gives the before and after
numbers.

- **Goldens:** `UPDATE_GOLDENS=1 npx vitest run tests/golden` rewrites the suites' JSON files. Then
  `git diff tests/golden/__baselines__` and confirm that only the intended entries changed. In the
  normal run a missing entry fails.
- **Snapshots** (net gaps): `npx vitest run -u <test file>`, then `git diff` the `.snap` file.
  Change an expectation that pins a defect only in the commit that fixes it.
- **Screenshots:** `npx playwright test tests/e2e/visual.spec.ts --update-snapshots` rewrites the
  baselines that fail; `--update-snapshots=all` rewrites every one, also those that changed within
  tolerance. Do it only in a commit whose change is visible, and say in its body why the pictures
  changed and by how many pixels.
- **Expected failures:** a defect found before its fix is pinned as `it.fails` (Vitest) or
  `test.fail` (Playwright) asserting the correct behaviour. The fix commit flips it to a plain
  test, so the commit carries the test that failed before it.
