import {
  SATELLITE_PLATFORM_HALF_SIZE_CM,
  getProjectedModuleCenterCm,
  type NadirModuleGeometry,
} from "./earth-albedo-occlusion.ts";

/** Existing engineering attenuation length; requires domain validation. */
export const MOUNT_EDGE_ATTENUATION_LENGTH_CM = 4.5;

export function getMountEdgeExposure(
  module: NadirModuleGeometry,
  mountX: number,
  mountZ: number,
): number {
  const center = getProjectedModuleCenterCm(module, mountX, mountZ);
  const clearanceCm = Math.min(
    SATELLITE_PLATFORM_HALF_SIZE_CM - Math.abs(center.x),
    SATELLITE_PLATFORM_HALF_SIZE_CM - Math.abs(center.z),
  );
  return Math.max(
    0.015,
    Math.min(
      1,
      Math.exp(
        -Math.max(0, clearanceCm) / MOUNT_EDGE_ATTENUATION_LENGTH_CM,
      ),
    ),
  );
}

export function getMountSkyVisibility(
  module: NadirModuleGeometry,
  mountX: number,
  mountZ: number,
): number {
  const horizontal = Math.hypot(module.normal[0], module.normal[2]);
  const horizonWeight = horizontal ** 3.4;
  return 1 + (getMountEdgeExposure(module, mountX, mountZ) - 1) *
    horizonWeight;
}
