import type * as THREE from 'three';
import { Viewport, type RendererFactory } from './Viewport';
import { SphereMesh } from './views/SphereMesh';
import { BaseMesh } from './views/BaseMesh';
import { TailMesh } from './views/TailMesh';
import { SpiralMesh } from './views/SpiralMesh';
import { AxisGizmo } from './views/AxisGizmo';
import { FlowCloud } from './views/FlowCloud';
import { CutGlueResult } from './views/CutGlueResult';
import { createModuleWorker, type WorkerFactory } from './workers';
import { useCloudStore } from '../store/cloudStore';
import { useUiStore } from '../store/uiStore';
import type { CutGlueRequest, CutGlueResponse, SurfaceMeshRequest, SurfaceMeshResponse } from '../workers/protocol';

export interface EditorEngineOptions {
  /** Creates the renderer; the default is a WebGLRenderer. */
  createRenderer?: RendererFactory;
  /** Starts each geometry worker; the default starts the module workers. */
  createWorker?: WorkerFactory;
}

export type EditorMode = 'edit' | 'preview';

/** The scaffold groups the GLB exports clone. */
export interface ScaffoldGroups {
  spheres: THREE.Group;
  base: THREE.Group;
  tail: THREE.Group;
  spirals: THREE.Group;
}

const ui = () => useUiStore.getState();

/**
 * The editor's three.js side: the viewport, a view per primitive, the axis gizmo, the Cut & Glue
 * result and the three geometry workers, wired to the stores. React mounts one per canvas
 * (useEditorEngine) and disposes it on unmount; dispose() releases everything the constructor
 * acquired, so a remount leaves nothing behind.
 */
export class EditorEngine {
  readonly viewport: Viewport;
  readonly spheres: SphereMesh;
  readonly base: BaseMesh;
  readonly tail: TailMesh;
  readonly spirals: SpiralMesh;
  readonly gizmo: AxisGizmo;
  readonly flowCloud: FlowCloud;
  readonly cutGlue: CutGlueResult;

