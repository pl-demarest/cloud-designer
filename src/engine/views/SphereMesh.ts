import * as THREE from 'three';
import type { SphereDef } from '../../model/types';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import { KeyedMeshSet } from '../KeyedMeshSet';
import type { DragSource, DragTarget } from '../DragController';

interface SphereEntry {
  wire: THREE.LineSegments;
  handle: THREE.Mesh;
  objects: readonly THREE.Object3D[];
}

export class SphereMesh implements DragSource {
  private group: THREE.Group;
  private viewport: Viewport;
  private meshes: KeyedMeshSet<SphereDef, SphereEntry>;
  private unsubscribe: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.sphereGroup;
    this.meshes = new KeyedMeshSet(this.group, {
      create: (def) => this.createMesh(def),
      update: (entry, def) => this.updateMesh(entry, def),
    });

    // Subscribe to store changes
    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.spheres,
      (spheres) => this.sync(spheres)
    );

    // Initial sync
    this.sync(useCloudStore.getState().preset.spheres);
  }

  private sync(spheres: SphereDef[]): void {
    this.meshes.sync(spheres);
  }

  private createMesh(def: SphereDef): SphereEntry {
    const geo = this.buildGeo(def);
    const { materials } = this.viewport;
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), materials.line);
    wire.userData.sphereId = def.id;

    const handleGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const handle = new THREE.Mesh(handleGeo, materials.sphereHandle);
    handle.userData.sphereId = def.id;
    handle.userData.isHandle = true;

    this.applyTransform(wire, handle, def);
    geo.dispose();
    return { wire, handle, objects: [wire, handle] };
  }

  private updateMesh(entry: SphereEntry, def: SphereDef): void {
    entry.wire.geometry.dispose();
    const geo = this.buildGeo(def);
    entry.wire.geometry = new THREE.WireframeGeometry(geo);
    this.applyTransform(entry.wire, entry.handle, def);
    geo.dispose();
  }

  private buildGeo(def: SphereDef): THREE.BufferGeometry {
    const thetaLength = def.half ? Math.PI / 2 : Math.PI;
    const geo = new THREE.SphereGeometry(def.radius, 12, 8, 0, Math.PI * 2, 0, thetaLength);
    if (def.shape === 'ellipsoid') {
      geo.scale(def.scale[0], def.scale[1], def.scale[2]);
    }
    return geo;
  }

  private applyTransform(wire: THREE.LineSegments, handle: THREE.Mesh, def: SphereDef): void {
    const pos = new THREE.Vector3(...def.position);
    const rot = def.rotation;
    wire.position.copy(pos);
    wire.rotation.set(rot[0], rot[1], rot[2]);
    handle.position.copy(pos);
  }

  // ── Dragging (DragController) ───────────────────────────────────────────────

  dragHandles(): THREE.Object3D[] {
    return Array.from(this.meshes.values(), (entry) => entry.handle);
  }

  dragTarget(handle: THREE.Object3D): DragTarget {
    const id = handle.userData.sphereId as string;
    return {
      position: () => useCloudStore.getState().preset.spheres.find((s) => s.id === id)!.position,
      moveTo: (position) => {
        useCloudStore.getState().updateSphere(id, { position });
        return true;
      },
    };
  }

  /** Returns all sphere edges as a flat array (convenience wrapper). */
  getEdges(): Float32Array {
    const groups = this.getEdgesGrouped();
    let total = 0;
    for (const g of groups) total += g.edges.length;
    const out = new Float32Array(total);
    let offset = 0;
    for (const g of groups) {
      out.set(g.edges, offset);
      offset += g.edges.length;
    }
    return out;
  }

  /** Returns per-sphere edge arrays tagged with sphereId, enabling self-exclusion
   *  during Cut & Glue (each sphere's edges clipped against everything except itself). */
  getEdgesGrouped(): Array<{ sphereId: string; edges: Float32Array }> {
    const groups: Array<{ sphereId: string; edges: Float32Array }> = [];
    const v = new THREE.Vector3();
    for (const [id, { wire }] of this.meshes) {
      wire.updateWorldMatrix(true, false);
      const pos = wire.geometry.attributes.position;
      if (!pos) continue;
      const verts: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(wire.matrixWorld);
        verts.push(v.x, v.y, v.z);
      }
      groups.push({ sphereId: id, edges: new Float32Array(verts) });
    }
    return groups;
  }


  dispose(): void {
    this.unsubscribe();
    this.meshes.clear();
  }
}
