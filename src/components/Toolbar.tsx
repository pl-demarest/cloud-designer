import { useCloudStore } from '../store/cloudStore';
import { useHistoryStore } from '../store/historyStore';

interface Props {
  mode: 'edit' | 'preview';
  onModeChange: (mode: 'edit' | 'preview') => void;
  showAxes: boolean;
  onToggleAxes: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  onZoomFit: () => void;
}

export function Toolbar({ mode, onModeChange, showAxes, onToggleAxes, showGrid, onToggleGrid, onZoomFit }: Props) {
  const preset = useCloudStore((s) => s.preset);
  const setPresetName = useCloudStore((s) => s.setPresetName);
  const undo = useCloudStore((s) => s.undo);
  const redo = useCloudStore((s) => s.redo);
  const canUndo = useHistoryStore((s) => s.canUndo());
  const canRedo = useHistoryStore((s) => s.canRedo());

  return (
    <div className="toolbar">
      <input
        className="preset-name"
        value={preset.name}
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
          onClick={() => onModeChange('edit')}
        >
          Edit
        </button>
        <button
          className={mode === 'preview' ? 'active' : ''}
          onClick={() => onModeChange('preview')}
        >
          Preview
        </button>
      </div>
      <div className="toolbar-group">
        <button className={showAxes ? 'active' : ''} onClick={onToggleAxes}>Axes</button>
        <button className={showGrid ? 'active' : ''} onClick={onToggleGrid}>Grid</button>
        <button onClick={onZoomFit}>Fit</button>
      </div>
      <button onClick={() => window.location.reload()} className="btn-reset">Reset</button>
    </div>
  );
}
