# Cloud Designer

An interactive 3D wireframe cloud designer for sculpting Eastern-style auspicious cloud assets. Built with React, Three.js, and TypeScript, this tool lets you visually compose wireframe cloud shapes from parametric primitives, merge them into unified surfaces, and export the results as GLB or JSON for use in web-based Three.js scenes.

Designed as a companion tool for [pl-demarest.github.io](https://github.com/pl-demarest/pl-demarest.github.io), where the exported clouds drift across the portfolio page as decorative wireframe elements.

## Features

- **Sphere primitives** -- metaball hemispheres with adjustable radius, falloff, shape (sphere/ellipsoid), rotation, and half-mode
- **Base spline** -- extruded CatmullRom curve with oval or rectangular cross-section, draggable control points
- **Variable-radius tail** -- tube geometry along CatmullRom setpoints with end-curl and base attachment
- **Spiral primitives** -- golden (logarithmic) or Archimedean ribbon geometry, flat or thickened rectangular cross-section with corner rounding
- **Flow cloud generation** -- marching cubes isosurface with spiral wireframe extraction, off-main-thread via web worker
- **Cut & Glue** -- boolean union of all primitives into a single unified wireframe with per-primitive self-exclusion clipping
- **SDF surface mesh** -- unified marching cubes mesh across all solid primitives (spheres, base, tail, flow cloud, thick spirals)
- **Undo/redo** -- snapshot-based history stack (Ctrl+Z / Ctrl+Shift+Z)
- **Multiple export formats** -- JSON preset, Cloud GLB (unified wireframe), Scaffold GLB, Wireframe GLB, Full GLB
- **Live preview mode** -- toggle between edit and preview to see the final wireframe without handles or grid
- **Drag handles** -- color-coded per primitive type (blue/green/red/orange/teal) with shared drag mutex

## Getting Started

```bash
git clone https://github.com/pl-demarest/cloud-designer.git
cd cloud-designer
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build     # TypeScript check + production build
npm run preview   # Preview the production build locally
```

## Tech Stack

| Technology | Version | Role |
|------------|---------|------|
| Vite | 8 (Rolldown) | Build tool and dev server |
| React | 19 | UI components and panels |
| TypeScript | 6 | Type safety |
| Three.js | r183 | 3D rendering, geometry, export |
| Zustand | 5 | State management with selector subscriptions |

## Architecture

```
src/
├── types/cloud.ts              -- CloudPreset data model + defaults
├── three/                      -- Three.js scene modules
│   ├── Viewport.ts             -- Scene, camera, OrbitControls, scene groups
│   ├── SphereMesh.ts           -- Metaball sphere wireframes + drag handles
│   ├── BaseMesh.ts             -- Extruded spline + dense wireframe grid
│   ├── TailMesh.ts             -- Variable-radius tube + dense wireframe grid
│   ├── SpiralMesh.ts           -- Flat ribbon or thickened coil geometry
│   ├── FlowCloud.ts            -- Marching cubes orchestration + flow lines
│   ├── CutGlueResult.ts        -- Unified clipped wireframe + surface mesh
│   └── AxisGizmo.ts            -- F/B draggable axis anchors
├── workers/                    -- Off-main-thread computation
│   ├── marchingCubes.worker.ts -- Isosurface + spiral wireframe extraction
│   ├── cutAndGlue.worker.ts    -- Per-primitive self-exclusion edge clipping
│   └── surfaceMesh.worker.ts   -- SDF-based marching cubes surface mesh
├── components/                 -- React UI panels
│   ├── App.tsx                 -- Root layout, worker dispatch
│   ├── Toolbar.tsx             -- Mode toggle, undo/redo, viewport controls
│   ├── SpherePanel.tsx         -- Per-sphere accordion controls
│   ├── BasePanel.tsx           -- Base spline controls + wireframe density
│   ├── TailPanel.tsx           -- Tail setpoints + curl + attachment
│   ├── SpiralPanel.tsx         -- Per-spiral accordion controls
│   ├── FlowCloudPanel.tsx      -- Flow cloud settings, Cut & Glue, surface mesh
│   ├── ExportPanel.tsx         -- All export options
│   └── ui/SliderRow.tsx        -- Reusable labeled slider component
├── store/
│   ├── cloudStore.ts           -- Zustand store for CloudPreset CRUD
│   └── historyStore.ts         -- Undo/redo snapshot stack
└── export/
    └── presetExporter.ts       -- JSON preset download
```

### Key Design Patterns

- **Zustand subscriptions**: Each Three.js module subscribes to its relevant store slice and reactively syncs geometry
- **Web workers**: Heavy computation (marching cubes, edge clipping, SDF evaluation) runs off the main thread
- **Drag mutex**: All draggable handles share a `claimDrag()/releaseDrag()` mutex on the Viewport to prevent conflicts
- **Scene groups**: 8 named groups in the Viewport with mode-dependent visibility (edit vs preview)

## Export Formats

| Format | Description |
|--------|-------------|
| **JSON Preset** | Full `CloudPreset` object -- can be loaded back into the editor |
| **Cloud GLB** | Unified wireframe from Cut & Glue (the primary export for integration) |
| **Scaffold GLB** | Sphere + base primitives only |
| **Wireframe GLB** | Flow cloud isosurface + tail + spirals |
| **Full GLB** | Everything combined |
| **CloudLayer Snippet** | Copy-paste code for integrating the preset into a Three.js scene |

## Integration

The exported JSON preset or GLB is consumed by a `CloudLayer` class in the companion portfolio site:

```typescript
import { CloudLayer } from './scene/CloudLayer';
import cloudPreset from './cloud-preset.json';

const cloudLayer = new CloudLayer(cloudPreset, scene);
// In animation loop:
cloudLayer.update(deltaTime);
```

## Usage

See [docs/USAGE.md](docs/USAGE.md) for the full functional manual covering UI layout, controls, workflow, and tips.

## License

MIT
