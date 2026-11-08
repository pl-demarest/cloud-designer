import { useId } from 'react';
import { useCloudStore } from '../../store/cloudStore';
import type { SphereDef } from '../../model/types';
import { SliderRow } from '../controls/SliderRow';
import { FieldRow } from '../controls/FieldRow';
import { ItemHeader } from '../controls/ItemHeader';
import { Vec3Field } from '../controls/Vec3Field';
import { formatDegrees } from '../controls/format';
import { useToggleSet } from '../hooks/useToggleSet';
import { RANGES } from '../../model/ranges';

const R = RANGES.sphere;

export function SpherePanel() {
  const spheres = useCloudStore((s) => s.preset.spheres);
  const addSphere = useCloudStore((s) => s.addSphere);
  const updateSphere = useCloudStore((s) => s.updateSphere);
  const removeSphere = useCloudStore((s) => s.removeSphere);
  const commit = useCloudStore((s) => s.commit);
  const [expanded, toggleExpanded] = useToggleSet<string>();
  const idPrefix = useId();

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
      {/* The count is on the section's header (App). */}
      <div className="panel-section-header panel-section-header--actions">
        <button onClick={handleAdd}>+ Add</button>
      </div>
      <div className="swirl-list">
        {spheres.map((sw, i) => (
          <div key={sw.id} className="swirl-item">
            <ItemHeader
              label={`Sphere ${i + 1} (${sw.shape})`}
              expanded={expanded.has(sw.id)}
              bodyId={`${idPrefix}-${sw.id}`}
              onToggle={() => toggleExpanded(sw.id)}
              removeLabel={`Remove sphere ${i + 1}`}
              onRemove={() => handleRemove(sw.id)}
            />
            {expanded.has(sw.id) && (
              <div id={`${idPrefix}-${sw.id}`} className="swirl-item-body">
                <FieldRow label="Shape">
                  {(id) => (
                    <select
                      id={id}
                      value={sw.shape}
                      onChange={(e) => { handleUpdate(sw.id, { shape: e.target.value as 'sphere' | 'ellipsoid' }); commit(); }}
                    >
                      <option value="sphere">Sphere</option>
                      <option value="ellipsoid">Ellipsoid</option>
                    </select>
                  )}
                </FieldRow>
                <Vec3Field
                  label="Pos"
                  value={sw.position}
                  range={R.position}
                  onChange={(position) => handleUpdate(sw.id, { position })}
                />
                <SliderRow
                  label="Radius"
                  value={sw.radius}
                  range={R.radius}
                  onChange={(v) => handleUpdate(sw.id, { radius: v })}
                />
                <SliderRow
                  label="Falloff"
                  value={sw.falloff}
                  range={R.falloff}
                  onChange={(v) => handleUpdate(sw.id, { falloff: v })}
                />
                <FieldRow label="Half">
                  {(id) => (
                    <input
                      id={id}
                      type="checkbox"
                      checked={sw.half}
                      onChange={(e) => { handleUpdate(sw.id, { half: e.target.checked }); commit(); }}
                    />
                  )}
                </FieldRow>
                <Vec3Field
                  label="Rotate"
                  value={sw.rotation}
                  range={R.rotation}
                  format={formatDegrees}
                  onChange={(rotation) => handleUpdate(sw.id, { rotation })}
                />
                {sw.shape === 'ellipsoid' && (
                  <Vec3Field
                    label="Scale"
                    value={sw.scale}
                    range={R.scale}
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
