import { useRef, useState, useEffect } from 'react';
import { ViewportCanvas } from './ViewportCanvas';
import { Toolbar } from './Toolbar';
import { SpherePanel } from './panels/SpherePanel';
import { BasePanel } from './panels/BasePanel';
import { TailPanel } from './panels/TailPanel';
import { SpiralPanel } from './panels/SpiralPanel';
import { FlowCloudPanel } from './panels/FlowCloudPanel';
import { ExportPanel } from './panels/ExportPanel';
import { useEditorEngine } from '../engine/useEditorEngine';
import { useCloudStore } from '../store/cloudStore';
import { useUiStore } from '../store/uiStore';

type PanelId = 'spheres' | 'base' | 'tail' | 'spirals' | 'flowCloud' | 'export';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useEditorEngine(canvasRef);

  const [openPanels, setOpenPanels]         = useState<Set<PanelId>>(
    new Set(['spheres', 'flowCloud'])
  );

  // The engine follows these flags (computeVisibility); the toolbar and panels set them.
  const mode               = useUiStore((s) => s.mode);
  const showAxes           = useUiStore((s) => s.showAxes);
  const showGrid           = useUiStore((s) => s.showGrid);
  const showFlowCloud      = useUiStore((s) => s.showFlowCloud);
  const surfaceMeshVisible = useUiStore((s) => s.surfaceMeshVisible);

  const generating        = useUiStore((s) => s.jobs.flowCloud.status === 'running');
  const cutGlueGenerating = useUiStore(
    (s) => s.jobs.cutAndGlue.status === 'running' || s.jobs.surfaceMesh.status === 'running'
  );
  const hasSurfaceMesh    = useUiStore((s) => s.hasSurfaceMesh);

  const preset = useCloudStore((s) => s.preset);

  // The first history entry is the preset the editor opens with. commit() skips a snapshot equal
  // to the newest one, so StrictMode's second run of this effect adds no undo step.
  useEffect(() => {
    useCloudStore.getState().commit();
  }, []);

  // The toolbar's Undo and Redo and these keys run the same store actions.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const { undo, redo } = useCloudStore.getState();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key === 'z') || e.key === 'y')) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleRegenerate() { void engineRef.current?.regenerate(); }

  function handleCutAndGlue() { void engineRef.current?.cutAndGlue(); }

  function handleToggleSurfaceMesh(v: boolean) { useUiStore.getState().setSurfaceMeshVisible(v); }

  function handleToggleFlowCloud() { useUiStore.getState().toggleFlowCloud(); }

  function togglePanel(id: PanelId) {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleModeChange(m: 'edit' | 'preview') { useUiStore.getState().setMode(m); }

  function handleToggleAxes() { useUiStore.getState().toggleAxes(); }
  function handleToggleGrid() { useUiStore.getState().toggleGrid(); }
  function handleZoomFit()    { engineRef.current?.zoomToFit(); }

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
          cutGlueGenerating={cutGlueGenerating}
          surfaceMeshVisible={surfaceMeshVisible}
          onToggleSurfaceMesh={handleToggleSurfaceMesh}
          hasSurfaceMesh={hasSurfaceMesh}
        />
      ),
    },
    {
      id: 'export',
      label: 'Export',
      component: (
        <ExportPanel
          getFlowCloudGroup={() => engineRef.current?.viewport.flowCloudGroup ?? null}
          getScaffoldGroups={() => engineRef.current?.scaffoldGroups() ?? null}
          getCutGlueEdges={() => engineRef.current?.cutGlue.getEdges() ?? new Float32Array(0)}
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
          <ViewportCanvas canvasRef={canvasRef} />
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
