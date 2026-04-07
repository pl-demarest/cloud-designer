import * as THREE from 'three';
import { Viewport } from './Viewport';
import { useCloudStore } from '../store/cloudStore';
import type { CloudPreset } from '../types/cloud';

const BLACK = new THREE.LineBasicMaterial({ color: 0x000000 });

interface WorkerResult {
  vertices: Float32Array;
  indices: Uint32Array;
  bands: Float32Array[];
  flowLines: Float32Array[];
  error?: string;
}

export class MergedCloud {
  private viewport: Viewport;
  private group: THREE.Group;
  private worker: Worker;
  private pending = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentObjects: THREE.Object3D[] = [];
  private unsubscribe: () => void;

  onGenerateStart?: () => void;
  onGenerateDone?: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.group = viewport.mergeGroup;

    this.worker = new Worker(
      new URL('../workers/marchingCubes.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = this.onWorkerMessage;
    this.worker.onerror = (e) => {
      console.error('Marching cubes worker error', e);
      this.pending = false;
      this.onGenerateDone?.();
    };

    this.unsubscribe = useCloudStore.subscribe(
      (s) => s.preset,
      () => {
        // Only auto-regenerate the spiral extraction part when wireframe changes;
        // full marching cubes is triggered by the Regenerate button
      }
    );
  }

  /** Trigger full regeneration (marching cubes + spiral extraction). */
  regenerate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.dispatch(), 50);
  }

  private dispatch(): void {
    if (this.pending) return;
    this.pending = true;
    this.onGenerateStart?.();

    const preset = useCloudStore.getState().preset;
    this.worker.postMessage({
      swirls: preset.swirls,
      base: preset.base,
      tail: preset.tail,
      merge: preset.merge,
    });
  }

  private onWorkerMessage = (e: MessageEvent<WorkerResult>): void => {
    this.pending = false;
    this.onGenerateDone?.();

    const { vertices, indices, bands, flowLines, error } = e.data;
    if (error) {
      console.error('MergedCloud worker error:', error);
      return;
    }

    this.clearScene();

    const preset = useCloudStore.getState().preset;
    const mode = preset.merge.wireframe.mode;

    if (mode === 'edges' && vertices.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      const edges = new THREE.EdgesGeometry(geo, 15);
      const lines = new THREE.LineSegments(edges, BLACK.clone());
      geo.dispose();
      this.group.add(lines);
      this.currentObjects.push(lines);
    } else if (mode === 'spiral') {
      const spiralGroup = new THREE.Group();
      spiralGroup.name = 'spiralGroup';

      if (preset.merge.wireframe.showBands) {
        for (const bandArr of bands) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(bandArr, 3));
          const line = new THREE.Line(geo, BLACK.clone());
          spiralGroup.add(line);
        }
      }

      if (preset.merge.wireframe.showFlowLines) {
        for (const flArr of flowLines) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(flArr, 3));
          const line = new THREE.Line(geo, BLACK.clone());
          spiralGroup.add(line);
        }
      }

      this.group.add(spiralGroup);
      this.currentObjects.push(spiralGroup);
    }
  };

  private clearScene(): void {
    for (const obj of this.currentObjects) {
      this.group.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
        }
      });
    }
    this.currentObjects = [];
  }

  isGenerating(): boolean {
    return this.pending;
  }

  dispose(): void {
    this.unsubscribe();
    this.worker.terminate();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.clearScene();
  }
}
