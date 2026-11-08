import { useCloudStore } from '../../store/cloudStore';
import { useEngine } from '../EngineContext';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export function ExportPanel() {
  const engine = useEngine();
  const getFlowCloudGroup = () => engine.current?.viewport.flowCloudGroup ?? null;
  const getScaffoldGroups = () => engine.current?.scaffoldGroups() ?? null;
  const getCutGlueEdges = () => engine.current?.cutGlue.getEdges() ?? new Float32Array(0);

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

  function exportGLB(exportGroup: THREE.Object3D, suffix: string) {
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
      },
      (err) => console.error('GLTFExporter error', err),
      { binary: true }
    );
  }

  function buildScaffoldGroup(): THREE.Group | null {
    const groups = getScaffoldGroups();
    if (!groups) return null;

    const out = new THREE.Group();
    out.name = 'scaffold';

    const spheresClone = new THREE.Group();
    spheresClone.name = 'spheres';
    groups.spheres.children.forEach((c) => spheresClone.add(c.clone()));

    const baseClone = new THREE.Group();
    baseClone.name = 'base';
    groups.base.children.forEach((c) => baseClone.add(c.clone()));

    out.add(spheresClone, baseClone);
    return out;
  }

  function handleExportScaffold() {
    const scaffold = buildScaffoldGroup();
    if (!scaffold || scaffold.children.every((g) => (g as THREE.Group).children.length === 0)) {
      alert('No scaffold geometry visible.');
      return;
    }
    exportGLB(scaffold, '-scaffold');
  }

  function handleExportWireframe() {
    const flowCloudGroup = getFlowCloudGroup();
    const hasContent = flowCloudGroup?.children.some((c) => !c.userData.editorOnly);
    if (!flowCloudGroup || !hasContent) {
      alert('No flow cloud geometry. Click Regenerate first.');
      return;
    }

    const combined = new THREE.Group();
    combined.name = 'cloud-wireframe';

    // Flow cloud isosurface — include position, exclude drag handle
    const bodyClone = new THREE.Group();
    bodyClone.name = 'body';
    bodyClone.position.copy(flowCloudGroup.position);
    flowCloudGroup.children
      .filter((c) => !c.userData.editorOnly)
      .forEach((c) => bodyClone.add(c.clone()));
    combined.add(bodyClone);

    // Tail and spirals are cloud output, not just scaffolding
    const scaffoldGroups = getScaffoldGroups();
    if (scaffoldGroups) {
      if (scaffoldGroups.tail.children.length > 0) {
        const tailClone = new THREE.Group();
        tailClone.name = 'tail';
        scaffoldGroups.tail.children.forEach((c) => tailClone.add(c.clone()));
        combined.add(tailClone);
      }
      // Exclude orange handle boxes (userData.editorOnly)
      const spiralWires = scaffoldGroups.spirals.children.filter(
        (c) => !c.userData.editorOnly
      );
      if (spiralWires.length > 0) {
        const spiralClone = new THREE.Group();
        spiralClone.name = 'spirals';
        spiralWires.forEach((c) => spiralClone.add(c.clone()));
        combined.add(spiralClone);
      }
    }

    exportGLB(combined, '-wireframe');
  }

  function handleExportBoth() {
    const flowCloudGroup = getFlowCloudGroup();
    const scaffold       = buildScaffoldGroup();
    const hasContent = flowCloudGroup?.children.some((c) => !c.userData.editorOnly);

    if (!hasContent && (!scaffold || scaffold.children.every((g) => (g as THREE.Group).children.length === 0))) {
      alert('Nothing to export.');
      return;
    }

    const combined = new THREE.Group();
    combined.name = 'cloud';

    if (scaffold) combined.add(scaffold);

    if (flowCloudGroup && hasContent) {
      const flowCloudClone = new THREE.Group();
      flowCloudClone.name = 'wireframe';
      flowCloudClone.position.copy(flowCloudGroup.position);
      flowCloudGroup.children
        .filter((c) => !c.userData.editorOnly)
        .forEach((c) => flowCloudClone.add(c.clone()));
      combined.add(flowCloudClone);
    }

    exportGLB(combined, '-full');
  }

  function handleExportCloudGLB() {
    const edges = getCutGlueEdges();
    if (edges.length === 0) {
      alert('Run Cut & Glue first to generate the unified cloud wireframe.');
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(edges, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x000000 });
    const lines = new THREE.LineSegments(geo, mat);
    const group = new THREE.Group();
    group.name = 'cloud';
    group.add(lines);
    exportGLB(group, '-cloud');
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
