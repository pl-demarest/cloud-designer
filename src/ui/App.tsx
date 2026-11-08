import { useRef, useEffect, type ReactNode } from 'react';
import { ViewportCanvas } from './ViewportCanvas';
import { ViewportArea } from './ViewportArea';
import { NoticeBar } from './NoticeBar';
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
import { useHistoryShortcuts } from './hooks/useHistoryShortcuts';
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

  useHistoryShortcuts();

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
          <ViewportArea>
            <ViewportCanvas canvasRef={canvasRef} />
            <NoticeBar />
          </ViewportArea>
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
