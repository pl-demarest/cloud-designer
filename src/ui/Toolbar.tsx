import { useCloudStore } from '../store/cloudStore';
import { useHistoryStore } from '../store/historyStore';
import { useUiStore } from '../store/uiStore';
import { useEngine } from './EngineContext';
import { confirmAndResetPreset } from './resetPreset';

export function Toolbar() {
  const engine = useEngine();
  const name = useCloudStore((s) => s.preset.name);
  const setPresetName = useCloudStore((s) => s.setPresetName);
  const commit = useCloudStore((s) => s.commit);
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
        aria-label="Cloud name"
        value={name}
        onChange={(e) => setPresetName(e.target.value)}
        // The keystrokes of a rename are one undo step.
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        placeholder="Cloud name..."
      />
      <div className="toolbar-group">
        <button onClick={() => undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={() => redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      <div className="toolbar-group">
        <button
          className={mode === 'edit' ? 'active' : ''}
          aria-pressed={mode === 'edit'}
          onClick={() => setMode('edit')}
        >
          Edit
        </button>
        <button
          className={mode === 'preview' ? 'active' : ''}
          aria-pressed={mode === 'preview'}
          onClick={() => setMode('preview')}
        >
          Preview
        </button>
      </div>
      <div className="toolbar-group">
        <button className={showAxes ? 'active' : ''} aria-pressed={showAxes} onClick={toggleAxes}>Axes</button>
        <button className={showGrid ? 'active' : ''} aria-pressed={showGrid} onClick={toggleGrid}>Grid</button>
        <button onClick={() => engine.current?.zoomToFit()}>Fit</button>
      </div>
      <button onClick={confirmAndResetPreset} className="btn-reset">Reset</button>
    </div>
  );
}
