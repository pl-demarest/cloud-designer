import * as THREE from 'three';
import type { BaseDef } from '../types/cloud';
import { Viewport } from './Viewport';
import { useCloudStore } from '../store/cloudStore';

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
  }

  /** Build a closed oval cross-section shape */
  private buildCrossSection(def: BaseDef): THREE.Shape {
    const shape = new THREE.Shape();
    const hw = def.crossSectionWidth / 2;
    const hh = def.crossSectionHeight / 2;

    if (def.crossSectionShape === 'oval') {
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const x = Math.cos(a) * hw;
        const y = Math.sin(a) * hh;
        i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
      }
      shape.closePath();
    } else {
      shape.moveTo(-hw, -hh);
      shape.lineTo(hw, -hh);
      shape.lineTo(hw, hh);
      shape.lineTo(-hw, hh);
      shape.closePath();
    }
    return shape;
  }

  private buildGeo(def: BaseDef): THREE.BufferGeometry {
    if (def.controlPoints.length < 2) return new THREE.BufferGeometry();

    const curve = new THREE.CatmullRomCurve3(
      def.controlPoints.map((p) => new THREE.Vector3(...p)),
      def.closed,
      'catmullrom',
      0.5
    );

    const shape = this.buildCrossSection(def);
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: Math.max(20, def.controlPoints.length * 6),
      bevelEnabled: false,
      extrudePath: curve,
    };

    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }

  /** Returns the world-space point on the base curve at parameter t ∈ [0,1] */
  getPointAt(t: number): THREE.Vector3 {
    const def = useCloudStore.getState().preset.base;
    if (def.controlPoints.length < 2) return new THREE.Vector3();
    const curve = new THREE.CatmullRomCurve3(
      def.controlPoints.map((p) => new THREE.Vector3(...p)),
      def.closed
    );
    return curve.getPointAt(Math.max(0, Math.min(1, t)));
  }

  private sync(def: BaseDef): void {
    // Rebuild wire
    if (this.wire) {
      this.group.remove(this.wire);
      this.wire.geometry.dispose();
    }
    const geo = this.buildGeo(def);
    const edges = new THREE.EdgesGeometry(geo, 20);
    this.wire = new THREE.LineSegments(edges, WIRE_MAT);
    this.group.add(this.wire);
    geo.dispose();

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

    const hit = hits[0];
    this.dragIdx = hit.object.userData.cpIdx as number;
    this.viewport.controls.enabled = false;

    const normal = this.viewport.camera.position.clone().sub(hit.point).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
    const pts = useCloudStore.getState().preset.base.controlPoints;
    this.dragOffset.copy(hit.point).sub(new THREE.Vector3(...pts[this.dragIdx]));

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragIdx < 0) return;
    this.getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, target);
    target.sub(this.dragOffset);
    useCloudStore.getState().updateBasePoint(this.dragIdx, [target.x, target.y, target.z]);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragIdx >= 0) {
      this.dragIdx = -1;
      this.viewport.controls.enabled = true;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

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
  }
}
