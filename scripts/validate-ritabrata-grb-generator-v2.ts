import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256,
  RITABRATA_GRB_V2_APPROVED_PROVENANCE_SHA256,
  generateRitabrataGrbResponse,
  selectThreeNearestRitabrataGrbDirections,
  type RitabrataGrbGeneratorAssets,
} from "../app/lib/ritabrata-grb-generator.ts";

const directory = resolve(
  process.argv[2] ?? "scientific-assets/rito-updated-20260907/generator",
);
const manifestBytes = readFileSync(resolve(directory, "cegengrb-v2.manifest.json"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
assert.equal(digest(manifestBytes), RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.directionCount, 1093);
assert.equal(manifest.pixelCount, 126);
assert.equal(manifest.primaryEnergyBinCount, 100);
assert.equal(manifest.depositedEnergyBinCount, 100);
assert.equal(manifest.maximumRequestedThetaDeg, 113);
assert.equal(manifest.interpolation.neighborCount, 3);
assert.equal(manifest.interpolation.weighting, "inverse-angular-distance-normalized");
assert.equal(manifest.interpolation.responseSemantics, "full-sample-expectation-approximation");
assert.equal(manifest.provenanceSha256, RITABRATA_GRB_V2_APPROVED_PROVENANCE_SHA256);
assert.equal(manifest.rootParity.verified, false);
assert.equal(manifest.rootParity.status, "PENDING_IDENTICAL_INPUT_CPP_ROOT_PARITY");
assert.equal(
  manifest.sourceFilesSha256["temDataSet5degNew.root"],
  "52cddade7195f9f1c7d03659f19599f116c56a03f2120684b39ec20eb1f14d01",
);

const selection = selectThreeNearestRitabrataGrbDirections(40, 120, manifest.directions);
assert.ok(selection);
assert.equal(selection.selections.length, 3);
const indices = selection.selections.map((selected) =>
  manifest.directions.indexOf(selected.direction));

function loadMembers(name: string): Float32Array {
  const descriptor = manifest.kernels[name];
  const file = readFileSync(resolve(directory, descriptor.file));
  assert.equal(digest(file), descriptor.fileSha256);
  const members = indices.map((directionIndex) => {
    const member = descriptor.members[directionIndex];
    const compressed = file.subarray(member.offset, member.offset + member.compressedByteLength);
    assert.equal(digest(compressed), member.sha256);
    const uncompressed = gunzipSync(compressed);
    assert.equal(uncompressed.byteLength, member.uncompressedByteLength);
    return new Float32Array(
      uncompressed.buffer,
      uncompressed.byteOffset,
      uncompressed.byteLength / 4,
    );
  });
  const merged = new Float32Array(members.reduce((sum, member) => sum + member.length, 0));
  let offset = 0;
  for (const member of members) {
    merged.set(member, offset);
    offset += member.length;
  }
  return merged;
}

const assets: RitabrataGrbGeneratorAssets = {
  assetVersion: manifest.assetVersion,
  manifestSha256: RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256,
  directionFrame: manifest.directionFrame,
  pixelCount: manifest.pixelCount,
  sourceAreaCm2: manifest.sourceAreaCm2,
  primaryEnergyBinEdgesKeV: manifest.primaryEnergyBinEdgesKeV,
  depositedEnergyBinEdgesKeV: manifest.depositedEnergyBinEdgesKeV,
  directions: selection.selections.map((selected) => selected.direction),
  primaryCountsKernel: loadMembers("primaryCounts"),
  pixelMeanKernel: loadMembers("pixelMean"),
  pixelVarianceKernel: loadMembers("pixelVariance"),
  depositedEnergyMeanKernel: loadMembers("depositedEnergyMean"),
  depositedEnergyVarianceKernel: loadMembers("depositedEnergyVariance"),
  provenanceSha256: manifest.provenanceSha256,
  rootParity: manifest.rootParity,
};
const generated = generateRitabrataGrbResponse(
  40,
  120,
  { normalization: 0.026, spectralIndex: -1.07, peakEnergyKeV: 756.4 },
  assets,
);
assert.equal(generated.status, "available");
if (generated.status === "available") {
  assert.equal(generated.response.selectedDatabaseDirections.length, 3);
  assert.equal(generated.response.responseSemantics, "full-sample-expectation-approximation");
  assert.ok(generated.response.pixelCountsPerSecond.some((value) => value > 0));
  assert.ok(generated.response.depositedEnergyCountsPerSecond.some((value) => value > 0));
}

console.log(JSON.stringify({
  status: "PASS",
  manifestSha256: RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256,
  directionCount: manifest.directionCount,
  selectedDirections: selection.selections,
  rootParity: manifest.rootParity.status,
}, null, 2));