  private readonly workers: Worker[];
  private readonly cutGlueWorker: Worker;
  private readonly surfaceMeshWorker: Worker;
  private readonly resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: EditorEngineOptions = {}) {
    const createWorker = options.createWorker ?? createModuleWorker;

    const vp = new Viewport(canvas, options.createRenderer);
    this.viewport = vp;
    const parent = canvas.parentElement;
    if (parent) vp.resize(parent.clientWidth, parent.clientHeight);
    vp.start();

    // Construction order is drag priority until the DragController: the first view whose
    // handle is under the pointer takes the drag.
    this.spheres = new SphereMesh(vp);
    this.base = new BaseMesh(vp);
    this.tail = new TailMesh(vp);
    this.spirals = new SpiralMesh(vp);
    this.gizmo = new AxisGizmo(vp);

    const flowCloudWorker = createWorker('flowCloud');
    this.flowCloud = new FlowCloud(vp, flowCloudWorker);
    this.flowCloud.onGenerateStart = () => ui().setRunning('flowCloud', true);
    this.flowCloud.onGenerateDone = () => ui().setRunning('flowCloud', false);

    this.cutGlue = new CutGlueResult(vp);

    this.cutGlueWorker = createWorker('cutAndGlue');
    this.cutGlueWorker.onmessage = (ev: MessageEvent<CutGlueResponse>) => {
      if ('error' in ev.data) {
        console.error('cutAndGlue worker error:', ev.data.error);
      } else {
        this.cutGlue.update(ev.data.clippedEdges);
      }
      ui().setRunning('cutAndGlue', false);
    };
    this.cutGlueWorker.onerror = (err) => {
      console.error('cutAndGlue worker error', err);
      ui().setRunning('cutAndGlue', false);
    };

    // The surface mesh worker (marching cubes on the union SDF)
    this.surfaceMeshWorker = createWorker('surfaceMesh');
    this.surfaceMeshWorker.onmessage = (ev: MessageEvent<SurfaceMeshResponse>) => {
      if ('error' in ev.data) {
        console.error('surfaceMesh worker error:', ev.data.error);
      } else {
        this.cutGlue.updateSurfaceMesh(ev.data.positions, ev.data.indices);
        ui().setHasSurfaceMesh(this.cutGlue.hasSurfaceMesh());
      }
      ui().setRunning('surfaceMesh', false);
    };
    this.surfaceMeshWorker.onerror = (err) => {
      console.error('surfaceMesh worker error', err);
      ui().setRunning('surfaceMesh', false);
    };

    this.workers = [flowCloudWorker, this.cutGlueWorker, this.surfaceMeshWorker];

    if (parent && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => vp.resize(parent.clientWidth, parent.clientHeight));
      this.resizeObserver.observe(parent);
    }
  }

  /** Regenerates the flow cloud from the current preset (debounced by the view). */
  regenerate(): void {
    this.flowCloud.regenerate();
  }

  /** Clips every wireframe against the other primitives' volumes and meshes the union. */
  cutAndGlue(): void {
    const preset = useCloudStore.getState().preset;
    ui().setRunning('cutAndGlue', true);

    const sphereEdgeGroups = this.spheres.getEdgesGrouped();
    const baseEdges = this.base.getEdges();
    const tailEdges = this.tail.getEdges();
    const spiralEdges = this.spirals.getEdges();
    const flowCloudEdges = this.flowCloud.getEdges();

    this.cutGlueWorker.postMessage({
      spheres: preset.spheres,
      base: preset.base,
      tail: preset.tail,
      sphereEdgeGroups,
      baseEdges,
      tailEdges,
      spiralEdges,
      flowCloudEdges,
    } satisfies CutGlueRequest);

    // Surface mesh generation runs in parallel
    ui().setRunning('surfaceMesh', true);
    this.surfaceMeshWorker.postMessage({
      spheres: preset.spheres,
      base: preset.base,
      tail: preset.tail,
      flowCloud: preset.flowCloud,
      spirals: preset.spirals,
      resolution: preset.surfaceMeshResolution,
    } satisfies SurfaceMeshRequest);
  }

  /** Edit shows the scaffold and its handles; Preview shows the Cut & Glue result. */
  setMode(mode: EditorMode, surfaceMeshVisible: boolean): void {
    const vp = this.viewport;
    vp.sphereGroup.visible = mode === 'edit';
    vp.baseGroup.visible = mode === 'edit';
    vp.tailGroup.visible = mode === 'edit';
    // Spirals: visible in edit mode. In preview with surface mesh, only show
    // spiralGroup if there are flat spirals (thick ones are in the SDF mesh).
    const hasFlatSpirals = useCloudStore.getState().preset.spirals.some((s) => s.thickness === 0);
    vp.spiralGroup.visible = mode === 'edit' || (mode === 'preview' && surfaceMeshVisible && hasFlatSpirals);
    vp.gizmoGroup.visible = mode === 'edit';
    vp.flowCloudGroup.visible = mode === 'edit';
    vp.cutGlueGroup.visible = mode === 'preview';
    this.spirals.setHandlesVisible(mode === 'edit');
    this.flowCloud.setHandlesVisible(mode === 'edit');
  }

  /** Shows the surface mesh instead of the clipped wireframe in the Cut & Glue result. */
  setSurfaceMeshVisible(visible: boolean, mode: EditorMode): void {
    this.cutGlue.setSurfaceMeshVisible(visible);
    // Thick spirals are included in the SDF surface mesh.
    // Flat spirals (thickness=0) still need the spiralGroup workaround.
    if (mode === 'preview') {
      const hasFlatSpirals = useCloudStore.getState().preset.spirals.some((s) => s.thickness === 0);
      this.viewport.spiralGroup.visible = visible && hasFlatSpirals;
      this.spirals.setHandlesVisible(false);
    }
  }

  setFlowCloudVisible(visible: boolean): void {
    this.viewport.flowCloudGroup.visible = visible;
  }

  showAxes(visible: boolean): void {
    this.viewport.showAxes(visible);
  }

  showGrid(visible: boolean): void {
    this.viewport.showGrid(visible);
  }

  zoomToFit(): void {
    this.viewport.zoomToFit();
  }

  scaffoldGroups(): ScaffoldGroups {
    const vp = this.viewport;
    return { spheres: vp.sphereGroup, base: vp.baseGroup, tail: vp.tailGroup, spirals: vp.spiralGroup };
  }

  /**
   * Releases everything the constructor acquired, last acquired first: the resize observer, each
   * view (store subscriptions, pointer listeners, geometries, materials, textures), the workers,
   * then the viewport (render loop, controls, helpers, renderer). Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.cutGlue.dispose();
    this.flowCloud.dispose();
    this.gizmo.dispose();
    this.spirals.dispose();
    this.tail.dispose();
    this.base.dispose();
    this.spheres.dispose();
    for (const worker of this.workers) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    this.viewport.dispose();
    ui().resetEngineState();
  }
}
