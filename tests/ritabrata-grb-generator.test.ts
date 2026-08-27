import assert from "node:assert/strict";
import test from "node:test";
import {
  RITABRATA_GRB_PIXEL_COUNT,
  RITABRATA_GRB_SOURCE_AREA_CM2,
  computeRitabrataGrbResponse,
  cutoffPowerLawDifferentialFlux,
  generateRitabrataGrbResponse,
  integrateCutoffPowerLaw,
  selectNearestRitabrataGrbDirection,
  type RitabrataGrbGeneratorAssets,
} from "../app/lib/ritabrata-grb-generator.ts";
import { RITABRATA_DETECTOR_FRAME } from "../app/lib/detector-local-frame-adapter.ts";

const provenance = "a".repeat(64);
const golden = "b".repeat(64);

function syntheticAssets(parityVerified = false): RitabrataGrbGeneratorAssets {
  const pixelMean = new Float32Array(RITABRATA_GRB_PIXEL_COUNT);
  const pixelVariance = new Float32Array(RITABRATA_GRB_PIXEL_COUNT);
  pixelMean[0] = 0.5;
  pixelVariance[0] = 0.25;
  return {
    assetVersion: "synthetic-test-only",
    directionFrame: RITABRATA_DETECTOR_FRAME,
    pixelCount: RITABRATA_GRB_PIXEL_COUNT,
    sourceAreaCm2: RITABRATA_GRB_SOURCE_AREA_CM2,
    primaryEnergyBinEdgesKeV: [20, 30],
    depositedEnergyBinEdgesKeV: [30, 40],
    directions: [{
      sourceId: "source-a",
      thetaDeg: 41.9898,
      phiDeg: 117.146,
      responseKey: "41_117",
    }],
    pixelMeanKernel: pixelMean,
    pixelVarianceKernel: pixelVariance,
    depositedEnergyMeanKernel: new Float32Array([0.25]),
    depositedEnergyVarianceKernel: new Float32Array([0.0625]),
    provenanceSha256: provenance,
    rootParity: {
      verified: parityVerified,
      goldenFixtureId: "synthetic-golden",
      goldenOutputSha256: golden,
      assetProvenanceSha256: parityVerified ? provenance : "",
    },
  };
}

test("CEGenGRB cutoff power-law port matches an analytic alpha=0 integral", () => {
  const parameters = { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 };
  assert.equal(cutoffPowerLawDifferentialFlux(100, parameters), Math.exp(-2));
  const expected = 50 * (Math.exp(-0.4) - Math.exp(-0.6));
  assert.ok(Math.abs(integrateCutoffPowerLaw(20, 30, parameters) - expected) < 1e-11);
});

test("nearest-direction selection uses spherical rather than rectangular angle", () => {
  const directions = [
    { sourceId: "src-41-117", thetaDeg: 41.9898, phiDeg: 117.146, responseKey: "41_117" },
    { sourceId: "src-37-121", thetaDeg: 37.1277, phiDeg: 121.415, responseKey: "37_121" },
  ];
  const selected = selectNearestRitabrataGrbDirection(40, 120, directions);
  assert.ok(selected);
  assert.equal(selected.direction.sourceId, "src-41-117");
  assert.ok(Math.abs(selected.separationDeg - 2.731714) < 1e-5);
});

test("pre-aggregated mean and variance kernels produce counts and ROOT-style errors", () => {
  const parameters = { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 };
  const response = computeRitabrataGrbResponse(40, 120, parameters, syntheticAssets());
  assert.ok(!("status" in response));
  const incidentRate = integrateCutoffPowerLaw(20, 30, parameters) * RITABRATA_GRB_SOURCE_AREA_CM2;
  assert.ok(Math.abs(response.pixelCountsPerSecond[0] - 0.5 * incidentRate) < 1e-9);
  assert.ok(Math.abs(response.pixelErrorsPerSecond[0] - 0.5 * incidentRate) < 1e-9);
  assert.ok(Math.abs(response.depositedEnergyCountsPerSecond[0] - 0.25 * incidentRate) < 1e-9);
  assert.ok(Math.abs(response.depositedEnergyErrorsPerSecond[0] - 0.25 * incidentRate) < 1e-9);
  assert.equal(response.requestedDirection.phiDeg, 120);
  assert.equal(response.selectedDatabaseDirection.responseKey, "41_117");
  assert.equal(response.directionFrame, RITABRATA_DETECTOR_FRAME);
});

test("runtime generation fails closed until code-pinned trust anchors are approved", () => {
  const parameters = { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 };
  assert.deepEqual(generateRitabrataGrbResponse(40, 120, parameters, syntheticAssets()), {
    status: "unavailable",
    reason: "asset-parity-unverified",
  });
  const result = generateRitabrataGrbResponse(40, 120, parameters, syntheticAssets(true));
  assert.deepEqual(result, { status: "unavailable", reason: "asset-parity-unverified" });
});

test("invalid physical spectrum parameters are rejected", () => {
  const response = computeRitabrataGrbResponse(
    40,
    120,
    { normalization: 0.026, spectralIndex: -2, peakEnergyKeV: 756.4 },
    syntheticAssets(),
  );
  assert.deepEqual(response, { status: "unavailable", reason: "invalid-spectrum" });
});

test("assets with an incompatible detector frame fail closed", () => {
  const incompatible = {
    ...syntheticAssets(),
    directionFrame: "THREE_LOCAL_PLUS_Y" as typeof RITABRATA_DETECTOR_FRAME,
  };
  assert.deepEqual(
    computeRitabrataGrbResponse(
      40,
      120,
      { normalization: 0.026, spectralIndex: -1.07, peakEnergyKeV: 756.4 },
      incompatible,
    ),
    { status: "unavailable", reason: "direction-frame-unavailable" },
  );
});
