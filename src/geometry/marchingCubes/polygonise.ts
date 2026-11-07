/**
 * Marching cubes over a scalar field sampled on a regular grid, shared by the flow-cloud and
 * surface-mesh workers.
 */

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

/**
 * What the field holds. It sets the iso level and the formula that places a vertex on an edge,
 * which is all the two workers' copies of the march differed in.
 * - 'density' (flow cloud): a metaball sum. Corners with value >= iso are inside, and the
 *   crossing is at t = (iso - a) / (b - a).
 * - 'negatedSdf' (surface mesh): minus a signed distance. Corners with value >= 0 are inside,
 *   and the crossing is at t = -a / (b - a).
 * With iso 0 the two agree for every finite corner value. For a NaN corner value they give NaN
 * vertices with different sign bits (-a flips the sign, iso - a keeps it), and the surface
 * mesh's degenerateBase golden pins those bytes, so both formulas are kept.
 */
export type FieldKind =
  | { kind: 'density'; iso: number }
  | { kind: 'negatedSdf' };

// Linear interpolation along edge
function interp(
  isolevel: number,
  ax: number, ay: number, az: number, aval: number,
  bx: number, by: number, bz: number, bval: number
): [number, number, number] {
  if (Math.abs(isolevel - aval) < 0.00001) return [ax, ay, az];
  if (Math.abs(isolevel - bval) < 0.00001) return [bx, by, bz];
  if (Math.abs(aval - bval) < 0.00001) return [ax, ay, az];
  const t = (isolevel - aval) / (bval - aval);
  return [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
}

function interpZero(
  ax: number, ay: number, az: number, aval: number,
  bx: number, by: number, bz: number, bval: number
): [number, number, number] {
  // Threshold is 0 for SDF
  if (Math.abs(aval) < 0.00001) return [ax, ay, az];
  if (Math.abs(bval) < 0.00001) return [bx, by, bz];
  if (Math.abs(aval - bval) < 0.00001) return [ax, ay, az];
  const t = -aval / (bval - aval);  // solve for aval + t*(bval - aval) = 0
  return [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
}

/**
 * Triangulates the iso-surface of `field` on `grid`. Triangles keep TRI_TABLE's vertex order,
 * and each edge vertex is interpolated from corner EDGE_PAIRS[e][0] towards EDGE_PAIRS[e][1].
 * Vertices are cached per cube, so neighbouring cubes never share one.
 */
export function polygonise(
  field: Float32Array,
  grid: Grid,
  fieldKind: FieldKind,
): { positions: Float32Array; indices: Uint32Array } {
  const { res, minX, minY, minZ, sx, sy, sz } = grid;
  const iso = fieldKind.kind === 'density' ? fieldKind.iso : 0;
  const negatedSdf = fieldKind.kind === 'negatedSdf';
  function idx(ix: number, iy: number, iz: number): number {
    return iz * (res + 1) * (res + 1) + iy * (res + 1) + ix;
  }

  // March cubes
  const verts: number[] = [];
  const tris: number[] = [];
  const edgeVerts = new Map<string, number>();

  function getEdgeVert(
    x0: number, y0: number, z0: number, v0: number,
    x1: number, y1: number, z1: number, v1: number,
    eKey: string
  ): number {
    if (edgeVerts.has(eKey)) return edgeVerts.get(eKey)!;
    const [px, py, pz] = negatedSdf
      ? interpZero(x0, y0, z0, v0, x1, y1, z1, v1)
      : interp(iso, x0, y0, z0, v0, x1, y1, z1, v1);
    const vi = verts.length / 3;
    verts.push(px, py, pz);
    edgeVerts.set(eKey, vi);
    return vi;
  }

  for (let iz = 0; iz < res; iz++) {
    for (let iy = 0; iy < res; iy++) {
      for (let ix = 0; ix < res; ix++) {
        // World coords of cube corners
        const cx = [ix, ix+1, ix+1, ix, ix, ix+1, ix+1, ix];
        const cy = [iy, iy, iy+1, iy+1, iy, iy, iy+1, iy+1];
        const cz = [iz, iz, iz, iz, iz+1, iz+1, iz+1, iz+1];

        const wx = cx.map(i => minX + i * sx);
        const wy = cy.map(i => minY + i * sy);
        const wz = cz.map(i => minZ + i * sz);
        const vals = cx.map((_xi, vi) => field[idx(cx[vi], cy[vi], cz[vi])]);

        // Compute cube index
        let cubeIdx = 0;
        for (let v = 0; v < 8; v++) {
          if (vals[v] >= iso) cubeIdx |= (1 << v);
        }

        if (cubeIdx === 0 || cubeIdx === 255) continue;

        // Get triangles for this config
        const triList = TRI_TABLE[cubeIdx];
        if (!triList || triList[0] === -1) continue;

        // Edge vertex positions
        const edgeV: (number | null)[] = new Array(12).fill(null);

        function ensureEdge(e: number): number {
          if (edgeV[e] !== null) return edgeV[e]!;
          const [a, b] = EDGE_PAIRS[e];
          const key = `${ix}_${iy}_${iz}_${e}`;
          const vi = getEdgeVert(wx[a], wy[a], wz[a], vals[a], wx[b], wy[b], wz[b], vals[b], key);
          edgeV[e] = vi;
          return vi;
        }

        for (let t = 0; t < triList.length && triList[t] !== -1; t += 3) {
          const v0 = ensureEdge(triList[t]);
          const v1 = ensureEdge(triList[t + 1]);
          const v2 = ensureEdge(triList[t + 2]);
          tris.push(v0, v1, v2);
        }
      }
    }
  }

  return {
    positions: new Float32Array(verts),
    indices: new Uint32Array(tris),
  };
}
