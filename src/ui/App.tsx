import { useRef, useEffect, type ReactNode } from 'react';
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
import { useToggleSet } from './hooks/useToggleSet';
import { Accordion } from './controls/Accordion';
import { EngineContext } from './EngineContext';

type PanelId = 'spheres' | 'base' | 'tail' | 'spirals' | 'flowCloud' | 'export';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useEditorEngine(canvasRef);

  const [openPanels, togglePanel] = useToggleSet<PanelId>(['spheres', 'flowCloud']);
  const sphereCount = useCloudStore((s) => s.preset.spheres.length);
  const spiralCount = useCloudStore((s) => s.preset.spirals.length);

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

  const panels: { id: PanelId; label: string; component: ReactNode }[] = [
    { id: 'spheres',   label: `Spheres (${sphereCount})`, component: <SpherePanel /> },
    { id: 'base',      label: 'Base',                     component: <BasePanel /> },
    { id: 'tail',      label: 'Tail',                     component: <TailPanel /> },
    { id: 'spirals',   label: `Spirals (${spiralCount})`, component: <SpiralPanel /> },
    { id: 'flowCloud', label: 'Flow Cloud',               component: <FlowCloudPanel /> },
    { id: 'export',    label: 'Export',                   component: <ExportPanel /> },
  ];

  return (
    <EngineContext.Provider value={engineRef}>
      <div className="app">
        <Toolbar />
        <div className="app-body">
          <div className="viewport-wrap">
            <ViewportCanvas canvasRef={canvasRef} />
          </div>
          <div className="sidebar">
            {panels.map(({ id, label, component }) => (
              <Accordion key={id} label={label} open={openPanels.has(id)} onToggle={() => togglePanel(id)}>
                {component}
              </Accordion>
            ))}
          </div>
        </div>
      </div>
    </EngineContext.Provider>
  );
}
