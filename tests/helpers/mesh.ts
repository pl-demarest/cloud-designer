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
