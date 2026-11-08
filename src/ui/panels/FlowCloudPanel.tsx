import { useCloudStore } from '../../store/cloudStore';
import { useUiStore } from '../../store/uiStore';
import { useEngine } from '../EngineContext';
import { confirmAndResetPreset } from '../resetPreset';
import { SliderRow } from '../controls/SliderRow';
import { FieldRow } from '../controls/FieldRow';
import { Vec3Field } from '../controls/Vec3Field';
import { formatPi } from '../controls/format';
import type { FlowCloudSettings } from '../../model/types';
import { resolveTailSetpoints } from '../../geometry/primitives/tail';

export function FlowCloudPanel() {
  const engine = useEngine();
  const flowCloud = useCloudStore((s) => s.preset.flowCloud);
  const surfaceMeshResolution = useCloudStore((s) => s.preset.surfaceMeshResolution);
  const setFlowCloud = useCloudStore((s) => s.setFlowCloud);
  const setSurfaceMeshResolution = useCloudStore((s) => s.setSurfaceMeshResolution);
  const commit = useCloudStore((s) => s.commit);

  // Job state and view flags: the engine publishes the first, the buttons below set the second.
  const generating = useUiStore((s) => s.jobs.flowCloud.status === 'running');
  const cutGlueGenerating = useUiStore(
    (s) => s.jobs.cutAndGlue.status === 'running' || s.jobs.surfaceMesh.status === 'running',
  );
  const hasSurfaceMesh = useUiStore((s) => s.hasSurfaceMesh);
  // Why the latest job failed, until the next run (WorkerClient's state).
  const regenerateError = useUiStore((s) => (s.jobs.flowCloud.status === 'failed' ? s.jobs.flowCloud.error : null));
  const cutGlueError = useUiStore((s) =>
    s.jobs.cutAndGlue.status === 'failed'
      ? s.jobs.cutAndGlue.error
      : s.jobs.surfaceMesh.status === 'failed'
        ? s.jobs.surfaceMesh.error
        : null,
  );
  const showFlowCloud = useUiStore((s) => s.showFlowCloud);
  const surfaceMeshVisible = useUiStore((s) => s.surfaceMeshVisible);
  const toggleFlowCloud = useUiStore((s) => s.toggleFlowCloud);
  const setSurfaceMeshVisible = useUiStore((s) => s.setSurfaceMeshVisible);

  function setWireframe(patch: Partial<FlowCloudSettings['wireframe']>) {
    setFlowCloud({ wireframe: { ...flowCloud.wireframe, ...patch } });
  }

  function snapBackToTail() {
    const { tail, base } = useCloudStore.getState().preset;
    // The posterior anchor goes where the tail meets the cloud body: its first setpoint as drawn,
    // which an attached tail takes from the base (resolveTailSetpoints), not the stored one.
    const start = resolveTailSetpoints(tail, base)[0];
    if (!start) return;
    const [x, y, z] = start.position;
    setWireframe({ backPoint: [x, y, z] });
    commit();
  }

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Flow Cloud</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={toggleFlowCloud} className="btn-regen" title={showFlowCloud ? 'Hide flow cloud' : 'Show flow cloud'}>
            {showFlowCloud ? 'Hide' : 'Show'}
          </button>
          <button onClick={() => void engine.current?.regenerate()} disabled={generating} className="btn-regen">
            {generating ? 'Working...' : 'Regenerate'}
          </button>
        </div>
      </div>
      {regenerateError && <p className="job-error" role="alert">Regenerate failed: {regenerateError}</p>}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #eee' }}>
        <button onClick={confirmAndResetPreset} className="btn-reset" style={{ width: '100%' }}>
          Reset to Default
        </button>
        <button
          onClick={() => void engine.current?.cutAndGlue()}
          disabled={cutGlueGenerating}
          className="btn-regen"
          style={{ width: '100%', marginTop: '6px' }}
        >
          {cutGlueGenerating ? 'Generating...' : 'Cut & Glue'}
        </button>
        {cutGlueError && <p className="job-error" role="alert">Cut & Glue failed: {cutGlueError}</p>}
        <FieldRow label="Surface Mesh" style={{ marginTop: '6px' }}>
          {(id) => (
            <input
              id={id}
              type="checkbox"
              checked={surfaceMeshVisible}
              disabled={!hasSurfaceMesh}
              onChange={(e) => setSurfaceMeshVisible(e.target.checked)}
              title={hasSurfaceMesh ? 'Toggle unified surface mesh wireframe' : 'Run Cut & Glue first'}
            />
          )}
        </FieldRow>
        <FieldRow label="Mesh Density">
          {(id) => (
            <select
              id={id}
              value={surfaceMeshResolution}
              onChange={(e) => { setSurfaceMeshResolution(parseInt(e.target.value)); commit(); }}
            >
              <option value={32}>32 (fast)</option>
              <option value={64}>64 (balanced)</option>
              <option value={96}>96 (fine)</option>
              <option value={128}>128 (dense)</option>
              <option value={192}>192 ⚠ slow</option>
              <option value={256}>256 ⚠ very slow</option>
            </select>
          )}
        </FieldRow>
      </div>
      <div className="panel-subsection">
        <div className="panel-subsection-header">Position</div>
        <Vec3Field
          label=""
          name="Position"
          value={flowCloud.position}
          min={-20} max={20} step={0.1}
          onChange={(position) => setFlowCloud({ position })}
        />
      </div>
      <FieldRow label="Resolution">
        {(id) => (
          <select
            id={id}
            value={flowCloud.resolution}
            onChange={(e) => { setFlowCloud({ resolution: parseInt(e.target.value) }); commit(); }}
          >
            <option value={32}>32 (fast)</option>
            <option value={64}>64 (balanced)</option>
            <option value={128}>128 ⚠ slow</option>
          </select>
        )}
      </FieldRow>
      <SliderRow
        label="Threshold"
        value={flowCloud.threshold}
        min={0.5} max={2.0} step={0.05}
        onChange={(v) => setFlowCloud({ threshold: v })}
      />
      <div className="panel-subsection">
        <div className="panel-subsection-header">Wireframe</div>
        <FieldRow label="Mode">
          {(id) => (
            <select
              id={id}
              value={flowCloud.wireframe.mode}
              onChange={(e) => { setWireframe({ mode: e.target.value as 'edges' | 'spiral' }); commit(); }}
            >
              <option value="edges">Edges</option>
              <option value="spiral">Spiral</option>
            </select>
          )}
        </FieldRow>

        {flowCloud.wireframe.mode === 'spiral' && (
          <>
            <FieldRow label="Generate Bands" title="When off, bands are not part of the generated isosurface at all. Hit Regenerate after changing.">
              {(id) => (
                <input
                  id={id}
                  type="checkbox"
                  checked={flowCloud.wireframe.generateBands}
                  onChange={(e) => { setWireframe({ generateBands: e.target.checked }); commit(); }}
                />
              )}
            </FieldRow>
            {flowCloud.wireframe.generateBands && (
              <FieldRow label="Show Bands">
                {(id) => (
                  <input
                    id={id}
                    type="checkbox"
                    checked={flowCloud.wireframe.showBands}
                    onChange={(e) => { setWireframe({ showBands: e.target.checked }); commit(); }}
                  />
                )}
              </FieldRow>
            )}
            <FieldRow label="Show Flow Lines">
              {(id) => (
                <input
                  id={id}
                  type="checkbox"
                  checked={flowCloud.wireframe.showFlowLines}
                  onChange={(e) => { setWireframe({ showFlowLines: e.target.checked }); commit(); }}
                />
              )}
            </FieldRow>
            {flowCloud.wireframe.generateBands && (
              <SliderRow
                label="Bands"
                value={flowCloud.wireframe.numBands}
                min={4} max={20} step={1} integer
                onChange={(v) => setWireframe({ numBands: v })}
                format={(v) => String(Math.round(v))}
              />
            )}
            <SliderRow
              label="Flow Lines"
              value={flowCloud.wireframe.numFlowLines}
              min={4} max={24} step={1} integer
              onChange={(v) => setWireframe({ numFlowLines: v })}
              format={(v) => String(Math.round(v))}
            />
            <SliderRow
              label="Spiral Twist"
              value={flowCloud.wireframe.spiralTwist}
              min={0} max={Math.PI * 4} step={0.05}
              onChange={(v) => setWireframe({ spiralTwist: v })}
              format={formatPi}
            />
            <div className="axis-coords">
              <div>
                <span>Front</span>
                <span>[{flowCloud.wireframe.frontPoint.map((v) => v.toFixed(1)).join(', ')}]</span>
              </div>
              <div>
                <span>Back</span>
                <span>[{flowCloud.wireframe.backPoint.map((v) => v.toFixed(1)).join(', ')}]</span>
              </div>
            <div className="axis-hint">Drag F/B gizmos in viewport to adjust</div>
              <button onClick={snapBackToTail} className="btn-regen" style={{ marginTop: 4 }}>
                Snap Back → Tail
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
