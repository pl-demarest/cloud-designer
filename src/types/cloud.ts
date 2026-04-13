export interface SphereDef {
  id: string;
  position: [number, number, number];
  radius: number;
  falloff: number;
  shape: 'sphere' | 'ellipsoid';
  scale: [number, number, number];
  rotation: [number, number, number]; // Euler XYZ in radians
  half: boolean;                       // clip to top hemisphere before rotation
}

export interface BaseDef {
  controlPoints: [number, number, number][];
  crossSectionWidth: number;
  crossSectionHeight: number;
  crossSectionShape: 'oval' | 'rect';
  closed: boolean;
  ringSegments?: number;    // vertices per cross-section ring (default 16)
  lengthSegments?: number;  // number of cross-section rings along path (default 24)
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
  radialSegments?: number;  // vertices per cross-section ring (default 12)
  lengthSegments?: number;  // number of cross-section rings along path (default 32)
}

export interface SpiralDef {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];   // Euler XYZ radians — tilts the spiral plane in 3D
  startRadius: number;                  // inner radius at the spiral center
  endRadius: number;                    // outer radius at the outermost turn
  turns: number;                        // number of full 360° revolutions
  separation: number;                   // max perpendicular gap between the two spiral copies (at outer edge)
  taperPower: number;                   // 0=uniform ribbon, 1=linear, 2=snail shell (quadratic)
  rungDensity: number;                  // connecting lines per full turn
  spiralType: 'archimedean' | 'golden'; // archimedean=equal spacing; golden=logarithmic (self-similar)
  thickness?: number;                   // depth of rectangular cross-section in radial direction
                                        // 0 or undefined = flat ribbon (legacy); >0 = thickened coil
  cornerRadius?: number;                // rounding at rectangle corners (0 = sharp)
                                        // clamped to min(thickness, separation*taper)/2 at each sample
}

export interface WireframeStyle {
  mode: 'edges' | 'spiral';
  frontPoint: [number, number, number];
  backPoint: [number, number, number];
  numBands: number;
  numFlowLines: number;
  spiralTwist: number;
  /** When false, bands are not extracted by the worker and are absent from the
   *  generated isosurface structure entirely. Requires Regenerate to apply. */
  generateBands: boolean;
  showBands: boolean;
  showFlowLines: boolean;
}

export interface FlowCloudSettings {
  resolution: number;
  threshold: number;
  smooth: boolean;
  tailStrength: number;
  wireframe: WireframeStyle;
  /** World-space position of the generated wireframe object. Draggable in the viewport. */
  position: [number, number, number];
}

export interface CloudPreset {
  name: string;
  version: number;
  spheres: SphereDef[];
  base: BaseDef;
  tail: TailDef;
  spirals: SpiralDef[];
  flowCloud: FlowCloudSettings;
  surfaceMeshResolution?: number; // MC grid resolution for unified surface mesh (32–256, default 64)
}

export const DEFAULT_PRESET: CloudPreset = {
  name: 'Default Cloud',
  version: 1,
  spheres: [
    {
      id: 'sphere-0',
      position: [0, 0, 0],
      radius: 1.2,
      falloff: 0.5,
      shape: 'sphere',
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      half: false,
    },
    {
      id: 'sphere-1',
      position: [1.6, 0.3, 0],
      radius: 1.0,
      falloff: 0.5,
      shape: 'sphere',
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      half: false,
    },
    {
      id: 'sphere-2',
      position: [-1.6, 0.2, 0],
      radius: 0.9,
      falloff: 0.5,
      shape: 'sphere',
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      half: false,
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
    ringSegments: 16,
    lengthSegments: 24,
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
    radialSegments: 12,
    lengthSegments: 32,
  },
  spirals: [],
  flowCloud: {
    resolution: 64,
    threshold: 1.0,
    smooth: true,
    tailStrength: 0,
    position: [0, 0, 0] as [number, number, number],
    wireframe: {
      mode: 'spiral',
      frontPoint: [-2, 0, 0],
      backPoint: [2.5, 0, 0],
      numBands: 8,
      numFlowLines: 16,
      spiralTwist: Math.PI,
      generateBands: false,
      showBands: true,
      showFlowLines: true,
    },
  },
};
