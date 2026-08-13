export type Vector3 = readonly [number, number, number];

export type DirectionReconstructionInput = Readonly<{
  pixelValues: readonly number[];
  pixelBaseline: readonly number[];
  detectorNormals: readonly Vector3[];
  radialBoresight: Vector3;
  frameIndex: number;
  acquisitionTimeSeconds: number;
}>;

export type BurstDirectionReconstruction = Readonly<{
  status: "available";
  method: "positive-excess-weighted-centroid-v1";
  frameIndex: number;
  acquisitionTimeSeconds: number;
  localDirection: Vector3;
  sceneDirection: Vector3;
  raDeg: number;
  decDeg: number;
  positiveExcessCounts: number;
  activePixelCount: number;
}>;

export type UnavailableBurstDirection = Readonly<{
  status: "unavailable";
  reason:
    | "dimension-mismatch"
    | "invalid-input"
    | "zero-positive-excess"
    | "degenerate-centroid";
  frameIndex: number;
  acquisitionTimeSeconds: number;
}>;

export type DirectionReconstructionResult =
  | BurstDirectionReconstruction
  | UnavailableBurstDirection;

function normalized(vector: Vector3): Vector3 | null {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length <= Number.EPSILON) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function rotateDetectorDirectionToScene(
  rawDirection: Vector3,
  rawBoresight: Vector3,
): Vector3 | null {
  const direction = normalized(rawDirection);
  const boresight = normalized(rawBoresight);
  if (!direction || !boresight) return null;
  const from: Vector3 = [0, 1, 0];
  const axis = cross(from, boresight);
  const axisLengthSquared = dot(axis, axis);
  const cosine = Math.max(-1, Math.min(1, dot(from, boresight)));
  const rotated: Vector3 = cosine < -1 + 1e-8
    ? [-direction[0], -direction[1], direction[2]]
    : axisLengthSquared <= Number.EPSILON
      ? direction
      : (() => {
          const axisCrossDirection = cross(axis, direction);
          const scale = dot(axis, direction) * (1 - cosine) / axisLengthSquared;
          return [
            direction[0] * cosine + axisCrossDirection[0] + axis[0] * scale,
            direction[1] * cosine + axisCrossDirection[1] + axis[1] * scale,
            direction[2] * cosine + axisCrossDirection[2] + axis[2] * scale,
          ];
        })();
  return normalized(rotated);
}

export function sceneDirectionToRaDec(direction: Vector3) {
  const unit = normalized(direction);
  if (!unit) return null;
  return Object.freeze({
    raDeg: ((Math.atan2(unit[2], unit[0]) * 180 / Math.PI) + 360) % 360,
    decDeg: Math.asin(Math.max(-1, Math.min(1, unit[1]))) * 180 / Math.PI,
  });
}

export function reconstructBurstDirection(
  input: DirectionReconstructionInput,
): DirectionReconstructionResult {
  const length = input.pixelValues.length;
  if (
    length === 0 ||
    input.pixelBaseline.length !== length ||
    input.detectorNormals.length !== length
  ) {
    return Object.freeze({
      status: "unavailable",
      reason: "dimension-mismatch",
      frameIndex: input.frameIndex,
      acquisitionTimeSeconds: input.acquisitionTimeSeconds,
    });
  }
  if (
    !Number.isFinite(input.acquisitionTimeSeconds) ||
    !Number.isInteger(input.frameIndex) ||
    input.pixelValues.some((value) => !Number.isFinite(value) || value < 0) ||
    input.pixelBaseline.some((value) => !Number.isFinite(value) || value < 0) ||
    input.detectorNormals.some((normal) => !normalized(normal)) ||
    !normalized(input.radialBoresight)
  ) {
    return Object.freeze({
      status: "unavailable",
      reason: "invalid-input",
      frameIndex: input.frameIndex,
      acquisitionTimeSeconds: input.acquisitionTimeSeconds,
    });
  }
  let positiveExcessCounts = 0;
  let activePixelCount = 0;
  const weighted: [number, number, number] = [0, 0, 0];
  input.pixelValues.forEach((value, index) => {
    const excess = Math.max(0, value - input.pixelBaseline[index]);
    if (excess > 0) activePixelCount += 1;
    const normal = normalized(input.detectorNormals[index])!;
    positiveExcessCounts += excess;
    weighted[0] += normal[0] * excess;
    weighted[1] += normal[1] * excess;
    weighted[2] += normal[2] * excess;
  });
  const localDirection = normalized(weighted);
  const sceneDirection = localDirection
    ? rotateDetectorDirectionToScene(localDirection, input.radialBoresight)
    : null;
  const coordinates = sceneDirection
    ? sceneDirectionToRaDec(sceneDirection)
    : null;
  if (positiveExcessCounts <= 0) {
    return Object.freeze({
      status: "unavailable",
      reason: "zero-positive-excess",
      frameIndex: input.frameIndex,
      acquisitionTimeSeconds: input.acquisitionTimeSeconds,
    });
  }
  if (!localDirection || !sceneDirection || !coordinates) {
    return Object.freeze({
      status: "unavailable",
      reason: "degenerate-centroid",
      frameIndex: input.frameIndex,
      acquisitionTimeSeconds: input.acquisitionTimeSeconds,
    });
  }
  return Object.freeze({
    status: "available",
    method: "positive-excess-weighted-centroid-v1",
    frameIndex: input.frameIndex,
    acquisitionTimeSeconds: input.acquisitionTimeSeconds,
    localDirection,
    sceneDirection,
    ...coordinates,
    positiveExcessCounts,
    activePixelCount,
  });
}
