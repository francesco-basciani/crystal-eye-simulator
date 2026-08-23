import type {
  BurstDirectionReconstruction,
  Vector3,
} from "./burst-direction-reconstruction";

export type DirectionTruth = Readonly<{ raDeg: number; decDeg: number }>;

function toVector({ raDeg, decDeg }: DirectionTruth): Vector3 {
  if (
    !Number.isFinite(raDeg) ||
    !Number.isFinite(decDeg) ||
    decDeg < -90 ||
    decDeg > 90
  ) {
    throw new RangeError("Direction requires finite RA and Dec within [-90, +90] degrees.");
  }
  const ra = raDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  return [
    Math.cos(dec) * Math.cos(ra),
    Math.sin(dec),
    Math.cos(dec) * Math.sin(ra),
  ];
}

export function angularSeparationDeg(
  firstDirection: DirectionTruth,
  secondDirection: DirectionTruth,
) {
  const first = toVector(firstDirection);
  const second = toVector(secondDirection);
  const dot = Math.max(-1, Math.min(1,
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2],
  ));
  const crossX = first[1] * second[2] - first[2] * second[1];
  const crossY = first[2] * second[0] - first[0] * second[2];
  const crossZ = first[0] * second[1] - first[1] * second[0];
  const crossMagnitude = Math.hypot(crossX, crossY, crossZ);
  return Math.atan2(crossMagnitude, dot) * 180 / Math.PI;
}

export function scoreDirectionAgainstTruth(
  reconstruction: BurstDirectionReconstruction,
  truth: DirectionTruth,
) {
  return angularSeparationDeg(reconstruction, truth);
}
