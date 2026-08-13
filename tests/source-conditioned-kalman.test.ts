import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceScalarOffsetKalman,
  createObservationRandom,
  initializeScalarOffsetKalman,
  runSourceConditionedKalman,
  samplePoisson,
  type AnalysisFrame,
} from "../app/lib/source-conditioned-kalman.ts";

function frame(
  frameIndex: number,
  observedCounts: number,
  knownInjectedSource = false,
): AnalysisFrame {
  return {
    frameIndex,
    acquisitionTimeSeconds: frameIndex * 0.2,
    exposureSeconds: 0.2,
    configuredBackgroundCounts: 100,
    observedCounts,
    knownInjectedSource,
    startedBurstIds: [],
  };
}

test("seeded Poisson observations replay exactly and use an independent RNG", () => {
  const first = createObservationRandom(0x4345_2001);
  const replay = createObservationRandom(0x4345_2001);
  const samples = Array.from({ length: 30 }, () => samplePoisson(1142.3, first));
  assert.deepEqual(
    samples,
    Array.from({ length: 30 }, () => samplePoisson(1142.3, replay)),
  );
  assert.ok(samples.every(Number.isSafeInteger));
  assert.throws(() => samplePoisson(-1, first), /non-negative/);
});

test("seeded Poisson ensemble mean stays within the predeclared sanity tolerance", () => {
  const intensity = 25;
  const sampleCount = 20_000;
  const meanToleranceCounts = 0.2;
  const random = createObservationRandom(0x4345_2002);
  const mean = Array.from(
    { length: sampleCount },
    () => samplePoisson(intensity, random),
  ).reduce((sum, sample) => sum + sample, 0) / sampleCount;
  assert.ok(
    Math.abs(mean - intensity) <= meanToleranceCounts,
    `mean ${mean} differs from ${intensity} by more than ${meanToleranceCounts}`,
  );
});

test("scalar offset filter uses the approved counts-per-bin initialization", () => {
  assert.deepEqual(initializeScalarOffsetKalman(100), {
    offsetCountsPerBin: 0,
    varianceCountsSquaredPerBin: 100,
  });
  const advanced = advanceScalarOffsetKalman(
    initializeScalarOffsetKalman(100),
    frame(0, 110),
  );
  assert.equal(advanced.state.offsetCountsPerBin, 5);
  assert.equal(advanced.state.varianceCountsSquaredPerBin, 50);
  assert.equal(advanced.point.signedInnovationCounts, 10);
});

test("streaming and replay are exactly equivalent", () => {
  const frames = [frame(0, 102), frame(1, 97), frame(2, 150, true), frame(3, 103)];
  const replay = runSourceConditionedKalman(frames);
  let state = initializeScalarOffsetKalman(100);
  const points = [];
  for (const item of frames) {
    const next = advanceScalarOffsetKalman(state, item);
    state = next.state;
    points.push(next.point);
  }
  assert.deepEqual(replay.points, points);
  assert.deepEqual(replay.finalState, state);
});

test("varying configured background is tracked exactly when observation equals background", () => {
  const configuredBackgrounds = [100, 80, 125, 95];
  const frames = configuredBackgrounds.map((configuredBackgroundCounts, index) => ({
    ...frame(index, configuredBackgroundCounts),
    configuredBackgroundCounts,
  }));
  const run = runSourceConditionedKalman(frames);
  assert.deepEqual(
    run.points.map((point) => point.estimatedBackgroundCounts),
    configuredBackgrounds,
  );
  assert.deepEqual(
    run.points.map((point) => point.signedInnovationCounts),
    [0, 0, 0, 0],
  );
  assert.equal(run.finalState.offsetCountsPerBin, 0);
});

test("reported estimate is the exact configured background plus offset", () => {
  const first = advanceScalarOffsetKalman(
    initializeScalarOffsetKalman(100),
    { ...frame(0, 0), configuredBackgroundCounts: 100 },
  );
  const second = advanceScalarOffsetKalman(
    first.state,
    { ...frame(1, 0), configuredBackgroundCounts: 10 },
  );
  assert.equal(
    second.point.estimatedBackgroundCounts,
    10 + second.state.offsetCountsPerBin,
  );
});

test("known injected onset and tail bins never update the background state", () => {
  const initial = runSourceConditionedKalman([frame(0, 100)]).finalState;
  const tail = runSourceConditionedKalman(
    [frame(1, 180, true), frame(2, 145, true), frame(3, 120, true)],
    initial,
  );
  assert.deepEqual(tail.finalState, initial);
  assert.ok(tail.points.every((point) => point.updateSkippedForKnownSource));
  assert.deepEqual(tail.points.map((point) => point.signedInnovationCounts), [80, 45, 20]);
});

test("masked source amplitude cannot create a post-source background tail", () => {
  const initial = runSourceConditionedKalman([frame(0, 100)]).finalState;
  const nominalSource = [frame(1, 180, true), frame(2, 145, true), frame(3, 120, true)];
  const tenfoldSource = nominalSource.map((item) => ({
    ...item,
    observedCounts: 100 + (item.observedCounts - 100) * 10,
  }));
  const nominalMasked = runSourceConditionedKalman(nominalSource, initial);
  const tenfoldMasked = runSourceConditionedKalman(tenfoldSource, initial);
  assert.deepEqual(nominalMasked.finalState, tenfoldMasked.finalState);
  assert.deepEqual(nominalMasked.finalState, initial);

  const nominalPostSource = runSourceConditionedKalman(
    [frame(4, 100), frame(5, 100)],
    nominalMasked.finalState,
  );
  const tenfoldPostSource = runSourceConditionedKalman(
    [frame(4, 100), frame(5, 100)],
    tenfoldMasked.finalState,
  );
  assert.deepEqual(nominalPostSource, tenfoldPostSource);
  assert.deepEqual(
    nominalPostSource.points.map((point) => ({
      estimate: point.estimatedBackgroundCounts,
      innovation: point.signedInnovationCounts,
    })),
    [
      { estimate: 100, innovation: 0 },
      { estimate: 100, innovation: 0 },
    ],
  );
});

test("filter fails closed on invalid carried state", () => {
  assert.throws(() => advanceScalarOffsetKalman({
    offsetCountsPerBin: Number.NaN,
    varianceCountsSquaredPerBin: 1,
  }, frame(0, 100)), /Kalman state/);
  assert.throws(() => runSourceConditionedKalman([frame(0, 100)], {
    offsetCountsPerBin: 0,
    varianceCountsSquaredPerBin: -1,
  }), /Kalman state/);
});
