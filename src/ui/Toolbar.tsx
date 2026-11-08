import { useCloudStore } from '../store/cloudStore';
import { useHistoryStore } from '../store/historyStore';
import { useUiStore } from '../store/uiStore';
import { useEngine } from './EngineContext';

export function Toolbar() {
  const engine = useEngine();
  const name = useCloudStore((s) => s.preset.name);
  const setPresetName = useCloudStore((s) => s.setPresetName);
  const undo = useCloudStore((s) => s.undo);
  const redo = useCloudStore((s) => s.redo);
  const canUndo = useHistoryStore((s) => s.canUndo());
  const canRedo = useHistoryStore((s) => s.canRedo());
  const mode = useUiStore((s) => s.mode);
  const showAxes = useUiStore((s) => s.showAxes);
  const showGrid = useUiStore((s) => s.showGrid);
  const setMode = useUiStore((s) => s.setMode);
  const toggleAxes = useUiStore((s) => s.toggleAxes);
  const toggleGrid = useUiStore((s) => s.toggleGrid);

  return (
    <div className="toolbar">
      <input
        className="preset-name"
        value={name}
        onChange={(e) => setPresetName(e.target.value)}
        placeholder="Cloud name..."
      />
      <div className="toolbar-group">
        <button onClick={() => undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={() => redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      <div className="toolbar-group">
        <button
          className={mode === 'edit' ? 'active' : ''}
          onClick={() => setMode('edit')}
        >
          Edit
        </button>
        <button
          className={mode === 'preview' ? 'active' : ''}
          onClick={() => setMode('preview')}
        >
          Preview
        </button>
      </div>
      <div className="toolbar-group">
        <button className={showAxes ? 'active' : ''} onClick={toggleAxes}>Axes</button>
        <button className={showGrid ? 'active' : ''} onClick={toggleGrid}>Grid</button>
        <button onClick={() => engine.current?.zoomToFit()}>Fit</button>
      </div>
      <button onClick={() => window.location.reload()} className="btn-reset">Reset</button>
    </div>
  );
}
