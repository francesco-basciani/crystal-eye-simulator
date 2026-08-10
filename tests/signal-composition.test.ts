import assert from "node:assert/strict";
import test from "node:test";
import {
  composeModeBackgroundRate,
  composePixelSignalFrame,
  distributeNormalizedTotal,
  selectModeReferencePixelCounts,
  sumPixelComponents,
} from "../app/lib/signal-composition.ts";

const environment = {
  sunRateCountsPerSecond: 260,
  moonRateCountsPerSecond: 11,
  earthRateCountsPerSecond: 70,
};

test("Reference Mode includes Rito while Simulation Mode excludes it", () => {
  assert.equal(
    composeModeBackgroundRate("reference", 5711.5784, environment),
    6052.5784,
  );
  assert.equal(composeModeBackgroundRate("simulation", null, environment), 341);
  assert.equal(
    composeModeBackgroundRate("simulation", 9_999_999, environment),
    341,
  );
});

test("Simulation pixel baseline is identically zero and independent of Rito", () => {
  assert.deepEqual(
    selectModeReferencePixelCounts("simulation", [10, 20, 30], 3),
    [0, 0, 0],
  );
  assert.deepEqual(
    selectModeReferencePixelCounts("simulation", null, 3),
    [0, 0, 0],
  );
  assert.deepEqual(
    selectModeReferencePixelCounts("reference", [10, 20, 30], 3),
    [10, 20, 30],
  );
});

test("directional allocations are non-negative and preserve component totals", () => {
  const sun = distributeNormalizedTotal(52, [0, 1, 3, -2]);
  const moon = distributeNormalizedTotal(2.2, [4, 1, 0, 0]);
  const earth = distributeNormalizedTotal(14, [0.2, 0, 0.8, 0]);
  const source = distributeNormalizedTotal(135, [1, 0.5, 0.25, 0]);

  for (const [component, total] of [
    [sun, 52],
    [moon, 2.2],
    [earth, 14],
    [source, 135],
  ] as const) {
    assert.ok(component.every((value) => value >= 0));
    assert.ok(
      Math.abs(component.reduce((sum, value) => sum + value, 0) - total) <
        1e-12,
    );
  }

  const background = sumPixelComponents(sun, moon, earth);
  const expected = sumPixelComponents(background, source);
  assert.ok(
    Math.abs(background.reduce((sum, value) => sum + value, 0) - 68.2) <
      1e-12,
  );
  assert.ok(
    Math.abs(expected.reduce((sum, value) => sum + value, 0) - 203.2) <
      1e-12,
  );
});

test("pixel frame totals reconcile and Simulation ignores supplied Rito pixels", () => {
  const common = {
    pixelCount: 3,
    ritoExpectedCountsPerBin: [100, 200, 300],
    sunExpectedCountsPerBin: [2, 3, 5],
    moonExpectedCountsPerBin: [0, 1, 1],
    earthExpectedCountsPerBin: [4, 0, 3],
    sourceExpectedCountsPerBin: [9, 6, 0],
  } as const;
  const simulation = composePixelSignalFrame({ mode: "simulation", ...common });
  const reference = composePixelSignalFrame({ mode: "reference", ...common });

  assert.deepEqual(simulation.components.rito, [0, 0, 0]);
  assert.equal(simulation.background.reduce((sum, value) => sum + value, 0), 19);
  assert.equal(simulation.source.reduce((sum, value) => sum + value, 0), 15);
  assert.equal(simulation.expected.reduce((sum, value) => sum + value, 0), 34);
  assert.equal(reference.background.reduce((sum, value) => sum + value, 0), 619);
  assert.equal(reference.expected.reduce((sum, value) => sum + value, 0), 634);
});

test("allocation fails closed for invalid totals, dimensions, and support", () => {
  assert.deepEqual(distributeNormalizedTotal(0, [0, 0]), [0, 0]);
  assert.throws(() => distributeNormalizedTotal(1, [0, 0]), /positive pixel weight/);
  assert.throws(() => distributeNormalizedTotal(-1, [1]), /non-negative/);
  assert.throws(() => sumPixelComponents([1], [1, 2]), /equal lengths/);
  assert.throws(
    () => selectModeReferencePixelCounts("reference", null, 3),
    /requires one Rito count/,
  );
});
