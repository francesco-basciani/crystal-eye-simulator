import assert from "node:assert/strict";
import test from "node:test";
import {
  RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
  RITABRATA_GRB_PIXEL_COUNT,
  RITABRATA_GRB_SOURCE_AREA_CM2,
  computeRitabrataGrbResponse,
  cutoffPowerLawDifferentialFlux,
  generateRitabrataGrbResponse,
  integrateCutoffPowerLaw,
  selectNearestRitabrataGrbDirection,
  selectThreeNearestRitabrataGrbDirections,
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
    manifestSha256: RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
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

test("updated selection uses three inverse-distance neighbours and handles an exact match", () => {
  const directions = [
    { sourceId: "a", thetaDeg: 30, phiDeg: 0, responseKey: "30_0" },
    { sourceId: "b", thetaDeg: 30, phiDeg: 120, responseKey: "30_120" },
    { sourceId: "c", thetaDeg: 30, phiDeg: 240, responseKey: "30_240" },
    { sourceId: "d", thetaDeg: 60, phiDeg: 30, responseKey: "60_30" },
  ];
  const exact = selectThreeNearestRitabrataGrbDirections(30, 120, directions);
  assert.ok(exact);
  assert.equal(exact.selections.length, 1);
  assert.equal(exact.selections[0].direction.sourceId, "b");
  assert.equal(exact.selections[0].weight, 1);
  assert.equal(exact.containmentWarning, null);

  const interpolated = selectThreeNearestRitabrataGrbDirections(40, 30, directions);
  assert.ok(interpolated);
  assert.equal(interpolated.selections.length, 3);
  assert.ok(Math.abs(interpolated.selections.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-12);
  for (const row of interpolated.selections) assert.ok(row.weight > 0);
});

test("updated selection accepts the approved 113 degree FoV boundary and rejects beyond it", () => {
  const directions = [
    { sourceId: "a", thetaDeg: 112, phiDeg: 0, responseKey: "112_0" },
    { sourceId: "b", thetaDeg: 114, phiDeg: 2, responseKey: "114_2" },
    { sourceId: "c", thetaDeg: 114, phiDeg: 358, responseKey: "114_358" },
  ];
  assert.ok(selectThreeNearestRitabrataGrbDirections(113, 0, directions));
  assert.equal(selectThreeNearestRitabrataGrbDirections(113.001, 0, directions), null);
});

test("three-neighbour ties follow the C++ pair theta/phi ordering", () => {
  const directions = [
    { sourceId: "late", thetaDeg: 20, phiDeg: 180, responseKey: "20_180" },
    { sourceId: "first", thetaDeg: 10, phiDeg: 0, responseKey: "10_0" },
    { sourceId: "middle", thetaDeg: 20, phiDeg: 0, responseKey: "20_0" },
  ];
  const selection = selectThreeNearestRitabrataGrbDirections(0, 0, directions);
  assert.ok(selection);
  assert.deepEqual(selection.selections.map((row) => row.direction.sourceId), [
    "first", "middle", "late",
  ]);
});

test("v2 response mixes sufficient statistics using weighted primary counts", () => {
  const directions = [
    { sourceId: "a", thetaDeg: 30, phiDeg: 0, responseKey: "30_0" },
    { sourceId: "b", thetaDeg: 30, phiDeg: 120, responseKey: "30_120" },
    { sourceId: "c", thetaDeg: 30, phiDeg: 240, responseKey: "30_240" },
  ];
  const selection = selectThreeNearestRitabrataGrbDirections(40, 30, directions);
  assert.ok(selection);
  const pixelMeanKernel = new Float32Array(3 * RITABRATA_GRB_PIXEL_COUNT);
  const pixelVarianceKernel = new Float32Array(3 * RITABRATA_GRB_PIXEL_COUNT);
  const depositedEnergyMeanKernel = new Float32Array(3);
  const depositedEnergyVarianceKernel = new Float32Array(3);
  [1, 2, 3].forEach((value, index) => {
    pixelMeanKernel[index * RITABRATA_GRB_PIXEL_COUNT] = value;
    pixelVarianceKernel[index * RITABRATA_GRB_PIXEL_COUNT] = value * value;
    depositedEnergyMeanKernel[index] = value;
    depositedEnergyVarianceKernel[index] = value * value;
  });
  const assets: RitabrataGrbGeneratorAssets = {
    ...syntheticAssets(),
    directions,
    primaryCountsKernel: new Float32Array([10, 20, 30]),
    pixelMeanKernel,
    pixelVarianceKernel,
    depositedEnergyMeanKernel,
    depositedEnergyVarianceKernel,
  };
  const spectrum = { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 };
  const response = computeRitabrataGrbResponse(40, 30, spectrum, assets);
  assert.ok(!("status" in response));
  const byId = new Map(selection.selections.map((row) => [row.direction.sourceId, row.weight]));
  const denominator = 10 * byId.get("a")! + 20 * byId.get("b")! + 30 * byId.get("c")!;
  const mixed = (10 * byId.get("a")! * 1 + 20 * byId.get("b")! * 2 +
    30 * byId.get("c")! * 3) / denominator;
  const incidentRate = integrateCutoffPowerLaw(20, 30, spectrum) * RITABRATA_GRB_SOURCE_AREA_CM2;
  assert.ok(Math.abs(response.pixelCountsPerSecond[0] - mixed * incidentRate) < 1e-8);
  assert.equal(response.selectedDatabaseDirections.length, 3);
  assert.equal(response.responseSemantics, "full-sample-expectation-approximation");
});

test("pre-aggregated mean and variance kernels produce counts and ROOT-style errors", () => {
  const parameters = { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 };
  const response = computeRitabrataGrbResponse(40, 120, parameters, syntheticAssets());
  assert.ok(!("status" in response));
  const incidentRate = integrateCutoffPowerLaw(20, 30, parameters) * RITABRATA_GRB_SOURCE_AREA_CM2;
  assert.ok(Math.abs(response.pixelCountsPerSecond[0] - 0.5 * incidentRate) < 1e-9);
  assert.ok(Math.abs(response.pixelMcSumw2ErrorsPerSecond[0] - 0.5 * incidentRate) < 1e-9);
  assert.ok(Math.abs(response.depositedEnergyCountsPerSecond[0] - 0.25 * incidentRate) < 1e-9);
  assert.ok(Math.abs(response.depositedEnergyMcSumw2ErrorsPerSecond[0] - 0.25 * incidentRate) < 1e-9);
  assert.equal(response.requestedDirection.phiDeg, 120);
  assert.equal(response.selectedDatabaseDirection.responseKey, "41_117");
  assert.equal(response.directionFrame, RITABRATA_DETECTOR_FRAME);
});

test("runtime generation rejects assets outside the code-pinned trust anchors", () => {
  const parameters = { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 };
  assert.deepEqual(generateRitabrataGrbResponse(40, 120, parameters, syntheticAssets()), {
    status: "unavailable",
    reason: "asset-parity-unverified",
  });
  const result = generateRitabrataGrbResponse(40, 120, parameters, syntheticAssets(true));
  assert.deepEqual(result, { status: "unavailable", reason: "asset-provenance-mismatch" });
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
