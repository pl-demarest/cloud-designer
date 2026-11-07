import * as THREE from 'three';
import type { BaseDef } from '../model/types';
import { Viewport } from './Viewport';
import { useCloudStore } from '../store/cloudStore';
import { basePointAt, sampleBasePath } from '../geometry/primitives/base';

const WIRE_MAT = new THREE.LineBasicMaterial({ color: 0x000000 });
const HANDLE_MAT = new THREE.MeshBasicMaterial({ color: 0x16a34a });

export class BaseMesh {
  private group: THREE.Group;
  private viewport: Viewport;
  private wire: THREE.LineSegments | null = null;
  private handles: THREE.Mesh[] = [];
  private unsubscribe: () => void;

  // Drag state
  private dragIdx: number = -1;
  private dragPlane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragOffset = new THREE.Vector3();

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.baseGroup;

    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.base,
      (base) => this.sync(base)
    );

    this.sync(useCloudStore.getState().preset.base);

    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointerup', this.onWindowPointerUp);
  }

  /** The point on the drawn base curve at arc-length fraction t ∈ [0,1] (basePointAt). */
  getPointAt(t: number): THREE.Vector3 {
    return new THREE.Vector3(...basePointAt(useCloudStore.getState().preset.base, t));
  }

  private buildWireframe(def: BaseDef): THREE.BufferGeometry {
    if (def.controlPoints.length < 2) return new THREE.BufferGeometry();

    const ringSegs = def.ringSegments;
    const lenSegs = def.lengthSegments;

    const path = sampleBasePath(def, lenSegs);
    // hx/hy swap per buildCrossSection: local X gets height, local Y gets width
    const hx = def.crossSectionHeight / 2;
    const hy = def.crossSectionWidth / 2;
    const isOval = def.crossSectionShape === 'oval';

    // Build all ring vertices
    const rings: THREE.Vector3[][] = [];
    for (let i = 0; i <= lenSegs; i++) {
      const center = path.points[i];
      const N = path.normals[i];
      const B = path.binormals[i];
      const ring: THREE.Vector3[] = [];

      for (let j = 0; j < ringSegs; j++) {
        const a = (j / ringSegs) * Math.PI * 2;
        let localN: number, localB: number;
        if (isOval) {
          localN = Math.cos(a) * hx;
          localB = Math.sin(a) * hy;
        } else {
          // Rect: distribute vertices along 4 sides
          const perimeter = 4;
          const side = (a / (Math.PI * 2)) * perimeter;
          const sideIdx = Math.floor(side) % 4;
          const frac = side - Math.floor(side);
          switch (sideIdx) {
            case 0: localN = -hx + frac * 2 * hx; localB = -hy; break;
            case 1: localN = hx; localB = -hy + frac * 2 * hy; break;
            case 2: localN = hx - frac * 2 * hx; localB = hy; break;
            default: localN = -hx; localB = hy - frac * 2 * hy; break;
          }
        }
        ring.push(new THREE.Vector3(
          center.x + localN * N.x + localB * B.x,
          center.y + localN * N.y + localB * B.y,
          center.z + localN * N.z + localB * B.z,
        ));
      }
      rings.push(ring);
    }

    // Emit ring + longitudinal segments
    const verts: number[] = [];
    for (let i = 0; i <= lenSegs; i++) {
      const ring = rings[i];
      for (let j = 0; j < ringSegs; j++) {
        const a = ring[j];
        const b = ring[(j + 1) % ringSegs];
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (let j = 0; j < ringSegs; j++) {
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

  private sync(def: BaseDef): void {
    // Rebuild wire
    if (this.wire) {
      this.group.remove(this.wire);
      this.wire.geometry.dispose();
    }
    const wireGeo = this.buildWireframe(def);
    this.wire = new THREE.LineSegments(wireGeo, WIRE_MAT);
    this.group.add(this.wire);

    // Rebuild handles
    for (const h of this.handles) {
      this.group.remove(h);
      h.geometry.dispose();
    }
    this.handles = def.controlPoints.map((pt, i) => {
      const geo = new THREE.SphereGeometry(0.1, 8, 6);
      const mesh = new THREE.Mesh(geo, HANDLE_MAT);
      mesh.position.set(...pt);
      mesh.userData.isBaseHandle = true;
      mesh.userData.cpIdx = i;
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
    this.dragIdx = hit.object.userData.cpIdx as number;
    this.viewport.controls.enabled = false;

    const normal = this.viewport.camera.position.clone().sub(hit.point).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    const pts = useCloudStore.getState().preset.base.controlPoints;
    const localPos = new THREE.Vector3(...pts[this.dragIdx]);
    this.dragOffset.copy(hit.point).sub(this.viewport.activeUnitGroup.localToWorld(localPos));

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragIdx < 0) return;
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, target);
    target.sub(this.dragOffset);
    this.viewport.activeUnitGroup.worldToLocal(target);
    useCloudStore.getState().updateBasePoint(this.dragIdx, [target.x, target.y, target.z]);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragIdx >= 0) {
      this.dragIdx = -1;
      this.viewport.controls.enabled = true;
      this.viewport.releaseDrag();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  private onWindowPointerUp = (): void => {
    if (this.dragIdx >= 0) {
      this.dragIdx = -1;
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
