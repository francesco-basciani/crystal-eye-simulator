export const SATELLITE_PLATFORM_HALF_SIZE_CM = 30;
export const CRYSTAL_EYE_RADIUS_CM = 15;

export type NadirPixelGeometry = Readonly<{
  ring: number;
  outermostRing: number;
  angleRadians: number;
}>;

export type UnitDirection = readonly [number, number, number];

export function getSubSatelliteSolarIncidence(
  surfaceOutwardDirection: UnitDirection,
  geocentricSunDirection: UnitDirection,
): number {
  const dot = surfaceOutwardDirection[0] * geocentricSunDirection[0] +
    surfaceOutwardDirection[1] * geocentricSunDirection[1] +
    surfaceOutwardDirection[2] * geocentricSunDirection[2];
  return Math.max(0, Math.min(1, dot));
}

function requireMount(value: number, label: string) {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(`${label} must be finite and within [-1, 1].`);
  }
}

/** Binary point-center visibility for a vertical nadir ray. */
export function isPixelCenterExposedToNadir(
  pixel: NadirPixelGeometry,
  mountX: number,
  mountZ: number,
): boolean {
  requireMount(mountX, "mountX");
  requireMount(mountZ, "mountZ");
  if (pixel.ring !== pixel.outermostRing) return false;
  const pixelX = mountX * SATELLITE_PLATFORM_HALF_SIZE_CM +
    Math.cos(pixel.angleRadians) * CRYSTAL_EYE_RADIUS_CM;
  const pixelZ = mountZ * SATELLITE_PLATFORM_HALF_SIZE_CM +
    Math.sin(pixel.angleRadians) * CRYSTAL_EYE_RADIUS_CM;
  return Math.abs(pixelX) > SATELLITE_PLATFORM_HALF_SIZE_CM ||
    Math.abs(pixelZ) > SATELLITE_PLATFORM_HALF_SIZE_CM;
}

export function getNadirExposureFraction(
  pixels: readonly NadirPixelGeometry[],
  mountX: number,
  mountZ: number,
): number {
  const outer = pixels.filter((pixel) => pixel.ring === pixel.outermostRing);
  if (outer.length === 0) return 0;
  return outer.filter((pixel) => isPixelCenterExposedToNadir(pixel, mountX, mountZ)).length /
    outer.length;
}

export function getExposedEarthAlbedoWeight(
  pixel: NadirPixelGeometry,
  illumination: number,
  azimuthRadians: number,
  directional: number,
  mountX: number,
  mountZ: number,
): number {
  if (
    illumination <= 0 ||
    !isPixelCenterExposedToNadir(pixel, mountX, mountZ)
  ) return 0;
  const delta = Math.atan2(
    Math.sin(pixel.angleRadians - azimuthRadians),
    Math.cos(pixel.angleRadians - azimuthRadians),
  );
  const directionalLobe = Math.max(0, Math.cos(delta)) ** 1.7;
  const boundedDirectional = Math.max(0, Math.min(1, directional));
  const azimuthWeight = 0.42 * (1 - boundedDirectional) +
    (0.08 + directionalLobe * 0.92) * boundedDirectional;
  return Math.max(0, illumination) * azimuthWeight;
}
