/**
 * Marching cubes over a scalar field sampled on a regular grid, shared by the flow-cloud and
 * surface-mesh workers.
 */

import { Float32Builder, Uint32Builder } from '../arrayBuilder';
import { EDGE_PAIRS, TRI_TABLE } from './tables';

/**
 * A sampling grid with `res` cells (res + 1 nodes) per axis, starting at (minX, minY, minZ) with
 * cell size (sx, sy, sz). Node (ix, iy, iz) sits at index iz * (res + 1)^2 + iy * (res + 1) + ix.
 */
export interface Grid {
  res: number;
  minX: number; minY: number; minZ: number;
  sx: number; sy: number; sz: number;
}

/**
 * The grid over a bounding box padded by 0.5 on every side, divided into `res` cells per axis.
 * Each axis gets its own cell size, so cells are boxes rather than cubes.
 */
export function gridFromBounds(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  res: number,
): Grid {
  // Pad bounds
  minX -= 0.5; minY -= 0.5; minZ -= 0.5;
  maxX += 0.5; maxY += 0.5; maxZ += 0.5;

  const sx = (maxX - minX) / res;
  const sy = (maxY - minY) / res;
  const sz = (maxZ - minZ) / res;
  return { res, minX, minY, minZ, sx, sy, sz };
}

/** Evaluates `sample` at every grid node. */
export function fillField(grid: Grid, sample: (x: number, y: number, z: number) => number): Float32Array {
  const { res, minX, minY, minZ, sx, sy, sz } = grid;
  const field = new Float32Array((res + 1) * (res + 1) * (res + 1));
  function idx(ix: number, iy: number, iz: number): number {
    return iz * (res + 1) * (res + 1) + iy * (res + 1) + ix;
  }

  for (let iz = 0; iz <= res; iz++) {
    for (let iy = 0; iy <= res; iy++) {
      for (let ix = 0; ix <= res; ix++) {
        const x = minX + ix * sx;
        const y = minY + iy * sy;
        const z = minZ + iz * sz;
        field[idx(ix, iy, iz)] = sample(x, y, z);
      }
    }
  }
  return field;
}

/** Corner v of a cube sits at node (ix + CORNER_X[v], iy + CORNER_Y[v], iz + CORNER_Z[v]). */
const CORNER_X = Int8Array.of(0, 1, 1, 0, 0, 1, 1, 0);
const CORNER_Y = Int8Array.of(0, 0, 1, 1, 0, 0, 1, 1);
const CORNER_Z = Int8Array.of(0, 0, 0, 0, 1, 1, 1, 1);

/**
 * Cube edge e runs from corner EDGE_LO[e] at its lower grid node to corner EDGE_HI[e] one step
 * up along axis EDGE_AXIS[e] (0 x, 1 y, 2 z): EDGE_PAIRS ordered by grid position.
 */
const EDGE_LO = new Int8Array(12);
const EDGE_HI = new Int8Array(12);
const EDGE_AXIS = new Int8Array(12);
EDGE_PAIRS.forEach(([a, b], e) => {
  const aIsLower = CORNER_X[a] + CORNER_Y[a] + CORNER_Z[a] < CORNER_X[b] + CORNER_Y[b] + CORNER_Z[b];
  EDGE_LO[e] = aIsLower ? a : b;
  EDGE_HI[e] = aIsLower ? b : a;
  EDGE_AXIS[e] = CORNER_X[a] !== CORNER_X[b] ? 0 : CORNER_Y[a] !== CORNER_Y[b] ? 1 : 2;
});

/**
 * Triangulates the iso-surface of `field` on `grid`: a node whose value is >= iso is inside.
 * Triangles keep TRI_TABLE's vertex order.
 *
 * Cubes share vertices: the vertex on a grid edge is interpolated once, from the edge's lower
 * node towards its upper node, and every cube that uses the edge gets its index. The indices are
 * cached by the edge's lower node and axis, for two node layers at a time (x and y edges of the
 * layers below and above the current slab of cubes, z edges between them), since the cubes of
 * one slab touch no other layer. Nothing is allocated per cube: the corner values live in a
 * scratch array, and the output grows in typed-array builders.
 */
