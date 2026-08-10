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
  const dot =
    surfaceOutwardDirection[0] * geocentricSunDirection[0] +
    surfaceOutwardDirection[1] * geocentricSunDirection[1] +
    surfaceOutwardDirection[2] * geocentricSunDirection[2];
  return Math.max(0, Math.min(1, dot));
}

function requireNormalizedMountCoordinate(value: number, label: string) {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(`${label} must be finite and within [-1, 1].`);
  }
}

/**
 * Binary point-center visibility for a vertical nadir ray. The opaque platform
 * includes its boundary, so a pixel is exposed only when its projected center
 * lies strictly outside the 60 x 60 cm top surface.
 */
export function isPixelCenterExposedToNadir(
  pixel: NadirPixelGeometry,
  mountX: number,
  mountZ: number,
): boolean {
  requireNormalizedMountCoordinate(mountX, "mountX");
  requireNormalizedMountCoordinate(mountZ, "mountZ");
  if (pixel.ring !== pixel.outermostRing) return false;

  const centerX = mountX * SATELLITE_PLATFORM_HALF_SIZE_CM;
  const centerZ = mountZ * SATELLITE_PLATFORM_HALF_SIZE_CM;
  const pixelX = centerX + Math.cos(pixel.angleRadians) * CRYSTAL_EYE_RADIUS_CM;
  const pixelZ = centerZ + Math.sin(pixel.angleRadians) * CRYSTAL_EYE_RADIUS_CM;
  const rayIntersectsPlatform =
    Math.abs(pixelX) <= SATELLITE_PLATFORM_HALF_SIZE_CM &&
    Math.abs(pixelZ) <= SATELLITE_PLATFORM_HALF_SIZE_CM;
  return !rayIntersectsPlatform;
}

export function getNadirExposureFraction(
  pixels: readonly NadirPixelGeometry[],
  mountX: number,
  mountZ: number,
): number {
  const outerPixels = pixels.filter(
    (pixel) => pixel.ring === pixel.outermostRing,
  );
  if (outerPixels.length === 0) return 0;
  return (
    outerPixels.filter((pixel) =>
      isPixelCenterExposedToNadir(pixel, mountX, mountZ),
    ).length / outerPixels.length
  );
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
    illumination <= 0.01 ||
    !isPixelCenterExposedToNadir(pixel, mountX, mountZ)
  ) {
    return 0;
  }
  const delta = Math.atan2(
    Math.sin(pixel.angleRadians - azimuthRadians),
    Math.cos(pixel.angleRadians - azimuthRadians),
  );
  const directionalLobe = Math.max(0, Math.cos(delta)) ** 1.7;
  const boundedDirectional = Math.max(0, Math.min(1, directional));
  const azimuthWeight =
    0.42 * (1 - boundedDirectional) +
    (0.08 + directionalLobe * 0.92) * boundedDirectional;
  return Math.max(0, illumination) * azimuthWeight;
}
