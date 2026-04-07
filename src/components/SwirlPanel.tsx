import { useCloudStore } from '../store/cloudStore';
import type { SwirlDef } from '../types/cloud';
import { useHistoryStore } from '../store/historyStore';
import { SliderRow } from './ui/SliderRow';
import { useState } from 'react';

export function SwirlPanel() {
  const swirls = useCloudStore((s) => s.preset.swirls);
  const preset = useCloudStore((s) => s.preset);
  const addSwirl = useCloudStore((s) => s.addSwirl);
  const updateSwirl = useCloudStore((s) => s.updateSwirl);
  const removeSwirl = useCloudStore((s) => s.removeSwirl);
  const push = useHistoryStore((s) => s.push);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function commit() {
    push(preset);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleAdd() {
    addSwirl();
    commit();
  }

  function handleRemove(id: string) {
    removeSwirl(id);
    commit();
  }

  function handleUpdate(id: string, patch: Partial<SwirlDef>) {
    updateSwirl(id, patch);
  }

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Swirls ({swirls.length})</span>
        <button onClick={handleAdd}>+ Add</button>
      </div>
      <div className="swirl-list">
        {swirls.map((sw, i) => (
          <div key={sw.id} className="swirl-item">
            <div
              className="swirl-item-header"
              onClick={() => toggleExpanded(sw.id)}
            >
              <span>Swirl {i + 1} ({sw.shape})</span>
              <div>
                <span>{expanded.has(sw.id) ? '▲' : '▼'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(sw.id); }}
                  className="btn-remove"
                >
                  ×
                </button>
              </div>
            </div>
            {expanded.has(sw.id) && (
              <div className="swirl-item-body">
                <div className="field-row">
                  <label>Shape</label>
                  <select
                    value={sw.shape}
                    onChange={(e) => handleUpdate(sw.id, { shape: e.target.value as 'sphere' | 'ellipsoid' })}
                    onBlur={commit}
                  >
                    <option value="sphere">Sphere</option>
                    <option value="ellipsoid">Ellipsoid</option>
                  </select>
                </div>
                <SliderRow
                  label="Pos X"
                  value={sw.position[0]}
                  min={-8} max={8} step={0.05}
                  onChange={(v) => handleUpdate(sw.id, { position: [v, sw.position[1], sw.position[2]] })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Pos Y"
                  value={sw.position[1]}
                  min={-4} max={4} step={0.05}
                  onChange={(v) => handleUpdate(sw.id, { position: [sw.position[0], v, sw.position[2]] })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Pos Z"
                  value={sw.position[2]}
                  min={-4} max={4} step={0.05}
                  onChange={(v) => handleUpdate(sw.id, { position: [sw.position[0], sw.position[1], v] })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Radius"
                  value={sw.radius}
                  min={0.1} max={3.0} step={0.05}
                  onChange={(v) => handleUpdate(sw.id, { radius: v })}
                  onCommit={commit}
                />
                <SliderRow
                  label="Falloff"
                  value={sw.falloff}
                  min={0.5} max={5.0} step={0.1}
                  onChange={(v) => handleUpdate(sw.id, { falloff: v })}
                  onCommit={commit}
                />
                {sw.shape === 'ellipsoid' && (
                  <>
                    <SliderRow
                      label="Scale X"
                      value={sw.scale[0]}
                      min={0.2} max={3.0} step={0.05}
                      onChange={(v) => handleUpdate(sw.id, { scale: [v, sw.scale[1], sw.scale[2]] })}
                      onCommit={commit}
                    />
                    <SliderRow
                      label="Scale Y"
                      value={sw.scale[1]}
                      min={0.2} max={3.0} step={0.05}
                      onChange={(v) => handleUpdate(sw.id, { scale: [sw.scale[0], v, sw.scale[2]] })}
                      onCommit={commit}
                    />
                    <SliderRow
                      label="Scale Z"
                      value={sw.scale[2]}
                      min={0.2} max={3.0} step={0.05}
                      onChange={(v) => handleUpdate(sw.id, { scale: [sw.scale[0], sw.scale[1], v] })}
                      onCommit={commit}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