export function polygonise(
  field: Float32Array,
  grid: Grid,
  iso: number,
): { positions: Float32Array; indices: Uint32Array } {
  const { res, minX, minY, minZ, sx, sy, sz } = grid;
  const n = res + 1;
  const nn = n * n;

  // Field index of each corner relative to the cube's first node (ix, iy, iz).
  const cornerOffset = new Int32Array(8);
  for (let v = 0; v < 8; v++) cornerOffset[v] = CORNER_Z[v] * nn + CORNER_Y[v] * n + CORNER_X[v];

  const positions = new Float32Builder();
  const indices = new Uint32Builder();
  const vals = new Float64Array(8);
  let vertexCount = 0;

  // Vertex index per grid edge, -1 until a cube uses the edge. The x and y edges of node layer z
  // sit at ((z & 1) * nn + y * n + x) * 2 + axis, the z edges of the current slab at y * n + x.
  const xyEdges = new Int32Array(4 * nn).fill(-1);
  const zEdges = new Int32Array(nn);

  // The cube being marched; edgeVertex reads it.
  let ix = 0, iy = 0, iz = 0;

  // The vertex on edge e of the current cube, interpolated on its grid edge's first use.
  const edgeVertex = (e: number): number => {
    const lo = EDGE_LO[e];
    const hi = EDGE_HI[e];
    const axis = EDGE_AXIS[e];
    const x = ix + CORNER_X[lo];
    const y = iy + CORNER_Y[lo];
    const z = iz + CORNER_Z[lo];
    const cache = axis === 2 ? zEdges : xyEdges;
    const slot = axis === 2 ? y * n + x : ((z & 1) * nn + y * n + x) * 2 + axis;
    let vi = cache[slot];
    if (vi >= 0) return vi;

    const ax = minX + x * sx;
    const ay = minY + y * sy;
    const az = minZ + z * sz;
    const bx = minX + (ix + CORNER_X[hi]) * sx;
    const by = minY + (iy + CORNER_Y[hi]) * sy;
    const bz = minZ + (iz + CORNER_Z[hi]) * sz;
    const aval = vals[lo];
    const bval = vals[hi];
    if (Math.abs(iso - aval) < 0.00001) positions.push3(ax, ay, az);
    else if (Math.abs(iso - bval) < 0.00001) positions.push3(bx, by, bz);
    else {
      const t = (iso - aval) / (bval - aval);
      positions.push3(ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az));
    }
    vi = vertexCount++;
    cache[slot] = vi;
    return vi;
  };

  for (iz = 0; iz < res; iz++) {
    // Node layer iz + 1 takes the slot of layer iz - 1, which no later cube touches.
    const above = (iz + 1) & 1;
    xyEdges.fill(-1, above * 2 * nn, (above + 1) * 2 * nn);
    zEdges.fill(-1);

    for (iy = 0; iy < res; iy++) {
      for (ix = 0; ix < res; ix++) {
        const node = iz * nn + iy * n + ix;
        let cubeIdx = 0;
        for (let v = 0; v < 8; v++) {
          const val = field[node + cornerOffset[v]];
          vals[v] = val;
          if (val >= iso) cubeIdx |= 1 << v;
        }
        if (cubeIdx === 0 || cubeIdx === 255) continue;

        const triList = TRI_TABLE[cubeIdx];
        for (let t = 0; t < triList.length && triList[t] !== -1; t += 3) {
          const v0 = edgeVertex(triList[t]);
          const v1 = edgeVertex(triList[t + 1]);
          const v2 = edgeVertex(triList[t + 2]);
          indices.push3(v0, v1, v2);
        }
      }
    }
  }

  return { positions: positions.toArray(), indices: indices.toArray() };
}
