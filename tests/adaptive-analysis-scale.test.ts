import assert from "node:assert/strict";
import test from "node:test";
import { deriveAnalysisScale } from "../app/lib/adaptive-analysis-scale.ts";

test("empty analysis history has finite placeholder ticks", () => {
  const scale = deriveAnalysisScale([]);
  assert.ok(Number.isFinite(scale.minimum));
  assert.ok(Number.isFinite(scale.maximum));
  assert.ok(scale.ticks.every(Number.isFinite));
  assert.deepEqual(scale, {
    minimum: 0,
    maximum: 1,
    ticks: [1, 0.75, 0.5, 0.25, 0],
  });
});

test("analysis scale preserves every observation and uncertainty bound", () => {
  const points = [{
    observedCounts: 1275,
    configuredBackgroundCounts: 1142,
    lowerBackgroundCounts: 1110,
    upperBackgroundCounts: 1174,
  }];
  const scale = deriveAnalysisScale(points);
  assert.ok(scale.minimum <= 1110);
  assert.ok(scale.maximum >= 1275);
  assert.ok(scale.ticks.every(Number.isFinite));
});
