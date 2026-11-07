import { describe, expect, test } from 'vitest'
import { digestValue } from '../helpers/digest'
import { runWorker } from '../helpers/workerHarness'
import { cutAndGlueMessage, fixture, marchingCubesMessage, surfaceMeshMessage } from '../fixtures/presets'
import { generateFlowCloud } from '../../src/workers/core/flowCloud'
import { generateSurfaceMesh } from '../../src/workers/core/surfaceMesh'
import { cutAndGlue } from '../../src/workers/core/cutAndGlue'

/**
 * The worker cores (src/workers/core) are pure functions of their request, and each worker
 * shell posts its core's result unchanged. The shells' output itself is pinned by
 * tests/golden/workers.test.ts and tests/golden/editor.test.ts.
 */

const segments = (...coords: number[]) => new Float32Array(coords)

describe('worker cores', () => {
  test('generateFlowCloud leaves its request untouched, and the shell posts its result', async () => {
    const request = marchingCubesMessage(fixture('bands'))
    const before = structuredClone(request)
    const result = generateFlowCloud(request)
    expect(request).toEqual(before)
    expect(result.bands.length).toBeGreaterThan(0)
    const { message } = await runWorker('marchingCubes', request)
    expect(digestValue(message)).toEqual(digestValue(result))
  })

  test('generateSurfaceMesh leaves its request untouched, and the shell posts its result', async () => {
    const request = surfaceMeshMessage(fixture('thickSpiral'))
    const before = structuredClone(request)
    const result = generateSurfaceMesh(request)
    expect(request).toEqual(before)
    expect(result.positions.length).toBeGreaterThan(0)
    const { message } = await runWorker('surfaceMesh', request)
    expect(digestValue(message)).toEqual(digestValue(result))
  })

  test('cutAndGlue leaves its request untouched, and the shell posts its result', async () => {
    const request = cutAndGlueMessage(fixture('default'), {
      // Each segment starts inside another primitive's volume, so every group is clipped.
      sphereEdgeGroups: [
        { sphereId: 'sphere-0', edges: segments(1.6, 0.3, 0, 4, 0.3, 0) },
        { sphereId: 'sphere-1', edges: segments(0, 0, 0, 0, 3, 0) },
      ],
      baseEdges: segments(0, -0.9, 0, 0, -3, 0),
      tailEdges: segments(0, 0, 0, 0, 0, 3),
      spiralEdges: segments(0, 0, 0, -3, 0, 0),
      flowCloudEdges: segments(1, 1, 1, 5, 5, 5),
    })
    const before = structuredClone(request)
    const result = cutAndGlue(request)
    expect(request).toEqual(before)
    expect(result.clippedEdges.length).toBeGreaterThan(0)
    const { message } = await runWorker('cutAndGlue', request)
    expect(digestValue(message)).toEqual(digestValue(result))
  })
})
