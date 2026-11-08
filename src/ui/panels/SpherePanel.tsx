import { useCloudStore } from '../../store/cloudStore';
import type { SphereDef } from '../../model/types';
import { SliderRow } from '../controls/SliderRow';
import { Vec3Field } from '../controls/Vec3Field';
import { formatDegrees } from '../controls/format';
import { useToggleSet } from '../hooks/useToggleSet';

export function SpherePanel() {
  const spheres = useCloudStore((s) => s.preset.spheres);
  const addSphere = useCloudStore((s) => s.addSphere);
  const updateSphere = useCloudStore((s) => s.updateSphere);
  const removeSphere = useCloudStore((s) => s.removeSphere);
  const commit = useCloudStore((s) => s.commit);
  const [expanded, toggleExpanded] = useToggleSet<string>();

  function handleAdd() {
    addSphere();
    commit();
  }

  function handleRemove(id: string) {
    removeSphere(id);
    commit();
  }

  function handleUpdate(id: string, patch: Partial<SphereDef>) {
    updateSphere(id, patch);
  }

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Spheres ({spheres.length})</span>
        <button onClick={handleAdd}>+ Add</button>
      </div>
      <div className="swirl-list">
        {spheres.map((sw, i) => (
          <div key={sw.id} className="swirl-item">
            <div
              className="swirl-item-header"
              onClick={() => toggleExpanded(sw.id)}
            >
              <span>Sphere {i + 1} ({sw.shape})</span>
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
                    onChange={(e) => { handleUpdate(sw.id, { shape: e.target.value as 'sphere' | 'ellipsoid' }); commit(); }}
                  >
                    <option value="sphere">Sphere</option>
                    <option value="ellipsoid">Ellipsoid</option>
                  </select>
                </div>
                <Vec3Field
                  label="Pos"
                  value={sw.position}
                  min={[-8, -4, -4]} max={[8, 4, 4]} step={0.05}
                  onChange={(position) => handleUpdate(sw.id, { position })}
                />
                <SliderRow
                  label="Radius"
                  value={sw.radius}
                  min={0.1} max={3.0} step={0.05}
                  onChange={(v) => handleUpdate(sw.id, { radius: v })}
                />
                <SliderRow
                  label="Falloff"
                  value={sw.falloff}
                  min={0.5} max={5.0} step={0.1}
                  onChange={(v) => handleUpdate(sw.id, { falloff: v })}
                />
                <div className="field-row">
                  <label>Half</label>
                  <input
                    type="checkbox"
                    checked={sw.half}
                    onChange={(e) => { handleUpdate(sw.id, { half: e.target.checked }); commit(); }}
                  />
                </div>
                <Vec3Field
                  label="Rotate"
                  value={sw.rotation}
                  min={-Math.PI} max={Math.PI} step={0.01}
                  format={formatDegrees}
                  onChange={(rotation) => handleUpdate(sw.id, { rotation })}
                />
                {sw.shape === 'ellipsoid' && (
                  <Vec3Field
                    label="Scale"
                    value={sw.scale}
                    min={0.2} max={3.0} step={0.05}
                    onChange={(scale) => handleUpdate(sw.id, { scale })}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
