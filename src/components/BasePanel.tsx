import { useCloudStore } from '../store/cloudStore';
import { SliderRow } from './ui/SliderRow';

export function BasePanel() {
  const base = useCloudStore((s) => s.preset.base);
  const setBase = useCloudStore((s) => s.setBase);
  const addBasePoint = useCloudStore((s) => s.addBasePoint);
  const removeBasePoint = useCloudStore((s) => s.removeBasePoint);
  const updateBasePoint = useCloudStore((s) => s.updateBasePoint);
  const commit = useCloudStore((s) => s.commit);

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Base</span>
        <button onClick={() => { addBasePoint(); commit(); }}>+ Point</button>
      </div>
      <div className="field-row">
        <label>Shape</label>
        <select
          value={base.crossSectionShape}
          onChange={(e) => { setBase({ crossSectionShape: e.target.value as 'oval' | 'rect' }); commit(); }}
        >
          <option value="oval">Oval</option>
          <option value="rect">Rect</option>
        </select>
      </div>
      <SliderRow
        label="Width"
        value={base.crossSectionWidth}
        min={0.1} max={4} step={0.05}
        onChange={(v) => setBase({ crossSectionWidth: v })}
        onCommit={commit}
      />
      <SliderRow
        label="Height"
        value={base.crossSectionHeight}
        min={0.05} max={2} step={0.05}
        onChange={(v) => setBase({ crossSectionHeight: v })}
        onCommit={commit}
      />
      <SliderRow
        label="Ring Density"
        value={base.ringSegments}
        min={6} max={32} step={1}
        onChange={(v) => setBase({ ringSegments: v })}
        onCommit={commit}
      />
      <SliderRow
        label="Length Density"
        value={base.lengthSegments}
        min={8} max={48} step={1}
        onChange={(v) => setBase({ lengthSegments: v })}
        onCommit={commit}
      />
      <div className="field-row">
        <label>Closed</label>
        <input
          type="checkbox"
          checked={base.closed}
          onChange={(e) => { setBase({ closed: e.target.checked }); commit(); }}
        />
      </div>
      <div className="control-points">
        {base.controlPoints.map((pt, i) => (
          <div key={i} className="control-point-row">
            <span className="cp-label">P{i}</span>
            {(['X', 'Y', 'Z'] as const).map((axis, ai) => (
              <input
                key={axis}
                type="number"
                value={pt[ai].toFixed(2)}
                step={0.1}
                className="cp-input"
                onChange={(e) => {
                  const newPt: [number, number, number] = [...pt] as [number, number, number];
                  newPt[ai] = parseFloat(e.target.value);
                  updateBasePoint(i, newPt);
                }}
                onBlur={commit}
              />
            ))}
            <button
              onClick={() => { removeBasePoint(i); commit(); }}
              disabled={base.controlPoints.length <= 2}
              className="btn-remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
