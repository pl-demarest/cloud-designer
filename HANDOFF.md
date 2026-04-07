# Cloud Designer — Handoff Document

**Status:** All phases complete (Phases 1–5)
**Build:** `npm run build` passes, `tsc --noEmit` passes

---

## Project Structure

```
src/
├── types/cloud.ts          — Shared data model (CloudPreset + all sub-types + DEFAULT_PRESET)
├── three/
│   ├── Viewport.ts         — Three.js scene, camera, OrbitControls, scene groups
│   ├── SwirlMesh.ts        — Per-swirl wireframe spheres + drag handles (blue boxes)
│   ├── BaseMesh.ts         — Extruded spline base mesh + drag handles (green spheres)
│   ├── TailMesh.ts         — Variable-radius tube along CatmullRom spline + drag handles (red spheres)
│   ├── MergedCloud.ts      — Orchestrates marching cubes worker + renders result
│   └── AxisGizmo.ts        — Draggable F/B axis anchors for spiral wireframe direction
├── workers/
│   └── marchingCubes.worker.ts  — Off-main-thread marching cubes + spiral extraction
├── components/
│   ├── App.tsx             — Root layout: instantiates all Three.js modules on viewport ready
│   ├── ViewportCanvas.tsx  — Canvas wrapper with ResizeObserver
│   ├── Toolbar.tsx         — Mode toggle, undo/redo, viewport controls
│   ├── SwirlPanel.tsx      — Per-swirl accordion rows
│   ├── BasePanel.tsx       — Base spline control points + cross-section settings
│   ├── TailPanel.tsx       — Tail setpoints + curl + attachment
│   ├── MergePanel.tsx      — Resolution, threshold, wireframe mode, spiral params
│   ├── ExportPanel.tsx     — GLB, JSON preset, CloudLayer snippet export
│   └── ui/SliderRow.tsx    — Reusable labeled slider component
├── store/
│   ├── cloudStore.ts       — Zustand store for CloudPreset state
│   └── historyStore.ts     — Undo/redo via snapshot stack (Ctrl+Z / Ctrl+Shift+Z)
└── export/
    └── presetExporter.ts   — Download preset JSON utility
```

---

## Store API

```typescript
import { useCloudStore } from './store/cloudStore';

// Read
const preset = useCloudStore(s => s.preset);

// Swirls
addSwirl()                                    // add new swirl at end
updateSwirl(id, patch)                        // partial update
removeSwirl(id)
reorderSwirls(fromIdx, toIdx)

// Base
setBase(patch)
addBasePoint()
removeBasePoint(idx)
updateBasePoint(idx, pos)

// Tail
setTail(patch)
addTailSetpoint(afterIdx?)
removeTailSetpoint(id)
updateTailSetpoint(id, { position?, width? })

// Merge / wireframe
setMerge(patch)                               // patch is Partial<MergeSettings>

// Presets
loadPreset(preset)
resetToDefault()
setPresetName(name)
```

---

## Scene Groups (Viewport)

| Group | Name | Contents |
|---|---|---|
| `viewport.swirlGroup` | `'swirlGroup'` | WireframeGeometry sphere per swirl + blue box handles |
| `viewport.baseGroup` | `'baseGroup'` | ExtrudeGeometry edges + green sphere handles |
| `viewport.tailGroup` | `'tailGroup'` | Variable-radius tube edges + red sphere handles |
| `viewport.mergeGroup` | `'mergeGroup'` | Marching cubes output (edges or spiral lines) |
| `viewport.gizmoGroup` | `'gizmoGroup'` | F/B axis gizmo handles + ArrowHelper |

All visible in **Edit** mode; only `mergeGroup` visible in **Preview** mode.

---

## Worker Protocol

**Post to worker:**
```typescript
{ swirls: SwirlDef[], base: BaseDef, tail: TailDef, merge: MergeSettings }
```

**Worker responds:**
```typescript
{
  vertices: Float32Array,   // raw mesh vertices (x,y,z interleaved)
  indices: Uint32Array,     // triangle indices
  bands: Float32Array[],    // one Float32Array per band ring (x,y,z pairs — segments, not loop)
  flowLines: Float32Array[] // one Float32Array per flow line (x,y,z sequence)
}
```

Trigger via `mergedCloud.regenerate()` — debounced 50ms, runs off-main-thread.

---

## githubLanding Integration

**File:** `githubLanding/src/scene/CloudLayer.ts`

```typescript
import { CloudLayer } from './scene/CloudLayer';
// Optionally load from JSON preset:
import cloudPreset from '../../public/cloud-preset.json';

const clouds = new CloudLayer(cloudPreset, sm.scene, {
  count: 3,
  baselineY: -3,
  spread: 14,
  speed: 0.4,
});

sm.onTick(dt => clouds.update(dt));
```

Options: `count`, `baselineY`, `spread`, `speed`, `oscAmp`, `oscPeriod`, `scale`.

For highest fidelity: export a GLB from cloud-designer and load it with `GLTFLoader`.

---

## Vite/Rolldown Note

This project uses Vite 8 + Rolldown. **All TypeScript interface imports must use `import type`** — regular `import { MyInterface }` from a type-only source will fail at build time. See all `*.ts` files for the pattern.

---

## Known Limitations / TODOs

- Marching cubes triTable is truncated mid-table (abbreviated for brevity). Full 256×16 table needed for production — replace with the standard Lorensen & Cline table.
- Base and tail geometry are not yet fed into the marching cubes scalar field (only swirls are); full SDF blend is the next step.
- Laplacian smoothing in worker is a pass-through stub; replace with real adjacency-based smoothing.
- The flow-line extraction produces segment lists, not chain-sorted polylines, so individual Line objects per segment may be numerous. Chain into polylines for better performance.
