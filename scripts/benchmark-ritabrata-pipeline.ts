import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
  generateRitabrataGrbResponse,
  selectNearestRitabrataGrbDirection,
  type RitabrataGrbGeneratorAssets,
} from "../app/lib/ritabrata-grb-generator.ts";
import { createRitabrataAssetBundle } from "../app/lib/ritabrata-localizer-assets.ts";
import { computeLegacyKsLocalization } from "../app/lib/legacy-template-localizer.ts";
import { bridgeGeneratedGrbToLegacyObservation } from "../app/lib/ritabrata-provisional-pipeline.ts";
import { ritabrataDirectionFromAngles } from "../app/lib/detector-local-frame-adapter.ts";

const SEED = 20260827;
const SAMPLE_COUNT = 128;
const SPECTRUM = Object.freeze({ normalization: 0.026, spectralIndex: -1.07, peakEnergyKeV: 756.4 });
const generatorDirectory = resolve(process.argv[2] ?? "public/data/ritabrata-grb-generator");
const localizerDirectory = resolve(process.argv[3] ?? "public/data/ritabrata-localizer");
const outputPath = resolve(process.argv[4] ?? "docs/evidence/ritabrata-pipeline-benchmark-20260827.json");

const manifestBytes = readFileSync(resolve(generatorDirectory, "ritabrata-grb-generator.manifest.json"));
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
assert.equal(manifestSha256, RITABRATA_GRB_APPROVED_MANIFEST_SHA256);
const generatorManifest = JSON.parse(manifestBytes.toString("utf8"));
const kernelFiles = Object.fromEntries(Object.entries(generatorManifest.kernels).map(
  ([name, descriptor]) => [name, readFileSync(resolve(generatorDirectory, (descriptor as { file: string }).file))],
));
const localizerManifest = JSON.parse(readFileSync(
  resolve(localizerDirectory, "ritabrata-localizer.manifest.json"), "utf8",
));
const localizerCompressed = readFileSync(resolve(
  localizerDirectory,
  localizerManifest.templateResponse.file,
));
const localizerUncompressed = gunzipSync(localizerCompressed);
const localizerAssets = createRitabrataAssetBundle(
  localizerManifest,
  localizerUncompressed.buffer.slice(
    localizerUncompressed.byteOffset,
    localizerUncompressed.byteOffset + localizerUncompressed.byteLength,
  ),
);

function memberValues(name: string, directionIndex: number): Float32Array {
  const descriptor = generatorManifest.kernels[name];
  const member = descriptor.members[directionIndex];
  const compressed = kernelFiles[name].subarray(
    member.offset,
    member.offset + member.compressedByteLength,
  );
  assert.equal(createHash("sha256").update(compressed).digest("hex"), member.sha256);
  const raw = gunzipSync(compressed);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function generatorAssets(directionIndex: number): RitabrataGrbGeneratorAssets {
  return {
    assetVersion: generatorManifest.assetVersion,
    manifestSha256,
    directionFrame: generatorManifest.directionFrame,
    pixelCount: generatorManifest.pixelCount,
    sourceAreaCm2: generatorManifest.sourceAreaCm2,
    primaryEnergyBinEdgesKeV: generatorManifest.primaryEnergyBinEdgesKeV,
    depositedEnergyBinEdgesKeV: generatorManifest.depositedEnergyBinEdgesKeV,
    directions: [generatorManifest.directions[directionIndex]],
    pixelMeanKernel: memberValues("pixelMean", directionIndex),
    pixelVarianceKernel: memberValues("pixelVariance", directionIndex),
    depositedEnergyMeanKernel: memberValues("depositedEnergyMean", directionIndex),
    depositedEnergyVarianceKernel: memberValues("depositedEnergyVariance", directionIndex),
    provenanceSha256: generatorManifest.provenanceSha256,
    rootParity: generatorManifest.rootParity,
  };
}

function nextRandomFactory(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function separationDeg(
  firstThetaDeg: number,
  firstPhiDeg: number,
  secondThetaDeg: number,
  secondPhiDeg: number,
): number {
  const first = ritabrataDirectionFromAngles(firstThetaDeg, firstPhiDeg);
  const second = ritabrataDirectionFromAngles(secondThetaDeg, secondPhiDeg);
  return Math.acos(Math.max(-1, Math.min(1,
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2],
  ))) * 180 / Math.PI;
}

function type7(values: readonly number[], probability: number): number {
  assert.ok(values.length > 0 && probability >= 0 && probability <= 1);
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * probability;
  const lower = Math.floor(h);
  const fraction = h - lower;
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]);
}

