import { celestialToVector, type SkyDirection, type SkyVector } from "./sky-localization.ts";

/** Orthographic sky view, north up and increasing RA to the left at the centre. */
export function projectSkyVector(point: SkyVector, centre: SkyDirection) {
  const ra = centre.raDeg * Math.PI / 180;
  const dec = centre.decDeg * Math.PI / 180;
  const normal = celestialToVector(centre);
  const right = [Math.sin(ra), 0, -Math.cos(ra)];
  const north = [-Math.sin(dec) * Math.cos(ra), Math.cos(dec), -Math.sin(dec) * Math.sin(ra)];
  const dot = (basis: readonly number[]) => point.reduce((sum, value, index) => sum + value * basis[index], 0);
  const depth = dot(normal);
  return { x: dot(right), y: -dot(north), depth, visible: depth >= -1e-10 };
}

export function oppositeSkyDirection(centre: SkyDirection): SkyDirection {
  return { raDeg: (centre.raDeg + 180) % 360, decDeg: -centre.decDeg };
}

/** Separate visible segments so a hidden arc is never drawn through the disk. */
export function orthographicPath(points: readonly SkyVector[], centre: SkyDirection, radius: number, cx: number, cy: number) {
  let drawing = false;
  return points.map(point => {
    const projection = projectSkyVector(point, centre);
    if (!projection.visible) { drawing = false; return ""; }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${(cx + projection.x * radius).toFixed(3)},${(cy + projection.y * radius).toFixed(3)}`;
  }).join(" ");
}
