export const KALMAN_ANALYSIS_VERSION = "ce-aggregate-background-kf-v1";
export const KALMAN_SCENARIO_SCHEMA_VERSION = 1;
export const KALMAN_DEMONSTRATOR_LABEL =
  "Synthetic engineering demonstrator — physical calibration pending.";

export type KalmanScenarioId =
  | "quiet-background-v1"
  | "bright-grb-presentation-v1"
  | "weak-grb-v1"
  | "crab-emergence-15px-v1";

export type KalmanSourceProfile =
  | "none"
  | "smooth-step"
  | "fast-rise-exponential-decay";

export type KalmanScenarioSpec = Readonly<{
  schemaVersion: 1;
  id: KalmanScenarioId;
  title: string;
  description: string;
  status: "PROVISIONAL";
  exposureSeconds: number;
  simulationStepSeconds: number;
  durationSeconds: number;
  seed: number;
  baselineRateCountsPerSecond: number;
  backgroundDriftRateCountsPerSecondSquared: number;
  sourceRateCountsPerSecond: number;
  sourceStartSeconds: number | null;
  sourceRiseSeconds: number;
  sourceDurationSeconds: number | null;
  sourceDecaySeconds: number;
  sourceProfile: KalmanSourceProfile;
  provenance: string;
}>;

export type KalmanReferenceFrame = Readonly<{
  frameIndex: number;
  simulationTimeSeconds: number;
  exposureSeconds: number;
  expectedBackgroundRateCountsPerSecond: number;
  expectedSourceRateCountsPerSecond: number;
  observedCounts: number;
  activeBurstCount?: number;
  startedBurstIds?: readonly string[];
}>;

export type KalmanFilterConfiguration = Readonly<{
  analysisVersion: typeof KALMAN_ANALYSIS_VERSION;
  gateSigma: number;
  accelerationNoiseStdCountsPerSecondSquared: number;
  confidenceZ: number;
  minimumRateCountsPerSecond: number;
}>;

export type KalmanAnalysisPoint = KalmanReferenceFrame &
  Readonly<{
    observedRateCountsPerSecond: number;
    predictedBackgroundRateCountsPerSecond: number;
    estimatedBackgroundRateCountsPerSecond: number;
    estimatedDriftRateCountsPerSecondSquared: number;
    backgroundStdCountsPerSecond: number;
    lowerBackgroundRateCountsPerSecond: number;
    upperBackgroundRateCountsPerSecond: number;
    signedResidualRateCountsPerSecond: number;
    normalizedInnovation: number;
    gated: boolean;
  }>;

export type KalmanAnalysisMetrics = Readonly<{
  backgroundRmseCountsPerSecond: number;
  backgroundBiasCountsPerSecond: number;
  confidenceCoverage: number;
  gatedBinCount: number;
  totalBinCount: number;
  sourceIntervalResidualCounts: number;
  sourceReferenceCounts: number;
}>;

export type KalmanFilterState = Readonly<{
  backgroundRateCountsPerSecond: number;
  driftRateCountsPerSecondSquared: number;
  covariance00: number;
  covariance01: number;
  covariance10: number;
  covariance11: number;
  previousSimulationTimeSeconds: number;
}>;

export type KalmanAnalysisRun = Readonly<{
  analysisVersion: typeof KALMAN_ANALYSIS_VERSION;
  scenarioId: string;
  scenarioSchemaVersion: number;
  seed: number;
  status: "PROVISIONAL";
  label: typeof KALMAN_DEMONSTRATOR_LABEL;
  filter: KalmanFilterConfiguration;
  points: readonly KalmanAnalysisPoint[];
  metrics: KalmanAnalysisMetrics;
  finalState: KalmanFilterState;
}>;

export const DEFAULT_KALMAN_FILTER_CONFIGURATION: KalmanFilterConfiguration =
  Object.freeze({
    analysisVersion: KALMAN_ANALYSIS_VERSION,
    gateSigma: 4,
    accelerationNoiseStdCountsPerSecondSquared: 0.35,
    confidenceZ: 1.96,
    minimumRateCountsPerSecond: 1,
  });

