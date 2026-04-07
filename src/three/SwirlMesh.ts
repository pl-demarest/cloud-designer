import * as THREE from 'three';
import type { SwirlDef } from '../types/cloud';
import { Viewport } from './Viewport';
import { useCloudStore } from '../store/cloudStore';

const HANDLE_MAT = new THREE.MeshBasicMaterial({ color: 0x2563eb });
const WIRE_MAT = new THREE.LineBasicMaterial({ color: 0x000000 });

export class SwirlMesh {
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
    this.group = viewport.swirlGroup;

    // Subscribe to store changes
    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.swirls,
      (swirls) => this.sync(swirls)
    );

    // Initial sync
    this.sync(useCloudStore.getState().preset.swirls);

    // Pointer events
    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
  }

  private sync(swirls: SwirlDef[]): void {
    const incomingIds = new Set(swirls.map((s) => s.id));

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
    for (const def of swirls) {
      if (this.meshMap.has(def.id)) {
        this.updateMesh(def);
      } else {
        this.createMesh(def);
      }
    }
  }

  private createMesh(def: SwirlDef): void {
    const geo = this.buildGeo(def);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), WIRE_MAT.clone());
    wire.userData.swirlId = def.id;

    const handleGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const handle = new THREE.Mesh(handleGeo, HANDLE_MAT.clone());
    handle.userData.swirlId = def.id;
    handle.userData.isHandle = true;

    this.applyTransform(wire, handle, def);
    this.group.add(wire, handle);
    this.meshMap.set(def.id, { wire, handle });
    geo.dispose();
  }

  private updateMesh(def: SwirlDef): void {
    const entry = this.meshMap.get(def.id)!;
    entry.wire.geometry.dispose();
    const geo = this.buildGeo(def);
    entry.wire.geometry = new THREE.WireframeGeometry(geo);
    this.applyTransform(entry.wire, entry.handle, def);
    geo.dispose();
  }

  private buildGeo(def: SwirlDef): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(def.radius, 12, 8);
    if (def.shape === 'ellipsoid') {
      geo.scale(def.scale[0], def.scale[1], def.scale[2]);
    }
    return geo;
  }

  private applyTransform(wire: THREE.LineSegments, handle: THREE.Mesh, def: SwirlDef): void {
    const pos = new THREE.Vector3(...def.position);
    wire.position.copy(pos);
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

    const hit = hits[0];
    const id = hit.object.userData.swirlId as string;
    this.dragId = id;
    this.viewport.controls.enabled = false;

    // Drag plane perpendicular to camera at hit point
    const normal = this.viewport.camera.position.clone().sub(hit.point).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    this.dragOffset.copy(hit.point).sub(new THREE.Vector3(...useCloudStore.getState().preset.swirls.find((s) => s.id === id)!.position));

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragId) return;
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, target);
    target.sub(this.dragOffset);

    useCloudStore.getState().updateSwirl(this.dragId, {
      position: [target.x, target.y, target.z],
    });
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragId) {
      this.dragId = null;
      this.viewport.controls.enabled = true;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

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
  }
}
