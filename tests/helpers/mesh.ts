/**
 * Topology checks for indexed triangle meshes (three vertex indices per triangle).
 */

export interface EdgeUse {
  /** Distinct undirected edges. */
  edges: number
  /** Edges not used by exactly two triangles, as [lower, higher] vertex index pairs. */
  notShared: Array<[number, number]>
  /** Edges that two triangles traverse in the same direction, so their orientations disagree. */
  sameDirection: number
}

/** How the mesh's triangles use its edges. A closed, consistently oriented surface has every
 *  edge in exactly two triangles, traversed once in each direction. */
export function edgeUse(indices: Uint32Array): EdgeUse {
  let vertexCount = 0
  for (const i of indices) vertexCount = Math.max(vertexCount, i + 1)
  // Per undirected edge: uses in the lower-to-higher direction and in the other.
  const uses = new Map<number, { up: number; down: number }>()
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]
      const b = indices[t + ((k + 1) % 3)]
      const key = Math.min(a, b) * vertexCount + Math.max(a, b)
      const u = uses.get(key) ?? { up: 0, down: 0 }
      if (a < b) u.up++
      else u.down++
      uses.set(key, u)
    }
  }
  const notShared: Array<[number, number]> = []
  let sameDirection = 0
  for (const [key, u] of uses) {
    if (u.up + u.down !== 2) notShared.push([Math.floor(key / vertexCount), key % vertexCount])
    else if (u.up !== 1) sameDirection++
  }
  return { edges: uses.size, notShared, sameDirection }
}

/** The volume the triangles enclose, signed: positive when they wind counterclockwise seen
 *  from outside (three.js front faces facing out), negative when they face inward. */
export function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let v = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const [ax, ay, az] = [positions[a], positions[a + 1], positions[a + 2]]
    const [bx, by, bz] = [positions[b], positions[b + 1], positions[b + 2]]
    const [cx, cy, cz] = [positions[c], positions[c + 1], positions[c + 2]]
    // a . (b x c) / 6, the signed volume of the tetrahedron (origin, a, b, c)
    v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  return v
}
