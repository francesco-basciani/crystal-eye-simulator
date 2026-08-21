export const SATELLITE_PLATFORM_HALF_SIZE_CM = 30;
export const CRYSTAL_EYE_RADIUS_CM = 15;
export const OUTER_CROWN_MIN_POLAR_ANGLE_DEG = 80;
const OUTER_CROWN_MAX_NORMAL_Y = Math.cos(
  OUTER_CROWN_MIN_POLAR_ANGLE_DEG * Math.PI / 180,
);

export type UnitDirection = readonly [number, number, number];

export type NadirModuleGeometry = Readonly<{
  pixelId: number;
  normal: UnitDirection;
}>;

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

function requireModule(module: NadirModuleGeometry) {
  const [x, y, z] = module.normal;
  const length = Math.hypot(x, y, z);
  if (
    !Number.isInteger(module.pixelId) ||
    module.pixelId < 0 ||
    !Number.isFinite(length) ||
    Math.abs(length - 1) > 1e-9
  ) {
    throw new RangeError("Nadir module requires a non-negative pixel ID and unit normal.");
  }
}

export function isOuterCrownModule(module: NadirModuleGeometry): boolean {
  requireModule(module);
  return module.normal[1] <= OUTER_CROWN_MAX_NORMAL_Y + 1e-12;
}

export function getProjectedModuleCenterCm(
  module: NadirModuleGeometry,
  mountX: number,
  mountZ: number,
): Readonly<{ x: number; z: number }> {
  requireModule(module);
  requireMount(mountX, "mountX");
  requireMount(mountZ, "mountZ");
  return Object.freeze({
    x: mountX * SATELLITE_PLATFORM_HALF_SIZE_CM +
      module.normal[0] * CRYSTAL_EYE_RADIUS_CM,
    z: mountZ * SATELLITE_PLATFORM_HALF_SIZE_CM +
      module.normal[2] * CRYSTAL_EYE_RADIUS_CM,
  });
}

/** Point-center visibility for a vertical nadir ray; partial module area is unavailable. */
export function isModuleCenterExposedToNadir(
  module: NadirModuleGeometry,
  mountX: number,
  mountZ: number,
): boolean {
  if (!isOuterCrownModule(module)) return false;
  const center = getProjectedModuleCenterCm(module, mountX, mountZ);
  return Math.abs(center.x) > SATELLITE_PLATFORM_HALF_SIZE_CM ||
    Math.abs(center.z) > SATELLITE_PLATFORM_HALF_SIZE_CM;
}

export function getNadirExposureFraction(
  modules: readonly NadirModuleGeometry[],
  mountX: number,
  mountZ: number,
): number {
  const outerCrown = modules.filter(isOuterCrownModule);
  if (outerCrown.length === 0) return 0;
  return outerCrown.filter((module) =>
    isModuleCenterExposedToNadir(module, mountX, mountZ)
  ).length / outerCrown.length;
}

export function getExposedEarthAlbedoWeight(
  module: NadirModuleGeometry,
  illumination: number,
  azimuthRadians: number,
  directional: number,
  mountX: number,
  mountZ: number,
): number {
  if (
    illumination <= 0 ||
    !isModuleCenterExposedToNadir(module, mountX, mountZ)
  ) return 0;
  const moduleAzimuth = Math.atan2(module.normal[2], module.normal[0]);
  const delta = Math.atan2(
    Math.sin(moduleAzimuth - azimuthRadians),
    Math.cos(moduleAzimuth - azimuthRadians),
  );
  const directionalLobe = Math.max(0, Math.cos(delta)) ** 1.7;
  const boundedDirectional = Math.max(0, Math.min(1, directional));
  const azimuthWeight = 0.42 * (1 - boundedDirectional) +
    (0.08 + directionalLobe * 0.92) * boundedDirectional;
  return Math.max(0, illumination) * azimuthWeight;
}
