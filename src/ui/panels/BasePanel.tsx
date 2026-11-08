import { useCloudStore } from '../../store/cloudStore';
import { SliderRow } from '../controls/SliderRow';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { AXES, withAxis } from '../controls/vec3';
import { RANGES } from '../../model/ranges';

const R = RANGES.base;

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
      <FieldRow label="Shape">
        {(id) => (
          <select
            id={id}
            value={base.crossSectionShape}
            onChange={(e) => { setBase({ crossSectionShape: e.target.value as 'oval' | 'rect' }); commit(); }}
          >
            <option value="oval">Oval</option>
            <option value="rect">Rect</option>
          </select>
        )}
      </FieldRow>
      <SliderRow
        label="Width"
        value={base.crossSectionWidth}
        range={R.crossSectionWidth}
        onChange={(v) => setBase({ crossSectionWidth: v })}
      />
      <SliderRow
        label="Height"
        value={base.crossSectionHeight}
        range={R.crossSectionHeight}
        onChange={(v) => setBase({ crossSectionHeight: v })}
      />
      <SliderRow
        label="Ring Density"
        value={base.ringSegments}
        range={R.ringSegments}
        onChange={(v) => setBase({ ringSegments: v })}
      />
      <SliderRow
        label="Length Density"
        value={base.lengthSegments}
        range={R.lengthSegments}
        onChange={(v) => setBase({ lengthSegments: v })}
      />
      <FieldRow label="Closed">
        {(id) => (
          <input
            id={id}
            type="checkbox"
            checked={base.closed}
            onChange={(e) => { setBase({ closed: e.target.checked }); commit(); }}
          />
        )}
      </FieldRow>
      <div className="control-points">
        {base.controlPoints.map((pt, i) => (
          <div key={i} className="control-point-row">
            <span className="cp-label">P{i}</span>
            {AXES.map((axis, ai) => (
              <NumberField
                key={axis}
                label={`P${i} ${axis}`}
                value={pt[ai]}
                min={R.controlPoint.min}
                max={R.controlPoint.max}
                step={R.controlPoint.step}
                onChange={(v) => updateBasePoint(i, withAxis(pt, ai, v))}
              />
            ))}
            <button
              onClick={() => { removeBasePoint(i); commit(); }}
              disabled={base.controlPoints.length <= 2}
              className="btn-remove"
              aria-label={`Remove P${i}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
