/** Display formats shared by the panels' sliders and number fields. */

/** `v` with `digits` decimals, as toFixed gives it, but without the minus sign of a value that
 *  rounds to zero: -0.001 -> "0.00", not "-0.00". */
export function formatFixed(v: number, digits: number): string {
  const text = v.toFixed(digits);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

/** Radians as whole degrees: π/2 -> "90°". */
export function formatDegrees(radians: number): string {
  return `${formatFixed((radians / Math.PI) * 180, 0)}°`;
}

/** Radians as a multiple of π: π/2 -> "0.50π". */
export function formatPi(radians: number): string {
  return `${formatFixed(radians / Math.PI, 2)}π`;
}
