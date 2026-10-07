import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { gunzipSync } from "node:zlib";

import {
  RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256,
  generateRitabrataGrbResponse,
  selectThreeNearestRitabrataGrbDirections,
  type GeneratedGrbResponse,
  type RitabrataGrbGeneratorAssets,
} from "../app/lib/ritabrata-grb-generator.ts";
import {
  APPROVED_LOCALIZER_MANIFEST_SHA256,
  createRitabrataAssetBundle,
} from "../app/lib/ritabrata-localizer-assets.ts";
import { computeLegacyKsLocalization, type LegacyKsAssetBundle } from "../app/lib/legacy-template-localizer.ts";
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

const SEED = 20260907;
const CASE_COUNT = 1_000;
const MAXIMUM_THETA_DEG = 113;
const THETA_BIN_EDGES_DEG = Object.freeze([0, 15, 30, 45, 60, 75, 90, 100, 113] as const);
const SPECTRUM = Object.freeze({
  normalization: 0.026,
  spectralIndex: -1.07,
  peakEnergyKeV: 756.4,
});
const updatedGeneratorDirectory = resolve(
  process.argv[2] ?? "scientific-assets/rito-updated-20260907/generator",
);
const localizer5Directory = resolve(
  process.argv[3] ?? "scientific-assets/rito-updated-20260907/localizer-5deg",
);
const localizer2Directory = resolve(
  process.argv[4] ?? "scientific-assets/rito-updated-20260907/localizer-2deg",
);
const outputPath = resolve(
  process.argv[5] ?? "docs/evidence/rito-updated-grb-pipeline-benchmark-1000-20260908.json",
);
const requestedCaseCount = Number(process.env.CE_BENCHMARK_CASE_COUNT ?? CASE_COUNT);
assert.ok(Number.isInteger(requestedCaseCount) && requestedCaseCount > 0 && requestedCaseCount <= CASE_COUNT);

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

type GeneratorManifest = Readonly<{
  schemaVersion: 1 | 2;
  assetVersion: string;
  directionFrame: RitabrataGrbGeneratorAssets["directionFrame"];
  pixelCount: number;
  sourceAreaCm2: number;
  primaryEnergyBinEdgesKeV: readonly number[];
  depositedEnergyBinEdgesKeV: readonly number[];
  directions: RitabrataGrbGeneratorAssets["directions"];
  kernels: Readonly<Record<string, Readonly<{
    file: string;
    fileSha256: string;
    members: readonly Readonly<{
      directionIndex: number;
      offset: number;
      compressedByteLength: number;
      uncompressedByteLength: number;
      sha256: string;
    }>[];
  }>>>;
  provenanceSha256: string;
  rootParity: RitabrataGrbGeneratorAssets["rootParity"];
}>;

type LoadedGenerator = Readonly<{
  label: "three-neighbour-v2";
  manifest: GeneratorManifest;
  manifestSha256: string;
  kernelFiles: Readonly<Record<string, Buffer>>;
  memberCache: Map<string, Float32Array>;
}>;

