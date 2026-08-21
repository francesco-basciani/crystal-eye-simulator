export const SATELLITE_ORBIT_RADIUS_SCALE = 1;
export const MOON_DIRECTION_RADIUS_SCALE = 1.35;
export const SUN_DIRECTION_RADIUS_SCALE = 1.55;

export type GeometryPoint = Readonly<{ x: number; y: number }>;
export type ProjectedGeometryDirection = GeometryPoint & Readonly<{
  outOfPlane: boolean;
}>;

export function projectEciDirectionToGeometryEllipse(
  direction: readonly [number, number, number],
  center: GeometryPoint,
  orbitRadius: GeometryPoint,
  radialScale: number,
): ProjectedGeometryDirection {
  if (
    direction.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y) ||
    !Number.isFinite(orbitRadius.x) ||
    !Number.isFinite(orbitRadius.y) ||
    orbitRadius.x <= 0 ||
    orbitRadius.y <= 0 ||
    !Number.isFinite(radialScale) ||
    radialScale <= 0
  ) {
    throw new RangeError("System geometry projection requires finite positive geometry.");
  }
  const planarLength = Math.hypot(direction[0], direction[2]);
  const planarX = planarLength > 1e-12 ? direction[0] / planarLength : 0;
  const planarY = planarLength > 1e-12 ? direction[2] / planarLength : -1;
  return Object.freeze({
    x: center.x + planarX * orbitRadius.x * radialScale,
    y: center.y + planarY * orbitRadius.y * radialScale,
    outOfPlane: planarLength <= 1e-12,
  });
}

export function getGeometryEllipticalRadius(
  point: GeometryPoint,
  center: GeometryPoint,
  orbitRadius: GeometryPoint,
): number {
  return Math.hypot(
    (point.x - center.x) / orbitRadius.x,
    (point.y - center.y) / orbitRadius.y,
  );
}
