import assert from "node:assert/strict";
import test from "node:test";
import {
  composeModeBackgroundCounts,
  composePixelSignalFrame,
  distributeSupportedTotal,
} from "../app/lib/signal-composition.ts";

test("option B includes Rito only in Reference while environment remains visible", () => {
  assert.equal(composeModeBackgroundCounts("reference", 100, 2, 3, 4), 109);
  assert.equal(composeModeBackgroundCounts("simulation", 100, 2, 3, 4), 9);
});

test("reported allocations reconcile exactly to their actual JS vector sum", () => {
  for (let fixture = 1; fixture <= 2_000; fixture += 1) {
    const weights = Array.from({ length: 126 }, (_, index) =>
      ((fixture * 1103515245 + index * 12345) >>> 0) / 0x1_0000_0000,
    );
    const allocation = distributeSupportedTotal(fixture / 17, weights);
    assert.ok(Object.is(
      allocation.allocatedTotal,
      allocation.values.reduce((sum, value) => sum + value, 0),
    ));
  }
});

test("composed expected aggregate is authoritative in both modes", () => {
  for (const mode of ["reference", "simulation"] as const) {
    for (let fixture = 1; fixture <= 10_000; fixture += 1) {
      const component = (salt: number) => Array.from({ length: 126 }, (_, index) =>
        (((fixture * (1103515245 + salt) + index * (12345 + salt)) >>> 0) /
          0x1_0000_0000) * (salt + 1),
      );
      const frame = composePixelSignalFrame({
        mode,
        rito: component(1),
        sun: component(2),
        moon: component(3),
        earth: component(4),
        source: component(5),
      });
      assert.ok(Object.is(
        frame.aggregateExpectedCounts,
        frame.expected.reduce((sum, value) => sum + value, 0),
      ));
      assert.ok(Object.is(
        frame.aggregateBackgroundCounts + frame.aggregateSourceCounts,
        frame.aggregateExpectedCounts,
      ));
    }
  }
});

test("Rito is blue baseline only while visible sources form excitation", () => {
  const common = {
    rito: [10, 20, 30],
    sun: [1, 0, 0],
    moon: [0, 2, 0],
    earth: [0, 0, 3],
    source: [4, 0, 0],
  } as const;
  const reference = composePixelSignalFrame({ mode: "reference", ...common });
  const simulation = composePixelSignalFrame({ mode: "simulation", ...common });
  assert.deepEqual(reference.background, [11, 22, 33]);
  assert.deepEqual(simulation.background, [1, 2, 3]);
  assert.deepEqual(reference.excitation, [5, 2, 3]);
  assert.deepEqual(simulation.excitation, reference.excitation);
  assert.ok(Object.is(
    reference.aggregateBackgroundCounts,
    reference.background.reduce((sum, value) => sum + value, 0),
  ));
  assert.ok(Object.is(
    reference.aggregateSourceCounts,
    reference.source.reduce((sum, value) => sum + value, 0),
  ));

  const baselineOnly = composePixelSignalFrame({
    mode: "reference",
    rito: [10, 20],
    sun: [0, 0],
    moon: [0, 0],
    earth: [0, 0],
    source: [0, 0],
  });
  assert.deepEqual(baselineOnly.excitation, [0, 0]);
});
