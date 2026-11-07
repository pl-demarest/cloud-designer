/**
 * Cut & Glue Web Worker (clips every primitive wireframe against the other
 * primitives' volumes).
 *
 * Receives a CutGlueRequest and posts back cutAndGlue's result ({ clippedEdges }),
 * transferring its buffer. An exception is not caught: it reaches Worker.onerror.
 */

import { cutAndGlue } from './core/cutAndGlue';
import type { CutGlueRequest } from './protocol';

self.onmessage = (e: MessageEvent<CutGlueRequest>) => {
  const result = cutAndGlue(e.data);
  self.postMessage(result, { transfer: [result.clippedEdges.buffer] });
};
