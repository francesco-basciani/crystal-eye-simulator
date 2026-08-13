export const SOURCE_CONDITIONED_KALMAN_VERSION =
  "ce-source-conditioned-scalar-offset-kf-v1";

export type AnalysisFrame = Readonly<{
  frameIndex: number;
  acquisitionTimeSeconds: number;
  exposureSeconds: number;
  configuredBackgroundCounts: number;
  observedCounts: number;
  knownInjectedSource: boolean;
  startedBurstIds: readonly number[];
}>;

export type ScalarOffsetKalmanState = Readonly<{
  offsetCountsPerBin: number;
  varianceCountsSquaredPerBin: number;
}>;

export type AnalysisPoint = AnalysisFrame & Readonly<{
  estimatedBackgroundCounts: number;
  backgroundStdCounts: number;
  lowerBackgroundCounts: number;
  upperBackgroundCounts: number;
  signedInnovationCounts: number;
  updateSkippedForKnownSource: boolean;
}>;

export type AnalysisRun = Readonly<{
  version: typeof SOURCE_CONDITIONED_KALMAN_VERSION;
  points: readonly AnalysisPoint[];
  finalState: ScalarOffsetKalmanState;
}>;

function requireCount(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
}

export function initializeScalarOffsetKalman(
  configuredBackgroundCounts: number,
): ScalarOffsetKalmanState {
  requireCount(configuredBackgroundCounts, "Configured background");
  return Object.freeze({
    offsetCountsPerBin: 0,
    varianceCountsSquaredPerBin: Math.max(configuredBackgroundCounts, Number.EPSILON),
  });
}

export function advanceScalarOffsetKalman(
  state: ScalarOffsetKalmanState,
  frame: AnalysisFrame,
): Readonly<{ point: AnalysisPoint; state: ScalarOffsetKalmanState }> {
  if (
    !Number.isFinite(state.offsetCountsPerBin) ||
    !Number.isFinite(state.varianceCountsSquaredPerBin) ||
    state.varianceCountsSquaredPerBin < 0
  ) {
    throw new RangeError("Kalman state must be finite with non-negative variance.");
  }
  requireCount(frame.configuredBackgroundCounts, "Configured background");
  requireCount(frame.observedCounts, "Observed counts");
  if (!Number.isFinite(frame.exposureSeconds) || frame.exposureSeconds <= 0) {
    throw new RangeError("Exposure must be finite and positive.");
  }
  const measurementVariance = Math.max(
    frame.configuredBackgroundCounts,
    Number.EPSILON,
  );
  const measuredOffset =
    frame.observedCounts - frame.configuredBackgroundCounts;
  const innovation = measuredOffset - state.offsetCountsPerBin;
  let nextState = state;
  if (!frame.knownInjectedSource) {
    const innovationVariance =
      state.varianceCountsSquaredPerBin + measurementVariance;
    const gain = state.varianceCountsSquaredPerBin / innovationVariance;
    nextState = Object.freeze({
      offsetCountsPerBin: state.offsetCountsPerBin + gain * innovation,
      varianceCountsSquaredPerBin:
        (1 - gain) * state.varianceCountsSquaredPerBin,
    });
  }
  const standardDeviation = Math.sqrt(
    Math.max(0, nextState.varianceCountsSquaredPerBin),
  );
  const estimatedBackground =
    frame.configuredBackgroundCounts + nextState.offsetCountsPerBin;
  return Object.freeze({
    state: nextState,
    point: Object.freeze({
      ...frame,
      estimatedBackgroundCounts: estimatedBackground,
      backgroundStdCounts: standardDeviation,
      lowerBackgroundCounts: estimatedBackground - standardDeviation,
      upperBackgroundCounts: estimatedBackground + standardDeviation,
      signedInnovationCounts: innovation,
      updateSkippedForKnownSource: frame.knownInjectedSource,
    }),
  });
}

export function runSourceConditionedKalman(
  frames: readonly AnalysisFrame[],
  initialState?: ScalarOffsetKalmanState,
): AnalysisRun {
  if (frames.length === 0 && !initialState) {
    throw new RangeError("Analysis requires a frame or an initial state.");
  }
  let state = initialState ??
    initializeScalarOffsetKalman(frames[0].configuredBackgroundCounts);
  const points: AnalysisPoint[] = [];
  for (const frame of frames) {
    const result = advanceScalarOffsetKalman(state, frame);
    state = result.state;
    points.push(result.point);
  }
  return Object.freeze({
    version: SOURCE_CONDITIONED_KALMAN_VERSION,
    points: Object.freeze(points),
    finalState: state,
  });
}

function normalizeSeed(seed: number) {
  const value = Math.trunc(seed) >>> 0;
  return value === 0 ? 0x6d2b_79f5 : value;
}

export function createObservationRandom(seed: number): () => number {
  let state = normalizeSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function sampleSmallPoisson(lambda: number, random: () => number) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

export function samplePoisson(lambda: number, random: () => number): number {
  requireCount(lambda, "Poisson intensity");
  if (lambda === 0) return 0;
  const chunkSize = 20;
  const chunks = Math.floor(lambda / chunkSize);
  const remainder = lambda - chunks * chunkSize;
  let sample = 0;
  for (let index = 0; index < chunks; index += 1) {
    sample += sampleSmallPoisson(chunkSize, random);
  }
  if (remainder > 0) sample += sampleSmallPoisson(remainder, random);
  return sample;
}
