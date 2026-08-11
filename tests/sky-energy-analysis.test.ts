import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNT_CUBE_SCHEMA_VERSION,
  LOCALIZATION_ALGORITHMS,
  allocateAggregateObservationByPixel,
  createCountCubeFrame,
  createIntegratedEnergyBands,
  createSyntheticEnergyBands,
  mapDetectorNormalsToIcrs,
  runSequentialResidualBaseline,
} from "../app/lib/sky-energy-analysis.ts";

const PIXELS = 126;
const vector = (value: number) => Array.from({ length: PIXELS }, () => value);
const normals = (normal: readonly [number, number, number]) =>
  Array.from({ length: PIXELS }, () => normal);

function angularDifference(actual: number, expected: number) {
  return Math.abs(((actual - expected + 540) % 360) - 180);
}

test("radial attitude maps detector +Y for all canonical scene axes, including antipodal", () => {
  const cases = [
    { boresight: [1, 0, 0], ra: 0, dec: 0 },
    { boresight: [-1, 0, 0], ra: 180, dec: 0 },
    { boresight: [0, 1, 0], ra: 0, dec: 90 },
    { boresight: [0, -1, 0], ra: 0, dec: -90 },
    { boresight: [0, 0, 1], ra: 90, dec: 0 },
    { boresight: [0, 0, -1], ra: 270, dec: 0 },
  ] as const;
  cases.forEach(({ boresight, ra, dec }) => {
    const result = mapDetectorNormalsToIcrs(normals([0, 1, 0]), boresight)[0];
    if (Math.abs(dec) < 89) assert.ok(angularDifference(result.raDeg, ra) < 1e-9);
    assert.ok(Math.abs(result.decDeg - dec) < 1e-9);
  });
  const asymmetric = mapDetectorNormalsToIcrs(
    normals([1, 2, 3]),
    [0, -1, 0],
  )[0];
  const expected = [-1, 3, -2] as const;
  const expectedLength = Math.hypot(...expected);
  assert.ok(angularDifference(
    asymmetric.raDeg,
    ((Math.atan2(expected[1], expected[0]) * 180 / Math.PI) + 360) % 360,
  ) < 1e-9);
  assert.ok(Math.abs(
    asymmetric.decDeg - Math.asin(expected[2] / expectedLength) * 180 / Math.PI,
  ) < 1e-9);
  const nearAntipodal = mapDetectorNormalsToIcrs(
    normals([1, 2, 3]),
    [0, -1, 1e-5],
  )[0];
  assert.ok(angularDifference(nearAntipodal.raDeg, asymmetric.raDeg) < 1e-9);
  assert.ok(Math.abs(nearAntipodal.decDeg - asymmetric.decDeg) < 1e-9);
});

test("CountCube v1 preserves 126 pixels and integrated existing counts", () => {
  const frame = createCountCubeFrame({
    frameIndex: 7,
    acquisitionTimeSeconds: 1.4,
    simulatedAt: "2033-01-01T00:00:00.000Z",
    exposureSeconds: 0.2,
    observedByPixel: vector(3),
    expectedBackgroundByPixel: vector(1),
    sourceExpectedByPixel: vector(0.5),
    detectorNormals: normals([0, 1, 0]),
    sceneRadialBoresight: [1, 0, 0],
    observationProvenance: "reference-deterministic-proportional-derived-allocation",
  });
  assert.equal(frame.schemaVersion, COUNT_CUBE_SCHEMA_VERSION);
  assert.equal(frame.pixels.length, PIXELS);
  assert.equal(frame.bands.length, 1);
  assert.deepEqual(frame.pixels[0][0], {
    observedCounts: 3,
    expectedBackgroundCounts: 1,
    sourceExpectedCounts: 0.5,
  });
});

test("six-band synthetic partition is configurable, normalized and non-calibrated", () => {
  const bands = createSyntheticEnergyBands([1, 2, 3, 4, 5, 6]);
  assert.equal(bands.length, 6);
  assert.equal(bands.reduce((sum, band) => sum + band.fraction, 0), 1);
  assert.ok(bands.every((band) => band.kind === "synthetic-partition" && band.calibrated === false));
  assert.throws(() => createSyntheticEnergyBands([1, 2]), /exactly six/);
  const frame = createCountCubeFrame({
    frameIndex: 1,
    acquisitionTimeSeconds: 0.2,
    simulatedAt: "2033-01-01T00:00:00.000Z",
    exposureSeconds: 0.2,
    observedByPixel: vector(1),
    expectedBackgroundByPixel: vector(1),
    sourceExpectedByPixel: vector(1),
    detectorNormals: normals([0, 1, 0]),
    sceneRadialBoresight: [1, 0, 0],
    bands: createSyntheticEnergyBands(),
    observationProvenance: "reference-deterministic-proportional-derived-allocation",
  });
  assert.equal(frame.pixels[0].reduce((sum, cell) => sum + cell.observedCounts, 0), 1);
});

