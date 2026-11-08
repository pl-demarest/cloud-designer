/**
 * Times the three worker cores (src/workers/core) on fixed cases and prints the median of
 * several runs.
 *
 *   node scripts/bench.mjs [--runs 7] [--json results.json]
 *
 * Cases: the default preset at resolution 64, the thick-spiral fixture (tests/fixtures/presets.ts)
 * at 64, and the default preset at 128. "Resolution" sets both flowCloud.resolution and
 * surfaceMeshResolution. Each core gets its request exactly as the app builds it (the fixture
 * message builders). The cut-and-glue request carries the edges the editor modules (SphereMesh,
 * BaseMesh, TailMesh, SpiralMesh, FlowCloud after Regenerate) hand to EditorEngine.cutAndGlue, so its
 * flow-cloud edges come from the flow cloud at the case's resolution.
 *
 * Each core runs once untimed (warm-up), then --runs times (default 7) back to back; the table
 * gives the median, minimum and maximum wall time of the core call alone, measured with
 * performance.now(). The modules load through Vite's SSR loader, so the TypeScript sources run as
 * the dev server would serve them. No DOM: the editor modules get a viewport stub and an EventTarget
 * for the canvas and the window; FlowCloud shows the flow-cloud core's result, run in-process.
 */

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

const RUNS = Number(option('runs', '7'))
const JSON_OUT = option('json', null)
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs must be a positive integer, got ${RUNS}`)

// The editor modules listen on the canvas and the window; the bench never dispatches events.
globalThis.window ??= new EventTarget()

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
})

try {
  const load = (path) => server.ssrLoadModule(path)
  const THREE = await import('three')
  const { FIXTURES, marchingCubesMessage, surfaceMeshMessage, cutAndGlueMessage } = await load('/tests/fixtures/presets.ts')
  const { generateFlowCloud } = await load('/src/workers/core/flowCloud.ts')
  const { generateSurfaceMesh } = await load('/src/workers/core/surfaceMesh.ts')
  const { cutAndGlue } = await load('/src/workers/core/cutAndGlue.ts')
  const { useCloudStore } = await load('/src/store/cloudStore.ts')
  const { SphereMesh } = await load('/src/engine/views/SphereMesh.ts')
  const { BaseMesh } = await load('/src/engine/views/BaseMesh.ts')
  const { TailMesh } = await load('/src/engine/views/TailMesh.ts')
  const { SpiralMesh } = await load('/src/engine/views/SpiralMesh.ts')
  const { FlowCloud } = await load('/src/engine/views/FlowCloud.ts')
  const { createEditorMaterials } = await load('/src/engine/materials.ts')

  /** The groups and fields of Viewport that the editor modules touch (tests/helpers/scene.ts). */
  function viewportStub() {
    const scene = new THREE.Scene()
    const named = (name) => Object.assign(new THREE.Group(), { name })
    const activeUnitGroup = named('activeUnitGroup')
    const groups = {
      sphereGroup: named('sphereGroup'),
      baseGroup: named('baseGroup'),
      tailGroup: named('tailGroup'),
      spiralGroup: named('spiralGroup'),
      flowCloudGroup: named('flowCloudGroup'),
      gizmoGroup: named('gizmoGroup'),
    }
    scene.add(activeUnitGroup)
    activeUnitGroup.add(...Object.values(groups))
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000)
    camera.position.set(0, 4, 10)
    camera.lookAt(0, 0, 0)
    return {
      scene,
      camera,
      activeUnitGroup,
      ...groups,
      cutGlueGroup: named('cutGlueGroup'),
      renderer: { domElement: new EventTarget() },
      materials: createEditorMaterials(),
      controls: { enabled: true },
    }
  }

  /** The Cut & Glue request EditorEngine.cutAndGlue posts after a Regenerate. */
  async function cutAndGlueRequest(preset) {
    useCloudStore.getState().loadPreset(preset)
    const vp = viewportStub()
    const sphere = new SphereMesh(vp)
    const base = new BaseMesh(vp)
    const tail = new TailMesh(vp)
    const spiral = new SpiralMesh(vp)
    // Regenerate: the flow-cloud core's result for the request EditorEngine.regenerate builds.
    const p = useCloudStore.getState().preset
    const flowCloud = new FlowCloud(vp)
    flowCloud.show(generateFlowCloud(structuredClone({ spheres: p.spheres, base: p.base, tail: p.tail, flowCloud: p.flowCloud })), p.flowCloud.wireframe.mode)
    const edges = {
      sphereEdgeGroups: sphere.getEdgesGrouped(),
      baseEdges: base.getEdges(),
      tailEdges: tail.getEdges(),
      spiralEdges: spiral.getEdges(),
      flowCloudEdges: flowCloud.getEdges(),
    }
    const request = cutAndGlueMessage(useCloudStore.getState().preset, edges)
    for (const m of [sphere, base, tail, spiral, flowCloud]) m.dispose()
    return request
  }

  function atResolution(preset, res) {
    const p = structuredClone(preset)
    p.flowCloud.resolution = res
    p.surfaceMeshResolution = res
    return p
  }

  const cases = [
    { name: 'default @64', preset: atResolution(FIXTURES.default, 64) },
    { name: 'thickSpiral @64', preset: atResolution(FIXTURES.thickSpiral, 64) },
    { name: 'default @128', preset: atResolution(FIXTURES.default, 128) },
  ]

  function time(fn) {
    fn()
    const ms = []
    let out
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      out = fn()
      ms.push(performance.now() - t0)
    }
    const sorted = [...ms].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    return { median, min: sorted[0], max: sorted[sorted.length - 1], runs: ms, out }
  }

  const floats = (list) => list.reduce((n, a) => n + a.length, 0)
  const results = []
  for (const c of cases) {
    const fcRequest = marchingCubesMessage(c.preset)
    const smRequest = surfaceMeshMessage(c.preset)
    const cgRequest = await cutAndGlueRequest(c.preset)
    const cgInput =
      floats(cgRequest.sphereEdgeGroups.map((g) => g.edges)) +
      floats([cgRequest.baseEdges, cgRequest.tailEdges, cgRequest.spiralEdges, cgRequest.flowCloudEdges])

    const fc = time(() => generateFlowCloud(fcRequest))
    const sm = time(() => generateSurfaceMesh(smRequest))
    const cg = time(() => cutAndGlue(cgRequest))
    results.push(
      {
        case: c.name,
        core: 'flowCloud',
        ...fc,
        output: `${fc.out.vertices.length / 3} vertices, ${fc.out.indices.length / 3} triangles, ` +
          `${fc.out.flowLines.length} flow lines (${floats(fc.out.flowLines)} floats), ${fc.out.bands.length} bands`,
      },
      {
        case: c.name,
        core: 'surfaceMesh',
        ...sm,
        output: `${sm.out.positions.length / 3} vertices, ${sm.out.indices.length / 3} triangles`,
      },
      {
        case: c.name,
        core: 'cutAndGlue',
        ...cg,
        output: `${cgInput} floats in (flow cloud ${cgRequest.flowCloudEdges.length}), ${cg.out.clippedEdges.length} out`,
      },
    )
  }

  const f = (x) => x.toFixed(1).padStart(8)
  console.log(`median of ${RUNS} runs after one warm-up run, milliseconds (Node ${process.version})`)
  console.log(`${'case'.padEnd(16)} ${'core'.padEnd(12)} ${'median'.padStart(8)} ${'min'.padStart(8)} ${'max'.padStart(8)}  output`)
  for (const r of results) {
    console.log(`${r.case.padEnd(16)} ${r.core.padEnd(12)} ${f(r.median)} ${f(r.min)} ${f(r.max)}  ${r.output}`)
  }
  if (JSON_OUT) {
    const rows = results.map(({ out: _out, ...rest }) => rest)
    writeFileSync(JSON_OUT, JSON.stringify({ node: process.version, runs: RUNS, results: rows }, null, 2) + '\n')
  }
} finally {
  await server.close()
}
