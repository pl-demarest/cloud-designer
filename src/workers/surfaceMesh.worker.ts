/**
 * Surface-mesh Web Worker (marching cubes on the union SDF of all primitives).
 *
 * Receives a SurfaceMeshRequest and posts back generateSurfaceMesh's result
 * ({ positions, indices }), transferring both buffers, or { error } if the
 * computation throws.
 */

import { generateSurfaceMesh } from './core/surfaceMesh';
import type { SurfaceMeshRequest } from './protocol';

self.onmessage = (e: MessageEvent<SurfaceMeshRequest>) => {
  try {
    const result = generateSurfaceMesh(e.data);
    const transferables: Transferable[] = [result.positions.buffer, result.indices.buffer];
    self.postMessage(result, { transfer: transferables });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