export const KALMAN_SCENARIOS: readonly KalmanScenarioSpec[] = Object.freeze([
  Object.freeze({
    schemaVersion: KALMAN_SCENARIO_SCHEMA_VERSION,
    id: "quiet-background-v1",
    title: "Quiet aggregate background",
    description:
      "Seeded Poisson observations around the current 126-pixel pixbkg aggregate.",
    status: "PROVISIONAL",
    exposureSeconds: 0.2,
    simulationStepSeconds: 0.2,
    durationSeconds: 60,
    seed: 0x4345_0001,
    baselineRateCountsPerSecond: 5711.5784,
    backgroundDriftRateCountsPerSecondSquared: 0,
    sourceRateCountsPerSecond: 0,
    sourceStartSeconds: null,
    sourceRiseSeconds: 0,
    sourceDurationSeconds: null,
    sourceDecaySeconds: 0,
    sourceProfile: "none",
    provenance: "pixbkg aggregate; CE-SIM-20260802-pixbkg-integration",
  }),
  Object.freeze({
    schemaVersion: KALMAN_SCENARIO_SCHEMA_VERSION,
    id: "bright-grb-presentation-v1",
    title: "Bright GRB · presentation case",
    description:
      "Presentation display: the current simulator's synthetic 100% test amplitude over seeded aggregate count noise.",
    status: "PROVISIONAL",
    exposureSeconds: 0.2,
    simulationStepSeconds: 0.2,
    durationSeconds: 60,
    seed: 0x4345_0004,
    baselineRateCountsPerSecond: 5711.5784,
    backgroundDriftRateCountsPerSecondSquared: 0.04,
    sourceRateCountsPerSecond: 675,
    sourceStartSeconds: 20,
    sourceRiseSeconds: 0,
    sourceDurationSeconds: 4,
    sourceDecaySeconds: 1.1,
    sourceProfile: "fast-rise-exponential-decay",
    provenance:
      "current simulator 135 counts/0.2 s peak at 100% configured test amplitude and 5.5-tick decay; synthetic presentation parameter, all physical semantics provisional",
  }),
  Object.freeze({
    schemaVersion: KALMAN_SCENARIO_SCHEMA_VERSION,
    id: "weak-grb-v1",
    title: "Weak GRB over aggregate background",
    description:
      "Limitation case: a 30%-of-current-test-amplitude FRED transient over seeded aggregate count noise.",
    status: "PROVISIONAL",
    exposureSeconds: 0.2,
    simulationStepSeconds: 0.2,
    durationSeconds: 60,
    seed: 0x4345_0003,
    baselineRateCountsPerSecond: 5711.5784,
    backgroundDriftRateCountsPerSecondSquared: 0.04,
    sourceRateCountsPerSecond: 202.5,
    sourceStartSeconds: 20,
    sourceRiseSeconds: 0,
    sourceDurationSeconds: 4,
    sourceDecaySeconds: 1.1,
    sourceProfile: "fast-rise-exponential-decay",
    provenance:
      "pixbkg aggregate plus 30% of current simulator 135 counts/0.2 s peak and 5.5-tick decay; all physical semantics provisional",
  }),
  Object.freeze({
    schemaVersion: KALMAN_SCENARIO_SCHEMA_VERSION,
    id: "crab-emergence-15px-v1",
    title: "Crab emergence · 15-pixel subset",
    description:
      "PRIN-informed synthetic Earth-limb emergence with a bounded smooth visibility transition.",
    status: "PROVISIONAL",
    exposureSeconds: 0.2,
    simulationStepSeconds: 0.2,
    durationSeconds: 100,
    seed: 0x4345_0002,
    baselineRateCountsPerSecond: 496,
    backgroundDriftRateCountsPerSecondSquared: 0.025,
    sourceRateCountsPerSecond: 13.3,
    sourceStartSeconds: 40,
    sourceRiseSeconds: 1,
    sourceDurationSeconds: null,
    sourceDecaySeconds: 0,
    sourceProfile: "smooth-step",
    provenance: "PRIN facsimile pp. 14–15; domain validation pending",
  }),
]);

function normalizeSeed(seed: number): number {
  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? 0x6d2b_79f5 : normalized;
}

