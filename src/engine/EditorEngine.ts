import type * as THREE from 'three';
import { Viewport, type RendererFactory } from './Viewport';
import { SphereMesh } from './views/SphereMesh';
import { BaseMesh } from './views/BaseMesh';
import { TailMesh } from './views/TailMesh';
import { SpiralMesh } from './views/SpiralMesh';
import { AxisGizmo } from './views/AxisGizmo';
import { FlowCloud } from './views/FlowCloud';
import { CutGlueResult } from './views/CutGlueResult';
import { WorkerClient, type JobOutcome } from './WorkerClient';
import { createModuleWorker, type WorkerFactory } from './workers';
import { useCloudStore } from '../store/cloudStore';
import { useUiStore } from '../store/uiStore';
import type {
  CutGlueRequest,
  CutGlueResult as CutGlueWorkerResult,
  FlowCloudRequest,
  FlowCloudResult,
  SurfaceMeshRequest,
  SurfaceMeshResult,
} from '../workers/protocol';

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

/** Regenerate waits this long for further clicks before it sends the request. */
const REGENERATE_DEBOUNCE_MS = 50;

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

  private readonly flowCloudJob: WorkerClient<FlowCloudRequest, FlowCloudResult>;
  private readonly cutGlueJob: WorkerClient<CutGlueRequest, CutGlueWorkerResult>;
  private readonly surfaceMeshJob: WorkerClient<SurfaceMeshRequest, SurfaceMeshResult>;
  private readonly resizeObserver: ResizeObserver | null = null;
  private regenerateTimer: ReturnType<typeof setTimeout> | null = null;
  private settleDebounced: ((outcome: JobOutcome<FlowCloudResult>) => void) | null = null;
  /** The Regenerate request whose result the flow-cloud view shows; null before the first. */
  private shownFlowCloud: FlowCloudRequest | null = null;
  /** Show/Hide: whether the user shows the flow cloud (the mode hides it in Preview as well). */
  private flowCloudVisible = true;
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

    this.flowCloud = new FlowCloud(vp);
    this.cutGlue = new CutGlueResult(vp);

    // Each job's state in the uiStore follows its latest request (WorkerClient).
    this.flowCloudJob = new WorkerClient(createWorker('flowCloud'), {
      name: 'flowCloud',
      onResult: (result, request) => {
        this.flowCloud.show(result);
        this.shownFlowCloud = request;
      },
      onState: (state) => ui().setJob('flowCloud', state),
    });
    this.cutGlueJob = new WorkerClient(createWorker('cutAndGlue'), {
      name: 'cutAndGlue',
      onResult: (result) => this.cutGlue.update(result.clippedEdges),
      onState: (state) => ui().setJob('cutAndGlue', state),
    });
    // Marching cubes on the union SDF
    this.surfaceMeshJob = new WorkerClient(createWorker('surfaceMesh'), {
      name: 'surfaceMesh',
      onResult: (result) => {
        this.cutGlue.updateSurfaceMesh(result.positions, result.indices);
        ui().setHasSurfaceMesh(this.cutGlue.hasSurfaceMesh());
      },
      onState: (state) => ui().setJob('surfaceMesh', state),
    });

    if (parent && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => vp.resize(parent.clientWidth, parent.clientHeight));
      this.resizeObserver.observe(parent);
    }
  }

  /**
   * Regenerates the flow cloud from the preset as it is when the request goes out, 50 ms after
   * the last call. A call while a job runs is not lost: its request runs when the job finishes
   * (WorkerClient). Resolves with the outcome; a call that a later one replaced within the 50 ms,
   * or whose request a later one superseded, resolves 'superseded'.
   */
  regenerate(): Promise<JobOutcome<FlowCloudResult>> {
    if (this.regenerateTimer) clearTimeout(this.regenerateTimer);
    this.settleDebounced?.({ status: 'superseded' });
    return new Promise((settle) => {
      this.settleDebounced = settle;
      this.regenerateTimer = setTimeout(() => {
        this.regenerateTimer = null;
        this.settleDebounced = null;
        const { spheres, base, tail, flowCloud } = useCloudStore.getState().preset;
        void this.flowCloudJob.request({ spheres, base, tail, flowCloud }).then(settle);
      }, REGENERATE_DEBOUNCE_MS);
    });
  }

  /**
   * Clips every wireframe against the other primitives' volumes and meshes the union: two jobs,
   * run in parallel. Resolves with both outcomes. The union includes the flow cloud the viewport
   * shows, if any: the one the last Regenerate produced, unless Show/Hide hides it.
   */
  cutAndGlue(): Promise<[JobOutcome<CutGlueWorkerResult>, JobOutcome<SurfaceMeshResult>]> {
    const preset = useCloudStore.getState().preset;

    const sphereEdgeGroups = this.spheres.getEdgesGrouped();
    const baseEdges = this.base.getEdges();
    const tailEdges = this.tail.getEdges();
    const spiralEdges = this.spirals.getEdges();
    const flowCloudEdges = this.flowCloud.getEdges();

    const cut = this.cutGlueJob.request({
      spheres: preset.spheres,
      base: preset.base,
      tail: preset.tail,
      sphereEdgeGroups,
      baseEdges,
      tailEdges,
      spiralEdges,
      flowCloudEdges,
    });

    const surface = this.surfaceMeshJob.request({
      spheres: preset.spheres,
      base: preset.base,
      tail: preset.tail,
      flowCloud: preset.flowCloud,
      spirals: preset.spirals,
      resolution: preset.surfaceMeshResolution,
      includeFlowCloud: this.flowCloudVisible && this.shownFlowCloud !== null,
      flowCloudInput: this.shownFlowCloud,
    });

    return Promise.all([cut, surface]);
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

  /** Show/Hide for the flow cloud. */
  setFlowCloudVisible(visible: boolean): void {
    this.flowCloudVisible = visible;
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
    if (this.regenerateTimer) clearTimeout(this.regenerateTimer);
    this.settleDebounced?.({ status: 'superseded' });
    this.cutGlue.dispose();
    this.flowCloud.dispose();
    this.gizmo.dispose();
    this.spirals.dispose();
    this.tail.dispose();
    this.base.dispose();
    this.spheres.dispose();
    this.flowCloudJob.dispose();
    this.cutGlueJob.dispose();
    this.surfaceMeshJob.dispose();
    this.viewport.dispose();
    ui().resetEngineState();
  }
}
