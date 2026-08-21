export function getSmoothAngularAcceptance(
  separationDeg: number,
  halfAngleDeg: number,
  edgeRolloffDeg: number,
): number {
  for (const [value, label] of [
    [separationDeg, "separationDeg"],
    [halfAngleDeg, "halfAngleDeg"],
    [edgeRolloffDeg, "edgeRolloffDeg"],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be finite.`);
    }
  }
  if (separationDeg < 0 || separationDeg > 180) {
    throw new RangeError("separationDeg must be within [0, 180].");
  }
  if (halfAngleDeg <= 0 || halfAngleDeg > 180) {
    throw new RangeError("halfAngleDeg must be within (0, 180].");
  }
  if (edgeRolloffDeg <= 0 || edgeRolloffDeg > halfAngleDeg) {
    throw new RangeError("edgeRolloffDeg must be within (0, halfAngleDeg].");
  }
  const cosineProjection = Math.max(
    0,
    Math.cos(separationDeg * Math.PI / 180),
  ) ** 2;
  const edgeFraction = Math.max(
    0,
    Math.min(1, (halfAngleDeg - separationDeg) / edgeRolloffDeg),
  );
  const smoothEdge = edgeFraction ** 2 * (3 - 2 * edgeFraction);
  return cosineProjection * smoothEdge;
}
