import * as THREE from 'three';

/**
 * Wire code the views share: the world-space vertices Cut & Glue takes from each view
 * (getEdges), and the ring-and-line lattice of the base and tail tubes.
 */

const world = new THREE.Vector3();

/** Appends the vertices of `line` in world space to `out`, x,y,z per vertex. */
export function pushWorldVertices(line: THREE.Line, out: number[]): void {
  line.updateWorldMatrix(true, false);
  const pos = line.geometry.attributes.position;
  if (!pos) return;
  for (let i = 0; i < pos.count; i++) {
    world.fromBufferAttribute(pos, i).applyMatrix4(line.matrixWorld);
    out.push(world.x, world.y, world.z);
  }
}

/**
 * The vertices, in world space, of every line object under `root` that is not editor-only (the
 * handles are). The base, tail and spiral views draw LineSegments only, so these are Cut & Glue's
 * x,y,z,x,y,z segment pairs.
 */
export function worldWires(root: THREE.Object3D): Float32Array {
  const out: number[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Line && !obj.userData.editorOnly) pushWorldVertices(obj, out);
  });
  return new Float32Array(out);
}

/**
 * A tube's wire as segment pairs: each ring closed on itself, then, for each point index, the
 * line through that point of every ring from the first ring to the last. The rings have equal
 * point counts.
 */
export function tubeLattice(rings: readonly (readonly THREE.Vector3[])[]): THREE.BufferGeometry {
  const verts: number[] = [];
  for (const ring of rings) {
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j];
      const b = ring[(j + 1) % ring.length];
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const points = rings[0]?.length ?? 0;
  for (let j = 0; j < points; j++) {
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = rings[i][j];
      const b = rings[i + 1][j];
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geo;
}
