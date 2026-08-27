import assert from "node:assert/strict";
import test from "node:test";
import {
  V2R8_CANDIDATE_GEOMETRY_VERSION,
} from "../app/lib/detector-geometry-v2r8.ts";
import {
  computeLegacyKsLocalization,
  localizeWithLegacyKsTemplates,
  rootHistogramKsComparison,
  rootKolmogorovProbability,
  type LegacyKsAssetBundle,
  type LegacyKsObservation,
} from "../app/lib/legacy-template-localizer.ts";
import {
  CELOC_UPCAL_RAW_COMPONENT_FRAME,
  RITABRATA_DETECTOR_FRAME,
  createCelocRawPixelVector,
} from "../app/lib/detector-local-frame-adapter.ts";

const observation: LegacyKsObservation = {
  geometryVersion: V2R8_CANDIDATE_GEOMETRY_VERSION,
  directionFrame: RITABRATA_DETECTOR_FRAME,
  pixelIds: Array.from({ length: 126 }, (_, pixelId) => pixelId),
  energyBinEdgesKeV: [10, 20],
  pixelCounts: Array.from({ length: 126 }, () => 2),
  pixelErrors: Array.from({ length: 126 }, () => Math.sqrt(2)),
  depositedEnergyCounts: [2],
};

const assets: LegacyKsAssetBundle = {
  geometryVersion: V2R8_CANDIDATE_GEOMETRY_VERSION,
  directionFrame: RITABRATA_DETECTOR_FRAME,
  pixelPositionFrame: CELOC_UPCAL_RAW_COMPONENT_FRAME,
  pixelIds: Array.from({ length: 126 }, (_, pixelId) => pixelId),
  pixelPositionRowIds: Array.from({ length: 126 }, (_, pixelId) => pixelId),
  pixelPositionVectors: Array.from({ length: 126 }, () => createCelocRawPixelVector(0, 0, 1)),
  energyBinEdgesKeV: [10, 20],
  templates: [{ templateId: "fixture-0", thetaDeg: 0, phiDeg: 0 }],
  templatePixelEnergyResponse: new Float32Array(126).fill(1),
  effectiveArea: [{ thetaDeg: 0, areaByEnergyBin: [1] }],
  provenanceSha256: "fixture-only",
  rootParity: {
    verified: true,
    rootVersion: "fixture-only",
    goldenFixtureId: "fixture-only",
    goldenOutputSha256: "a".repeat(64),
    assetProvenanceSha256: "fixture-only",
  },
};

test("the ROOT Kolmogorov probability port covers the source branches", () => {
  assert.equal(rootKolmogorovProbability(0), 1);
  assert.ok(Math.abs(rootKolmogorovProbability(1) - 0.26999967167735456) < 1e-12);
  assert.equal(rootKolmogorovProbability(7), 0);
});

test("the histogram KS port is shape-only and returns the cumulative distance", () => {
  assert.deepEqual(
    rootHistogramKsComparison([1, 1], [2, 2], [1, 1], [1, 1]),
    { probability: 1, distance: 0 },
  );
  const shifted = rootHistogramKsComparison([2, 0], [0, 2], [1, 1], [1, 1]);
  assert.ok(shifted);
  assert.equal(shifted.distance, 1);
  assert.ok(shifted.probability > 0 && shifted.probability < 1);
});

test("the TypeScript core ports centroid, response projection, KS and weighted direction", () => {
  const reconstruction = computeLegacyKsLocalization(observation, assets);
  assert.ok(!("status" in reconstruction));
  assert.equal(reconstruction.thetaDeg, 0);
  assert.equal(reconstruction.phiDeg, 0);
  assert.equal(reconstruction.provisionalThetaDeg, 0);
  assert.equal(reconstruction.effectiveAreaThetaDeg, 0);
  assert.equal(reconstruction.maximumProbability, 1);
  assert.equal(reconstruction.selectedTemplateCount, 1);
  assert.deepEqual(reconstruction.rootLocalDirection, [0, 0, 1]);
  assert.deepEqual(reconstruction.localDirection, [0, 1, -0]);
});

test("the runtime boundary never fabricates localization without assets", () => {
  assert.deepEqual(
    localizeWithLegacyKsTemplates(observation),
    { status: "unavailable", reason: "template-data-unavailable" },
  );
});

test("the runtime boundary requires independent ROOT parity metadata", () => {
  const unverified: LegacyKsAssetBundle = {
    ...assets,
    rootParity: {
      verified: false,
      rootVersion: "",
      goldenFixtureId: "",
      goldenOutputSha256: "",
      assetProvenanceSha256: "",
    },
  };
  const computed = computeLegacyKsLocalization(observation, unverified);
  assert.ok(!("status" in computed));
  assert.deepEqual(
    localizeWithLegacyKsTemplates(observation, unverified),
    { status: "unavailable", reason: "root-ks-parity-unverified" },
  );
});

test("the verified wrapper exposes the declared standalone method", () => {
  const result = localizeWithLegacyKsTemplates(observation, assets);
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.method, "ritabrata-standalone-template-root-ks-parity-v1");
    assert.equal(result.reconstruction.thetaDeg, 0);
  }
});

test("invalid dimensions and missing errors fail closed", () => {
  assert.deepEqual(
    localizeWithLegacyKsTemplates({
      ...observation,
      directionFrame: "wrong-frame" as typeof observation.directionFrame,
    }, assets),
    { status: "unavailable", reason: "direction-frame-unavailable" },
  );
  assert.deepEqual(
    localizeWithLegacyKsTemplates(observation, {
      ...assets,
      pixelPositionFrame: "wrong-frame" as typeof assets.pixelPositionFrame,
    }),
    { status: "unavailable", reason: "direction-frame-unavailable" },
  );
  assert.deepEqual(
    localizeWithLegacyKsTemplates({ ...observation, pixelErrors: [] }, assets),
    { status: "unavailable", reason: "pixel-errors-unavailable" },
  );
  assert.deepEqual(
    localizeWithLegacyKsTemplates({ ...observation, depositedEnergyCounts: [] }, assets),
    { status: "unavailable", reason: "energy-spectrum-unavailable" },
  );
  assert.deepEqual(
    localizeWithLegacyKsTemplates({ ...observation, pixelCounts: [1] }, assets),
    { status: "unavailable", reason: "dimension-mismatch" },
  );
  assert.deepEqual(
    localizeWithLegacyKsTemplates({
      ...observation,
      pixelIds: [...Array.from({ length: 125 }, (_, id) => id), 124],
    }, assets),
    { status: "unavailable", reason: "dimension-mismatch" },
  );
  assert.deepEqual(
    localizeWithLegacyKsTemplates({ ...observation, energyBinEdgesKeV: [10, 21] }, assets),
    { status: "unavailable", reason: "dimension-mismatch" },
  );
});
