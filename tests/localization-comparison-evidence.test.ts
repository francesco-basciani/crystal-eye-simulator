import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LOCALIZATION_COMPARISON_EVIDENCE } from "../app/lib/localization-comparison-evidence.ts";

type BenchmarkMetric = Readonly<{ count: number; median: number }>;
type BenchmarkBand = Readonly<{
  minimumDeg: number;
  maximumDeg: number;
  requestedToReconstructedDeg: BenchmarkMetric;
}>;
type PairedBand = Readonly<{
  minimumDeg: number;
  maximumDeg: number;
  pairedCases: number;
  templateKsLowerError: number;
}>;
type TemplateMethod = Readonly<{
  templateCount: number;
  requestedToReconstructedDeg: BenchmarkMetric;
  runtimeMs: BenchmarkMetric;
  byRequestedDetectorZenith: readonly BenchmarkBand[];
  pairedAgainstPositiveExcessCentroid: Readonly<{
    templateKsLowerError: number;
    byRequestedDetectorZenith: readonly PairedBand[];
  }>;
}>;
type BenchmarkEvidence = Readonly<{
  seed: number;
  pairedTemplateGridComparison: Readonly<{
    ks2LowerError: number;
    byRequestedDetectorZenith: readonly Readonly<{
      ks2LowerError: number;
    }>[];
  }>;
  methods: Readonly<{
    positiveExcessCentroid: Readonly<{
      requestedToReconstructedDeg: BenchmarkMetric;
      runtimeMs: BenchmarkMetric;
      byRequestedDetectorZenith: readonly BenchmarkBand[];
    }>;
    templateKs: Readonly<Record<string, TemplateMethod>>;
  }>;
}>;

const evidence = JSON.parse(readFileSync(
  new URL(
    "../docs/evidence/grb-localizer-comparison-stratified-theta-20260827.json",
    import.meta.url,
  ),
  "utf8",
)) as BenchmarkEvidence;
const globalEvidence = JSON.parse(readFileSync(
  new URL("../docs/evidence/grb-localizer-comparison-20260827.json", import.meta.url),
  "utf8",
)) as BenchmarkEvidence;

test("localization comparison UI is an exact projection of durable stratified evidence", () => {
  const compact = LOCALIZATION_COMPARISON_EVIDENCE;
  const templateMethods = Object.values(evidence.methods.templateKs);
  const ks5 = templateMethods.find((method) => method.requestedToReconstructedDeg.count === 144 &&
    method.byRequestedDetectorZenith[0]?.requestedToReconstructedDeg.median > 3);
  const ks2 = templateMethods.find((method) => method.requestedToReconstructedDeg.count === 144 &&
    method.byRequestedDetectorZenith[0]?.requestedToReconstructedDeg.median < 3);

  assert.ok(ks5);
  assert.ok(ks2);
  assert.equal(compact.seed, evidence.seed);
  assert.deepEqual(compact.overall, {
      sampleCount: evidence.methods.positiveExcessCentroid.requestedToReconstructedDeg.count,
      centroidMedianErrorDeg: evidence.methods.positiveExcessCentroid.requestedToReconstructedDeg.median,
      ks5MedianErrorDeg: ks5?.requestedToReconstructedDeg.median,
      ks5PairedWins: ks5?.pairedAgainstPositiveExcessCentroid.templateKsLowerError,
    ks2MedianErrorDeg: ks2?.requestedToReconstructedDeg.median,
    ks2PairedWins: ks2?.pairedAgainstPositiveExcessCentroid.templateKsLowerError,
    ks2VsKs5PairedWins: evidence.pairedTemplateGridComparison.ks2LowerError,
  });

  const globalTemplateMethods = Object.values(globalEvidence.methods.templateKs);
  const globalKs5 = globalTemplateMethods.find((method) => method.templateCount === 742);
  const globalKs2 = globalTemplateMethods.find((method) => method.templateCount === 4980);
  assert.ok(globalKs5);
  assert.ok(globalKs2);
  assert.deepEqual(compact.runtimeReference, {
    sampleCount: globalEvidence.methods.positiveExcessCentroid.runtimeMs.count,
    centroidMedianMs: globalEvidence.methods.positiveExcessCentroid.runtimeMs.median,
    ks5MedianMs: globalKs5.runtimeMs.median,
    ks2MedianMs: globalKs2.runtimeMs.median,
  });

  assert.equal(compact.bands.length, 6);
  compact.bands.forEach((band, index) => {
    const centroidBand = evidence.methods.positiveExcessCentroid.byRequestedDetectorZenith[index];
    const ks5Band = ks5.byRequestedDetectorZenith[index];
    const ks2Band = ks2.byRequestedDetectorZenith[index];
    const ks5Paired = ks5.pairedAgainstPositiveExcessCentroid.byRequestedDetectorZenith[index];
    const ks2Paired = ks2.pairedAgainstPositiveExcessCentroid.byRequestedDetectorZenith[index];
    assert.deepEqual(band, {
        minimumThetaDeg: centroidBand.minimumDeg,
        maximumThetaDeg: centroidBand.maximumDeg,
        sampleCount: centroidBand.requestedToReconstructedDeg.count,
        centroidMedianErrorDeg: centroidBand.requestedToReconstructedDeg.median,
        ks5MedianErrorDeg: ks5Band?.requestedToReconstructedDeg.median,
        ks5PairedWins: ks5Paired?.templateKsLowerError,
        ks2MedianErrorDeg: ks2Band?.requestedToReconstructedDeg.median,
      ks2PairedWins: ks2Paired?.templateKsLowerError,
      ks2VsKs5PairedWins:
        evidence.pairedTemplateGridComparison.byRequestedDetectorZenith[index].ks2LowerError,
    });
  });
});
