/**
 * The range of every numeric field of the preset (refactor plan D11): the values the editor's
 * controls can set and normalizePreset keeps. A field with a slider has the slider's min, max
 * and step; the coordinates of base control points, tail setpoints and the F and B anchors, which
 * have number fields and handles only, have a range chosen to hold every value the rest of the
 * editor works with. The panels read their sliders, number fields and lists from here.
 */

export interface NumberRange {
  readonly min: number;
  readonly max: number;
  /** The slider's step, or a number field's arrow-key step for a field without a slider. */
  readonly step: number;
  /** A number field's arrow-key step, where the field also has a slider with another step. */
  readonly fieldStep?: number;
  /** A whole number (a segment count, a density): normalizePreset rounds it, then clamps it. */
  readonly integer?: boolean;
  /** An angle in radians, min to max being one full turn: normalizePreset wraps a value from
   *  outside the range into it, which keeps the rotation it describes, instead of clamping. */
  readonly angle?: boolean;
}

function range(min: number, max: number, step: number, extra: Partial<NumberRange> = {}): NumberRange {
  return { min, max, step, ...extra };
}

/** A whole-number field with a step-1 slider. */
function count(min: number, max: number): NumberRange {
  return range(min, max, 1, { integer: true });
}

/** An Euler angle, as the Rotate sliders set it. */
const ANGLE = range(-Math.PI, Math.PI, 0.01, { angle: true });

/** The Pos sliders of a sphere or a spiral, per axis. */
const POSITION: readonly [NumberRange, NumberRange, NumberRange] = [
  range(-8, 8, 0.05),
  range(-4, 4, 0.05),
  range(-4, 4, 0.05),
];

/**
 * A coordinate with a number field and a handle but no slider: base control points, tail
 * setpoints, the F and B anchors. -50 to 50 holds every fixture and the default preset (within
 * 4.3 of the origin), the flow cloud's Position range (-20 to 20) and the sphere and spiral
 * Pos ranges, with margin; the view's grid spans -10 to 10.
 */
const COORDINATE = range(-50, 50, 0.1);

export const RANGES = {
  sphere: {
    position: POSITION,
    radius: range(0.1, 3, 0.05),
    falloff: range(0.5, 5, 0.1),
    rotation: ANGLE,
    scale: range(0.2, 3, 0.05),
  },
  base: {
    controlPoint: COORDINATE,
    crossSectionWidth: range(0.1, 4, 0.05),
    crossSectionHeight: range(0.05, 2, 0.05),
    ringSegments: count(6, 32),
    lengthSegments: count(8, 48),
  },
  tail: {
    setpointPosition: COORDINATE,
    /** The Start radius and End radius sliders, and each setpoint's w field. */
    width: range(0.05, 1.5, 0.01, { fieldStep: 0.05 }),
    curlAmount: range(0, Math.PI * 2, 0.05),
    attachOffset: range(0, 1, 0.01),
    radialSegments: count(4, 24),
    lengthSegments: count(8, 64),
  },
  spiral: {
    position: POSITION,
    rotation: ANGLE,
    startRadius: range(0.01, 2, 0.01),
    endRadius: range(0.1, 6, 0.05),
    turns: range(0.25, 6, 0.25),
    separation: range(0, 2, 0.01),
    taperPower: range(0, 4, 0.05),
    rungDensity: count(1, 32),
    thickness: range(0, 2, 0.01),
    cornerRadius: range(0, 1, 0.01),
  },
  flowCloud: {
    position: range(-20, 20, 0.1),
    threshold: range(0.5, 2, 0.05),
    /** No control sets it (plan decision D27): a preset file can, within this range. */
    tailStrength: range(0, 10, 0.1),
    /** The F and B anchors' coordinates. */
    anchor: COORDINATE,
    numBands: count(4, 20),
    numFlowLines: count(4, 24),
    spiralTwist: range(0, Math.PI * 4, 0.05),
  },
} as const;

/** The grid resolutions the Flow Cloud panel's selects offer, ascending: 'Resolution' for the
 *  flow cloud and 'Mesh Density' for the surface mesh. */
export const RESOLUTIONS = {
  flowCloud: [32, 64, 128],
  surfaceMesh: [32, 64, 96, 128, 192, 256],
} as const satisfies Record<string, readonly number[]>;

/** `v` clamped into `range`, and -0 as 0 (adding 0 changes nothing else): JSON writes -0 as 0,
 *  so a preset that held -0 would not come back from Export JSON and Import unchanged. */
export function clampTo(range: NumberRange, v: number): number {
  return Math.min(Math.max(v, range.min), range.max) + 0;
}

/** Each component of `v` clamped into its range: one range for all three, or one per axis. */
export function clampVec3(
  range: NumberRange | readonly NumberRange[],
  v: readonly [number, number, number],
): [number, number, number] {
  const r = (i: number) => ('min' in range ? range : range[i]);
  return [clampTo(r(0), v[0]), clampTo(r(1), v[1]), clampTo(r(2), v[2])];
}
