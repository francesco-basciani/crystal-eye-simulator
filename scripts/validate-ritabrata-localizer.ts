import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import {
  computeLegacyKsLocalization,
  type LegacyKsAssetBundle,
  type LegacyKsObservation,
} from "../app/lib/legacy-template-localizer.ts";
import {
  CELOC_UPCAL_RAW_COMPONENT_FRAME,
  RITABRATA_DETECTOR_FRAME,
  createCelocRawPixelVector,
} from "../app/lib/detector-local-frame-adapter.ts";

type Manifest = Readonly<{
  geometryVersion: LegacyKsAssetBundle["geometryVersion"];
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  pixelPositionFrame: typeof CELOC_UPCAL_RAW_COMPONENT_FRAME;
  pixelIdsInSourceFileOrder: readonly number[];
  pixelPositionVectorsInSourceFileOrder: readonly (readonly [number, number, number])[];
  energyBinEdgesKeV: readonly number[];
  templates: LegacyKsAssetBundle["templates"];
  effectiveArea: LegacyKsAssetBundle["effectiveArea"];
  provenanceSha256: string;
  templateResponse: Readonly<{
    file: string;
    sha256: string;
    uncompressedByteLength: number;
  }>;
  rootParity: LegacyKsAssetBundle["rootParity"];
}>;
type Sample = LegacyKsObservation & Readonly<{
  fixtureId: string;
  injectedDirectionLabelFromFilename: Readonly<{ thetaDeg: number; phiDeg: number }>;
  rootExpectedReconstruction: null;
  rootExpectedReconstructionStatus: string;
}>;

const assetDirectory = new URL("../public/data/ritabrata-localizer/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("ritabrata-localizer.manifest.json", assetDirectory), "utf8"),
) as Manifest;
const compressed = await readFile(new URL(manifest.templateResponse.file, assetDirectory));
const compressedHash = createHash("sha256").update(compressed).digest("hex");
assert.equal(compressedHash, manifest.templateResponse.sha256);
const binary = gunzipSync(compressed);
assert.equal(binary.byteLength, manifest.templateResponse.uncompressedByteLength);
const responseBuffer = binary.buffer.slice(
  binary.byteOffset,
  binary.byteOffset + binary.byteLength,
) as ArrayBuffer;
const assets: LegacyKsAssetBundle = {
  geometryVersion: manifest.geometryVersion,
  directionFrame: manifest.directionFrame,
  pixelPositionFrame: manifest.pixelPositionFrame,
  pixelIds: Array.from({ length: 126 }, (_, pixelId) => pixelId),
  pixelPositionRowIds: manifest.pixelIdsInSourceFileOrder,
  pixelPositionVectors: manifest.pixelPositionVectorsInSourceFileOrder.map((vector) =>
    createCelocRawPixelVector(vector[0], vector[1], vector[2])),
  energyBinEdgesKeV: manifest.energyBinEdgesKeV,
  templates: manifest.templates,
  templatePixelEnergyResponse: new Float32Array(responseBuffer),
  effectiveArea: manifest.effectiveArea,
  provenanceSha256: manifest.provenanceSha256,
  rootParity: manifest.rootParity,
};
const fixtureDocument = JSON.parse(
  await readFile(new URL("ritabrata-localizer-samples.json", assetDirectory), "utf8"),
) as Readonly<{ fixtures: readonly Sample[] }>;

// Frozen outputs from the independently replicated TypeScript/ROOT semantics.
// These characterize this port; they are not official ROOT golden outputs.
const derivedCharacterization = new Map([
  ["sample-src-41-117", { thetaDeg: 42.183986, phiDeg: 124.786313, selected: 2 }],
  ["sample-src-74-349", { thetaDeg: 74.394207, phiDeg: -6.634992, selected: 3 }],
]);
const results = [];
for (const fixture of fixtureDocument.fixtures) {
  assert.equal(fixture.rootExpectedReconstruction, null);
  assert.equal(fixture.rootExpectedReconstructionStatus, "REQUESTED_FROM_DOMAIN_AUTHOR");
  const reconstruction = computeLegacyKsLocalization({
    ...fixture,
    // ROOT histogram bins are canonical 0..125; upCal row IDs are separate metadata.
    pixelIds: assets.pixelIds,
  }, assets);
  assert.ok(!("status" in reconstruction), `${fixture.fixtureId} must be computable`);
  const expected = derivedCharacterization.get(fixture.fixtureId);
  assert.ok(expected, `Missing derived characterization for ${fixture.fixtureId}`);
  assert.ok(Math.abs(reconstruction.thetaDeg - expected.thetaDeg) < 1e-3);
  assert.ok(Math.abs(reconstruction.phiDeg - expected.phiDeg) < 1e-3);
  assert.equal(reconstruction.selectedTemplateCount, expected.selected);
  results.push({
    fixtureId: fixture.fixtureId,
    injectedDirectionLabelFromFilename: fixture.injectedDirectionLabelFromFilename,
    derivedTypeScriptReconstruction: {
      thetaDeg: reconstruction.thetaDeg,
      phiDeg: reconstruction.phiDeg,
      selectedTemplateCount: reconstruction.selectedTemplateCount,
      maximumProbability: reconstruction.maximumProbability,
    },
    verificationStatus: "DERIVED_CHARACTERIZATION_ONLY",
  });
}
assert.equal(manifest.rootParity.verified, false);
console.log(JSON.stringify({
  assetProvenanceSha256: manifest.provenanceSha256,
  compressedTemplateSha256: compressedHash,
  rootParity: "PENDING_OFFICIAL_OUTPUTS",
  results,
}, null, 2));
