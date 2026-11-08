import { SliderRow } from './SliderRow';
import { AXES, withAxis, type Vec3 } from './vec3';
import type { NumberRange } from '../../model/ranges';

interface Props {
  /** Each slider's label is this prefix and its axis ("Pos" gives "Pos X"); empty gives "X". */
  label: string;
  /** With an empty label: the prefix of each slider's accessible name ("Position" gives
   *  "Position X"). */
  name?: string;
  value: readonly [number, number, number];
  /** The range table's entry for every axis, or one per axis. */
  range: NumberRange | readonly [NumberRange, NumberRange, NumberRange];
  format?: (v: number) => string;
  /** Receives the whole vector with one component replaced. */
  onChange: (value: Vec3) => void;
}

/** Three SliderRows, one per component of a vector field of the preset. */
export function Vec3Field({ label, name, value, range, format, onChange }: Props) {
  return (
    <>
      {AXES.map((axis, i) => (
        <SliderRow
          key={axis}
          label={label ? `${label} ${axis}` : axis}
          ariaLabel={name ? `${name} ${axis}` : undefined}
          value={value[i]}
          range={'min' in range ? range : range[i]}
          format={format}
          onChange={(x) => onChange(withAxis(value, i, x))}
        />
      ))}
    </>
  );
}
