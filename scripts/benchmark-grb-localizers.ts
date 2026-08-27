import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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
import { reconstructBurstDirection } from "../app/lib/burst-direction-reconstruction.ts";
import { createV2R8CandidateDetectorGeometry, getV2R8CandidateNormals } from "../app/lib/detector-geometry-v2r8.ts";
import { parsePixelBackgroundTsv } from "../app/lib/pixel-background.ts";
import {
  createThreeDetectorLocalVector,
  ritabrataAnglesFromDirection,
  ritabrataDirectionFromAngles,
  threeDetectorLocalToRitabrata,
} from "../app/lib/detector-local-frame-adapter.ts";

const SEED = 20260828;
const SPECTRUM = Object.freeze({ normalization: 0.026, spectralIndex: -1.07, peakEnergyKeV: 756.4 });
const THETA_BINS = Object.freeze([[0, 15], [15, 30], [30, 45], [45, 60], [60, 75], [75, 90]] as const);
const generatorDirectory = resolve(process.argv[2] ?? "public/data/ritabrata-grb-generator");
const outputPath = resolve(process.argv[3] ?? "docs/evidence/grb-localizer-comparison-20260827.json");
const sampleCount = Number(process.argv[4] ?? 128);
const samplingMode = process.env.GRB_BENCHMARK_SAMPLING === "stratified-theta"
  ? "stratified-theta"
  : "uniform-hemisphere";
const localizerDirectories = process.argv.slice(5).map((value) => resolve(value));
if (localizerDirectories.length === 0) {
  localizerDirectories.push(resolve("public/data/ritabrata-localizer"));
}
assert.ok(Number.isInteger(sampleCount) && sampleCount > 0);

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const generatorManifestBytes = readFileSync(resolve(generatorDirectory, "ritabrata-grb-generator.manifest.json"));
const generatorManifestSha256 = digest(generatorManifestBytes);
assert.equal(generatorManifestSha256, RITABRATA_GRB_APPROVED_MANIFEST_SHA256);
const generatorManifest = JSON.parse(generatorManifestBytes.toString("utf8"));
const kernelFiles = Object.fromEntries(Object.entries(generatorManifest.kernels).map(
  ([name, descriptor]) => [name, readFileSync(resolve(generatorDirectory, (descriptor as { file: string }).file))],
));
function loadLocalizerResponse(directory: string, descriptor: {
  file?: string;
  sha256?: string;
  uncompressedByteLength: number;
  shards?: readonly {
    file: string;
    sha256: string;
    uncompressedByteLength: number;
  }[];
}): Buffer {
  if (descriptor.shards) {
    const parts = descriptor.shards.map((shard) => {
      const compressed = readFileSync(resolve(directory, shard.file));
      assert.equal(digest(compressed), shard.sha256);
      const raw = gunzipSync(compressed);
      assert.equal(raw.byteLength, shard.uncompressedByteLength);
      return raw;
    });
    const raw = Buffer.concat(parts);
    assert.equal(raw.byteLength, descriptor.uncompressedByteLength);
    return raw;
  }
  assert.ok(descriptor.file && descriptor.sha256);
  const compressed = readFileSync(resolve(directory, descriptor.file));
  assert.equal(digest(compressed), descriptor.sha256);
  return gunzipSync(compressed);
}

