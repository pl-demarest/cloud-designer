import { useState } from 'react';
import { useCloudStore } from '../../store/cloudStore';
import { SliderRow } from '../controls/SliderRow';
import type { SpiralDef } from '../../model/types';

export function SpiralPanel() {
  const spirals = useCloudStore((s) => s.preset.spirals);
  const addSpiral = useCloudStore((s) => s.addSpiral);
  const updateSpiral = useCloudStore((s) => s.updateSpiral);
  const removeSpiral = useCloudStore((s) => s.removeSpiral);
  const commit = useCloudStore((s) => s.commit);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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
            <div
              className="swirl-item-header"
              onClick={() => toggleExpanded(sp.id)}
            >
              <span>Spiral {i + 1} ({sp.spiralType})</span>
              <div>
                <span>{expanded.has(sp.id) ? '▲' : '▼'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(sp.id); }}
                  className="btn-remove"
                >
                  ×
                </button>
              </div>
            </div>

            {expanded.has(sp.id) && (
              <div className="swirl-item-body">

                {/* Type */}
                <div className="field-row">
                  <label>Type</label>
                  <select
                    value={sp.spiralType}
                    onChange={(e) => { handleUpdate(sp.id, { spiralType: e.target.value as 'archimedean' | 'golden' }); commit(); }}
                  >
                    <option value="golden">Golden (logarithmic)</option>
                    <option value="archimedean">Archimedean (equal spacing)</option>
                  </select>
                </div>

                {/* Shape */}
                <SliderRow
                  label="Inner Radius"
                  value={sp.startRadius}
                  min={0.01} max={2.0} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { startRadius: v })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Outer Radius"
                  value={sp.endRadius}
                  min={0.1} max={6.0} step={0.05}
                  onChange={(v) => handleUpdate(sp.id, { endRadius: v })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Turns"
                  value={sp.turns}
                  min={0.25} max={6.0} step={0.25}
                  onChange={(v) => handleUpdate(sp.id, { turns: v })}
                  onCommit={commit}
                  format={(v) => `${v.toFixed(2)}×`}
                />

                {/* Ribbon / taper */}
                <SliderRow
                  label="Separation"
                  value={sp.separation}
                  min={0.0} max={2.0} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { separation: v })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Taper Power"
                  value={sp.taperPower}
                  min={0} max={4.0} step={0.05}
                  onChange={(v) => handleUpdate(sp.id, { taperPower: v })}
                  onCommit={commit}
                  format={(v) => v === 0 ? 'uniform' : v.toFixed(2)}
                />
                <SliderRow
                  label="Rung Density"
                  value={sp.rungDensity}
                  min={1} max={32} step={1}
                  onChange={(v) => handleUpdate(sp.id, { rungDensity: Math.round(v) })}
                  onCommit={commit}
                  format={(v) => `${Math.round(v)}/turn`}
                />

                {/* Thickness (3D coil) */}
                <SliderRow
                  label="Thickness"
                  value={sp.thickness}
                  min={0} max={2.0} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { thickness: v })}
                  onCommit={commit}
                  format={(v) => v === 0 ? 'flat' : v.toFixed(2)}
                />
                {sp.thickness > 0 && (
                  <SliderRow
                    label="Corner Rnd"
                    value={sp.cornerRadius}
                    min={0} max={1.0} step={0.01}
                    onChange={(v) => handleUpdate(sp.id, { cornerRadius: v })}
                    onCommit={commit}
                  />
                )}

                {/* Position */}
                <SliderRow
                  label="Pos X"
                  value={sp.position[0]}
                  min={-8} max={8} step={0.05}
                  onChange={(v) => handleUpdate(sp.id, { position: [v, sp.position[1], sp.position[2]] })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Pos Y"
                  value={sp.position[1]}
                  min={-4} max={4} step={0.05}
                  onChange={(v) => handleUpdate(sp.id, { position: [sp.position[0], v, sp.position[2]] })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Pos Z"
                  value={sp.position[2]}
                  min={-4} max={4} step={0.05}
                  onChange={(v) => handleUpdate(sp.id, { position: [sp.position[0], sp.position[1], v] })}
                  onCommit={commit}
                />

                {/* Rotation */}
                <SliderRow
                  label="Rotate X"
                  value={sp.rotation[0]}
                  min={-Math.PI} max={Math.PI} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { rotation: [v, sp.rotation[1], sp.rotation[2]] })}
                  onCommit={commit}
                  format={(v) => `${(v / Math.PI * 180).toFixed(0)}°`}
                />
                <SliderRow
                  label="Rotate Y"
                  value={sp.rotation[1]}
                  min={-Math.PI} max={Math.PI} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { rotation: [sp.rotation[0], v, sp.rotation[2]] })}
                  onCommit={commit}
                  format={(v) => `${(v / Math.PI * 180).toFixed(0)}°`}
                />
                <SliderRow
                  label="Rotate Z"
                  value={sp.rotation[2]}
                  min={-Math.PI} max={Math.PI} step={0.01}
                  onChange={(v) => handleUpdate(sp.id, { rotation: [sp.rotation[0], sp.rotation[1], v] })}
                  onCommit={commit}
                  format={(v) => `${(v / Math.PI * 180).toFixed(0)}°`}
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
