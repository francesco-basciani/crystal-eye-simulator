import type { EciEphemerisSample } from "./eci-ephemeris";

export type ParametricOrbitOverride = {
  canonicalSample: EciEphemerisSample;
  canonicalEquatorialPhaseRad: number;
  satelliteEciKm: [number, number, number];
};

/**
 * Builds a parametric circular orbit-plane scenario override while retaining
 * the complete timestamped ECI sample as its canonical source.
 *
 * The canonical satellite x/y longitude is reused as a parametric phase, the
 * ascending node is conventionally fixed at zero, and no orbit propagation is
 * performed. Sun and Moon vectors are not transformed.
 */
export function createParametricOrbitOverride(
  canonicalSample: EciEphemerisSample,
  radialDistanceKm: number,
  inclinationDeg: number,
): ParametricOrbitOverride {
  const canonicalEquatorialPhaseRad = Math.atan2(
    canonicalSample.satelliteKm[1],
    canonicalSample.satelliteKm[0],
  );
  const inclinationRad = (inclinationDeg * Math.PI) / 180;
  const phaseSine = Math.sin(canonicalEquatorialPhaseRad);

  return {
    canonicalSample,
    canonicalEquatorialPhaseRad,
    satelliteEciKm: [
      radialDistanceKm * Math.cos(canonicalEquatorialPhaseRad),
      radialDistanceKm * Math.cos(inclinationRad) * phaseSine,
      radialDistanceKm * Math.sin(inclinationRad) * phaseSine,
    ],
  };
}