const localizers = localizerDirectories.map((directory) => {
  const manifestBytes = readFileSync(resolve(directory, "ritabrata-localizer.manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const raw = loadLocalizerResponse(directory, manifest.templateResponse);
  const flowRaw = manifest.templateProjectionFlow
    ? loadLocalizerResponse(directory, manifest.templateProjectionFlow)
    : undefined;
  return Object.freeze({
    label: `${manifest.assetVersion}:${manifest.templateCount}`,
    directory: basename(directory),
    manifestSha256: digest(manifestBytes),
    manifest,
    assets: createRitabrataAssetBundle(
      manifest,
      arrayBufferCopy(raw),
      flowRaw ? arrayBufferCopy(flowRaw) : undefined,
    ),
  });
});

function memberValues(name: string, directionIndex: number): Float32Array {
  const descriptor = generatorManifest.kernels[name];
  const member = descriptor.members[directionIndex];
  const compressed = kernelFiles[name].subarray(member.offset, member.offset + member.compressedByteLength);
  assert.equal(digest(compressed), member.sha256);
  const raw = gunzipSync(compressed);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function generatorAssets(directionIndex: number): RitabrataGrbGeneratorAssets {
  return {
    assetVersion: generatorManifest.assetVersion,
    manifestSha256: generatorManifestSha256,
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

function randomFactory(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function separation(first: readonly number[], second: readonly number[]): number {
  return Math.acos(Math.max(-1, Math.min(1,
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2],
  ))) * 180 / Math.PI;
}

function type7(values: readonly number[], probability: number): number {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * probability;
  const lower = Math.floor(h);
  const fraction = h - lower;
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]);
}

function summary(values: readonly number[]) {
  return values.length === 0 ? null : Object.freeze({
    count: values.length,
    median: type7(values, 0.5),
    p68: type7(values, 0.68),
    p90: type7(values, 0.9),
    p95: type7(values, 0.95),
    max: Math.max(...values),
  });
}

type MethodCase = {
  sampleIndex: number;
  requestedThetaDeg: number;
  requestedPhiDeg: number;
  selectedThetaDeg: number;
  selectedPhiDeg: number;
  reconstructedThetaDeg: number;
  reconstructedPhiDeg: number;
  quantizationErrorDeg: number;
  selectedToReconstructedDeg: number;
  requestedToReconstructedDeg: number;
  runtimeMs: number;
};

function methodSummary(cases: readonly MethodCase[]) {
  return {
    attempted: requests.length,
    successful: cases.length,
    failed: requests.length - cases.length,
    selectedDatabaseToReconstructedDeg: summary(cases.map((row) => row.selectedToReconstructedDeg)),
    requestedToReconstructedDeg: summary(cases.map((row) => row.requestedToReconstructedDeg)),
    runtimeMs: summary(cases.map((row) => row.runtimeMs)),
    byRequestedDetectorZenith: THETA_BINS.map(([minimumDeg, maximumDeg], binIndex) => {
      const rows = cases.filter((row) =>
        row.requestedThetaDeg >= minimumDeg &&
        (binIndex === THETA_BINS.length - 1
          ? row.requestedThetaDeg <= maximumDeg
          : row.requestedThetaDeg < maximumDeg),
      );
      return {
        minimumDeg,
        maximumDeg,
        requestedToReconstructedDeg: summary(rows.map((row) => row.requestedToReconstructedDeg)),
        selectedDatabaseToReconstructedDeg: summary(rows.map((row) => row.selectedToReconstructedDeg)),
      };
    }),
  };
}

function pairedComparison(ks: readonly MethodCase[], centroid: readonly MethodCase[]) {
  const centroidBySample = new Map(centroid.map((row) => [row.sampleIndex, row]));
  const pairs = ks.flatMap((row) => {
    const comparison = centroidBySample.get(row.sampleIndex);
    return comparison ? [[row, comparison] as const] : [];
  });
  const countPairs = (selectedPairs: readonly (readonly [MethodCase, MethodCase])[]) => {
    const counts = { templateKsLowerError: 0, centroidLowerError: 0, exactTie: 0 };
    for (const [ksRow, centroidRow] of selectedPairs) {
      const difference = ksRow.requestedToReconstructedDeg - centroidRow.requestedToReconstructedDeg;
      if (difference < 0) counts.templateKsLowerError += 1;
      else if (difference > 0) counts.centroidLowerError += 1;
      else counts.exactTie += 1;
    }
    return { pairedCases: selectedPairs.length, ...counts };
  };
  return {
    ...countPairs(pairs),
    byRequestedDetectorZenith: THETA_BINS.map(([minimumDeg, maximumDeg], binIndex) => ({
      minimumDeg,
      maximumDeg,
      ...countPairs(pairs.filter(([row]) =>
        row.requestedThetaDeg >= minimumDeg &&
        (binIndex === THETA_BINS.length - 1
          ? row.requestedThetaDeg <= maximumDeg
          : row.requestedThetaDeg < maximumDeg),
      )),
    })),
  };
}

function pairedTemplateGridComparison(
  ks5: readonly MethodCase[],
  ks2: readonly MethodCase[],
) {
  const ks2BySample = new Map(ks2.map((row) => [row.sampleIndex, row]));
  const pairs = ks5.flatMap((row) => {
    const comparison = ks2BySample.get(row.sampleIndex);
    return comparison ? [[row, comparison] as const] : [];
  });
  const countPairs = (selectedPairs: readonly (readonly [MethodCase, MethodCase])[]) => {
    const counts = { ks5LowerError: 0, ks2LowerError: 0, exactTie: 0 };
    for (const [ks5Row, ks2Row] of selectedPairs) {
      const difference = ks5Row.requestedToReconstructedDeg - ks2Row.requestedToReconstructedDeg;
      if (difference < 0) counts.ks5LowerError += 1;
      else if (difference > 0) counts.ks2LowerError += 1;
      else counts.exactTie += 1;
    }
    return { pairedCases: selectedPairs.length, ...counts };
  };
  return {
    ...countPairs(pairs),
    byRequestedDetectorZenith: THETA_BINS.map(([minimumDeg, maximumDeg], binIndex) => ({
      minimumDeg,
      maximumDeg,
      ...countPairs(pairs.filter(([row]) =>
        row.requestedThetaDeg >= minimumDeg &&
        (binIndex === THETA_BINS.length - 1
          ? row.requestedThetaDeg <= maximumDeg
          : row.requestedThetaDeg < maximumDeg),
      )),
    })),
  };
}

const records = parsePixelBackgroundTsv(readFileSync(resolve("public/data/pixbkg.txt"), "utf8"));
const detectorNormals = getV2R8CandidateNormals(createV2R8CandidateDetectorGeometry(records));
const random = randomFactory(SEED);
const requests = samplingMode === "stratified-theta"
  ? THETA_BINS.flatMap(([minimumDeg, maximumDeg]) => {
      const cosineMaximum = Math.cos(minimumDeg * Math.PI / 180);
      const cosineMinimum = Math.cos(maximumDeg * Math.PI / 180);
      return Array.from({ length: sampleCount }, () => ({
        requestedThetaDeg: Math.acos(
          cosineMinimum + random() * (cosineMaximum - cosineMinimum),
        ) * 180 / Math.PI,
        requestedPhiDeg: random() * 360,
      }));
    })
  : Array.from({ length: sampleCount }, () => ({
      requestedThetaDeg: Math.acos(random()) * 180 / Math.PI,
      requestedPhiDeg: random() * 360,
    }));
const centroidCases: MethodCase[] = [];
const ksCases = new Map(localizers.map((localizer) => [localizer.label, [] as MethodCase[]]));
const failureReasons = new Map<string, number>();

for (let sampleIndex = 0; sampleIndex < requests.length; sampleIndex += 1) {
  const { requestedThetaDeg, requestedPhiDeg } = requests[sampleIndex];
  const requestedRoot = ritabrataDirectionFromAngles(requestedThetaDeg, requestedPhiDeg);
  const selection = selectNearestRitabrataGrbDirection(requestedThetaDeg, requestedPhiDeg, generatorManifest.directions);
  assert.ok(selection);
  const directionIndex = generatorManifest.directions.indexOf(selection.direction);
  const generated = generateRitabrataGrbResponse(
    requestedThetaDeg,
    requestedPhiDeg,
    SPECTRUM,
    generatorAssets(directionIndex),
  );
  if (generated.status === "unavailable") {
    failureReasons.set(`generator:${generated.reason}`, (failureReasons.get(`generator:${generated.reason}`) ?? 0) + 1);
    continue;
  }
  const selectedRoot = ritabrataDirectionFromAngles(
    generated.response.selectedDatabaseDirection.thetaDeg,
    generated.response.selectedDatabaseDirection.phiDeg,
  );
  const centroidStart = performance.now();
  const centroid = reconstructBurstDirection({
    pixelValues: Array.from(generated.response.pixelCountsPerSecond),
    pixelBaseline: Array.from({ length: 126 }, () => 0),
    detectorNormals,
    radialBoresight: [0, 1, 0],
    frameIndex: sampleIndex,
    acquisitionTimeSeconds: 0.2,
  });
  const centroidRuntimeMs = performance.now() - centroidStart;
  if (centroid.status === "available") {
    const centroidRoot = threeDetectorLocalToRitabrata(createThreeDetectorLocalVector(...centroid.localDirection));
    centroidCases.push({
      sampleIndex,
      requestedThetaDeg,
      requestedPhiDeg,
      selectedThetaDeg: generated.response.selectedDatabaseDirection.thetaDeg,
      selectedPhiDeg: generated.response.selectedDatabaseDirection.phiDeg,
      ...(() => {
        const reconstructed = ritabrataAnglesFromDirection(centroidRoot);
        return {
          reconstructedThetaDeg: reconstructed.thetaDeg,
          reconstructedPhiDeg: reconstructed.phiDeg,
        };
      })(),
      quantizationErrorDeg: generated.response.quantizationErrorDeg,
      selectedToReconstructedDeg: separation(selectedRoot, centroidRoot),
      requestedToReconstructedDeg: separation(requestedRoot, centroidRoot),
      runtimeMs: centroidRuntimeMs,
    });
  } else {
    failureReasons.set(`centroid:${centroid.reason}`, (failureReasons.get(`centroid:${centroid.reason}`) ?? 0) + 1);
  }
  for (const localizer of localizers) {
    const observation = bridgeGeneratedGrbToLegacyObservation(generated.response, localizer.assets);
    const start = performance.now();
    const localized = computeLegacyKsLocalization(observation, localizer.assets);
    const runtimeMs = performance.now() - start;
    if ("status" in localized) {
      const key = `${localizer.label}:${localized.reason}`;
      failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
      continue;
    }
    ksCases.get(localizer.label)!.push({
      sampleIndex,
      requestedThetaDeg,
      requestedPhiDeg,
      selectedThetaDeg: generated.response.selectedDatabaseDirection.thetaDeg,
      selectedPhiDeg: generated.response.selectedDatabaseDirection.phiDeg,
      ...(() => {
        const reconstructed = ritabrataAnglesFromDirection(localized.rootLocalDirection);
        return {
          reconstructedThetaDeg: reconstructed.thetaDeg,
          reconstructedPhiDeg: reconstructed.phiDeg,
        };
      })(),
      quantizationErrorDeg: generated.response.quantizationErrorDeg,
      selectedToReconstructedDeg: separation(selectedRoot, localized.rootLocalDirection),
      requestedToReconstructedDeg: separation(requestedRoot, localized.rootLocalDirection),
      runtimeMs,
    });
  }
}

const localizer5 = localizers.find((localizer) => localizer.manifest.templateCount === 742);
const localizer2 = localizers.find((localizer) => localizer.manifest.templateCount === 4980);
const caseRecords = requests.map((request, sampleIndex) => {
  const centroid = centroidCases.find((row) => row.sampleIndex === sampleIndex) ?? null;
  const templateKs = Object.fromEntries(localizers.map((localizer) => [
    localizer.label,
    ksCases.get(localizer.label)!.find((row) => row.sampleIndex === sampleIndex) ?? null,
  ]));
  const representative = centroid ?? Object.values(templateKs).find((row) => row !== null) ?? null;
  return {
    sampleIndex,
    requestedDirection: {
      thetaDeg: request.requestedThetaDeg,
      phiDeg: request.requestedPhiDeg,
    },
    selectedDatabaseDirection: representative ? {
      thetaDeg: representative.selectedThetaDeg,
      phiDeg: representative.selectedPhiDeg,
    } : null,
    quantizationErrorDeg: representative?.quantizationErrorDeg ?? null,
    positiveExcessCentroid: centroid,
    templateKs,
  };
});
const scientificCaseRecords = caseRecords.map((record) => {
  const withoutRuntime = (row: MethodCase | null) => {
    if (!row) return null;
    const scientificFields: Partial<MethodCase> = { ...row };
    delete scientificFields.runtimeMs;
    return scientificFields;
  };
  return {
    ...record,
    positiveExcessCentroid: withoutRuntime(record.positiveExcessCentroid),
    templateKs: Object.fromEntries(Object.entries(record.templateKs).map(
      ([method, row]) => [method, withoutRuntime(row)],
    )),
  };
});
const caseRecordsSha256 = digest(Buffer.from(JSON.stringify(scientificCaseRecords)));

const output = {
  schemaVersion: 1,
  benchmarkVersion: `grb-localizer-comparison-${samplingMode}-v1`,
  validationStatus: "PROVISIONAL",
  seed: SEED,
  randomAlgorithm: "mulberry32",
  sampling: samplingMode === "stratified-theta"
    ? "equal cases per detector-zenith bin; uniform solid angle within each bin"
    : "uniform solid angle over detector upper hemisphere",
  sampleCount: requests.length,
  samplesPerDetectorZenithBin: samplingMode === "stratified-theta" ? sampleCount : null,
  detectorZenithBinsDeg: THETA_BINS,
  spectrum: SPECTRUM,
  percentileDefinition: "Hyndman-Fan type 7 empirical percentile; not a confidence interval",
  quantizationDeg: summary(centroidCases.map((row) => row.quantizationErrorDeg)),
  caseRecordsSha256,
  caseRecordsDigestScope: "all per-case scientific fields; runtimeMs excluded",
  cases: caseRecords,
  methods: {
    positiveExcessCentroid: methodSummary(centroidCases),
    templateKs: Object.fromEntries(localizers.map((localizer) => [
      localizer.label,
      {
        templateCount: localizer.manifest.templateCount,
        manifestSha256: localizer.manifestSha256,
        pairedAgainstPositiveExcessCentroid: pairedComparison(
          ksCases.get(localizer.label)!,
          centroidCases,
        ),
        ...methodSummary(ksCases.get(localizer.label)!),
      },
    ])),
  },
  pairedTemplateGridComparison: localizer5 && localizer2
    ? {
        ks5Method: localizer5.label,
        ks2Method: localizer2.label,
        ...pairedTemplateGridComparison(
          ksCases.get(localizer5.label)!,
          ksCases.get(localizer2.label)!,
        ),
      }
    : null,
  failureReasons: Object.fromEntries([...failureReasons.entries()].sort()),
  assetHashes: {
    generatorManifestSha256,
    generatorProvenanceSha256: generatorManifest.provenanceSha256,
    localizers: Object.fromEntries(localizers.map((localizer) => [localizer.label, {
      manifestSha256: localizer.manifestSha256,
      provenanceSha256: localizer.manifest.provenanceSha256,
    }])),
  },
  limitations: [
    "Source-only expected responses; no background, Poisson sampling, duration, or light curve.",
    "CELoc official ROOT output parity remains pending.",
    "Generator and localizer templates are not an independent scientific test set.",
    "The centroid and KS methods receive the same CEGenGRB nearest-database response.",
    "Empirical percentiles are descriptive and are not confidence regions.",
  ],
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, methods: output.methods }, null, 2));
