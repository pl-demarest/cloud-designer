import { useCloudStore } from '../store/cloudStore';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

interface Props {
  getMergeGroup: () => THREE.Group | null;
}

export function ExportPanel({ getMergeGroup }: Props) {
  const preset = useCloudStore((s) => s.preset);

  function exportJSON() {
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name.replace(/\s+/g, '-').toLowerCase()}-preset.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGLB() {
    const group = getMergeGroup();
    if (!group || group.children.length === 0) {
      alert('No merged cloud geometry. Click Regenerate first.');
      return;
    }
    const exporter = new GLTFExporter();
    exporter.parse(
      group,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${preset.name.replace(/\s+/g, '-').toLowerCase()}.glb`;
        a.click();
        URL.revokeObjectURL(url);
      },
      (err) => console.error('GLTFExporter error', err),
      { binary: true }
    );
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
        <button onClick={exportJSON} className="btn-export">Export JSON Preset</button>
        <button onClick={exportGLB} className="btn-export">Export GLB</button>
        <button onClick={copySnippet} className="btn-export">Copy CloudLayer Snippet</button>
      </div>
    </div>
  );
}