function summarize(values: readonly number[]) {
  return Object.freeze({
    median: type7(values, 0.5),
    p68: type7(values, 0.68),
    p90: type7(values, 0.9),
    p95: type7(values, 0.95),
    max: Math.max(...values),
  });
}

const random = nextRandomFactory(SEED);
const successful = [] as Array<{
  requestedThetaDeg: number;
  requestedPhiDeg: number;
  selectedThetaDeg: number;
  selectedPhiDeg: number;
  reconstructedThetaDeg: number;
  reconstructedPhiDeg: number;
  quantizationErrorDeg: number;
  selectedToReconstructedDeg: number;
  requestedToReconstructedDeg: number;
}>;
const failureReasons = new Map<string, number>();
for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
  const requestedThetaDeg = Math.acos(random()) * 180 / Math.PI;
  const requestedPhiDeg = random() * 360;
  const selection = selectNearestRitabrataGrbDirection(
    requestedThetaDeg,
    requestedPhiDeg,
    generatorManifest.directions,
  );
  assert.ok(selection);
  const directionIndex = generatorManifest.directions.indexOf(selection.direction);
  const generated = generateRitabrataGrbResponse(
    requestedThetaDeg,
    requestedPhiDeg,
    SPECTRUM,
    generatorAssets(directionIndex),
  );
  if (generated.status === "unavailable") {
    failureReasons.set(generated.reason, (failureReasons.get(generated.reason) ?? 0) + 1);
    continue;
  }
  const localized = computeLegacyKsLocalization(
    bridgeGeneratedGrbToLegacyObservation(generated.response, localizerAssets),
    localizerAssets,
  );
  if ("status" in localized) {
    failureReasons.set(localized.reason, (failureReasons.get(localized.reason) ?? 0) + 1);
    continue;
  }
  successful.push({
    requestedThetaDeg,
    requestedPhiDeg,
    selectedThetaDeg: generated.response.selectedDatabaseDirection.thetaDeg,
    selectedPhiDeg: generated.response.selectedDatabaseDirection.phiDeg,
    reconstructedThetaDeg: localized.thetaDeg,
    reconstructedPhiDeg: localized.phiDeg,
    quantizationErrorDeg: generated.response.quantizationErrorDeg,
    selectedToReconstructedDeg: separationDeg(
      generated.response.selectedDatabaseDirection.thetaDeg,
      generated.response.selectedDatabaseDirection.phiDeg,
      localized.thetaDeg,
      localized.phiDeg,
    ),
    requestedToReconstructedDeg: separationDeg(
      requestedThetaDeg,
      requestedPhiDeg,
      localized.thetaDeg,
      localized.phiDeg,
    ),
  });
}
const output = {
  schemaVersion: 1,
  benchmarkVersion: "ritabrata-random-upper-hemisphere-v1",
  validationStatus: "PROVISIONAL",
  localizerRootParity: "PENDING_OFFICIAL_ROOT_OUTPUTS",
  seed: SEED,
  randomAlgorithm: "mulberry32",
  sampling: "uniform solid angle over detector upper hemisphere",
  sampleCount: SAMPLE_COUNT,
  spectrum: SPECTRUM,
  percentileDefinition: "Hyndman-Fan type 7 empirical percentile; not a confidence interval",
  attempted: SAMPLE_COUNT,
  successful: successful.length,
  failed: SAMPLE_COUNT - successful.length,
  failureRate: (SAMPLE_COUNT - successful.length) / SAMPLE_COUNT,
  failureReasons: Object.fromEntries([...failureReasons.entries()].sort()),
  metricsDeg: successful.length > 0 ? {
    requestedToSelectedDatabaseQuantization: summarize(successful.map((row) => row.quantizationErrorDeg)),
    selectedDatabaseToReconstructedLocalizer: summarize(successful.map((row) => row.selectedToReconstructedDeg)),
    requestedToReconstructedEndToEnd: summarize(successful.map((row) => row.requestedToReconstructedDeg)),
  } : null,
  assetHashes: {
    generatorManifestSha256: manifestSha256,
    generatorProvenanceSha256: generatorManifest.provenanceSha256,
    localizerProvenanceSha256: localizerManifest.provenanceSha256,
  },
  limitations: [
    "Source-only expected responses; no background, Poisson sampling, duration, or light curve.",
    "CELoc official ROOT output parity remains pending.",
    "Generator and localizer templates are not an independent scientific test set.",
    "Empirical percentiles are descriptive and are not confidence regions.",
  ],
  cases: successful,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  attempted: output.attempted,
  successful: output.successful,
  failed: output.failed,
  failureRate: output.failureRate,
  metricsDeg: output.metricsDeg,
}, null, 2));
