import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  RITABRATA_GRB_APPROVED_GOLDEN_SHA256,
  RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
  RITABRATA_GRB_APPROVED_PROVENANCE_SHA256,
  computeRitabrataGrbResponse,
  type RitabrataGrbGeneratorAssets,
} from "../app/lib/ritabrata-grb-generator.ts";

const directory = resolve(process.argv[2] ?? "public/data/ritabrata-grb-generator");
const manifestBytes = readFileSync(resolve(directory, "ritabrata-grb-generator.manifest.json"));
const manifestHash = createHash("sha256").update(manifestBytes).digest("hex");
assert.equal(manifestHash, RITABRATA_GRB_APPROVED_MANIFEST_SHA256);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const goldenBytes = readFileSync(resolve(directory, manifest.goldenFixture.file));
assert.equal(createHash("sha256").update(goldenBytes).digest("hex"), manifest.goldenFixture.sha256);
const golden = JSON.parse(goldenBytes.toString("utf8"));
assert.equal(manifest.directionCount, 985);
assert.equal(manifest.pixelCount, 126);
assert.equal(manifest.primaryEnergyBinCount, 100);
assert.equal(manifest.depositedEnergyBinCount, 100);
assert.equal(manifest.sourceFilesSha256["sampleDataSet.root"],
  "2f3ca611e3252aac0cac2c5f12ee470d66a75914cba0f9d3c7aa23ff21749ba2");
assert.equal(manifest.provenanceSha256, RITABRATA_GRB_APPROVED_PROVENANCE_SHA256);
assert.equal(manifest.rootParity.verified, true);
assert.equal(manifest.rootParity.goldenOutputSha256, RITABRATA_GRB_APPROVED_GOLDEN_SHA256);
assert.equal(manifest.rootParity.assetProvenanceSha256, manifest.provenanceSha256);

const directionIndex = manifest.directions.findIndex(
  (direction: { sourceId: string }) => direction.sourceId === golden.selectedDirection.sourceId,
);
assert.ok(directionIndex >= 0);

function loadMember(name: string): Float32Array {
  const descriptor = manifest.kernels[name];
  const file = readFileSync(resolve(directory, descriptor.file));
  assert.equal(createHash("sha256").update(file).digest("hex"), descriptor.fileSha256);
  const member = descriptor.members[directionIndex];
  const compressed = file.subarray(member.offset, member.offset + member.compressedByteLength);
  assert.equal(createHash("sha256").update(compressed).digest("hex"), member.sha256);
  const uncompressed = gunzipSync(compressed);
  assert.equal(uncompressed.byteLength, member.uncompressedByteLength);
  return new Float32Array(
    uncompressed.buffer,
    uncompressed.byteOffset,
    uncompressed.byteLength / 4,
  );
}

const assets: RitabrataGrbGeneratorAssets = {
  assetVersion: manifest.assetVersion,
  manifestSha256: manifestHash,
  directionFrame: manifest.directionFrame,
  pixelCount: manifest.pixelCount,
  sourceAreaCm2: manifest.sourceAreaCm2,
  primaryEnergyBinEdgesKeV: manifest.primaryEnergyBinEdgesKeV,
  depositedEnergyBinEdgesKeV: manifest.depositedEnergyBinEdgesKeV,
  directions: [manifest.directions[directionIndex]],
  pixelMeanKernel: loadMember("pixelMean"),
  pixelVarianceKernel: loadMember("pixelVariance"),
  depositedEnergyMeanKernel: loadMember("depositedEnergyMean"),
  depositedEnergyVarianceKernel: loadMember("depositedEnergyVariance"),
  provenanceSha256: manifest.provenanceSha256,
  rootParity: manifest.rootParity,
};
const computed = computeRitabrataGrbResponse(
  golden.requestedDirection.thetaDeg,
  golden.requestedDirection.phiDeg,
  golden.spectrum,
  assets,
);
assert.ok(!("status" in computed), JSON.stringify(computed));
assert.equal(computed.selectedDatabaseDirection.sourceId, golden.selectedDirection.sourceId);

function compare(
  name: string,
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  absoluteTolerance: number,
  relativeTolerance: number,
): void {
  assert.equal(actual.length, expected.length);
  let maximumAbsoluteDifference = 0;
  let maximumRelativeDifference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const difference = Math.abs(actual[index] - expected[index]);
    const tolerance = absoluteTolerance + relativeTolerance * Math.abs(expected[index]);
    assert.ok(difference <= tolerance,
      `${name}[${index}] differs by ${difference}, tolerance ${tolerance}`);
    maximumAbsoluteDifference = Math.max(maximumAbsoluteDifference, difference);
    maximumRelativeDifference = Math.max(
      maximumRelativeDifference,
      difference / Math.max(Math.abs(expected[index]), 1e-12),
    );
  }
  console.log(`${name}: PASS maxAbs=${maximumAbsoluteDifference} maxRel=${maximumRelativeDifference}`);
}

compare("pixel counts", computed.pixelCountsPerSecond, golden.pixelCountsPerSecond, 1e-4, 2e-6);
compare("pixel MC Sumw2 errors", computed.pixelMcSumw2ErrorsPerSecond,
  golden.pixelErrorsPerSecond, 1e-6, 2e-6);
compare(
  "deposited-energy counts",
  computed.depositedEnergyCountsPerSecond,
  golden.depositedEnergyCountsPerSecond,
  1e-3,
  1e-4,
);
compare(
  "deposited-energy errors",
  computed.depositedEnergyMcSumw2ErrorsPerSecond,
  golden.depositedEnergyErrorsPerSecond,
  1e-6,
  1e-4,
);
console.log(`Selected ${computed.selectedDatabaseDirection.thetaDeg}°, ` +
  `${computed.selectedDatabaseDirection.phiDeg}°; quantization=${computed.quantizationErrorDeg}°`);
console.log("Ritabrata CEGenGRB converted-kernel regression: PASS (offline only)");
