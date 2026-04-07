import { useRef, useState, useCallback, useEffect } from 'react';
import { ViewportCanvas } from './ViewportCanvas';
import { Toolbar } from './Toolbar';
import { SwirlPanel } from './SwirlPanel';
import { BasePanel } from './BasePanel';
import { TailPanel } from './TailPanel';
import { MergePanel } from './MergePanel';
import { ExportPanel } from './ExportPanel';
import { Viewport } from '../three/Viewport';
import { SwirlMesh } from '../three/SwirlMesh';
import { BaseMesh } from '../three/BaseMesh';
import { TailMesh } from '../three/TailMesh';
import { MergedCloud } from '../three/MergedCloud';
import { AxisGizmo } from '../three/AxisGizmo';
import { useCloudStore } from '../store/cloudStore';
import { useHistoryStore } from '../store/historyStore';
import * as THREE from 'three';

type PanelId = 'swirls' | 'base' | 'tail' | 'merge' | 'export';

export function App() {
  const vpRef = useRef<Viewport | null>(null);
  const mergeGroupRef = useRef<THREE.Group | null>(null);
  const mergedCloudRef = useRef<MergedCloud | null>(null);

  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [showAxes, setShowAxes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [openPanels, setOpenPanels] = useState<Set<PanelId>>(new Set(['swirls', 'merge']));
  const [generating, setGenerating] = useState(false);

  const preset = useCloudStore((s) => s.preset);
  const loadPreset = useCloudStore((s) => s.loadPreset);
  const push = useHistoryStore((s) => s.push);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const canUndo = useHistoryStore((s) => s.canUndo());
  const canRedo = useHistoryStore((s) => s.canRedo());

  useEffect(() => {
    push(preset);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (canUndo) {
          const prev = undo();
          if (prev) loadPreset(prev);
        }
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key === 'z') || e.key === 'y')) {
        e.preventDefault();
        if (canRedo) {
          const next = redo();
          if (next) loadPreset(next);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [canUndo, canRedo]);

  const handleViewportReady = useCallback((vp: Viewport) => {
    vpRef.current = vp;
    mergeGroupRef.current = vp.mergeGroup;

    // Instantiate Three.js scene modules
    new SwirlMesh(vp);
    const baseMesh = new BaseMesh(vp);
    new TailMesh(vp, baseMesh);
    new AxisGizmo(vp);

    const mc = new MergedCloud(vp);
    mc.onGenerateStart = () => setGenerating(true);
    mc.onGenerateDone = () => setGenerating(false);
    mergedCloudRef.current = mc;

    vp.showAxes(showAxes);
    vp.showGrid(showGrid);
  }, []);

  function handleRegenerate() {
    mergedCloudRef.current?.regenerate();
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
      vpRef.current.swirlGroup.visible = m === 'edit';
      vpRef.current.baseGroup.visible = m === 'edit';
      vpRef.current.tailGroup.visible = m === 'edit';
      vpRef.current.gizmoGroup.visible = m === 'edit';
      vpRef.current.mergeGroup.visible = true;
    }
  }

  function handleToggleAxes() {
    const next = !showAxes;
    setShowAxes(next);
    vpRef.current?.showAxes(next);
  }

  function handleToggleGrid() {
    const next = !showGrid;
    setShowGrid(next);
    vpRef.current?.showGrid(next);
  }

  function handleZoomFit() {
    vpRef.current?.zoomToFit();
  }

  const panels: { id: PanelId; label: string; component: React.ReactNode }[] = [
    { id: 'swirls', label: `Swirls (${preset.swirls.length})`, component: <SwirlPanel /> },
    { id: 'base', label: 'Base', component: <BasePanel /> },
    { id: 'tail', label: 'Tail', component: <TailPanel /> },
    {
      id: 'merge',
      label: 'Merge & Wireframe',
      component: <MergePanel onRegenerate={handleRegenerate} generating={generating} />,
    },
    { id: 'export', label: 'Export', component: <ExportPanel getMergeGroup={() => mergeGroupRef.current} /> },
  ];

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
