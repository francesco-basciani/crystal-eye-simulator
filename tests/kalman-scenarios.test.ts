import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KALMAN_FILTER_CONFIGURATION,
  KALMAN_ANALYSIS_VERSION,
  KALMAN_DEMONSTRATOR_LABEL,
  KALMAN_SCENARIOS,
  createLiveReferenceFrames,
  createSeededRandom,
  generateScenarioFrames,
  runAggregateBackgroundKalman,
  runKalmanScenario,
  samplePoisson,
  type KalmanReferenceFrame,
} from "../app/lib/kalman-scenarios.ts";

test("the seeded generator and Poisson observations replay exactly", () => {
  const first = createSeededRandom(12345);
  const second = createSeededRandom(12345);
  const firstValues = Array.from({ length: 12 }, first);
  const secondValues = Array.from({ length: 12 }, second);
  assert.deepEqual(firstValues, secondValues);
  assert.ok(firstValues.every((value) => value >= 0 && value < 1));

  const scenario = KALMAN_SCENARIOS[0];
  assert.deepEqual(
    generateScenarioFrames(scenario, 9876),
    generateScenarioFrames(scenario, 9876),
  );
  assert.notDeepEqual(
    generateScenarioFrames(scenario, 9876).map((frame) => frame.observedCounts),
    generateScenarioFrames(scenario, 9877).map((frame) => frame.observedCounts),
  );
});

test("the dependency-free Poisson sampler handles high aggregate intensities", () => {
  assert.equal(samplePoisson(0, createSeededRandom(1)), 0);
  assert.throws(() => samplePoisson(-1, createSeededRandom(1)), /intensity/);

  const random = createSeededRandom(0x5053_4e31);
  const lambda = 1_142.31568;
  const samples = Array.from({ length: 2_000 }, () =>
    samplePoisson(lambda, random),
  );
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  assert.ok(Math.abs(mean - lambda) < 3, `mean ${mean} differs from ${lambda}`);
  assert.ok(samples.every(Number.isInteger));
  assert.ok(samples.every((value) => value >= 0));
});

test("scenario versions preserve exposure independently from simulation time", () => {
  const scenario = KALMAN_SCENARIOS[3];
  const frames = generateScenarioFrames(scenario);
  assert.equal(scenario.schemaVersion, 1);
  assert.equal(scenario.status, "PROVISIONAL");
  assert.equal(frames.length, 500);
  assert.equal(frames[0].exposureSeconds, 0.2);
  assert.equal(frames[1].simulationTimeSeconds, 0.2);
  assert.equal(frames[199].expectedSourceRateCountsPerSecond, 0);
  assert.ok(frames[202].expectedSourceRateCountsPerSecond > 0);
  assert.equal(frames.at(-1)?.expectedSourceRateCountsPerSecond, 13.3);
});

test("the weak GRB limitations preset is bounded and reproducible", () => {
  const scenario = KALMAN_SCENARIOS.find(({ id }) => id === "weak-grb-v1");
  assert.ok(scenario);
  const frames = generateScenarioFrames(scenario);
  assert.equal(frames[99].expectedSourceRateCountsPerSecond, 0);
  assert.equal(frames[100].expectedSourceRateCountsPerSecond, 202.5);
  assert.ok(frames[101].expectedSourceRateCountsPerSecond < 202.5);
  assert.equal(frames[120].expectedSourceRateCountsPerSecond, 0);
  assert.deepEqual(frames, generateScenarioFrames(scenario));
  const run = runKalmanScenario(scenario);
  assert.ok(run.metrics.sourceReferenceCounts > 0);
  assert.ok(Number.isFinite(run.metrics.sourceIntervalResidualCounts));
});

