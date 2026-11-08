import { useId } from 'react';
import { useCloudStore } from '../../store/cloudStore';
import { SliderRow } from '../controls/SliderRow';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { AXES, withAxis } from '../controls/vec3';
import { formatPi } from '../controls/format';
import { RANGES } from '../../model/ranges';

const R = RANGES.tail;

export function TailPanel() {
  const tail = useCloudStore((s) => s.preset.tail);
  const setTail = useCloudStore((s) => s.setTail);
  const addTailSetpoint = useCloudStore((s) => s.addTailSetpoint);
  const removeTailSetpoint = useCloudStore((s) => s.removeTailSetpoint);
  const updateTailSetpoint = useCloudStore((s) => s.updateTailSetpoint);
  const commit = useCloudStore((s) => s.commit);
  const idPrefix = useId();

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Tail ({tail.setpoints.length} pts)</span>
        <button onClick={() => { addTailSetpoint(); commit(); }}>+ Point</button>
      </div>
      <SliderRow
        label="Start radius"
        value={tail.setpoints[0]?.width ?? 0.5}
        range={R.width}
        onChange={(v) => updateTailSetpoint(tail.setpoints[0].id, { width: v })}
      />
      <SliderRow
        label="End radius"
        value={tail.setpoints[tail.setpoints.length - 1]?.width ?? 0.1}
        range={R.width}
        onChange={(v) => updateTailSetpoint(tail.setpoints[tail.setpoints.length - 1].id, { width: v })}
      />
      <SliderRow
        label="Curl"
        value={tail.curlAmount}
        range={R.curlAmount}
        onChange={(v) => setTail({ curlAmount: v })}
        format={formatPi}
      />
      <SliderRow
        label="Radial Density"
        value={tail.radialSegments}
        range={R.radialSegments}
        onChange={(v) => setTail({ radialSegments: v })}
      />
      <SliderRow
        label="Length Density"
        value={tail.lengthSegments}
        range={R.lengthSegments}
        onChange={(v) => setTail({ lengthSegments: v })}
      />
      <FieldRow label="Attach">
        {(id) => (
          <select
            id={id}
            value={tail.attachToBase}
            onChange={(e) => { setTail({ attachToBase: e.target.value as 'start' | 'end' | 'none' }); commit(); }}
          >
            <option value="none">None</option>
            <option value="start">Base Start</option>
            <option value="end">Base End</option>
          </select>
        )}
      </FieldRow>
      {tail.attachToBase !== 'none' && (
        <SliderRow
          label="Attach Offset"
          value={tail.attachOffset}
          range={R.attachOffset}
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
                  aria-label={`Insert a setpoint after SP ${i}`}
                  className="btn-small"
                >
                  +
                </button>
                <button
                  onClick={() => { removeTailSetpoint(sp.id); commit(); }}
                  disabled={tail.setpoints.length <= 2}
                  className="btn-remove"
                  aria-label={`Remove SP ${i}`}
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
                  step={R.setpointPosition.step}
                  onChange={(v) => updateTailSetpoint(sp.id, { position: withAxis(sp.position, ai, v) })}
                />
              ))}
              <label htmlFor={`${idPrefix}-${sp.id}-width`} style={{ fontSize: '0.7rem' }}>w</label>
              <NumberField
                id={`${idPrefix}-${sp.id}-width`}
                label={`SP ${i} width`}
                value={sp.width}
                step={R.width.fieldStep}
                min={R.width.min}
                max={R.width.max}
                onChange={(width) => updateTailSetpoint(sp.id, { width })}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
