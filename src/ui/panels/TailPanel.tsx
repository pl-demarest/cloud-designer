import { useCloudStore } from '../../store/cloudStore';
import { SliderRow } from '../controls/SliderRow';
import { NumberField } from '../controls/NumberField';
import { AXES, withAxis } from '../controls/vec3';
import { formatPi } from '../controls/format';

export function TailPanel() {
  const tail = useCloudStore((s) => s.preset.tail);
  const setTail = useCloudStore((s) => s.setTail);
  const addTailSetpoint = useCloudStore((s) => s.addTailSetpoint);
  const removeTailSetpoint = useCloudStore((s) => s.removeTailSetpoint);
  const updateTailSetpoint = useCloudStore((s) => s.updateTailSetpoint);
  const commit = useCloudStore((s) => s.commit);

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Tail ({tail.setpoints.length} pts)</span>
        <button onClick={() => { addTailSetpoint(); commit(); }}>+ Point</button>
      </div>
      <SliderRow
        label="Start radius"
        value={tail.setpoints[0]?.width ?? 0.5}
        min={0.05} max={1.5} step={0.01}
        onChange={(v) => updateTailSetpoint(tail.setpoints[0].id, { width: v })}
      />
      <SliderRow
        label="End radius"
        value={tail.setpoints[tail.setpoints.length - 1]?.width ?? 0.1}
        min={0.05} max={1.5} step={0.01}
        onChange={(v) => updateTailSetpoint(tail.setpoints[tail.setpoints.length - 1].id, { width: v })}
      />
      <SliderRow
        label="Curl"
        value={tail.curlAmount}
        min={0} max={Math.PI * 2} step={0.05}
        onChange={(v) => setTail({ curlAmount: v })}
        format={formatPi}
      />
      <SliderRow
        label="Radial Density"
        value={tail.radialSegments}
        min={4} max={24} step={1} integer
        onChange={(v) => setTail({ radialSegments: v })}
      />
      <SliderRow
        label="Length Density"
        value={tail.lengthSegments}
        min={8} max={64} step={1} integer
        onChange={(v) => setTail({ lengthSegments: v })}
      />
      <div className="field-row">
        <label>Attach</label>
        <select
          value={tail.attachToBase}
          onChange={(e) => { setTail({ attachToBase: e.target.value as 'start' | 'end' | 'none' }); commit(); }}
        >
          <option value="none">None</option>
          <option value="start">Base Start</option>
          <option value="end">Base End</option>
        </select>
      </div>
      {tail.attachToBase !== 'none' && (
        <SliderRow
          label="Attach Offset"
          value={tail.attachOffset}
          min={0} max={1} step={0.01}
          onChange={(v) => setTail({ attachOffset: v })}
        />
      )}
      <div className="setpoint-list">
        {tail.setpoints.map((sp, i) => (
          <div key={sp.id} className="setpoint-row">
            <div className="setpoint-header">
              <span>SP {i}</span>
              <div>
                <button
                  onClick={() => { addTailSetpoint(i); commit(); }}
                  title="Insert after"
                  className="btn-small"
                >
                  +
                </button>
                <button
                  onClick={() => { removeTailSetpoint(sp.id); commit(); }}
                  disabled={tail.setpoints.length <= 2}
                  className="btn-remove"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="setpoint-fields">
              {AXES.map((axis, ai) => (
                <NumberField
                  key={axis}
                  label={`SP ${i} ${axis}`}
                  value={sp.position[ai]}
                  step={0.1}
                  onChange={(v) => updateTailSetpoint(sp.id, { position: withAxis(sp.position, ai, v) })}
                />
              ))}
              <label style={{ fontSize: '0.7rem' }}>w</label>
              <NumberField
                label={`SP ${i} width`}
                value={sp.width}
                step={0.05}
                min={0.05}
                max={1.5}
                onChange={(width) => updateTailSetpoint(sp.id, { width })}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
