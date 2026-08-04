import assert from "node:assert/strict";
import test from "node:test";
import { createParametricOrbitOverride } from "../app/lib/orbital-overrides.ts";
import type { EciEphemerisSample } from "../app/lib/eci-ephemeris.ts";

const canonicalSample: EciEphemerisSample = {
  timestampMs: Date.parse("2033-01-01T00:00:00Z"),
  satelliteKm: [3_000, 4_000, 5_000],
  sunKm: [10, 20, 30],
  moonKm: [-40, 50, -60],
  lowerRecordIndex: 0,
  upperRecordIndex: 0,
  interpolationFraction: 0,
};

function magnitude(vector: readonly number[]) {
  return Math.hypot(...vector);
}

test("altitude override sets only the satellite radial distance", () => {
  const earthRadiusKm = 6_371;
  const altitudeKm = 550;
  const originalSnapshot = structuredClone(canonicalSample);
  const result = createParametricOrbitOverride(
    canonicalSample,
    earthRadiusKm + altitudeKm,
    20,
  );

  assert.ok(
    Math.abs(magnitude(result.satelliteEciKm) - (earthRadiusKm + altitudeKm)) <
      1e-9,
  );
  assert.strictEqual(result.canonicalSample, canonicalSample);
  assert.deepEqual(canonicalSample, originalSnapshot);
  assert.strictEqual(result.canonicalSample.sunKm, canonicalSample.sunKm);
  assert.strictEqual(result.canonicalSample.moonKm, canonicalSample.moonKm);
  assert.equal(result.canonicalSample.timestampMs, canonicalSample.timestampMs);
});

test("zero inclination puts the overridden direction in the ECI equatorial plane", () => {
  const result = createParametricOrbitOverride(canonicalSample, 7_000, 0);
  assert.ok(Math.abs(result.satelliteEciKm[2]) < 1e-12);
});

test("inclination override produces a direction in the declared synthetic plane", () => {
  const inclinationDeg = 37;
  const inclinationRad = (inclinationDeg * Math.PI) / 180;
  const result = createParametricOrbitOverride(
    canonicalSample,
    7_000,
    inclinationDeg,
  );
  const [, y, z] = result.satelliteEciKm;
  const planeNormalDot = -Math.sin(inclinationRad) * y +
    Math.cos(inclinationRad) * z;

  assert.ok(Math.abs(planeNormalDot) < 1e-9);
  assert.equal(
    result.canonicalEquatorialPhaseRad,
    Math.atan2(canonicalSample.satelliteKm[1], canonicalSample.satelliteKm[0]),
  );
});
