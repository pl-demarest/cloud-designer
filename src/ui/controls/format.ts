/** Display formats shared by the panels' sliders. */

/** Radians as whole degrees: π/2 -> "90°". */
export function formatDegrees(radians: number): string {
  return `${((radians / Math.PI) * 180).toFixed(0)}°`;
}

/** Radians as a multiple of π: π/2 -> "0.50π". */
export function formatPi(radians: number): string {
  return `${(radians / Math.PI).toFixed(2)}π`;
}
