import { SKY_BENCHMARK_DATA } from "./sky-benchmark-data.ts";
import type { SkyLocalizationEvent } from "./sky-localization.ts";

// Display coordinates encode the established ROOT -> Three Rx(-90°) rotation.
// These are detector-local longitude/latitude, never equatorial RA/Dec.
const displayDirection = (angles: {thetaDeg: number; phiDeg: number}) => ({
  raDeg: ((-angles.phiDeg % 360) + 360) % 360, decDeg: 90 - angles.thetaDeg,
});
export const SKY_BENCHMARK_EXAMPLES: readonly SkyLocalizationEvent[] = SKY_BENCHMARK_DATA.cases.map(record => ({
  eventKey: `benchmark:${record.caseIndex}`, burstId: record.caseIndex,
  simulatedDate: SKY_BENCHMARK_DATA.generatedAtUtc,
  dataOrigin: "benchmark", coordinateSystem: "detector-local", status: "available",
  truth: displayDirection(record.requestedDirection),
  ks: displayDirection(record.methods["ks-5deg-v2"]),
  centroid: displayDirection(record.methods["positive-excess-centroid"]),
  ksErrorDeg: record.methods["ks-5deg-v2"].requestedToReconstructedDeg,
  centroidErrorDeg: record.methods["positive-excess-centroid"].requestedToReconstructedDeg,
  coordinateFrame: "Detector-local θ / φ · source-only benchmark",
  gridLabel: "KS 5° · deterministic expected response",
  reason: "Computed benchmark; no background or Poisson sampling. Not an observed burst or calibrated uncertainty.",
}));
