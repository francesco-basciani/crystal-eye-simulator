import type { EciEphemerisSample, EciVectorKm } from "./eci-ephemeris";

export type CelestialReferenceFrameDirections = Readonly<{
  satelliteGeocentric: EciVectorKm;
  sunGeocentric: EciVectorKm;
  moonGeocentric: EciVectorKm;
  sunTopocentric: EciVectorKm;
  moonTopocentric: EciVectorKm;
  sunBoresightSeparationDeg: number;
  moonBoresightSeparationDeg: number;
  sunMoonGeocentricSeparationDeg: number;
}>;

function unit(vector: EciVectorKm): EciVectorKm {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error("Celestial direction requires a finite, non-zero ECI vector.");
  }
  return Object.freeze(vector.map((component) => component / length) as [
    number,
    number,
    number,
  ]);
}

function subtract(a: EciVectorKm, b: EciVectorKm): EciVectorKm {
  return Object.freeze([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
}

export function angularSeparationDeg(
  first: EciVectorKm,
  second: EciVectorKm,
): number {
  const firstUnit = unit(first);
  const secondUnit = unit(second);
  const dot = Math.max(
    -1,
    Math.min(
      1,
      firstUnit[0] * secondUnit[0] +
        firstUnit[1] * secondUnit[1] +
        firstUnit[2] * secondUnit[2],
    ),
  );
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Keeps the Earth-system and detector frames distinct.
 *
 * Geocentric directions are derived directly from the workbook ECI positions
 * and are therefore independent of the satellite scenario. Detector/FOV
 * directions are topocentric and use the selected satellite ECI position.
 */
export function deriveCelestialReferenceFrameDirections(
  sample: EciEphemerisSample,
  satelliteEciKm: EciVectorKm = sample.satelliteKm,
): CelestialReferenceFrameDirections {
  const satelliteGeocentric = unit(satelliteEciKm);
  const sunGeocentric = unit(sample.sunKm);
  const moonGeocentric = unit(sample.moonKm);
  const sunTopocentric = unit(subtract(sample.sunKm, satelliteEciKm));
  const moonTopocentric = unit(subtract(sample.moonKm, satelliteEciKm));

  return Object.freeze({
    satelliteGeocentric,
    sunGeocentric,
    moonGeocentric,
    sunTopocentric,
    moonTopocentric,
    sunBoresightSeparationDeg: angularSeparationDeg(
      satelliteGeocentric,
      sunTopocentric,
    ),
    moonBoresightSeparationDeg: angularSeparationDeg(
      satelliteGeocentric,
      moonTopocentric,
    ),
    sunMoonGeocentricSeparationDeg: angularSeparationDeg(
      sunGeocentric,
      moonGeocentric,
    ),
  });
}

