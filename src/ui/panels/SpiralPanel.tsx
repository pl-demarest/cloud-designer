import { useId } from 'react';
import { useCloudStore } from '../../store/cloudStore';
import { SliderRow } from '../controls/SliderRow';
import { FieldRow } from '../controls/FieldRow';
import { ItemHeader } from '../controls/ItemHeader';
import { Vec3Field } from '../controls/Vec3Field';
import { formatDegrees } from '../controls/format';
import { useToggleSet } from '../hooks/useToggleSet';
import type { SpiralDef } from '../../model/types';

export function SpiralPanel() {
  const spirals = useCloudStore((s) => s.preset.spirals);
  const addSpiral = useCloudStore((s) => s.addSpiral);
  const updateSpiral = useCloudStore((s) => s.updateSpiral);
  const removeSpiral = useCloudStore((s) => s.removeSpiral);
  const commit = useCloudStore((s) => s.commit);
  const [expanded, toggleExpanded] = useToggleSet<string>();
  const idPrefix = useId();

  function handleAdd() {
    addSpiral();
    commit();
  }

  function handleRemove(id: string) {
    removeSpiral(id);
    commit();
  }

  function handleUpdate(id: string, patch: Partial<SpiralDef>) {
    updateSpiral(id, patch);
  }

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Spirals ({spirals.length})</span>
        <button onClick={handleAdd}>+ Add</button>
      </div>
      <div className="swirl-list">
        {spirals.map((sp, i) => (
          <div key={sp.id} className="swirl-item">
            <ItemHeader
              label={`Spiral ${i + 1} (${sp.spiralType})`}
              expanded={expanded.has(sp.id)}
              bodyId={`${idPrefix}-${sp.id}`}
              onToggle={() => toggleExpanded(sp.id)}
              removeLabel={`Remove spiral ${i + 1}`}
              onRemove={() => handleRemove(sp.id)}
            />

            {expanded.has(sp.id) && (
              <div id={`${idPrefix}-${sp.id}`} className="swirl-item-body">

                {/* Type */}
                <FieldRow label="Type">
                  {(id) => (
                    <select
                      id={id}
                      value={sp.spiralType}
                      onChange={(e) => { handleUpdate(sp.id, { spiralType: e.target.value as 'archimedean' | 'golden' }); commit(); }}
                    >
                      <option value="golden">Golden (logarithmic)</option>
                      <option value="archimedean">Archimedean (equal spacing)</option>
                    </select>
                  )}
                </FieldRow>

                {/* Shape */}
                <SliderRow
                  label="Inner Radius"
                  value={sp.startRadius}
                  min={0.01} max={2.0} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { startRadius: v })}
                />
                <SliderRow
                  label="Outer Radius"
                  value={sp.endRadius}
                  min={0.1} max={6.0} step={0.05}
                  onChange={(v) => handleUpdate(sp.id, { endRadius: v })}
                />
                <SliderRow
                  label="Turns"
                  value={sp.turns}
                  min={0.25} max={6.0} step={0.25}
                  onChange={(v) => handleUpdate(sp.id, { turns: v })}
                  format={(v) => `${v.toFixed(2)}×`}
                />

                {/* Ribbon / taper */}
                <SliderRow
                  label="Separation"
                  value={sp.separation}
                  min={0.0} max={2.0} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { separation: v })}
                />
                <SliderRow
                  label="Taper Power"
                  value={sp.taperPower}
                  min={0} max={4.0} step={0.05}
                  onChange={(v) => handleUpdate(sp.id, { taperPower: v })}
                  format={(v) => v === 0 ? 'uniform' : v.toFixed(2)}
                />
                <SliderRow
                  label="Rung Density"
                  value={sp.rungDensity}
                  min={1} max={32} step={1} integer
                  onChange={(v) => handleUpdate(sp.id, { rungDensity: v })}
                  format={(v) => `${Math.round(v)}/turn`}
                />

                {/* Thickness (3D coil) */}
                <SliderRow
                  label="Thickness"
                  value={sp.thickness}
                  min={0} max={2.0} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { thickness: v })}
                  format={(v) => v === 0 ? 'flat' : v.toFixed(2)}
                />
                {sp.thickness > 0 && (
                  <SliderRow
                    label="Corner Rnd"
                    value={sp.cornerRadius}
                    min={0} max={1.0} step={0.01}
                    onChange={(v) => handleUpdate(sp.id, { cornerRadius: v })}
                  />
                )}

                {/* Position */}
                <Vec3Field
                  label="Pos"
                  value={sp.position}
                  min={[-8, -4, -4]} max={[8, 4, 4]} step={0.05}
                  onChange={(position) => handleUpdate(sp.id, { position })}
                />

                {/* Rotation */}
                <Vec3Field
                  label="Rotate"
                  value={sp.rotation}
                  min={-Math.PI} max={Math.PI} step={0.01}
                  format={formatDegrees}
                  onChange={(rotation) => handleUpdate(sp.id, { rotation })}
                />

              </div>
            )}
          </div>
        ))}
        {spirals.length === 0 && (
          <div style={{ padding: '8px', color: '#999', fontSize: '0.75rem' }}>
            No spirals. Click + Add to place a Fibonacci spiral on the cloud body.
          </div>
        )}
      </div>
    </div>
  );
}