function loadGenerator(directory: string): LoadedGenerator {
  const filename = "cegengrb-v2.manifest.json";
  const manifestBytes = readFileSync(resolve(directory, filename));
  const manifestSha256 = sha256(manifestBytes);
  assert.equal(manifestSha256, RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as GeneratorManifest;
  const kernelFiles = Object.fromEntries(Object.entries(manifest.kernels).map(([name, descriptor]) => {
    const bytes = readFileSync(resolve(directory, descriptor.file));
    assert.equal(sha256(bytes), descriptor.fileSha256);
    return [name, bytes];
  }));
  return Object.freeze({
    label: "three-neighbour-v2" as const,
    manifest,
    manifestSha256,
    kernelFiles,
    memberCache: new Map<string, Float32Array>(),
  });
}

function memberValues(generator: LoadedGenerator, name: string, directionIndex: number): Float32Array {
  const cacheKey = `${name}:${directionIndex}`;
  const cached = generator.memberCache.get(cacheKey);
  if (cached) return cached;
  const descriptor = generator.manifest.kernels[name];
  const member = descriptor.members[directionIndex];
  assert.equal(member.directionIndex, directionIndex);
  const compressed = generator.kernelFiles[name].subarray(
    member.offset,
    member.offset + member.compressedByteLength,
  );
  assert.equal(sha256(compressed), member.sha256);
  const raw = gunzipSync(compressed);
  assert.equal(raw.byteLength, member.uncompressedByteLength);
  const result = new Float32Array(toArrayBuffer(raw));
  generator.memberCache.set(cacheKey, result);
  return result;
}

function concatenate(values: readonly Float32Array[]): Float32Array {
  const result = new Float32Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function generatorAssets(
  generator: LoadedGenerator,
  thetaDeg: number,
  phiDeg: number,
): RitabrataGrbGeneratorAssets {
  const match = selectThreeNearestRitabrataGrbDirections(
    thetaDeg,
    phiDeg,
    generator.manifest.directions,
  );
  assert.ok(match);
  const selected = match.selections.map((selection) => selection.direction);
  const indices = selected.map((direction) => generator.manifest.directions.indexOf(direction));
  const values = (name: string) => concatenate(indices.map((index) => memberValues(generator, name, index)));
  return Object.freeze({
    assetVersion: generator.manifest.assetVersion,
    manifestSha256: generator.manifestSha256,
    directionFrame: generator.manifest.directionFrame,
    pixelCount: generator.manifest.pixelCount,
    sourceAreaCm2: generator.manifest.sourceAreaCm2,
    primaryEnergyBinEdgesKeV: generator.manifest.primaryEnergyBinEdgesKeV,
    depositedEnergyBinEdgesKeV: generator.manifest.depositedEnergyBinEdgesKeV,
    directions: selected,
    primaryCountsKernel: values("primaryCounts"),
    pixelMeanKernel: values("pixelMean"),
    pixelVarianceKernel: values("pixelVariance"),
    depositedEnergyMeanKernel: values("depositedEnergyMean"),
    depositedEnergyVarianceKernel: values("depositedEnergyVariance"),
    provenanceSha256: generator.manifest.provenanceSha256,
    rootParity: generator.manifest.rootParity,
  });
}

function loadCompressedDescriptor(
  directory: string,
  descriptor: Readonly<{
    file?: string;
    sha256?: string;
    uncompressedByteLength: number;
    shards?: readonly Readonly<{
      file: string;
      sha256: string;
      uncompressedByteLength: number;
    }>[];
  }>,
): Buffer {
  const raw = descriptor.shards
    ? Buffer.concat(descriptor.shards.map((shard) => {
        const compressed = readFileSync(resolve(directory, shard.file));
        assert.equal(sha256(compressed), shard.sha256);
        const part = gunzipSync(compressed);
        assert.equal(part.byteLength, shard.uncompressedByteLength);
        return part;
      }))
    : (() => {
        assert.ok(descriptor.file && descriptor.sha256);
        const compressed = readFileSync(resolve(directory, descriptor.file));
        assert.equal(sha256(compressed), descriptor.sha256);
        return gunzipSync(compressed);
      })();
  assert.equal(raw.byteLength, descriptor.uncompressedByteLength);
  return raw;
}

type LoadedLocalizer = Readonly<{
  label: "ks-5deg-v2" | "ks-2deg-v2";
  manifestSha256: string;
  provenanceSha256: string;
  templateCount: number;
  assets: LegacyKsAssetBundle;
}>;

function loadLocalizer(directory: string, label: LoadedLocalizer["label"]): LoadedLocalizer {
  const manifestBytes = readFileSync(resolve(directory, "ritabrata-localizer.manifest.json"));
  const manifestSha256 = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const approved = APPROVED_LOCALIZER_MANIFEST_SHA256[
    manifest.assetVersion as keyof typeof APPROVED_LOCALIZER_MANIFEST_SHA256
  ];
  assert.equal(manifestSha256, approved);
  const response = loadCompressedDescriptor(directory, manifest.templateResponse);
  const flow = manifest.templateProjectionFlow
    ? loadCompressedDescriptor(directory, manifest.templateProjectionFlow)
    : undefined;
  return Object.freeze({
    label,
    manifestSha256,
    provenanceSha256: manifest.provenanceSha256,
    templateCount: manifest.templateCount,
    assets: createRitabrataAssetBundle(
      manifest,
      toArrayBuffer(response),
      flow ? toArrayBuffer(flow) : undefined,
    ),
  });
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

function sampleUniformSolidAngle(
  count: number,
  maximumThetaDeg: number,
  random: () => number,
): readonly Readonly<{ thetaDeg: number; phiDeg: number }>[] {
  const minimumCosine = Math.cos(maximumThetaDeg * Math.PI / 180);
  return Array.from({ length: count }, () => Object.freeze({
    // cos(theta) is uniform on a spherical cap for an isotropic source direction.
    thetaDeg: Math.acos(minimumCosine + random() * (1 - minimumCosine)) * 180 / Math.PI,
    phiDeg: random() * 360,
  }));
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

function percentile(values: readonly number[], probability: number): number {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]);
}

function summarize(values: readonly number[]) {
  return Object.freeze({
    count: values.length,
    median: percentile(values, 0.5),
    p68: percentile(values, 0.68),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    maximum: Math.max(...values),
  });
}

function summarizeSigned(values: readonly number[]) {
  assert.ok(values.length > 0);
  return Object.freeze({
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  });
}

function wrappedDeltaDeg(reconstructedDeg: number, requestedDeg: number): number {
  return ((reconstructedDeg - requestedDeg + 540) % 360) - 180;
}

type Reconstruction = Readonly<{
  status: "available";
  thetaDeg: number;
  phiDeg: number;
  requestedToReconstructedDeg: number;
  thetaResidualDeg: number;
  wrappedPhiResidualDeg: number;
  maximumProbability?: number;
  selectedTemplateCount?: number;
  runtimeMs?: number;
}> | Readonly<{ status: "unavailable"; reason: string }>;

function localize(
  generated: GeneratedGrbResponse,
  localizer: LoadedLocalizer,
): Reconstruction {
  try {
    const result = computeLegacyKsLocalization(
      bridgeGeneratedGrbToLegacyObservation(generated, localizer.assets),
      localizer.assets,
    );
    if ("status" in result) return Object.freeze({ status: "unavailable", reason: result.reason });
    return Object.freeze({
      status: "available",
      thetaDeg: result.thetaDeg,
      phiDeg: result.phiDeg,
      requestedToReconstructedDeg: separationDeg(
        generated.requestedDirection.thetaDeg,
        generated.requestedDirection.phiDeg,
        result.thetaDeg,
        result.phiDeg,
      ),
      thetaResidualDeg: result.thetaDeg - generated.requestedDirection.thetaDeg,
      wrappedPhiResidualDeg: wrappedDeltaDeg(
        result.phiDeg,
        generated.requestedDirection.phiDeg,
      ),
      maximumProbability: result.maximumProbability,
      selectedTemplateCount: result.selectedTemplateCount,
    });
  } catch (error) {
    return Object.freeze({
      status: "unavailable",
      reason: error instanceof Error ? error.message : "localization-failed",
    });
  }
}

function positiveExcessCentroid(
  generated: GeneratedGrbResponse,
  frameIndex: number,
): Reconstruction {
  const reconstruction = reconstructBurstDirection({
    pixelValues: Array.from(generated.pixelCountsPerSecond),
    pixelBaseline: Array.from({ length: 126 }, () => 0),
    detectorNormals,
    radialBoresight: [0, 1, 0],
    frameIndex,
    acquisitionTimeSeconds: 0.2,
  });
  if (reconstruction.status === "unavailable") {
    return Object.freeze({ status: "unavailable", reason: reconstruction.reason });
  }
  const rootDirection = threeDetectorLocalToRitabrata(
    createThreeDetectorLocalVector(...reconstruction.localDirection),
  );
  const { thetaDeg, phiDeg } = ritabrataAnglesFromDirection(rootDirection);
  return Object.freeze({
    status: "available",
    thetaDeg,
    phiDeg,
    requestedToReconstructedDeg: separationDeg(
      generated.requestedDirection.thetaDeg,
      generated.requestedDirection.phiDeg,
      thetaDeg,
      phiDeg,
    ),
    thetaResidualDeg: thetaDeg - generated.requestedDirection.thetaDeg,
    wrappedPhiResidualDeg: wrappedDeltaDeg(phiDeg, generated.requestedDirection.phiDeg),
  });
}

const updatedGenerator = loadGenerator(updatedGeneratorDirectory);
const localizers = [
  loadLocalizer(localizer5Directory, "ks-5deg-v2"),
  loadLocalizer(localizer2Directory, "ks-2deg-v2"),
] as const;
const detectorNormals = getV2R8CandidateNormals(createV2R8CandidateDetectorGeometry(
  parsePixelBackgroundTsv(readFileSync(resolve("public/data/pixbkg.txt"), "utf8")),
));
const random = randomFactory(SEED);
const requests = sampleUniformSolidAngle(requestedCaseCount, MAXIMUM_THETA_DEG, random);
const METHOD_LABELS = ["positive-excess-centroid", "ks-5deg-v2", "ks-2deg-v2"] as const;
type MethodLabel = typeof METHOD_LABELS[number];
type CaseRecord = Readonly<{
  caseIndex: number;
  requestedDirection: Readonly<{ thetaDeg: number; phiDeg: number }>;
  generation: Readonly<{
    status: "available";
    runtimeMs: number;
    selectedDatabaseDirections: GeneratedGrbResponse["selectedDatabaseDirections"];
    nearestTemplateDistanceDeg: number;
    containmentWarning: GeneratedGrbResponse["containmentWarning"];
    totalPixelCountsPerSecond: number;
  }> | Readonly<{ status: "unavailable"; runtimeMs: number; reason: string }>;
  methods: Readonly<Record<MethodLabel, Reconstruction>>;
}>;

function withRuntime(result: Reconstruction, runtimeMs: number): Reconstruction {
  return result.status === "available" ? Object.freeze({ ...result, runtimeMs }) : result;
}

const cases: CaseRecord[] = [];
const benchmarkStart = performance.now();
for (let caseIndex = 0; caseIndex < requests.length; caseIndex += 1) {
  const request = requests[caseIndex];
  const generationStart = performance.now();
  const generated = generateRitabrataGrbResponse(
    request.thetaDeg,
    request.phiDeg,
    SPECTRUM,
    generatorAssets(updatedGenerator, request.thetaDeg, request.phiDeg),
  );
  const generationRuntimeMs = performance.now() - generationStart;
  if (generated.status !== "available") {
    const unavailable = Object.freeze({ status: "unavailable" as const, reason: "generation-unavailable" });
    cases.push(Object.freeze({
      caseIndex,
      requestedDirection: request,
      generation: Object.freeze({
        status: "unavailable" as const,
        runtimeMs: generationRuntimeMs,
        reason: generated.reason,
      }),
      methods: Object.freeze({
        "positive-excess-centroid": unavailable,
        "ks-5deg-v2": unavailable,
        "ks-2deg-v2": unavailable,
      }),
    }));
  } else {
    const centroidStart = performance.now();
    const centroid = positiveExcessCentroid(generated.response, caseIndex);
    const centroidRuntimeMs = performance.now() - centroidStart;
    const ks5Start = performance.now();
    const ks5 = localize(generated.response, localizers[0]);
    const ks5RuntimeMs = performance.now() - ks5Start;
    const ks2Start = performance.now();
    const ks2 = localize(generated.response, localizers[1]);
    const ks2RuntimeMs = performance.now() - ks2Start;
    cases.push(Object.freeze({
      caseIndex,
      requestedDirection: request,
      generation: Object.freeze({
        status: "available" as const,
        runtimeMs: generationRuntimeMs,
        selectedDatabaseDirections: generated.response.selectedDatabaseDirections,
        nearestTemplateDistanceDeg: Math.min(
          ...generated.response.selectedDatabaseDirections.map((entry) => entry.separationDeg),
        ),
        containmentWarning: generated.response.containmentWarning,
        totalPixelCountsPerSecond: Array.from(generated.response.pixelCountsPerSecond)
          .reduce((sum, value) => sum + value, 0),
      }),
      methods: Object.freeze({
        "positive-excess-centroid": withRuntime(centroid, centroidRuntimeMs),
        "ks-5deg-v2": withRuntime(ks5, ks5RuntimeMs),
        "ks-2deg-v2": withRuntime(ks2, ks2RuntimeMs),
      }),
    }));
  }
  if ((caseIndex + 1) % 10 === 0 || caseIndex + 1 === requests.length) {
    const elapsedSeconds = (performance.now() - benchmarkStart) / 1000;
    console.error(`progress ${caseIndex + 1}/${requests.length} elapsed=${elapsedSeconds.toFixed(1)}s`);
  }
}
const totalRuntimeMs = performance.now() - benchmarkStart;

function rowsFor(method: MethodLabel, selectedCases: readonly CaseRecord[] = cases) {
  return selectedCases.flatMap((entry) => {
    const row = entry.methods[method];
    return row.status === "available" ? [row] : [];
  });
}

function summaryOrNull(values: readonly number[]) {
  return values.length > 0 ? summarize(values) : null;
}

function signedSummaryOrNull(values: readonly number[]) {
  return values.length > 0 ? summarizeSigned(values) : null;
}

function methodSummary(method: MethodLabel) {
  const make = (selectedCases: readonly CaseRecord[]) => {
    const rows = rowsFor(method, selectedCases);
    const failures = selectedCases.flatMap((entry) => {
      const row = entry.methods[method];
      return row.status === "unavailable" ? [row.reason] : [];
    });
    return Object.freeze({
      attempted: selectedCases.length,
      successful: rows.length,
      failed: failures.length,
      failureReasons: Object.fromEntries([...new Set(failures)].sort().map((reason) => [
        reason,
        failures.filter((value) => value === reason).length,
      ])),
      requestedToReconstructedDeg: summaryOrNull(rows.map((row) => row.requestedToReconstructedDeg)),
      thetaResidualDeg: signedSummaryOrNull(rows.map((row) => row.thetaResidualDeg)),
      wrappedPhiResidualDeg: signedSummaryOrNull(rows.map((row) => row.wrappedPhiResidualDeg)),
      runtimeMs: summaryOrNull(rows.flatMap((row) => row.runtimeMs === undefined ? [] : [row.runtimeMs])),
    });
  };
  return Object.freeze({
    global: make(cases),
    byRequestedDetectorZenith: THETA_BIN_EDGES_DEG.slice(0, -1).map((minimumDeg, index) => {
      const maximumDeg = THETA_BIN_EDGES_DEG[index + 1];
      const selected = cases.filter((entry) =>
        entry.requestedDirection.thetaDeg >= minimumDeg &&
        (index === THETA_BIN_EDGES_DEG.length - 2
          ? entry.requestedDirection.thetaDeg <= maximumDeg
          : entry.requestedDirection.thetaDeg < maximumDeg));
      return Object.freeze({ minimumDeg, maximumDeg, ...make(selected) });
    }),
  });
}

function pairedComparison(first: MethodLabel, second: MethodLabel) {
  let firstLowerError = 0;
  let secondLowerError = 0;
  let exactTie = 0;
  let pairedCases = 0;
  const differences: number[] = [];
  for (const entry of cases) {
    const left = entry.methods[first];
    const right = entry.methods[second];
    if (left.status !== "available" || right.status !== "available") continue;
    pairedCases += 1;
    const difference = right.requestedToReconstructedDeg - left.requestedToReconstructedDeg;
    differences.push(difference);
    if (Math.abs(difference) <= 1e-12) exactTie += 1;
    else if (difference > 0) firstLowerError += 1;
    else secondLowerError += 1;
  }
  return Object.freeze({
    first,
    second,
    pairedCases,
    firstLowerError,
    secondLowerError,
    exactTie,
    medianErrorAdvantageDegForFirst: differences.length > 0 ? percentile(differences, 0.5) : null,
  });
}

const scientificCases = cases.map((entry) => Object.freeze({
  ...entry,
  generation: entry.generation.status === "available"
    ? Object.freeze({ ...entry.generation, runtimeMs: undefined })
    : Object.freeze({ ...entry.generation, runtimeMs: undefined }),
  methods: Object.fromEntries(METHOD_LABELS.map((method) => {
    const row = entry.methods[method];
    return [method, row.status === "available" ? Object.freeze({ ...row, runtimeMs: undefined }) : row];
  })),
}));
const caseRecordsSha256 = sha256(JSON.stringify(scientificCases));
const containmentCounts = Object.fromEntries(["none", "outside-neighbour-triangle", "degenerate-neighbour-triangle"].map(
  (label) => [label, cases.filter((entry) => entry.generation.status === "available" &&
    (entry.generation.containmentWarning ?? "none") === label).length],
));
const evidence = Object.freeze({
  schemaVersion: 2,
  status: "PROVISIONAL",
  benchmarkVersion: "updated-three-neighbour-source-only-isotropic-1000-v1",
  generatedAtUtc: new Date().toISOString(),
  protocol: Object.freeze({
    requestedCaseCount,
    canonicalCaseCount: CASE_COUNT,
    seed: SEED,
    randomAlgorithm: "mulberry32",
    sampling: "uniform solid angle over the spherical cap theta=[0,113] deg; phi=[0,360) deg",
    maximumThetaDeg: MAXIMUM_THETA_DEG,
    detectorZenithBinEdgesDeg: THETA_BIN_EDGES_DEG,
    spectrum: SPECTRUM,
    signalModel: "source-only deterministic expected response",
    excluded: ["background", "Poisson sampling", "light curve", "duration", "occultation"],
    percentileDefinition: "Hyndman-Fan type 7 empirical percentile; descriptive, not a confidence interval",
  }),
  assets: Object.freeze({
    generator: Object.freeze({
      directory: basename(updatedGeneratorDirectory),
      manifestSha256: updatedGenerator.manifestSha256,
      provenanceSha256: updatedGenerator.manifest.provenanceSha256,
      directionCount: updatedGenerator.manifest.directions.length,
    }),
    localizers: localizers.map((localizer) => Object.freeze({
      label: localizer.label,
      directory: basename(localizer.label === "ks-5deg-v2" ? localizer5Directory : localizer2Directory),
      templateCount: localizer.templateCount,
      manifestSha256: localizer.manifestSha256,
      provenanceSha256: localizer.provenanceSha256,
    })),
  }),
  environment: Object.freeze({ node: process.version, platform: process.platform, arch: process.arch }),
  totalRuntimeMs,
  generation: Object.freeze({
    successful: cases.filter((entry) => entry.generation.status === "available").length,
    failed: cases.filter((entry) => entry.generation.status === "unavailable").length,
    runtimeMs: summaryOrNull(cases.map((entry) => entry.generation.runtimeMs)),
    nearestTemplateDistanceDeg: summaryOrNull(cases.flatMap((entry) =>
      entry.generation.status === "available" ? [entry.generation.nearestTemplateDistanceDeg] : [])),
    containmentWarnings: containmentCounts,
  }),
  methods: Object.fromEntries(METHOD_LABELS.map((method) => [method, methodSummary(method)])),
  pairedComparisons: Object.freeze([
    pairedComparison("ks-5deg-v2", "positive-excess-centroid"),
    pairedComparison("ks-2deg-v2", "positive-excess-centroid"),
    pairedComparison("ks-2deg-v2", "ks-5deg-v2"),
  ]),
  caseRecordsSha256,
  caseRecordsDigestScope: "all scientific per-case fields; runtimeMs excluded",
  cases,
  limitations: Object.freeze([
    "The browser generator is a full-sample expectation approximation, not the C++ prefix-event copy.",
    "Generator and localizer use related response families; this is not an independent scientific validation set.",
    "No background or counting noise is present, so these results do not estimate operational localization performance.",
    "Identical-input parity with the official C++/ROOT generator and localizer remains pending.",
    "The wrapped phi residual is coordinate-dependent and unstable near the detector pole; angular separation is the primary error metric.",
  ]),
});

writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  requestedCaseCount,
  totalRuntimeMs,
  generation: evidence.generation,
  methods: evidence.methods,
  pairedComparisons: evidence.pairedComparisons,
  caseRecordsSha256,
}, null, 2));
