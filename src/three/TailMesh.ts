import * as THREE from 'three';
import type { TailDef, TailSetpoint } from '../types/cloud';
import { Viewport } from './Viewport';
import { useCloudStore } from '../store/cloudStore';
import { BaseMesh } from './BaseMesh';

const WIRE_MAT = new THREE.LineBasicMaterial({ color: 0x000000 });
const HANDLE_MAT = new THREE.MeshBasicMaterial({ color: 0xdc2626 });

export class TailMesh {
  private group: THREE.Group;
  private viewport: Viewport;
  private baseMesh: BaseMesh;
  private wire: THREE.LineSegments | null = null;
  private handles: THREE.Mesh[] = [];
  private unsubscribe: () => void;

  private dragId: string | null = null;
  private dragPlane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragOffset = new THREE.Vector3();

  constructor(viewport: Viewport, baseMesh: BaseMesh) {
    this.viewport = viewport;
    this.baseMesh = baseMesh;
    this.group = viewport.tailGroup;

    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.tail,
      (tail) => this.sync(tail),
      { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
    );

    this.sync(useCloudStore.getState().preset.tail);

    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointerup', this.onWindowPointerUp);
  }

  private resolveSetpoints(tail: TailDef): TailSetpoint[] {
    const pts = [...tail.setpoints];

    // Attachment: lock first setpoint to base curve
    if (tail.attachToBase !== 'none' && pts.length > 0) {
      const t = tail.attachOffset;
      const attachPt = this.baseMesh.getPointAt(t);
      pts[0] = { ...pts[0], position: [attachPt.x, attachPt.y, attachPt.z] };
    }

    return pts;
  }

  private interpolateRadius(t: number, setpoints: TailSetpoint[]): number {
    if (setpoints.length === 0) return 0.5;
    if (setpoints.length === 1) return setpoints[0].width;

    const segT = t * (setpoints.length - 1);
    const i = Math.min(Math.floor(segT), setpoints.length - 2);
    const f = segT - i;
    return setpoints[i].width + (setpoints[i + 1].width - setpoints[i].width) * f;
  }

  private buildWireframe(tail: TailDef): THREE.BufferGeometry {
    const setpoints = this.resolveSetpoints(tail);
    if (setpoints.length < 2) return new THREE.BufferGeometry();

    const radSegs = tail.radialSegments ?? 12;
    const lenSegs = tail.lengthSegments ?? 32;

    const curve = new THREE.CatmullRomCurve3(
      setpoints.map((sp) => new THREE.Vector3(...sp.position)),
      false,
      'catmullrom',
      0.5
    );

    const arcLengths = curve.getLengths(lenSegs);
    const totalLength = arcLengths[arcLengths.length - 1];
    const frames = curve.computeFrenetFrames(lenSegs, false);

    // Build all ring vertices
    const rings: THREE.Vector3[][] = [];
    for (let i = 0; i <= lenSegs; i++) {
      const t = i / lenSegs;
      const pt = curve.getPoint(t);

      // Interpolate radius from setpoints by arc-length parameter
      const arcT = arcLengths[Math.min(i, arcLengths.length - 1)] / totalLength;
      const r = this.interpolateRadius(arcT, setpoints);

      // Curl in the last 20% of arc
      const curlFraction = Math.max(0, (t - 0.8) / 0.2);
      const curlAngle = tail.curlAmount * curlFraction;

      const normal = frames.normals[Math.min(i, frames.normals.length - 1)];
      const binormal = frames.binormals[Math.min(i, frames.binormals.length - 1)];
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

  private sync(tail: TailDef): void {
    // Rebuild wire
    if (this.wire) {
      this.group.remove(this.wire);
      this.wire.geometry.dispose();
    }
    const wireGeo = this.buildWireframe(tail);
    this.wire = new THREE.LineSegments(wireGeo, WIRE_MAT);
    this.group.add(this.wire);

    // Rebuild handles
    for (const h of this.handles) {
      this.group.remove(h);
      h.geometry.dispose();
    }
    const resolved = this.resolveSetpoints(tail);
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