export function createSeededRandom(seed: number): () => number {
  let state = normalizeSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function mixSeed(seed: number, streamIndex: number): number {
  let value = normalizeSeed(seed) ^ Math.imul(streamIndex + 1, 0x9e37_79b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return normalizeSeed(value);
}

function sampleSmallPoisson(lambda: number, random: () => number): number {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

export function samplePoisson(
  lambda: number,
  random: () => number,
): number {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new RangeError("Poisson intensity must be finite and non-negative.");
  }
  if (lambda === 0) return 0;

  // Poisson variables are additive. Splitting large intensities into bounded
  // independent terms keeps Knuth's exact sampler away from exp(-lambda)
  // underflow while retaining a dependency-free, deterministic generator.
  const maximumChunk = 20;
  const fullChunks = Math.floor(lambda / maximumChunk);
  const remainder = lambda - fullChunks * maximumChunk;
  let sample = 0;
  for (let index = 0; index < fullChunks; index += 1) {
    sample += sampleSmallPoisson(maximumChunk, random);
  }
  if (remainder > 0) sample += sampleSmallPoisson(remainder, random);
  return sample;
}

function sourceVisibility(
  timeSeconds: number,
  scenario: KalmanScenarioSpec,
): number {
  const startSeconds = scenario.sourceStartSeconds;
  if (startSeconds === null) return 0;
  if (scenario.sourceProfile === "none" || timeSeconds < startSeconds) return 0;
  if (scenario.sourceProfile === "fast-rise-exponential-decay") {
    const ageSeconds = timeSeconds - startSeconds;
    if (
      scenario.sourceDurationSeconds !== null &&
      ageSeconds >= scenario.sourceDurationSeconds
    ) {
      return 0;
    }
    const rise =
      scenario.sourceRiseSeconds <= 0
        ? 1
        : Math.min(1, ageSeconds / scenario.sourceRiseSeconds);
    return rise * Math.exp(-ageSeconds / scenario.sourceDecaySeconds);
  }
  const riseSeconds = scenario.sourceRiseSeconds;
  if (riseSeconds <= 0) return 1;
  const normalized = Math.max(
    0,
    Math.min(1, (timeSeconds - startSeconds) / riseSeconds),
  );
  return normalized * normalized * (3 - 2 * normalized);
}

export function generateScenarioFrames(
  scenario: KalmanScenarioSpec,
  seed = scenario.seed,
): readonly KalmanReferenceFrame[] {
  if (
    scenario.exposureSeconds <= 0 ||
    scenario.simulationStepSeconds <= 0 ||
    scenario.durationSeconds <= 0 ||
    (scenario.sourceProfile === "fast-rise-exponential-decay" &&
      scenario.sourceDecaySeconds <= 0)
  ) {
    throw new RangeError("Scenario times must be positive.");
  }
  const frameCount = Math.floor(
    scenario.durationSeconds / scenario.simulationStepSeconds,
  );
  return Object.freeze(
    Array.from({ length: frameCount }, (_, frameIndex) => {
      const simulationTimeSeconds =
        frameIndex * scenario.simulationStepSeconds;
      const expectedBackgroundRateCountsPerSecond = Math.max(
        0,
        scenario.baselineRateCountsPerSecond +
          scenario.backgroundDriftRateCountsPerSecondSquared *
            simulationTimeSeconds,
      );
      const expectedSourceRateCountsPerSecond =
        scenario.sourceRateCountsPerSecond *
        sourceVisibility(simulationTimeSeconds, scenario);
      const expectedCounts =
        (expectedBackgroundRateCountsPerSecond +
          expectedSourceRateCountsPerSecond) *
        scenario.exposureSeconds;
      const random = createSeededRandom(mixSeed(seed, frameIndex));
      return Object.freeze({
        frameIndex,
        simulationTimeSeconds,
        exposureSeconds: scenario.exposureSeconds,
        expectedBackgroundRateCountsPerSecond,
        expectedSourceRateCountsPerSecond,
        observedCounts: samplePoisson(expectedCounts, random),
      });
    }),
  );
}

export function createLiveReferenceFrames(
  samples: readonly Readonly<{
    frameIndex: number;
    simulationTimeSeconds: number;
    exposureSeconds: number;
    expectedBackgroundCounts: number;
    expectedSourceCounts: number;
  }>[],
  seed: number,
): readonly KalmanReferenceFrame[] {
  return Object.freeze(
    samples.map((sample) => {
      if (sample.exposureSeconds <= 0) {
        throw new RangeError("Live exposure must be positive.");
      }
      const expectedCounts = Math.max(
        0,
        sample.expectedBackgroundCounts + sample.expectedSourceCounts,
      );
      const random = createSeededRandom(mixSeed(seed, sample.frameIndex));
      return Object.freeze({
        frameIndex: sample.frameIndex,
        simulationTimeSeconds: sample.simulationTimeSeconds,
        exposureSeconds: sample.exposureSeconds,
        expectedBackgroundRateCountsPerSecond:
          sample.expectedBackgroundCounts / sample.exposureSeconds,
        expectedSourceRateCountsPerSecond:
          sample.expectedSourceCounts / sample.exposureSeconds,
        observedCounts: samplePoisson(expectedCounts, random),
      });
    }),
  );
}

export function runAggregateBackgroundKalman(
  frames: readonly KalmanReferenceFrame[],
  options: Readonly<{
    scenarioId: string;
    scenarioSchemaVersion?: number;
    seed: number;
    filter?: KalmanFilterConfiguration;
    initialState?: KalmanFilterState;
  }>,
): KalmanAnalysisRun {
  if (frames.length === 0) {
    throw new RangeError("Kalman analysis requires at least one frame.");
  }
  const filter = options.filter ?? DEFAULT_KALMAN_FILTER_CONFIGURATION;
  const first = frames[0];
  const suppliedState = options.initialState;
  let backgroundRate = suppliedState?.backgroundRateCountsPerSecond ??
    first.observedCounts / first.exposureSeconds;
  let driftRate = suppliedState?.driftRateCountsPerSecondSquared ?? 0;
  const initialMeasurementVariance = Math.max(
    filter.minimumRateCountsPerSecond,
    backgroundRate,
  ) / first.exposureSeconds;
  let p00 = suppliedState?.covariance00 ?? initialMeasurementVariance;
  let p01 = suppliedState?.covariance01 ?? 0;
  let p10 = suppliedState?.covariance10 ?? 0;
  let p11 = suppliedState?.covariance11 ?? initialMeasurementVariance / (60 * 60);
  let previousSimulationTime = suppliedState?.previousSimulationTimeSeconds ??
    first.simulationTimeSeconds;

  const points: KalmanAnalysisPoint[] = [];
  for (const frame of frames) {
    const dt = Math.max(
      0,
      frame.simulationTimeSeconds - previousSimulationTime,
    );
    previousSimulationTime = frame.simulationTimeSeconds;

    const predictedBackgroundRate = Math.max(
      filter.minimumRateCountsPerSecond,
      backgroundRate + driftRate * dt,
    );
    const predictedDriftRate = driftRate;
    const accelerationVariance =
      filter.accelerationNoiseStdCountsPerSecondSquared ** 2;
    const q00 = accelerationVariance * (dt ** 4 / 4);
    const q01 = accelerationVariance * (dt ** 3 / 2);
    const q11 = accelerationVariance * dt ** 2;
    const predictedP00 =
      p00 + dt * (p01 + p10) + dt * dt * p11 + q00;
    const predictedP01 = p01 + dt * p11 + q01;
    const predictedP10 = p10 + dt * p11 + q01;
    const predictedP11 = p11 + q11;

    const observedRate = frame.observedCounts / frame.exposureSeconds;
    const measurementVariance =
      predictedBackgroundRate / frame.exposureSeconds;
    const innovation = observedRate - predictedBackgroundRate;
    const innovationVariance = Math.max(
      Number.EPSILON,
      predictedP00 + measurementVariance,
    );
    const normalizedInnovation = innovation / Math.sqrt(innovationVariance);
    const gated = Math.abs(normalizedInnovation) > filter.gateSigma;

    if (gated) {
      backgroundRate = predictedBackgroundRate;
      driftRate = predictedDriftRate;
      p00 = predictedP00;
      p01 = predictedP01;
      p10 = predictedP10;
      p11 = predictedP11;
    } else {
      const gain0 = predictedP00 / innovationVariance;
      const gain1 = predictedP10 / innovationVariance;
      backgroundRate = Math.max(
        filter.minimumRateCountsPerSecond,
        predictedBackgroundRate + gain0 * innovation,
      );
      driftRate = predictedDriftRate + gain1 * innovation;
      p00 = Math.max(0, (1 - gain0) * predictedP00);
      p01 = (1 - gain0) * predictedP01;
      p10 = predictedP10 - gain1 * predictedP00;
      p11 = Math.max(0, predictedP11 - gain1 * predictedP01);
      const symmetricCrossCovariance = (p01 + p10) / 2;
      p01 = symmetricCrossCovariance;
      p10 = symmetricCrossCovariance;
    }

    const backgroundStd = Math.sqrt(Math.max(0, p00));
    points.push(
      Object.freeze({
        ...frame,
        observedRateCountsPerSecond: observedRate,
        predictedBackgroundRateCountsPerSecond: predictedBackgroundRate,
        estimatedBackgroundRateCountsPerSecond: backgroundRate,
        estimatedDriftRateCountsPerSecondSquared: driftRate,
        backgroundStdCountsPerSecond: backgroundStd,
        lowerBackgroundRateCountsPerSecond: Math.max(
          0,
          backgroundRate - filter.confidenceZ * backgroundStd,
        ),
        upperBackgroundRateCountsPerSecond:
          backgroundRate + filter.confidenceZ * backgroundStd,
        signedResidualRateCountsPerSecond:
          observedRate - predictedBackgroundRate,
        normalizedInnovation,
        gated,
      }),
    );
  }

  const errors = points.map(
    (point) =>
      point.estimatedBackgroundRateCountsPerSecond -
      point.expectedBackgroundRateCountsPerSecond,
  );
  const confidenceHits = points.filter(
    (point) =>
      point.expectedBackgroundRateCountsPerSecond >=
        point.lowerBackgroundRateCountsPerSecond &&
      point.expectedBackgroundRateCountsPerSecond <=
        point.upperBackgroundRateCountsPerSecond,
  ).length;
  const metrics = Object.freeze({
    backgroundRmseCountsPerSecond: Math.sqrt(
      errors.reduce((sum, error) => sum + error * error, 0) / errors.length,
    ),
    backgroundBiasCountsPerSecond:
      errors.reduce((sum, error) => sum + error, 0) / errors.length,
    confidenceCoverage: confidenceHits / points.length,
    gatedBinCount: points.filter((point) => point.gated).length,
    totalBinCount: points.length,
    sourceIntervalResidualCounts: points.reduce(
      (sum, point) =>
        point.expectedSourceRateCountsPerSecond > 0
          ? sum +
            (point.observedRateCountsPerSecond -
              point.predictedBackgroundRateCountsPerSecond) *
              point.exposureSeconds
          : sum,
      0,
    ),
    sourceReferenceCounts: points.reduce(
      (sum, point) =>
        sum +
        point.expectedSourceRateCountsPerSecond * point.exposureSeconds,
      0,
    ),
  });

  return Object.freeze({
    analysisVersion: KALMAN_ANALYSIS_VERSION,
    scenarioId: options.scenarioId,
    scenarioSchemaVersion:
      options.scenarioSchemaVersion ?? KALMAN_SCENARIO_SCHEMA_VERSION,
    seed: normalizeSeed(options.seed),
    status: "PROVISIONAL",
    label: KALMAN_DEMONSTRATOR_LABEL,
    filter,
    points: Object.freeze(points),
    metrics,
    finalState: Object.freeze({
      backgroundRateCountsPerSecond: backgroundRate,
      driftRateCountsPerSecondSquared: driftRate,
      covariance00: p00,
      covariance01: p01,
      covariance10: p10,
      covariance11: p11,
      previousSimulationTimeSeconds: previousSimulationTime,
    }),
  });
}

export function runKalmanScenario(
  scenario: KalmanScenarioSpec,
  seed = scenario.seed,
  filter = DEFAULT_KALMAN_FILTER_CONFIGURATION,
): KalmanAnalysisRun {
  return runAggregateBackgroundKalman(generateScenarioFrames(scenario, seed), {
    scenarioId: scenario.id,
    scenarioSchemaVersion: scenario.schemaVersion,
    seed,
    filter,
  });
}
