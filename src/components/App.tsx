import { useRef, useState, useCallback, useEffect } from 'react';
import { ViewportCanvas } from './ViewportCanvas';
import { Toolbar } from './Toolbar';
import { SpherePanel } from './SpherePanel';
import { BasePanel } from './BasePanel';
import { TailPanel } from './TailPanel';
import { SpiralPanel } from './SpiralPanel';
import { FlowCloudPanel } from './FlowCloudPanel';
import { ExportPanel } from './ExportPanel';
import { Viewport } from '../three/Viewport';
import { SphereMesh } from '../three/SphereMesh';
import { BaseMesh } from '../three/BaseMesh';
import { TailMesh } from '../three/TailMesh';
import { SpiralMesh } from '../three/SpiralMesh';
import { FlowCloud } from '../three/FlowCloud';
import { CutGlueResult } from '../three/CutGlueResult';
import { AxisGizmo } from '../three/AxisGizmo';
import { useCloudStore } from '../store/cloudStore';
import { useHistoryStore } from '../store/historyStore';
import type { CutGlueRequest, CutGlueResponse, SurfaceMeshRequest } from '../workers/protocol';
import * as THREE from 'three';

type PanelId = 'spheres' | 'base' | 'tail' | 'spirals' | 'flowCloud' | 'export';

