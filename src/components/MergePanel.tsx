import { useCloudStore } from '../store/cloudStore';
import { useHistoryStore } from '../store/historyStore';
import { SliderRow } from './ui/SliderRow';
import type { MergeSettings } from '../types/cloud';

interface Props {
  onRegenerate?: () => void;
  generating?: boolean;
}

export function MergePanel({ onRegenerate, generating }: Props) {
  const merge = useCloudStore((s) => s.preset.merge);
  const preset = useCloudStore((s) => s.preset);
  const setMerge = useCloudStore((s) => s.setMerge);
  const push = useHistoryStore((s) => s.push);

  function commit() {
    push(preset);
  }

  function setWireframe(patch: Partial<MergeSettings['wireframe']>) {
    setMerge({ wireframe: { ...merge.wireframe, ...patch } });
  }

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Merge</span>
        <button onClick={onRegenerate} disabled={generating} className="btn-regen">
          {generating ? 'Working...' : 'Regenerate'}
        </button>
      </div>
      <div className="field-row">
        <label>Resolution</label>
        <select
          value={merge.resolution}
          onChange={(e) => setMerge({ resolution: parseInt(e.target.value) })}
          onBlur={commit}
        >
          <option value={32}>32 (fast)</option>
          <option value={64}>64 (balanced)</option>
          <option value={128}>128 ⚠ slow</option>
        </select>
      </div>
      <SliderRow
        label="Threshold"
        value={merge.threshold}
        min={0.5} max={2.0} step={0.05}
        onChange={(v) => setMerge({ threshold: v })}
        onCommit={commit}
      />
      <div className="field-row">
        <label>Smooth</label>
        <input
          type="checkbox"
          checked={merge.smooth}
          onChange={(e) => { setMerge({ smooth: e.target.checked }); commit(); }}
        />
      </div>

      <div className="panel-subsection">
        <div className="panel-subsection-header">Wireframe</div>
        <div className="field-row">
          <label>Mode</label>
          <select
            value={merge.wireframe.mode}
            onChange={(e) => setWireframe({ mode: e.target.value as 'edges' | 'spiral' })}
            onBlur={commit}
          >
            <option value="edges">Edges</option>
            <option value="spiral">Spiral</option>
          </select>
        </div>

        {merge.wireframe.mode === 'spiral' && (
          <>
            <div className="field-row">
              <label>Show Bands</label>
              <input
                type="checkbox"
                checked={merge.wireframe.showBands}
                onChange={(e) => { setWireframe({ showBands: e.target.checked }); commit(); }}
              />
            </div>
            <div className="field-row">
              <label>Show Flow Lines</label>
              <input
                type="checkbox"
                checked={merge.wireframe.showFlowLines}
                onChange={(e) => { setWireframe({ showFlowLines: e.target.checked }); commit(); }}
              />
            </div>
            <SliderRow
              label="Bands"
              value={merge.wireframe.numBands}
              min={4} max={20} step={1}
              onChange={(v) => setWireframe({ numBands: Math.round(v) })}
              onCommit={commit}
              format={(v) => String(Math.round(v))}
            />
            <SliderRow
              label="Flow Lines"
              value={merge.wireframe.numFlowLines}
              min={4} max={24} step={1}
              onChange={(v) => setWireframe({ numFlowLines: Math.round(v) })}
              onCommit={commit}
              format={(v) => String(Math.round(v))}
            />
            <SliderRow
              label="Spiral Twist"
              value={merge.wireframe.spiralTwist}
              min={0} max={Math.PI * 4} step={0.05}
              onChange={(v) => setWireframe({ spiralTwist: v })}
              onCommit={commit}
              format={(v) => `${(v / Math.PI).toFixed(2)}π`}
            />
            <div className="axis-coords">
              <div>
                <span>Front</span>
                <span>[{merge.wireframe.frontPoint.map((v) => v.toFixed(1)).join(', ')}]</span>
              </div>
              <div>
                <span>Back</span>
                <span>[{merge.wireframe.backPoint.map((v) => v.toFixed(1)).join(', ')}]</span>
              </div>
              <div className="axis-hint">Drag F/B gizmos in viewport to adjust</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
