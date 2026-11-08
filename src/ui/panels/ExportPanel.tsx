import type { Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { useCloudStore } from '../../store/cloudStore';
import { useEngine } from '../EngineContext';
import { cloudScene, fullScene, scaffoldScene, wireframeScene, type ExportSources } from '../../export/scenes';

export function ExportPanel() {
  const engine = useEngine();

  /** The editor's groups, or null before the engine is mounted. */
  function sources(): ExportSources | null {
    const e = engine.current;
    return e ? { ...e.scaffoldGroups(), flowCloud: e.viewport.flowCloudGroup } : null;
  }

  // Read when a button is pressed: the panel shows nothing of the preset.
  const preset = () => useCloudStore.getState().preset;
  const baseName = () => preset().name.replace(/\s+/g, '-').toLowerCase();

  function exportJSON() {
    const json = JSON.stringify(preset(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName()}-preset.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGLB(exportGroup: Object3D, suffix: string, done?: () => void) {
    const exporter = new GLTFExporter();
    exporter.parse(
      exportGroup,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName()}${suffix}.glb`;
        a.click();
        URL.revokeObjectURL(url);
        done?.();
      },
      (err) => {
        console.error('GLTFExporter error', err);
        done?.();
      },
      { binary: true }
    );
  }

  function handleExportScaffold() {
    const src = sources();
    const scene = src && scaffoldScene(src);
    if (!scene) {
      alert('No scaffold geometry visible.');
      return;
    }
    exportGLB(scene, '-scaffold');
  }

  function handleExportWireframe() {
    const src = sources();
    const scene = src && wireframeScene(src);
    if (!scene) {
      alert('No flow cloud geometry. Click Regenerate first.');
      return;
    }
    exportGLB(scene, '-wireframe');
  }

  function handleExportBoth() {
    const src = sources();
    const scene = src && fullScene(src);
    if (!scene) {
      alert('Nothing to export.');
      return;
    }
    exportGLB(scene, '-full');
  }

  function handleExportCloudGLB() {
    const edges = engine.current?.cutGlue.getEdges() ?? new Float32Array(0);
    if (edges.length === 0) {
      alert('Run Cut & Glue first to generate the unified cloud wireframe.');
      return;
    }
    // githubLanding's input; the contract is at cloudScene (src/export/scenes.ts).
    const cloud = cloudScene(edges);
    exportGLB(cloud.scene, '-cloud', cloud.dispose);
  }

  function copySnippet() {
    const snippet = `import { CloudLayer } from './scene/CloudLayer';
import cloudPreset from './cloud-preset.json';

// In your scene init:
const cloudLayer = new CloudLayer(cloudPreset, scene);

// In your animation loop:
cloudLayer.update(deltaTime);
`;
    navigator.clipboard.writeText(snippet).then(() => {
      alert('Snippet copied to clipboard!');
    });
  }

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Export</span>
      </div>
      <div className="export-buttons">
        <button onClick={exportJSON}             className="btn-export">Export JSON Preset</button>
        <button onClick={handleExportCloudGLB}  className="btn-export">Export Cloud GLB</button>
        <button onClick={handleExportScaffold}   className="btn-export">Export Scaffold GLB</button>
        <button onClick={handleExportWireframe}  className="btn-export">Export Wireframe GLB</button>
        <button onClick={handleExportBoth}       className="btn-export">Export Both (Full)</button>
        <button onClick={copySnippet}            className="btn-export">Copy CloudLayer Snippet</button>
      </div>
    </div>
  );
}
