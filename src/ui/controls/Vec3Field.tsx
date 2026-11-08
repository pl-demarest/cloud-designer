import { SliderRow } from './SliderRow';

type Vec3 = [number, number, number];

const AXES = ['X', 'Y', 'Z'] as const;

interface Props {
  /** Each slider's label is this prefix and its axis ("Pos" gives "Pos X"); empty gives "X". */
  label: string;
  value: readonly [number, number, number];
  /** One bound for every axis, or one per axis. */
  min: number | Vec3;
  max: number | Vec3;
  step?: number;
  format?: (v: number) => string;
  /** Receives the whole vector with one component replaced. */
  onChange: (value: Vec3) => void;
  onCommit?: () => void;
}

/** `v` with component `axis` set to `x`. */
function withAxis(v: readonly [number, number, number], axis: number, x: number): Vec3 {
  const next: Vec3 = [v[0], v[1], v[2]];
  next[axis] = x;
  return next;
}

/** Three SliderRows, one per component of a vector field of the preset. */
export function Vec3Field({ label, value, min, max, step, format, onChange, onCommit }: Props) {
  return (
    <>
      {AXES.map((axis, i) => (
        <SliderRow
          key={axis}
          label={label ? `${label} ${axis}` : axis}
          value={value[i]}
          min={typeof min === 'number' ? min : min[i]}
          max={typeof max === 'number' ? max : max[i]}
          step={step}
          format={format}
          onChange={(x) => onChange(withAxis(value, i, x))}
          onCommit={onCommit}
        />
      ))}
    </>
  );
}
