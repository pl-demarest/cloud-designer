import { useCloudStore } from '../../store/cloudStore';
import { useUiStore } from '../../store/uiStore';
import { useEngine } from '../EngineContext';
import { SliderRow } from '../controls/SliderRow';
import { Vec3Field } from '../controls/Vec3Field';
import { formatPi } from '../controls/format';
import type { FlowCloudSettings } from '../../model/types';

export function FlowCloudPanel() {
  const engine = useEngine();
  const flowCloud = useCloudStore((s) => s.preset.flowCloud);
  const surfaceMeshResolution = useCloudStore((s) => s.preset.surfaceMeshResolution);
  const setFlowCloud = useCloudStore((s) => s.setFlowCloud);
  const setSurfaceMeshResolution = useCloudStore((s) => s.setSurfaceMeshResolution);
  const resetToDefault = useCloudStore((s) => s.resetToDefault);
  const commit = useCloudStore((s) => s.commit);

  // Job state and view flags: the engine publishes the first, the buttons below set the second.
  const generating = useUiStore((s) => s.jobs.flowCloud.status === 'running');
  const cutGlueGenerating = useUiStore(
    (s) => s.jobs.cutAndGlue.status === 'running' || s.jobs.surfaceMesh.status === 'running',
  );
  const hasSurfaceMesh = useUiStore((s) => s.hasSurfaceMesh);
  const showFlowCloud = useUiStore((s) => s.showFlowCloud);
  const surfaceMeshVisible = useUiStore((s) => s.surfaceMeshVisible);
  const toggleFlowCloud = useUiStore((s) => s.toggleFlowCloud);
  const setSurfaceMeshVisible = useUiStore((s) => s.setSurfaceMeshVisible);

  function setWireframe(patch: Partial<FlowCloudSettings['wireframe']>) {
    setFlowCloud({ wireframe: { ...flowCloud.wireframe, ...patch } });
  }

  function handleResetToDefault() {
    resetToDefault();
    commit();
  }

  function snapBackToTail() {
    const sp = useCloudStore.getState().preset.tail.setpoints;
    if (sp.length === 0) return;
    // Use the first setpoint as the posterior anchor (where tail meets the cloud body)
    const [x, y, z] = sp[0].position;
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
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #eee' }}>
        <button onClick={handleResetToDefault} className="btn-reset" style={{ width: '100%' }}>
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
        <div className="field-row" style={{ marginTop: '6px' }}>
          <label>Surface Mesh</label>
          <input
            type="checkbox"
            checked={surfaceMeshVisible}
            disabled={!hasSurfaceMesh}
            onChange={(e) => setSurfaceMeshVisible(e.target.checked)}
            title={hasSurfaceMesh ? 'Toggle unified surface mesh wireframe' : 'Run Cut & Glue first'}
          />
        </div>
        <div className="field-row">
          <label>Mesh Density</label>
          <select
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
        </div>
      </div>
      <div className="panel-subsection">
        <div className="panel-subsection-header">Position</div>
        <Vec3Field
          label=""
          value={flowCloud.position}
          min={-20} max={20} step={0.1}
          onChange={(position) => setFlowCloud({ position })}
        />
      </div>
      <div className="field-row">
        <label>Resolution</label>
        <select
          value={flowCloud.resolution}
          onChange={(e) => { setFlowCloud({ resolution: parseInt(e.target.value) }); commit(); }}
        >
          <option value={32}>32 (fast)</option>
          <option value={64}>64 (balanced)</option>
          <option value={128}>128 ⚠ slow</option>
        </select>
      </div>
      <SliderRow
        label="Threshold"
        value={flowCloud.threshold}
        min={0.5} max={2.0} step={0.05}
        onChange={(v) => setFlowCloud({ threshold: v })}
      />
      <div className="field-row">
        <label>Smooth</label>
        <input
          type="checkbox"
          checked={flowCloud.smooth}
          onChange={(e) => { setFlowCloud({ smooth: e.target.checked }); commit(); }}
        />
      </div>
      <div className="panel-subsection">
        <div className="panel-subsection-header">Wireframe</div>
        <div className="field-row">
          <label>Mode</label>
          <select
            value={flowCloud.wireframe.mode}
            onChange={(e) => { setWireframe({ mode: e.target.value as 'edges' | 'spiral' }); commit(); }}
          >
            <option value="edges">Edges</option>
            <option value="spiral">Spiral</option>
          </select>
        </div>

        {flowCloud.wireframe.mode === 'spiral' && (
          <>
            <div className="field-row" title="When off, bands are not part of the generated isosurface at all. Hit Regenerate after changing.">
              <label>Generate Bands</label>
              <input
                type="checkbox"
                checked={flowCloud.wireframe.generateBands}
                onChange={(e) => { setWireframe({ generateBands: e.target.checked }); commit(); }}
              />
            </div>
            {flowCloud.wireframe.generateBands && (
              <div className="field-row">
                <label>Show Bands</label>
                <input
                  type="checkbox"
                  checked={flowCloud.wireframe.showBands}
                  onChange={(e) => { setWireframe({ showBands: e.target.checked }); commit(); }}
                />
              </div>
            )}
            <div className="field-row">
              <label>Show Flow Lines</label>
              <input
                type="checkbox"
                checked={flowCloud.wireframe.showFlowLines}
                onChange={(e) => { setWireframe({ showFlowLines: e.target.checked }); commit(); }}
              />
            </div>
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
