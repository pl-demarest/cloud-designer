import * as THREE from 'three';
import type { BaseDef } from '../../model/types';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import { sampleBasePath } from '../../geometry/primitives/base';
import type { DragSource, DragTarget } from '../DragController';
import { sameValue } from '../../model/sameValue';
import { RANGES } from '../../model/ranges';

export class BaseMesh implements DragSource {
  private group: THREE.Group;
  private viewport: Viewport;
  private wire: THREE.LineSegments | null = null;
  private handles: THREE.Mesh[] = [];
  /** The definition the wire and handles show. */
  private shown: BaseDef | null = null;
  private unsubscribe: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.baseGroup;

    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.base,
      (base) => this.sync(base)
    );

    this.sync(useCloudStore.getState().preset.base);
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

  /** Rebuilds when the base changed by value: the wire, and the handles only if their number did
   *  (otherwise they move). */
  private sync(def: BaseDef): void {
    if (this.shown && sameValue(this.shown, def)) return;
    this.shown = def;

    // Rebuild wire
    if (this.wire) {
      this.wire.geometry.dispose();
      this.wire.geometry = this.buildWireframe(def);
    } else {
      this.wire = new THREE.LineSegments(this.buildWireframe(def), this.viewport.materials.line);
      this.group.add(this.wire);
    }

    if (this.handles.length === def.controlPoints.length) {
      this.handles.forEach((h, i) => h.position.set(...def.controlPoints[i]));
      return;
    }

    // Rebuild handles
    for (const h of this.handles) {
      this.group.remove(h);
      h.geometry.dispose();
    }
    this.handles = def.controlPoints.map((pt, i) => {
      const geo = new THREE.SphereGeometry(0.1, 8, 6);
      const mesh = new THREE.Mesh(geo, this.viewport.materials.baseHandle);
      mesh.position.set(...pt);
      mesh.userData.editorOnly = true;
      mesh.userData.cpIdx = i;
      this.group.add(mesh);
      return mesh;
    });
  }

  // ── Dragging (DragController) ───────────────────────────────────────────────

  dragHandles(): THREE.Object3D[] {
    return this.handles;
  }

  dragTarget(handle: THREE.Object3D): DragTarget {
    const idx = handle.userData.cpIdx as number;
    return {
      position: () => useCloudStore.getState().preset.base.controlPoints[idx],
      range: RANGES.base.controlPoint,
      moveTo: (position) => useCloudStore.getState().updateBasePoint(idx, position),
    };
  }

  getEdges(): Float32Array {
    const verts: number[] = [];
    const v = new THREE.Vector3();
    this.group.traverse((obj) => {
      if ((obj instanceof THREE.LineSegments || obj instanceof THREE.Line) && !obj.userData.editorOnly) {
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
  }
}
