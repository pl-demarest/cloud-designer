import * as THREE from 'three';
import type { SphereDef } from '../types/cloud';
import { Viewport } from './Viewport';
import { useCloudStore } from '../store/cloudStore';

const HANDLE_MAT = new THREE.MeshBasicMaterial({ color: 0x2563eb });
const WIRE_MAT = new THREE.LineBasicMaterial({ color: 0x000000 });

export class SphereMesh {
  private group: THREE.Group;
  private viewport: Viewport;
  private meshMap = new Map<string, { wire: THREE.LineSegments; handle: THREE.Mesh }>();
  private unsubscribe: () => void;

  // Drag state
  private dragId: string | null = null;
  private dragPlane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragOffset = new THREE.Vector3();

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.sphereGroup;

    // Subscribe to store changes
    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.spheres,
      (spheres) => this.sync(spheres)
    );

    // Initial sync
    this.sync(useCloudStore.getState().preset.spheres);

    // Pointer events
    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointerup', this.onWindowPointerUp);
  }

  private sync(spheres: SphereDef[]): void {
    const incomingIds = new Set(spheres.map((s) => s.id));

    // Remove stale
    for (const [id, { wire, handle }] of this.meshMap) {
      if (!incomingIds.has(id)) {
        this.group.remove(wire, handle);
        wire.geometry.dispose();
        handle.geometry.dispose();
        this.meshMap.delete(id);
      }
    }

    // Add / update
    for (const def of spheres) {
      if (this.meshMap.has(def.id)) {
        this.updateMesh(def);
      } else {
        this.createMesh(def);
      }
    }
  }

  private createMesh(def: SphereDef): void {
    const geo = this.buildGeo(def);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), WIRE_MAT.clone());
    wire.userData.sphereId = def.id;

    const handleGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const handle = new THREE.Mesh(handleGeo, HANDLE_MAT.clone());
    handle.userData.sphereId = def.id;
    handle.userData.isHandle = true;

    this.applyTransform(wire, handle, def);
    this.group.add(wire, handle);
    this.meshMap.set(def.id, { wire, handle });
    geo.dispose();
  }

  private updateMesh(def: SphereDef): void {
    const entry = this.meshMap.get(def.id)!;
    entry.wire.geometry.dispose();
    const geo = this.buildGeo(def);
    entry.wire.geometry = new THREE.WireframeGeometry(geo);
    this.applyTransform(entry.wire, entry.handle, def);
    geo.dispose();
  }

  private buildGeo(def: SphereDef): THREE.BufferGeometry {
    const thetaLength = (def.half ?? false) ? Math.PI / 2 : Math.PI;
    const geo = new THREE.SphereGeometry(def.radius, 12, 8, 0, Math.PI * 2, 0, thetaLength);
    if (def.shape === 'ellipsoid') {
      geo.scale(def.scale[0], def.scale[1], def.scale[2]);
    }
    return geo;
  }

  private applyTransform(wire: THREE.LineSegments, handle: THREE.Mesh, def: SphereDef): void {
    const pos = new THREE.Vector3(...def.position);
    const rot = def.rotation ?? [0, 0, 0];
    wire.position.copy(pos);
    wire.rotation.set(rot[0], rot[1], rot[2]);
    handle.position.copy(pos);
  }

  // Drag interaction
  private getPointer(e: PointerEvent): void {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const handles = Array.from(this.meshMap.values()).map((v) => v.handle);
    const hits = this.raycaster.intersectObjects(handles);
    if (hits.length === 0) return;
    if (!this.viewport.claimDrag()) return;

    const hit = hits[0];
    const id = hit.object.userData.sphereId as string;
    this.dragId = id;
    this.viewport.controls.enabled = false;

    // Drag plane perpendicular to camera at hit point
    const normal = this.viewport.camera.position.clone().sub(hit.point).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    const localPos = new THREE.Vector3(...useCloudStore.getState().preset.spheres.find((s) => s.id === id)!.position);
    this.dragOffset.copy(hit.point).sub(this.viewport.activeUnitGroup.localToWorld(localPos));

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragId) return;
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, target);
    target.sub(this.dragOffset);
    this.viewport.activeUnitGroup.worldToLocal(target);

    useCloudStore.getState().updateSphere(this.dragId, {
      position: [target.x, target.y, target.z],
    });
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragId) {
      this.dragId = null;
      this.viewport.controls.enabled = true;
      this.viewport.releaseDrag();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  private onWindowPointerUp = (): void => {
    if (this.dragId) {
      this.dragId = null;
      this.viewport.controls.enabled = true;
      this.viewport.releaseDrag();
    }
  };

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
    for (const [id, { wire }] of this.meshMap) {
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
    for (const { wire, handle } of this.meshMap.values()) {
      wire.geometry.dispose();
      handle.geometry.dispose();
    }
    this.meshMap.clear();

    const canvas = this.viewport.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
  }
}
