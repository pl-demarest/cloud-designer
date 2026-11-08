import * as THREE from 'three';
import { shallow } from 'zustand/vanilla/shallow';
import type { BaseDef, TailDef, TailSetpoint } from '../../model/types';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import { resolveTailSetpoints, sampleTailPath } from '../../geometry/primitives/tail';

const WIRE_MAT = new THREE.LineBasicMaterial({ color: 0x000000 });
const HANDLE_MAT = new THREE.MeshBasicMaterial({ color: 0xdc2626 });

export class TailMesh {
  private group: THREE.Group;
  private viewport: Viewport;
  private wire: THREE.LineSegments | null = null;
  private handles: THREE.Mesh[] = [];
  private unsubscribe: () => void;

  private dragId: string | null = null;
  private dragPlane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragOffset = new THREE.Vector3();

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.tailGroup;

    // The base too: an attached tail starts on it.
    this.unsubscribe = useCloudStore.subscribe(
      (s) => [s.preset.tail, s.preset.base] as const,
      ([tail, base]) => this.sync(tail, base),
      { equalityFn: shallow }
    );

    const { tail, base } = useCloudStore.getState().preset;
    this.sync(tail, base);

    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointerup', this.onWindowPointerUp);
  }

  private buildWireframe(tail: TailDef, setpoints: TailSetpoint[]): THREE.BufferGeometry {
    if (setpoints.length < 2) return new THREE.BufferGeometry();

    const radSegs = tail.radialSegments;
    const lenSegs = tail.lengthSegments;

    // Centre, frame and width at the same arc-length position u = i / lenSegs.
    const path = sampleTailPath(setpoints, lenSegs);

    // Build all ring vertices
    const rings: THREE.Vector3[][] = [];
    for (let i = 0; i <= lenSegs; i++) {
      const u = i / lenSegs;
      const pt = path.points[i];
      const r = path.widths[i];

      // Curl in the last 20% of arc
      const curlFraction = Math.max(0, (u - 0.8) / 0.2);
      const curlAngle = tail.curlAmount * curlFraction;

      const normal = path.normals[i];
      const binormal = path.binormals[i];
      const ring: THREE.Vector3[] = [];

      for (let j = 0; j < radSegs; j++) {
        const angle = (j / radSegs) * Math.PI * 2 + curlAngle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = normal.x * cos + binormal.x * sin;
        const ny = normal.y * cos + binormal.y * sin;
        const nz = normal.z * cos + binormal.z * sin;
        ring.push(new THREE.Vector3(pt.x + nx * r, pt.y + ny * r, pt.z + nz * r));
      }
      rings.push(ring);
    }

    // Emit ring + longitudinal segments
    const verts: number[] = [];
    for (let i = 0; i <= lenSegs; i++) {
      const ring = rings[i];
      for (let j = 0; j < radSegs; j++) {
        const a = ring[j];
        const b = ring[(j + 1) % radSegs];
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (let j = 0; j < radSegs; j++) {
      for (let i = 0; i < lenSegs; i++) {
        const a = rings[i][j];
        const b = rings[i + 1][j];
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return geo;
  }

  private sync(tail: TailDef, base: BaseDef): void {
    const resolved = resolveTailSetpoints(tail, base);

    // Rebuild wire
    if (this.wire) {
      this.group.remove(this.wire);
      this.wire.geometry.dispose();
    }
    const wireGeo = this.buildWireframe(tail, resolved);
    this.wire = new THREE.LineSegments(wireGeo, WIRE_MAT);
    this.group.add(this.wire);

    // Rebuild handles
    for (const h of this.handles) {
      this.group.remove(h);
      h.geometry.dispose();
    }
    this.handles = resolved.map((sp, i) => {
      const hGeo = new THREE.SphereGeometry(0.08, 8, 6);
      const mesh = new THREE.Mesh(hGeo, HANDLE_MAT);
      mesh.position.set(...sp.position);
      mesh.userData.isTailHandle = true;
      mesh.userData.spId = tail.setpoints[i]?.id ?? sp.id;
      this.group.add(mesh);
      return mesh;
    });
  }

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
    const hits = this.raycaster.intersectObjects(this.handles);
    if (hits.length === 0) return;
    if (!this.viewport.claimDrag()) return;

    const hit = hits[0];
    this.dragId = hit.object.userData.spId as string;
    this.viewport.controls.enabled = false;

    const normal = this.viewport.camera.position.clone().sub(hit.point).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    const sp = useCloudStore.getState().preset.tail.setpoints.find((p) => p.id === this.dragId);
    const localPos = new THREE.Vector3(...(sp?.position ?? [0, 0, 0]));
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

    // Don't drag attached setpoints
    const tail = useCloudStore.getState().preset.tail;
    if (tail.attachToBase !== 'none' && tail.setpoints[0]?.id === this.dragId) return;

    this.viewport.activeUnitGroup.worldToLocal(target);
    useCloudStore.getState().updateTailSetpoint(this.dragId, {
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

  getEdges(): Float32Array {
    const verts: number[] = [];
    const v = new THREE.Vector3();
    this.group.traverse((obj) => {
      if ((obj instanceof THREE.LineSegments || obj instanceof THREE.Line) && !obj.userData.isHandle) {
        obj.updateWorldMatrix(true, false);
        const pos = obj.geometry.attributes.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
          verts.push(v.x, v.y, v.z);
        }
      }
    });
    return new Float32Array(verts);
  }

  dispose(): void {
    this.unsubscribe();
    if (this.wire) {
      this.group.remove(this.wire);
      this.wire.geometry.dispose();
    }
    for (const h of this.handles) {
      this.group.remove(h);
      h.geometry.dispose();
    }
    const canvas = this.viewport.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
  }
}
