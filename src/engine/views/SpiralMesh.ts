import * as THREE from 'three';
import type { SpiralDef } from '../../model/types';
import { Viewport } from '../Viewport';
import { useCloudStore } from '../../store/cloudStore';
import { KeyedMeshSet } from '../KeyedMeshSet';
import type { DragSource, DragTarget } from '../DragController';

/** Smooth curve samples per full 360° turn. 64 gives sub-pixel smoothness at normal zoom. */
const SAMPLES_PER_TURN = 64;

interface SpiralEntry {
  wire: THREE.LineSegments;
  handle: THREE.Mesh;
  objects: readonly THREE.Object3D[];
}

export class SpiralMesh implements DragSource {
  private group: THREE.Group;
  private viewport: Viewport;
  private meshes: KeyedMeshSet<SpiralDef, SpiralEntry>;
  private unsubscribe: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.spiralGroup;
    this.meshes = new KeyedMeshSet(this.group, {
      create: (def) => this.createMesh(def),
      update: (entry, def) => this.updateMesh(entry, def),
    });

    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset.spirals,
      (spirals) => this.sync(spirals)
    );
    this.sync(useCloudStore.getState().preset.spirals);
  }

  /** Call with false in preview mode to hide handles while keeping spiral geometry visible. */
  setHandlesVisible(visible: boolean): void {
    for (const { handle } of this.meshes.values()) {
      handle.visible = visible;
    }
  }

  private sync(spirals: SpiralDef[]): void {
    this.meshes.sync(spirals);
  }

  private createMesh(def: SpiralDef): SpiralEntry {
    const { materials } = this.viewport;
    const wire = new THREE.LineSegments(this.buildGeo(def), materials.line);
    wire.userData.spiralId = def.id;

    const handleGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const handle = new THREE.Mesh(handleGeo, materials.spiralHandle);
    handle.position.set(...def.position);
    handle.userData.spiralId = def.id;
    handle.userData.editorOnly = true;

    return { wire, handle, objects: [wire, handle] };
  }

  private updateMesh(entry: SpiralEntry, def: SpiralDef): void {
    entry.wire.geometry.dispose();
    entry.wire.geometry = this.buildGeo(def);
    entry.handle.position.set(...def.position);
  }

  private buildGeo(def: SpiralDef): THREE.BufferGeometry {
    const thickness = def.thickness;
    if (thickness > 0) return this.buildThickGeo(def);
    return this.buildFlatGeo(def);
  }

  /** Legacy flat-ribbon geometry: 2 spiral curves + connecting rungs. */
  private buildFlatGeo(def: SpiralDef): THREE.BufferGeometry {
    const maxTheta = def.turns * Math.PI * 2;
    if (maxTheta < 0.001 || def.endRadius <= 0) return new THREE.BufferGeometry();

    const N = Math.max(2, Math.round(def.turns * SAMPLES_PER_TURN));
    const startR = Math.max(def.startRadius, 0.001);
    const endR = Math.max(def.endRadius, startR + 0.001);

    const getRadius = (theta: number): number => {
      if (def.spiralType === 'golden') {
        const b = Math.log(endR / startR) / maxTheta;
        return startR * Math.exp(b * theta);
      }
      return startR + (endR - startR) * (theta / maxTheta);
    };

    const P1: THREE.Vector3[] = [];
    const P2: THREE.Vector3[] = [];

    for (let i = 0; i <= N; i++) {
      const theta = (i / N) * maxTheta;
      const r = getRadius(theta);
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      const taper = def.taperPower === 0 ? 1.0 : Math.pow(r / endR, def.taperPower);
      const z = def.separation * taper;
      P1.push(new THREE.Vector3(x, y, 0));
      P2.push(new THREE.Vector3(x, y, z));
    }

    const euler = new THREE.Euler(def.rotation[0], def.rotation[1], def.rotation[2]);
    const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);
    const offset = new THREE.Vector3(...def.position);
    for (const p of [...P1, ...P2]) p.applyMatrix4(rotMat).add(offset);

    const verts: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = P1[i], b = P1[i + 1];
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let i = 0; i < N; i++) {
      const a = P2[i], b = P2[i + 1];
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const totalRungs = Math.max(1, Math.round(def.turns * def.rungDensity));
    for (let j = 0; j <= totalRungs; j++) {
      const idx = Math.min(Math.round((j / totalRungs) * N), N);
      const p1 = P1[idx], p2 = P2[idx];
      verts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return geo;
  }

  /** Thickened coil geometry: 4 edge curves forming a rectangular cross-section
   *  tube along the spiral path, with cross-section rings at rung intervals.
   *  Corner rounding via quarter-circle arcs when cornerRadius > 0. */
  private buildThickGeo(def: SpiralDef): THREE.BufferGeometry {
    const maxTheta = def.turns * Math.PI * 2;
    if (maxTheta < 0.001 || def.endRadius <= 0) return new THREE.BufferGeometry();

    const N = Math.max(2, Math.round(def.turns * SAMPLES_PER_TURN));
    const startR = Math.max(def.startRadius, 0.001);
    const endR = Math.max(def.endRadius, startR + 0.001);
    const thickness = def.thickness;
    const halfThick = thickness / 2;

    const getRadius = (theta: number): number => {
      if (def.spiralType === 'golden') {
        const b = Math.log(endR / startR) / maxTheta;
        return startR * Math.exp(b * theta);
      }
      return startR + (endR - startR) * (theta / maxTheta);
    };

    // 4 corner curves: PA (inner z=0), PB (outer z=0), PC (outer z=sep), PD (inner z=sep)
    const PA: THREE.Vector3[] = [];
    const PB: THREE.Vector3[] = [];
    const PC: THREE.Vector3[] = [];
    const PD: THREE.Vector3[] = [];

    for (let i = 0; i <= N; i++) {
      const theta = (i / N) * maxTheta;
      const r = getRadius(theta);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const taper = def.taperPower === 0 ? 1.0 : Math.pow(r / endR, def.taperPower);
      const sep = def.separation * taper;

      // Radial direction in local XY plane
      const rx = cosT;
      const ry = sinT;

      // Center of the spiral arm at this angle
      const cx = r * cosT;
      const cy = r * sinT;

      PA.push(new THREE.Vector3(cx - halfThick * rx, cy - halfThick * ry, 0));
      PB.push(new THREE.Vector3(cx + halfThick * rx, cy + halfThick * ry, 0));
      PC.push(new THREE.Vector3(cx + halfThick * rx, cy + halfThick * ry, sep));
      PD.push(new THREE.Vector3(cx - halfThick * rx, cy - halfThick * ry, sep));
    }

    // Apply rotation + translation
    const euler = new THREE.Euler(def.rotation[0], def.rotation[1], def.rotation[2]);
    const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);
    const offset = new THREE.Vector3(...def.position);
    for (const p of [...PA, ...PB, ...PC, ...PD]) p.applyMatrix4(rotMat).add(offset);

    const verts: number[] = [];

    // ── 4 longitudinal edge curves ──
    for (const curve of [PA, PB, PC, PD]) {
      for (let i = 0; i < N; i++) {
        const a = curve[i], b = curve[i + 1];
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    // ── Cross-section rings at rung intervals ──
    const totalRings = Math.max(1, Math.round(def.turns * def.rungDensity));
    const cornerR = def.cornerRadius;
    const ARC_SEGS = 4; // segments per quarter-circle corner arc

    for (let j = 0; j <= totalRings; j++) {
      const idx = Math.min(Math.round((j / totalRings) * N), N);
      const pa = PA[idx], pb = PB[idx], pc = PC[idx], pd = PD[idx];

      if (cornerR <= 0) {
        // Sharp corners: 4 straight edges
        verts.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z); // bottom
        verts.push(pb.x, pb.y, pb.z, pc.x, pc.y, pc.z); // outer
        verts.push(pc.x, pc.y, pc.z, pd.x, pd.y, pd.z); // top
        verts.push(pd.x, pd.y, pd.z, pa.x, pa.y, pa.z); // inner
      } else {
        // Rounded corners: compute the cross-section in local space, then transform
        // The 4 corners of the rect are pa, pb, pc, pd (already in world space).
        // We compute the rounded rectangle by interpolating along edges with arc insets.
        const theta = (idx / N) * maxTheta;
        const r = getRadius(theta);
        const taper = def.taperPower === 0 ? 1.0 : Math.pow(r / endR, def.taperPower);
        const sep = def.separation * taper;
        const cr = Math.min(cornerR, Math.min(halfThick, sep / 2));

        if (cr < 0.001) {
          // Negligible corner radius — draw sharp
          verts.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
          verts.push(pb.x, pb.y, pb.z, pc.x, pc.y, pc.z);
          verts.push(pc.x, pc.y, pc.z, pd.x, pd.y, pd.z);
          verts.push(pd.x, pd.y, pd.z, pa.x, pa.y, pa.z);
        } else {
          // Build rounded rectangle in local 2D (radial, separation) then transform.
          // Local 2D origin = center of cross-section at this spiral sample.
          // radial axis = R direction, separation axis = Z direction (before rotation).
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          const cx = r * cosT;
          const cy = r * sinT;

          // Local half-dims
          const hx = halfThick;  // radial half-extent
          const hy = sep / 2;    // separation half-extent

          // Generate rounded rect points in local 2D (radial, sep) coordinates
          // Walk CCW: bottom-left corner arc, bottom-right, top-right, top-left
          const localPts: [number, number][] = [];

          // Corner centers in local 2D
          const corners: [number, number, number, number][] = [
            [-hx + cr, -hy + cr, Math.PI, Math.PI * 1.5],     // bottom-left (PA corner)
            [ hx - cr, -hy + cr, Math.PI * 1.5, Math.PI * 2], // bottom-right (PB corner)
            [ hx - cr,  hy - cr, 0, Math.PI * 0.5],           // top-right (PC corner)
            [-hx + cr,  hy - cr, Math.PI * 0.5, Math.PI],     // top-left (PD corner)
          ];

          for (const [ccx, ccy, startA, endA] of corners) {
            for (let k = 0; k <= ARC_SEGS; k++) {
              const a = startA + (endA - startA) * (k / ARC_SEGS);
              localPts.push([ccx + cr * Math.cos(a), ccy + cr * Math.sin(a)]);
            }
          }

          // Transform local 2D → world 3D:
          // local radial coord → offset along R = (cosT, sinT, 0)
          // local sep coord → offset along Z = (0, 0, 1)
          // Both relative to spiral center (cx, cy, 0), then midpoint shifted up by sep/2
          const worldPts: THREE.Vector3[] = [];
          for (const [lr, ls] of localPts) {
            const p = new THREE.Vector3(
              cx + lr * cosT,
              cy + lr * sinT,
              hy + ls  // sep/2 + local sep offset → maps [-hy,hy] to [0, sep]
            );
            p.applyMatrix4(rotMat).add(offset);
            worldPts.push(p);
          }

          // Emit line segments around the ring
          for (let k = 0; k < worldPts.length; k++) {
            const a = worldPts[k];
            const b = worldPts[(k + 1) % worldPts.length];
            verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return geo;
  }

  // ── Dragging (DragController) ───────────────────────────────────────────────

  dragHandles(): THREE.Object3D[] {
    return Array.from(this.meshes.values(), (entry) => entry.handle);
  }

  dragTarget(handle: THREE.Object3D): DragTarget {
    const id = handle.userData.spiralId as string;
    return {
      position: () => useCloudStore.getState().preset.spirals.find((s) => s.id === id)!.position,
      moveTo: (position) => {
        useCloudStore.getState().updateSpiral(id, { position });
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

  /** Per-spiral edge groups for Cut & Glue self-exclusion (analogous to SphereMesh.getEdgesGrouped). */
  getEdgesGrouped(): Array<{ spiralId: string; edges: Float32Array }> {
    const result: Array<{ spiralId: string; edges: Float32Array }> = [];
    const v = new THREE.Vector3();
    for (const [id, { wire }] of this.meshes) {
      const verts: number[] = [];
      wire.updateWorldMatrix(true, false);
      const pos = wire.geometry.attributes.position;
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(wire.matrixWorld);
          verts.push(v.x, v.y, v.z);
        }
      }
      result.push({ spiralId: id, edges: new Float32Array(verts) });
    }
    return result;
  }

  dispose(): void {
    this.unsubscribe();
    this.meshes.clear();
  }
}