test("sequential residual baseline uses environmental input and parameter-free Welford state", () => {
  const makeFrame = (frameIndex: number, observed: number, environment: number) => createCountCubeFrame({
    frameIndex,
    acquisitionTimeSeconds: frameIndex * 0.2,
    simulatedAt: "2033-01-01T00:00:00.000Z",
    exposureSeconds: 0.2,
    observedByPixel: vector(observed),
    expectedBackgroundByPixel: vector(environment),
    sourceExpectedByPixel: vector(0),
    detectorNormals: normals([0, 1, 0]),
    sceneRadialBoresight: [1, 0, 0],
    bands: createIntegratedEnergyBands(),
    observationProvenance: "reference-deterministic-proportional-derived-allocation",
  });
  const result = runSequentialResidualBaseline([
    makeFrame(0, 5, 1),
    makeFrame(1, 8, 2),
  ]);
  assert.equal(result.length, PIXELS);
  assert.equal(result[0].correctedCounts, 6);
  assert.equal(result[0].residualCounts, 2);
  assert.equal(result[0].cumulativeMeanCorrectedCounts, 5);
  assert.ok(Math.abs(result[0].sampleStdCorrectedCounts - Math.SQRT2) < 1e-12);
});

test("localization interfaces expose only the approved non-operative stubs", () => {
  assert.deepEqual(LOCALIZATION_ALGORITHMS.map(({ id }) => id), [
    "template-ks",
    "cnn",
    "statistical-sky-estimator",
  ]);
  assert.ok(LOCALIZATION_ALGORITHMS.every(({ operative }) => operative === false));
});

test("approved live adapters preserve the aggregate and distinguish provenance", () => {
  const weights = Array.from({ length: PIXELS }, (_, index) => index + 1);
  const reference = allocateAggregateObservationByPixel({
    mode: "reference",
    aggregateObservedCounts: 17.25,
    expectedByPixel: weights,
    seed: 9,
    frameIndex: 12,
  });
  assert.equal(reference.values.reduce((sum, value) => sum + value, 0), 17.25);
  assert.equal(reference.provenance, "reference-deterministic-proportional-derived-allocation");

  let fuzzState = 0x5eed_1260;
  const random = () => {
    fuzzState ^= fuzzState << 13;
    fuzzState ^= fuzzState >>> 17;
    fuzzState ^= fuzzState << 5;
    return (fuzzState >>> 0) / 0x1_0000_0000;
  };
  for (let fixture = 0; fixture < 1_000; fixture += 1) {
    const fuzzWeights = Array.from(
      { length: PIXELS },
      () => random() < 0.1 ? 0 : random() * 100,
    );
    const aggregate = random() * 2_000;
    const allocation = allocateAggregateObservationByPixel({
      mode: "reference",
      aggregateObservedCounts: aggregate,
      expectedByPixel: fuzzWeights,
      seed: 1,
      frameIndex: fixture,
    });
    assert.equal(allocation.values.reduce((sum, value) => sum + value, 0), aggregate);
    assert.ok(allocation.values.every((value) => value >= 0));
  }

  const first = allocateAggregateObservationByPixel({
    mode: "simulation",
    aggregateObservedCounts: 713,
    expectedByPixel: weights,
    seed: 0x4345_1000,
    frameIndex: 12,
  });
  const replay = allocateAggregateObservationByPixel({
    mode: "simulation",
    aggregateObservedCounts: 713,
    expectedByPixel: weights,
    seed: 0x4345_1000,
    frameIndex: 12,
  });
  assert.deepEqual(first, replay);
  assert.equal(first.values.reduce((sum, value) => sum + value, 0), 713);
  assert.ok(first.values.every(Number.isSafeInteger));
  assert.equal(first.provenance, "simulation-seeded-conditional-multinomial-derived-allocation");
});

test("live adapters fail closed without support and preserve a zero aggregate", () => {
  const zeroWeights = vector(0);
  assert.throws(() => allocateAggregateObservationByPixel({
    mode: "simulation",
    aggregateObservedCounts: 1,
    expectedByPixel: zeroWeights,
    seed: 1,
    frameIndex: 0,
  }), /positive pixel support/i);
  const zero = allocateAggregateObservationByPixel({
    mode: "reference",
    aggregateObservedCounts: 0,
    expectedByPixel: zeroWeights,
    seed: 1,
    frameIndex: 0,
  });
  assert.deepEqual(zero.values, zeroWeights);
});
