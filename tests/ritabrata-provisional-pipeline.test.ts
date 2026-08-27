import assert from "node:assert/strict";
import test from "node:test";
import {
  CELOC_UPCAL_RAW_COMPONENT_FRAME,
  RITABRATA_DETECTOR_FRAME,
  createCelocRawPixelVector,
} from "../app/lib/detector-local-frame-adapter.ts";
import {
  RITABRATA_GRB_APPROVED_GOLDEN_SHA256,
  RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
  RITABRATA_GRB_APPROVED_PROVENANCE_SHA256,
  computeRitabrataGrbResponse,
  type RitabrataGrbGeneratorAssets,
} from "../app/lib/ritabrata-grb-generator.ts";
import {
  RITABRATA_KS_GEOMETRY_VERSION,
  type LegacyKsAssetBundle,
} from "../app/lib/legacy-template-localizer.ts";
import {
  bridgeGeneratedGrbToLegacyObservation,
  runRitabrataProvisionalPipelineFromAssets,
} from "../app/lib/ritabrata-provisional-pipeline.ts";

const canonicalIds = Array.from({ length: 126 }, (_, pixelId) => pixelId);
const generatorAssets: RitabrataGrbGeneratorAssets = {
  assetVersion: "pipeline-test-v1",
  manifestSha256: RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
  directionFrame: RITABRATA_DETECTOR_FRAME,
  pixelCount: 126,
  sourceAreaCm2: 1296,
  primaryEnergyBinEdgesKeV: [20, 30],
  depositedEnergyBinEdgesKeV: [30, 40],
  directions: [{ sourceId: "boresight", thetaDeg: 0, phiDeg: 0, responseKey: "0_0" }],
  pixelMeanKernel: new Float32Array(126).fill(1),
  pixelVarianceKernel: new Float32Array(126).fill(1),
  depositedEnergyMeanKernel: new Float32Array([126]),
  depositedEnergyVarianceKernel: new Float32Array([126]),
  provenanceSha256: RITABRATA_GRB_APPROVED_PROVENANCE_SHA256,
  rootParity: {
    verified: true,
    goldenFixtureId: "pipeline-test",
    goldenOutputSha256: RITABRATA_GRB_APPROVED_GOLDEN_SHA256,
    assetProvenanceSha256: RITABRATA_GRB_APPROVED_PROVENANCE_SHA256,
  },
};
const localizerAssets: LegacyKsAssetBundle = {
  geometryVersion: RITABRATA_KS_GEOMETRY_VERSION,
  directionFrame: RITABRATA_DETECTOR_FRAME,
  pixelPositionFrame: CELOC_UPCAL_RAW_COMPONENT_FRAME,
  pixelIds: canonicalIds,
  pixelPositionRowIds: [...canonicalIds].reverse(),
  pixelPositionVectors: canonicalIds.map(() => createCelocRawPixelVector(0, 0, 1)),
  energyBinEdgesKeV: [30, 40],
  templates: [{ templateId: "boresight", thetaDeg: 0, phiDeg: 0 }],
  templatePixelEnergyResponse: new Float32Array(126).fill(1),
  effectiveArea: [{ thetaDeg: 0, areaByEnergyBin: [1] }],
  provenanceSha256: "pipeline-test",
  rootParity: {
    verified: false,
    rootVersion: "",
    goldenFixtureId: "",
    goldenOutputSha256: "",
    assetProvenanceSha256: "",
  },
};

test("the bridge preserves canonical ROOT bin order and MC Sumw2 errors", () => {
  const generated = computeRitabrataGrbResponse(
    0,
    0,
    { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 },
    generatorAssets,
  );
  assert.ok(!("status" in generated));
  generated.pixelCountsPerSecond.forEach((_, index) => {
    generated.pixelCountsPerSecond[index] = index + 1;
    generated.pixelMcSumw2ErrorsPerSecond[index] = index + 0.5;
  });
  const observation = bridgeGeneratedGrbToLegacyObservation(generated, localizerAssets);
  assert.deepEqual(Array.from(observation.pixelIds), canonicalIds);
  assert.deepEqual(Array.from(observation.pixelCounts), canonicalIds.map((id) => id + 1));
  assert.deepEqual(Array.from(observation.pixelErrors), canonicalIds.map((id) => id + 0.5));
  assert.throws(
    () => bridgeGeneratedGrbToLegacyObservation({
      ...generated,
      depositedEnergyBinEdgesKeV: [30, 41],
    }, localizerAssets),
    /dimensions are incompatible/,
  );
});

test("the provisional vertical slice reports three separate angular metrics", () => {
  const result = runRitabrataProvisionalPipelineFromAssets({
    requestedThetaDeg: 0,
    requestedPhiDeg: 0,
    spectrum: { normalization: 1, spectralIndex: 0, peakEnergyKeV: 100 },
    radialBoresight: [0, 1, 0],
    truth: { raDeg: 0, decDeg: 90 },
    detectorNormals: canonicalIds.map(() => [0, 1, 0] as const),
    frameIndex: 1,
    acquisitionTimeSeconds: 0.2,
    generatorAssets,
    localizerAssets,
  });
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.validationStatus, "PROVISIONAL");
    assert.equal(result.localizerRootParity, "PENDING_OFFICIAL_ROOT_OUTPUTS");
    assert.equal(result.quantizationErrorDeg, 0);
    assert.equal(result.selectedDatabaseToReconstructedDeg, 0);
    assert.equal(result.requestedToReconstructedDeg, 0);
    assert.equal(result.centroid.thetaDeg, 0);
    assert.equal(result.centroid.phiDeg, 0);
    assert.equal(result.centroid.selectedDatabaseToReconstructedDeg, 0);
    assert.equal(result.centroid.requestedToReconstructedDeg, 0);
    assert.equal(result.centroid.truthAngularErrorDeg, 0);
  }
});
