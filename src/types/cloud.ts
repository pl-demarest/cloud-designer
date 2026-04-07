export interface SwirlDef {
  id: string;
  position: [number, number, number];
  radius: number;
  falloff: number;
  shape: 'sphere' | 'ellipsoid';
  scale: [number, number, number];
}

export interface BaseDef {
  controlPoints: [number, number, number][];
  crossSectionWidth: number;
  crossSectionHeight: number;
  crossSectionShape: 'oval' | 'rect';
  closed: boolean;
}

export interface TailSetpoint {
  id: string;
  position: [number, number, number];
  width: number;
}

export interface TailDef {
  setpoints: TailSetpoint[];
  curlAmount: number;
  attachToBase: 'start' | 'end' | 'none';
  attachOffset: number;
}

export interface WireframeStyle {
  mode: 'edges' | 'spiral';
  frontPoint: [number, number, number];
  backPoint: [number, number, number];
  numBands: number;
  numFlowLines: number;
  spiralTwist: number;
  showBands: boolean;
  showFlowLines: boolean;
}

export interface MergeSettings {
  resolution: number;
  threshold: number;
  smooth: boolean;
  wireframe: WireframeStyle;
}

export interface CloudPreset {
  name: string;
  version: number;
  swirls: SwirlDef[];
  base: BaseDef;
  tail: TailDef;
  merge: MergeSettings;
}

export const DEFAULT_PRESET: CloudPreset = {
  name: 'Default Cloud',
  version: 1,
  swirls: [
    {
      id: 'swirl-0',
      position: [0, 0, 0],
      radius: 1.2,
      falloff: 2.0,
      shape: 'sphere',
      scale: [1, 1, 1],
    },
    {
      id: 'swirl-1',
      position: [1.6, 0.3, 0],
      radius: 1.0,
      falloff: 2.0,
      shape: 'sphere',
      scale: [1, 1, 1],
    },
    {
      id: 'swirl-2',
      position: [-1.6, 0.2, 0],
      radius: 0.9,
      falloff: 2.0,
      shape: 'sphere',
      scale: [1, 1, 1],
    },
  ],
  base: {
    controlPoints: [
      [-2.5, -0.8, 0],
      [-1.0, -1.0, 0.3],
      [1.0, -1.0, -0.3],
      [2.5, -0.8, 0],
    ],
    crossSectionWidth: 1.2,
    crossSectionHeight: 0.4,
    crossSectionShape: 'oval',
    closed: false,
  },
  tail: {
    setpoints: [
      { id: 'tail-0', position: [2.5, -0.8, 0], width: 0.8 },
      { id: 'tail-1', position: [3.5, -0.4, 0.5], width: 0.4 },
      { id: 'tail-2', position: [4.2, 0.2, 0.8], width: 0.1 },
    ],
    curlAmount: Math.PI * 0.5,
    attachToBase: 'end',
    attachOffset: 1.0,
  },
  merge: {
    resolution: 64,
    threshold: 1.0,
    smooth: true,
    wireframe: {
      mode: 'spiral',
      frontPoint: [0, 0, 2],
      backPoint: [0, 0, -2],
      numBands: 8,
      numFlowLines: 8,
      spiralTwist: Math.PI,
      showBands: true,
      showFlowLines: true,
    },
  },
};
