/**
 * Flow-cloud Web Worker (marching cubes on the metaball field).
 *
 * Receives a FlowCloudRequest and posts back generateFlowCloud's result
 * ({ vertices, indices, bands, flowLines }), transferring every buffer, or
 * { error } if the computation throws.
 */

import { generateFlowCloud } from './core/flowCloud';
import type { FlowCloudRequest } from './protocol';

self.onmessage = (e: MessageEvent<FlowCloudRequest>) => {
  // Read outside the try, as before the core was extracted: a message that is not an
  // object throws to Worker.onerror instead of replying { error }.
  const { spheres, base, tail, flowCloud } = e.data;

  try {
    const result = generateFlowCloud({ spheres, base, tail, flowCloud });

    const transferables: Transferable[] = [result.vertices.buffer, result.indices.buffer];
    for (const b of result.bands) transferables.push(b.buffer);
    for (const fl of result.flowLines) transferables.push(fl.buffer);

    self.postMessage(result, { transfer: transferables });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
