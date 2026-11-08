import * as THREE from 'three';
import { shallow } from 'zustand/vanilla/shallow';
import type { BaseDef, TailDef, TailSetpoint } from '../../model/types';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import { resolveTailSetpoints, sampleTailPath } from '../../geometry/primitives/tail';
import type { DragSource, DragTarget } from '../DragController';
import { sameValue } from '../sameValue';

/** What the tail's wire and handles are built from: the attachment folds into the setpoints. */
interface TailInputs {
  setpoints: TailSetpoint[];
  radialSegments: number;
  lengthSegments: number;
  curlAmount: number;
}

export class TailMesh implements DragSource {
  private group: THREE.Group;
  private viewport: Viewport;
  private wire: THREE.LineSegments | null = null;
  private handles: THREE.Mesh[] = [];
  /** The inputs the wire and handles show. */
  private shown: TailInputs | null = null;
  private unsubscribe: () => void;

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

  /** Rebuilds when the resolved setpoints or the tail's own settings changed by value, so a base
   *  edit rebuilds the tail only if it moves the attachment point. Handles move, and are rebuilt
   *  only if their number changed. */
  private sync(tail: TailDef, base: BaseDef): void {
    const resolved = resolveTailSetpoints(tail, base);
    const inputs: TailInputs = {
      setpoints: resolved,
      radialSegments: tail.radialSegments,
      lengthSegments: tail.lengthSegments,
      curlAmount: tail.curlAmount,
    };
    if (this.shown && sameValue(this.shown, inputs)) return;
    this.shown = inputs;

    // Rebuild wire
    if (this.wire) {
      this.wire.geometry.dispose();
      this.wire.geometry = this.buildWireframe(tail, resolved);
    } else {
      this.wire = new THREE.LineSegments(this.buildWireframe(tail, resolved), this.viewport.materials.line);
      this.group.add(this.wire);
    }

    if (this.handles.length === resolved.length) {
      this.handles.forEach((h, i) => {
        h.position.set(...resolved[i].position);
        h.userData.spId = tail.setpoints[i]?.id ?? resolved[i].id;
      });
      return;
    }

    // Rebuild handles
    for (const h of this.handles) {
      this.group.remove(h);
      h.geometry.dispose();
    }
    this.handles = resolved.map((sp, i) => {
      const hGeo = new THREE.SphereGeometry(0.08, 8, 6);
      const mesh = new THREE.Mesh(hGeo, this.viewport.materials.tailHandle);
      mesh.position.set(...sp.position);
      mesh.userData.editorOnly = true;
      mesh.userData.spId = tail.setpoints[i]?.id ?? sp.id;
      this.group.add(mesh);
      return mesh;
    });
  }

  // ── Dragging (DragController) ───────────────────────────────────────────────

  dragHandles(): THREE.Object3D[] {
    return this.handles;
  }

  dragTarget(handle: THREE.Object3D): DragTarget {
    const id = handle.userData.spId as string;
    return {
      position: () => useCloudStore.getState().preset.tail.setpoints.find((p) => p.id === id)?.position ?? [0, 0, 0],
      moveTo: (position) => {
        // An attached tail's first setpoint sits on the base: the press holds it, but it stays.
        const tail = useCloudStore.getState().preset.tail;
        if (tail.attachToBase !== 'none' && tail.setpoints[0]?.id === id) return false;
        useCloudStore.getState().updateTailSetpoint(id, { position });
        return true;
      },
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
