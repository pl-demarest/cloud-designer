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

/** The two corners of each cube edge (EDGE_PAIRS as flat tables). */
const EDGE_A = Int8Array.from(EDGE_PAIRS, (pair) => pair[0]);
const EDGE_B = Int8Array.from(EDGE_PAIRS, (pair) => pair[1]);

/**
 * Triangulates the iso-surface of `field` on `grid`: a node whose value is >= iso is inside.
 * Triangles keep TRI_TABLE's vertex order, and each edge vertex is interpolated from corner
 * EDGE_PAIRS[e][0] towards EDGE_PAIRS[e][1]. Vertices are cached per cube, so neighbouring cubes
 * never share one. Nothing is allocated per cube: the corner values and the cube's edge vertices
 * live in scratch arrays, and the output grows in typed-array builders.
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
  // The vertex of each of the current cube's 12 edges, -1 until a triangle uses it.
  const cubeVertex = new Int32Array(12);
  let vertexCount = 0;

  // The cube being marched; edgeVertex reads it.
  let ix = 0, iy = 0, iz = 0;

  // The vertex on edge e of the current cube, interpolated on first use.
  const edgeVertex = (e: number): number => {
    let vi = cubeVertex[e];
    if (vi >= 0) return vi;
    const a = EDGE_A[e];
    const b = EDGE_B[e];
    const ax = minX + (ix + CORNER_X[a]) * sx;
    const ay = minY + (iy + CORNER_Y[a]) * sy;
    const az = minZ + (iz + CORNER_Z[a]) * sz;
    const bx = minX + (ix + CORNER_X[b]) * sx;
    const by = minY + (iy + CORNER_Y[b]) * sy;
    const bz = minZ + (iz + CORNER_Z[b]) * sz;
    const aval = vals[a];
    const bval = vals[b];
    if (Math.abs(iso - aval) < 0.00001) positions.push3(ax, ay, az);
    else if (Math.abs(iso - bval) < 0.00001) positions.push3(bx, by, bz);
    else if (Math.abs(aval - bval) < 0.00001) positions.push3(ax, ay, az);
    else {
      const t = (iso - aval) / (bval - aval);
      positions.push3(ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az));
    }
    vi = vertexCount++;
    cubeVertex[e] = vi;
    return vi;
  };

  for (iz = 0; iz < res; iz++) {
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
        if (triList[0] === -1) continue;
        cubeVertex.fill(-1);

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
