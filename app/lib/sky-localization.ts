import { angularSeparationDeg } from "./burst-direction-truth-score.ts";

export type SkyDirection = Readonly<{ raDeg: number; decDeg: number }>;
export type SkyVector = readonly [number, number, number];
type SkyPipelineResult = Readonly<{ status: "unavailable"; reason: string }> |
  Readonly<{ status: "available"; ritabrata: SkyDirection; centroid: Readonly<{ reconstruction: SkyDirection }> }>;
export type SkyLocalizationEvent = Readonly<{
  eventKey: string;
  coordinateSystem?: "detector-local";
  referenceOverlay?: "rito-gbm-bayestar";
  dataOrigin?: "source-only-pipeline" | "archived-detection" | "demo" | "reference" | "benchmark";
  burstId: number;
  simulatedDate: string;
  truth: SkyDirection | null;
  ks: SkyDirection | null;
  centroid: SkyDirection | null;
  ksErrorDeg: number | null;
  centroidErrorDeg: number | null;
  status: "pending" | "available" | "unavailable";
  reason?: string;
  gridLabel: string;
  coordinateFrame: string;
}>;

/** Display basis matches the existing equatorial truth scorer, not terrestrial ECEF. */
export function celestialToVector({ raDeg, decDeg }: SkyDirection): SkyVector {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || Math.abs(decDeg) > 90) {
    throw new RangeError("Sky coordinates require finite RA and Dec in [-90, 90].");
  }
  const ra = raDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), Math.cos(dec) * Math.sin(ra)];
}

/** Shortest spherical arc; antipodal endpoints use a deterministic great circle. */
export function greatCircleArc(from: SkyDirection, to: SkyDirection, segments = 64): readonly SkyVector[] {
  if (!Number.isInteger(segments) || segments < 1) throw new RangeError("Arc segments must be a positive integer.");
  const a = celestialToVector(from);
  const b = celestialToVector(to);
  const dot = Math.max(-1, Math.min(1, a.reduce((sum, v, i) => sum + v * b[i], 0)));
  const cross: SkyVector = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const angle = Math.atan2(Math.hypot(...cross), dot);
  const tangent = b.map((v, i) => v - dot * a[i]);
  let length = Math.hypot(...tangent);
  if (length < 1e-12) {
    if (dot > 0) return [a, b];
    const leastAligned = a.map(Math.abs).indexOf(Math.min(...a.map(Math.abs)));
    for (let i = 0; i < 3; i++) tangent[i] = (i === leastAligned ? 1 : 0) - a[leastAligned] * a[i];
    length = Math.hypot(...tangent);
  }
  const points: SkyVector[] = Array.from({ length: segments + 1 }, (_, i) => {
    const t = angle * i / segments;
    return [0, 1, 2].map(j => a[j] * Math.cos(t) + tangent[j] / length * Math.sin(t)) as [number, number, number];
  });
  points[0] = a;
  points[segments] = b;
  return points;
}

function direction(raDeg: number, decDeg: number): SkyDirection {
  celestialToVector({ raDeg, decDeg });
  return Object.freeze({ raDeg: ((raDeg % 360) + 360) % 360, decDeg });
}

export function createSkyLocalizationEvent(input: Readonly<{
  eventKey: string;
  coordinateSystem?: "detector-local"; burstId: number; simulatedDate: string;
  raDeg: number; decDeg: number; gridLabel: string;
}>): SkyLocalizationEvent {
  return Object.freeze({
    dataOrigin: "source-only-pipeline" as const,
    eventKey: input.eventKey, burstId: input.burstId, simulatedDate: input.simulatedDate,
    truth: direction(input.raDeg, input.decDeg), ks: null, centroid: null,
    ksErrorDeg: null, centroidErrorDeg: null, status: "pending", gridLabel: input.gridLabel,
    coordinateFrame: "Simulator ECI-like equatorial · simulated UTC",
  });
}

/** Never insert a completion for an event that was removed by reset. */
export function completeSkyLocalizationEvent(
  events: readonly SkyLocalizationEvent[], eventKey: string, result: SkyPipelineResult,
): readonly SkyLocalizationEvent[] {
  return events.map(event => {
    if (event.eventKey !== eventKey) return event;
    if (result.status === "unavailable") return Object.freeze({ ...event, status: "unavailable" as const, reason: result.reason });
    try {
      const ks = direction(result.ritabrata.raDeg, result.ritabrata.decDeg);
      const centroid = direction(result.centroid.reconstruction.raDeg, result.centroid.reconstruction.decDeg);
      return Object.freeze({ ...event, status: "available" as const, reason: undefined, ks, centroid,
        ksErrorDeg: event.truth ? angularSeparationDeg(event.truth, ks) : null,
        centroidErrorDeg: event.truth ? angularSeparationDeg(event.truth, centroid) : null,
      });
    } catch {
      return Object.freeze({ ...event, status: "unavailable" as const, reason: "invalid-reconstruction-coordinates" });
    }
  });
}