export function App() {
  const vpRef              = useRef<Viewport | null>(null);
  const flowCloudGroupRef  = useRef<THREE.Group | null>(null);
  const flowCloudRef       = useRef<FlowCloud | null>(null);
  const spiralMeshRef      = useRef<SpiralMesh | null>(null);
  const sphereMeshRef      = useRef<SphereMesh | null>(null);
  const baseMeshRef        = useRef<BaseMesh | null>(null);
  const tailMeshRef        = useRef<TailMesh | null>(null);
  const cutGlueRef            = useRef<CutGlueResult | null>(null);
  const cutGlueWorkerRef      = useRef<Worker | null>(null);
  const surfaceMeshWorkerRef  = useRef<Worker | null>(null);

  const [mode, setMode]                     = useState<'edit' | 'preview'>('edit');
  const [showAxes, setShowAxes]             = useState(true);
  const [showGrid, setShowGrid]             = useState(true);
  const [showFlowCloud, setShowFlowCloud]   = useState(true);
  const [openPanels, setOpenPanels]         = useState<Set<PanelId>>(
    new Set(['spheres', 'flowCloud'])
  );
  const [generating, setGenerating]         = useState(false);
  const [cutGlueGenerating, setCutGlueGenerating] = useState(false);
  const [surfaceMeshGenerating, setSurfaceMeshGenerating] = useState(false);
  const [surfaceMeshVisible, setSurfaceMeshVisible] = useState(false);

  const preset     = useCloudStore((s) => s.preset);
  const loadPreset = useCloudStore((s) => s.loadPreset);
  const push       = useHistoryStore((s) => s.push);
  const undo       = useHistoryStore((s) => s.undo);
  const redo       = useHistoryStore((s) => s.redo);
  const canUndo    = useHistoryStore((s) => s.canUndo());
  const canRedo    = useHistoryStore((s) => s.canRedo());

  useEffect(() => {
    push(preset);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (canUndo) { const prev = undo(); if (prev) loadPreset(prev); }
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key === 'z') || e.key === 'y')) {
        e.preventDefault();
        if (canRedo) { const next = redo(); if (next) loadPreset(next); }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [canUndo, canRedo]);

  // ── Viewport init ──────────────────────────────────────────────────────────

  const handleViewportReady = useCallback((vp: Viewport) => {
    vpRef.current          = vp;
    flowCloudGroupRef.current = vp.flowCloudGroup;

    const sm = new SphereMesh(vp);
    sphereMeshRef.current = sm;
    const bm = new BaseMesh(vp);
    baseMeshRef.current = bm;
    const tm = new TailMesh(vp);
    tailMeshRef.current = tm;
    spiralMeshRef.current = new SpiralMesh(vp);
    new AxisGizmo(vp);

    const fc = new FlowCloud(vp);
    fc.onGenerateStart = () => setGenerating(true);
    fc.onGenerateDone  = () => setGenerating(false);
    flowCloudRef.current = fc;

    cutGlueRef.current = new CutGlueResult(vp);

    // Set up the cut & glue worker
    const worker = new Worker(
      new URL('../workers/cutAndGlue.worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (ev: MessageEvent<CutGlueResponse>) => {
      if ('error' in ev.data) {
        console.error('cutAndGlue worker error:', ev.data.error);
      } else {
        cutGlueRef.current?.update(ev.data.clippedEdges);
      }
      setCutGlueGenerating(false);
    };
    worker.onerror = (err) => {
      console.error('cutAndGlue worker error', err);
      setCutGlueGenerating(false);
    };
    cutGlueWorkerRef.current = worker;

    // Set up the surface mesh worker (SDF-based marching cubes)
    const smWorker = new Worker(
      new URL('../workers/surfaceMesh.worker.ts', import.meta.url),
      { type: 'module' }
    );
    smWorker.onmessage = (ev: MessageEvent) => {
      const { positions, indices, error } = ev.data as {
        positions?: Float32Array;
        indices?: Uint32Array;
        error?: string;
      };
      if (error) {
        console.error('surfaceMesh worker error:', error);
      } else if (positions && indices) {
        cutGlueRef.current?.updateSurfaceMesh(positions, indices);
      }
      setSurfaceMeshGenerating(false);
    };
    smWorker.onerror = (err) => {
      console.error('surfaceMesh worker error', err);
      setSurfaceMeshGenerating(false);
    };
    surfaceMeshWorkerRef.current = smWorker;

    vp.showAxes(showAxes);
    vp.showGrid(showGrid);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleRegenerate() { flowCloudRef.current?.regenerate(); }

  function handleCutAndGlue() {
    const worker = cutGlueWorkerRef.current;
    if (!worker) return;
    const preset = useCloudStore.getState().preset;
    setCutGlueGenerating(true);

    const sphereEdgeGroups = sphereMeshRef.current?.getEdgesGrouped() ?? [];
    const baseEdges        = baseMeshRef.current?.getEdges()        ?? new Float32Array(0);
    const tailEdges        = tailMeshRef.current?.getEdges()        ?? new Float32Array(0);
    const spiralEdges      = spiralMeshRef.current?.getEdges()       ?? new Float32Array(0);
    const flowCloudEdges   = flowCloudRef.current?.getEdges()       ?? new Float32Array(0);

    // Do NOT transfer the buffers — the arrays are shared with live Three.js geometry.
    worker.postMessage({
      spheres:    preset.spheres,
      base:       preset.base,
      tail:       preset.tail,
      sphereEdgeGroups,
      baseEdges,
      tailEdges,
      spiralEdges,
      flowCloudEdges,
    } satisfies CutGlueRequest);

    // Dispatch surface mesh generation in parallel (SDF-based MC)
    const smWorker = surfaceMeshWorkerRef.current;
    if (smWorker) {
      setSurfaceMeshGenerating(true);
      smWorker.postMessage({
        spheres:    preset.spheres,
        base:       preset.base,
        tail:       preset.tail,
        flowCloud:  preset.flowCloud,
        spirals:    preset.spirals,
        resolution: preset.surfaceMeshResolution,
      } satisfies SurfaceMeshRequest);
    }
  }

  function handleToggleSurfaceMesh(v: boolean) {
    setSurfaceMeshVisible(v);
    cutGlueRef.current?.setSurfaceMeshVisible(v);
    // Thick spirals are now included in the SDF surface mesh.
    // Flat spirals (thickness=0) still need the spiralGroup workaround.
    if (vpRef.current && mode === 'preview') {
      const hasFlatSpirals = preset.spirals.some(s => s.thickness === 0);
      vpRef.current.spiralGroup.visible = v && hasFlatSpirals;
      spiralMeshRef.current?.setHandlesVisible(false);
    }
  }

  function handleToggleFlowCloud() {
    const next = !showFlowCloud;
    setShowFlowCloud(next);
    if (vpRef.current) vpRef.current.flowCloudGroup.visible = next;
  }

  function getScaffoldGroups() {
    const vp = vpRef.current;
    if (!vp) return null;
    return { spheres: vp.sphereGroup, base: vp.baseGroup, tail: vp.tailGroup, spirals: vp.spiralGroup };
  }

  function togglePanel(id: PanelId) {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleModeChange(m: 'edit' | 'preview') {
    setMode(m);
    if (vpRef.current) {
      vpRef.current.sphereGroup.visible     = m === 'edit';
      vpRef.current.baseGroup.visible      = m === 'edit';
      vpRef.current.tailGroup.visible      = m === 'edit';
      // Spirals: visible in edit mode. In preview with surface mesh, only show
      // spiralGroup if there are flat spirals (thick ones are in the SDF mesh).
      const hasFlatSpirals = preset.spirals.some(s => s.thickness === 0);
      vpRef.current.spiralGroup.visible    = m === 'edit' || (m === 'preview' && surfaceMeshVisible && hasFlatSpirals);
      vpRef.current.gizmoGroup.visible     = m === 'edit';
      vpRef.current.flowCloudGroup.visible = m === 'edit';
      vpRef.current.cutGlueGroup.visible = m === 'preview';
    }
    spiralMeshRef.current?.setHandlesVisible(m === 'edit');
    flowCloudRef.current?.setHandlesVisible(m === 'edit');
  }

  function handleToggleAxes() { const n = !showAxes; setShowAxes(n); vpRef.current?.showAxes(n); }
  function handleToggleGrid()  { const n = !showGrid; setShowGrid(n); vpRef.current?.showGrid(n); }
  function handleZoomFit()     { vpRef.current?.zoomToFit(); }

  // ── Panel list ─────────────────────────────────────────────────────────────

  const panels: { id: PanelId; label: string; component: React.ReactNode }[] = [
    { id: 'spheres', label: `Spheres (${preset.spheres.length})`,         component: <SpherePanel /> },
    { id: 'base',    label: 'Base',                                        component: <BasePanel /> },
    { id: 'tail',    label: 'Tail',                                        component: <TailPanel /> },
    { id: 'spirals', label: `Spirals (${preset.spirals.length})`,  component: <SpiralPanel /> },
    {
      id: 'flowCloud',
      label: 'Flow Cloud',
      component: (
        <FlowCloudPanel
          onRegenerate={handleRegenerate}
          generating={generating}
          showFlowCloud={showFlowCloud}
          onToggleFlowCloud={handleToggleFlowCloud}
          onCutAndGlue={handleCutAndGlue}
          cutGlueGenerating={cutGlueGenerating || surfaceMeshGenerating}
          surfaceMeshVisible={surfaceMeshVisible}
          onToggleSurfaceMesh={handleToggleSurfaceMesh}
          hasSurfaceMesh={cutGlueRef.current?.hasSurfaceMesh() ?? false}
        />
      ),
    },
    {
      id: 'export',
      label: 'Export',
      component: (
        <ExportPanel
          getFlowCloudGroup={() => flowCloudGroupRef.current}
          getScaffoldGroups={getScaffoldGroups}
          getCutGlueEdges={() => cutGlueRef.current?.getEdges() ?? new Float32Array(0)}
        />
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <Toolbar
        mode={mode}
        onModeChange={handleModeChange}
        showAxes={showAxes}
        onToggleAxes={handleToggleAxes}
        showGrid={showGrid}
        onToggleGrid={handleToggleGrid}
        onZoomFit={handleZoomFit}
      />
      <div className="app-body">
        <div className="viewport-wrap">
          <ViewportCanvas onViewportReady={handleViewportReady} />
        </div>
        <div className="sidebar">
          {panels.map(({ id, label, component }) => (
            <div key={id} className="accordion">
              <button
                className={`accordion-header ${openPanels.has(id) ? 'open' : ''}`}
                onClick={() => togglePanel(id)}
              >
                <span>{label}</span>
                <span>{openPanels.has(id) ? '▲' : '▼'}</span>
              </button>
              {openPanels.has(id) && <div className="accordion-body">{component}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
