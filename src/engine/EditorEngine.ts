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
import { DragController } from './DragController';
import { computeVisibility } from './visibility';
import { createModuleWorker, type WorkerFactory } from './workers';
import { useCloudStore } from '../store/cloudStore';
import { useUiStore, viewFlags } from '../store/uiStore';
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
  readonly drag: DragController;

  private readonly flowCloudJob: WorkerClient<FlowCloudRequest, FlowCloudResult>;
  private readonly cutGlueJob: WorkerClient<CutGlueRequest, CutGlueWorkerResult>;
  private readonly surfaceMeshJob: WorkerClient<SurfaceMeshRequest, SurfaceMeshResult>;
  private readonly resizeObserver: ResizeObserver | null = null;
  private regenerateTimer: ReturnType<typeof setTimeout> | null = null;
  private settleDebounced: ((outcome: JobOutcome<FlowCloudResult>) => void) | null = null;
  /** The Regenerate request whose result the flow-cloud view shows; null before the first. */
  private shownFlowCloud: FlowCloudRequest | null = null;
  private readonly unsubscribeView: () => void;
  private readonly unsubscribeSpirals: () => void;
  private readonly unsubscribeReplacements: () => void;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: EditorEngineOptions = {}) {
    const createWorker = options.createWorker ?? createModuleWorker;

    const vp = new Viewport(canvas, options.createRenderer);
    this.viewport = vp;
    const parent = canvas.parentElement;
    if (parent) vp.resize(parent.clientWidth, parent.clientHeight);
    vp.start();

    this.spheres = new SphereMesh(vp);
    this.base = new BaseMesh(vp);
    this.tail = new TailMesh(vp);
    this.spirals = new SpiralMesh(vp);
    this.gizmo = new AxisGizmo(vp);

    this.flowCloud = new FlowCloud(vp);
    this.cutGlue = new CutGlueResult(vp);

    // Every handle drags through one controller. Each drag is one history gesture, so a drag
    // that moved something is one undo step, committed when it ends.
    this.drag = new DragController(vp, {
      onDragStart: () => useCloudStore.getState().beginGesture(),
      onDragEnd: () => useCloudStore.getState().endGesture(),
    });
    for (const source of [this.spheres, this.base, this.tail, this.spirals, this.gizmo, this.flowCloud]) {
      this.drag.register(source);
    }

    // Each job's state in the uiStore follows its latest request (WorkerClient).
    this.flowCloudJob = new WorkerClient(createWorker('flowCloud'), {
      name: 'flowCloud',
      onResult: (result, request) => {
        // In the mode the request was computed in: the Mode select may have changed since.
        this.flowCloud.show(result, request.flowCloud.wireframe.mode);
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

    // What shows follows the view flags (uiStore) and whether any spiral is flat.
    this.unsubscribeView = useUiStore.subscribe((s, prev) => {
      if (
        s.mode !== prev.mode ||
        s.showAxes !== prev.showAxes ||
        s.showGrid !== prev.showGrid ||
        s.showFlowCloud !== prev.showFlowCloud ||
        s.surfaceMeshVisible !== prev.surfaceMeshVisible
      ) {
        this.applyVisibility();
      }
    });
    this.unsubscribeSpirals = useCloudStore.subscribe((s) => s.preset.spirals, () => this.applyVisibility());
    this.applyVisibility();

    // Another cloud replaced the preset: what was generated from the one before goes.
    this.unsubscribeReplacements = useCloudStore.subscribe((s) => s.replacements, () => this.clearGenerated());

    if (parent && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => vp.resize(parent.clientWidth, parent.clientHeight));
      this.resizeObserver.observe(parent);
    }
  }

  /** Shows and hides each part of the viewport by computeVisibility, the one place that does. */
  private applyVisibility(): void {
    const hasFlatSpirals = useCloudStore.getState().preset.spirals.some((s) => s.thickness === 0);
    const v = computeVisibility({ ...viewFlags(useUiStore.getState()), hasFlatSpirals });
    const vp = this.viewport;
    vp.showAxes(v.axes);
    vp.showGrid(v.grid);
    vp.sphereGroup.visible = v.spheres;
    vp.baseGroup.visible = v.base;
    vp.tailGroup.visible = v.tail;
    vp.spiralGroup.visible = v.spirals;
    vp.showThickSpirals(v.thickSpirals);
    this.spirals.setHandlesVisible(v.spiralHandles);
    vp.gizmoGroup.visible = v.gizmo;
    vp.flowCloudGroup.visible = v.flowCloud;
    this.flowCloud.setHandlesVisible(v.flowCloudHandle);
    vp.cutGlueGroup.visible = v.cutGlue;
    this.cutGlue.setSurfaceMeshVisible(v.cutGlueSurfaceMesh);
  }

  /**
   * Drops what was generated from a cloud the preset no longer holds (Reset, Import, Discard, the
   * autosave restore): the flow cloud and the inputs the surface mesh would union, the clipped
   * wireframe and the surface mesh, and the replies of jobs still computing for it. The exports
   * that need them then refuse as before the first Regenerate.
   */
  private clearGenerated(): void {
    this.flowCloudJob.cancel();
    this.cutGlueJob.cancel();
    this.surfaceMeshJob.cancel();
    this.flowCloud.clear();
    this.shownFlowCloud = null;
    this.cutGlue.clear();
    ui().setHasSurfaceMesh(false);
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
   * run in parallel. Resolves with both outcomes. Both include the flow cloud the last Regenerate
   * produced, unless Show/Hide hides it, in Edit and in Preview alike: the clipped wireframe its
   * bands and flow lines as Show Bands and Show Flow Lines say, the union its volume.
   */
  cutAndGlue(): Promise<[JobOutcome<CutGlueWorkerResult>, JobOutcome<SurfaceMeshResult>]> {
    const preset = useCloudStore.getState().preset;
    const showFlowCloud = useUiStore.getState().showFlowCloud;

    const sphereEdgeGroups = this.spheres.getEdgesGrouped();
    const baseEdges = this.base.getEdges();
    const tailEdges = this.tail.getEdges();
    const spiralEdges = this.spirals.getEdges();
    const flowCloudEdges = showFlowCloud ? this.flowCloud.getEdges() : new Float32Array(0);

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
      includeFlowCloud: showFlowCloud && this.shownFlowCloud !== null,
      flowCloudInput: this.shownFlowCloud,
    });

    return Promise.all([cut, surface]);
  }

  zoomToFit(): void {
    this.viewport.zoomToFit();
  }

  scaffoldGroups(): ScaffoldGroups {
    const vp = this.viewport;
    return { spheres: vp.sphereGroup, base: vp.baseGroup, tail: vp.tailGroup, spirals: vp.spiralGroup };
  }

  /**
   * Releases everything the constructor acquired, last acquired first: the resize observer, the
   * store subscriptions, the drag controller (ending a drag in progress, removing its pointer listeners), each view
   * (store subscriptions, geometries, textures), the workers, then the viewport (render loop,
   * controls, helpers, shared materials, renderer). Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    if (this.regenerateTimer) clearTimeout(this.regenerateTimer);
    this.settleDebounced?.({ status: 'superseded' });
    this.unsubscribeView();
    this.unsubscribeSpirals();
    this.unsubscribeReplacements();
    this.drag.dispose();
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
