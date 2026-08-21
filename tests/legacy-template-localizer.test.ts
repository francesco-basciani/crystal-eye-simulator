import assert from "node:assert/strict";
import test from "node:test";
import {
  V2R8_CANDIDATE_GEOMETRY_VERSION,
} from "../app/lib/detector-geometry-v2r8.ts";
import {
  localizeWithLegacyKsTemplates,
  type LegacyKsAssetBundle,
  type LegacyKsObservation,
} from "../app/lib/legacy-template-localizer.ts";

const observation: LegacyKsObservation = {
  pixelCounts: Array.from({ length: 126 }, () => 2),
  depositedEnergyCounts: [2],
  backgroundPixelCounts: Array.from({ length: 126 }, () => 1),
  backgroundEnergyCounts: [1],
  exposureSeconds: 1,
};

const assets: LegacyKsAssetBundle = {
  geometryVersion: V2R8_CANDIDATE_GEOMETRY_VERSION,
  directionFrame: "+Y detector local",
  pixelIds: Array.from({ length: 126 }, (_, pixelId) => pixelId),
  energyBinEdgesKeV: [10, 20],
  templates: [{
    templateId: "fixture-0",
    thetaDeg: 0,
    phiDeg: 0,
    pixelEnergyResponse: Array.from({ length: 126 }, () => 1),
  }],
  effectiveArea: [{ thetaDeg: 0, areaByEnergyBin: [1] }],
  provenanceSha256: "fixture-only",
  rootParity: {
    verified: true,
    rootVersion: "fixture-only",
    goldenFixtureId: "fixture-only",
  },
};

test("the TypeScript boundary never fabricates localization without assets", () => {
  assert.deepEqual(
    localizeWithLegacyKsTemplates({ pixelCounts: observation.pixelCounts }),
    { status: "unavailable", reason: "template-data-unavailable" },
  );
  assert.deepEqual(
    localizeWithLegacyKsTemplates(observation, assets),
    { status: "unavailable", reason: "typescript-core-not-implemented" },
  );
});

test("the boundary rejects unsupported negative background residuals", () => {
  const invalid: LegacyKsObservation = {
    ...observation,
    pixelCounts: [0, ...observation.pixelCounts.slice(1)],
  };
  assert.deepEqual(
    localizeWithLegacyKsTemplates(invalid, assets),
    { status: "unavailable", reason: "unsupported-negative-residual" },
  );
});

test("the boundary requires ROOT parity metadata before becoming executable", () => {
  const unverified: LegacyKsAssetBundle = {
    ...assets,
    rootParity: { verified: false, rootVersion: "", goldenFixtureId: "" },
  };
  assert.deepEqual(
    localizeWithLegacyKsTemplates(observation, unverified),
    { status: "unavailable", reason: "root-ks-parity-unverified" },
  );
  assert.deepEqual(observation.pixelCounts[0], 2);
});
