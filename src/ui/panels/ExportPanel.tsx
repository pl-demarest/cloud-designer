import { useRef } from 'react';
import type { Object3D } from 'three';
import { useCloudStore } from '../../store/cloudStore';
import { useUiStore } from '../../store/uiStore';
import { useEngine } from '../EngineContext';
import { downloadBlob, safeFileName } from '../../export/download';
import { cloudScene, fullScene, scaffoldScene, wireframeScene, type ExportSources } from '../../export/scenes';
import { writeGlb } from '../../export/glb';
import { importPresetFile } from '../importPreset';

export function ExportPanel() {
  const engine = useEngine();
  const fileInput = useRef<HTMLInputElement>(null);

  /** The editor's groups, or null before the engine is mounted. */
  function sources(): ExportSources | null {
    const e = engine.current;
    return e ? { ...e.scaffoldGroups(), flowCloud: e.viewport.flowCloudGroup } : null;
  }

  // Read when a button is pressed: the panel shows nothing of the preset.
  const fileStem = () => safeFileName(useCloudStore.getState().preset.name);

  function exportJSON() {
    const json = JSON.stringify(useCloudStore.getState().preset, null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), `${fileStem()}-preset.json`);
  }

  async function exportGLB(scene: Object3D, suffix: string) {
    const file = `${fileStem()}${suffix}.glb`;
    try {
      const glb = await writeGlb(scene);
      downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), file);
    } catch (err) {
      // writeGlb loads GLTFExporter on first use, which fails offline or after a deploy.
      console.error('GLTFExporter error', err);
      const reason = err instanceof Error ? err.message : String(err);
      useUiStore.getState().showNotice({ tone: 'error', text: `Could not export ${file}: ${reason}` });
    }
  }

  function handleExportScaffold() {
    const src = sources();
    const scene = src && scaffoldScene(src);
    if (!scene) {
      alert('No scaffold geometry visible.');
      return;
    }
    void exportGLB(scene, '-scaffold');
  }

  function handleExportWireframe() {
    const src = sources();
    const scene = src && wireframeScene(src);
    if (!scene) {
      alert('No flow cloud geometry. Click Regenerate first.');
      return;
    }
    void exportGLB(scene, '-wireframe');
  }

  function handleExportBoth() {
    const src = sources();
    const scene = src && fullScene(src);
    if (!scene) {
      alert('Nothing to export.');
      return;
    }
    void exportGLB(scene, '-full');
  }

  function handleExportCloudGLB() {
    const edges = engine.current?.cutGlue.getEdges() ?? new Float32Array(0);
    if (edges.length === 0) {
      alert('Run Cut & Glue first to generate the unified cloud wireframe.');
      return;
    }
    // githubLanding's input; the contract is at cloudScene (src/export/scenes.ts).
    const cloud = cloudScene(edges);
    void exportGLB(cloud.scene, '-cloud').finally(cloud.dispose);
  }

  /** githubLanding's loader call for the file 'Export Cloud GLB' writes (src/export/scenes.ts). */
  function copySnippet() {
    const file = `${fileStem()}-cloud.glb`;
    const snippet = `import { loadCloudLayer } from './scene/CloudLayer';

// Put ${file} (Export Cloud GLB) in public/, then in your scene init:
const clouds = await loadCloudLayer(scene, \`\${import.meta.env.BASE_URL}${file}\`);

// In your animation loop:
clouds.update(deltaTime);
`;
    const { showNotice } = useUiStore.getState();
    // Undefined outside a secure context (HTTPS or localhost).
    if (!navigator.clipboard) {
      showNotice({ tone: 'error', text: 'Could not copy the snippet: this page has no clipboard access.' });
      return;
    }
    navigator.clipboard.writeText(snippet).then(
      () => showNotice({ tone: 'info', text: `Copied the CloudLayer snippet for ${file}.` }),
      (err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        showNotice({ tone: 'error', text: `Could not copy the snippet: ${reason}` });
      },
    );
  }

  return (
    <div className="panel-section">
      <div className="panel-section-header">
        <span>Export</span>
      </div>
      <div className="export-buttons">
        <button onClick={() => fileInput.current?.click()} className="btn-export">Import JSON Preset</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Preset file to import"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // choosing the same file again imports it again
            if (file) void importPresetFile(file);
          }}
        />
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