test("the synthetic bright presentation GRB produces a visible gated innovation", () => {
  const scenario = KALMAN_SCENARIOS.find(
    ({ id }) => id === "bright-grb-presentation-v1",
  );
  assert.ok(scenario);
  assert.equal(scenario.status, "PROVISIONAL");
  assert.equal(scenario.sourceRateCountsPerSecond * scenario.exposureSeconds, 135);
  const run = runKalmanScenario(scenario);
  assert.ok(run.metrics.gatedBinCount > 0);
  assert.ok(
    Math.max(...run.points.map((point) => Math.abs(point.normalizedInnovation))) >
      run.filter.gateSigma,
  );
  assert.ok(run.metrics.sourceReferenceCounts > 700);
  assert.ok(run.metrics.sourceIntervalResidualCounts > 0);
  assert.deepEqual(run, runKalmanScenario(scenario));
});

test("live frames use stable frame identities and explicit exposure", () => {
  const input = [
    {
      frameIndex: 41,
      simulationTimeSeconds: 20,
      exposureSeconds: 0.2,
      expectedBackgroundCounts: 100,
      expectedSourceCounts: 5,
    },
    {
      frameIndex: 42,
      simulationTimeSeconds: 120,
      exposureSeconds: 0.2,
      expectedBackgroundCounts: 120,
      expectedSourceCounts: 0,
    },
  ];
  const frames = createLiveReferenceFrames(input, 99);
  assert.deepEqual(frames, createLiveReferenceFrames(input, 99));
  assert.equal(frames[0].expectedBackgroundRateCountsPerSecond, 500);
  assert.equal(frames[0].expectedSourceRateCountsPerSecond, 25);
  assert.equal(frames[1].simulationTimeSeconds - frames[0].simulationTimeSeconds, 100);
  assert.equal(frames[1].exposureSeconds, 0.2);
  assert.throws(
    () => createLiveReferenceFrames([{ ...input[0], exposureSeconds: 0 }], 99),
    /exposure/,
  );
});

test("the aggregate filter gates a large innovation instead of absorbing it", () => {
  const frames: KalmanReferenceFrame[] = Array.from(
    { length: 30 },
    (_, frameIndex) => ({
      frameIndex,
      simulationTimeSeconds: frameIndex * 0.2,
      exposureSeconds: 0.2,
      expectedBackgroundRateCountsPerSecond: 500,
      expectedSourceRateCountsPerSecond: frameIndex === 15 ? 1_000 : 0,
      observedCounts: frameIndex === 15 ? 300 : 100,
    }),
  );
  const run = runAggregateBackgroundKalman(frames, {
    scenarioId: "test-outlier-v1",
    seed: 7,
  });
  assert.equal(run.analysisVersion, KALMAN_ANALYSIS_VERSION);
  assert.equal(run.label, KALMAN_DEMONSTRATOR_LABEL);
  assert.equal(run.points[15].gated, true);
  assert.equal(run.points[15].estimatedBackgroundRateCountsPerSecond, 500);
  assert.ok(run.points[15].sourceResidualRateCountsPerSecond >= 1_000);
  assert.ok(run.metrics.gatedBinCount >= 1);
});

test("scenario analysis exposes finite provisional metrics and covariance bands", () => {
  const scenario = KALMAN_SCENARIOS[0];
  const run = runKalmanScenario(scenario);
  assert.equal(run.scenarioId, scenario.id);
  assert.equal(run.filter, DEFAULT_KALMAN_FILTER_CONFIGURATION);
  assert.equal(run.points.length, 300);
  assert.ok(Number.isFinite(run.metrics.backgroundRmseCountsPerSecond));
  assert.ok(Number.isFinite(run.metrics.backgroundBiasCountsPerSecond));
  assert.ok(run.metrics.confidenceCoverage >= 0);
  assert.ok(run.metrics.confidenceCoverage <= 1);
  assert.equal(run.metrics.sourceReferenceCounts, 0);
  assert.equal(run.metrics.sourceIntervalResidualCounts, 0);
  assert.ok(
    run.points.every(
      (point) =>
        point.lowerBackgroundRateCountsPerSecond <=
        point.estimatedBackgroundRateCountsPerSecond,
    ),
  );
  assert.ok(
    run.points.every(
      (point) =>
        point.upperBackgroundRateCountsPerSecond >=
        point.estimatedBackgroundRateCountsPerSecond,
    ),
  );
});
