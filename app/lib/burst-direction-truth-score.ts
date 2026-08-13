import type {
  BurstDirectionReconstruction,
  Vector3,
} from "./burst-direction-reconstruction";

export type DirectionTruth = Readonly<{ raDeg: number; decDeg: number }>;

function toVector({ raDeg, decDeg }: DirectionTruth): Vector3 {
  const ra = raDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  return [
    Math.cos(dec) * Math.cos(ra),
    Math.sin(dec),
    Math.cos(dec) * Math.sin(ra),
  ];
}

export function scoreDirectionAgainstTruth(
  reconstruction: BurstDirectionReconstruction,
  truth: DirectionTruth,
) {
  const first = toVector(reconstruction);
  const second = toVector(truth);
  const dot =
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}
