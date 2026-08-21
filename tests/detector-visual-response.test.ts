import assert from "node:assert/strict";
import test from "node:test";
import {
  getAbsoluteExcitationImpact,
  getDetectorVisualResponse,
} from "../app/lib/detector-visual-response.ts";

test("absolute excitation impact preserves source amplitude across frames", () => {
  const referenceCount = 0.75;
  const samples = [0, 0.01, 0.1, 0.75, 3].map((expectedCount) =>
    getAbsoluteExcitationImpact(expectedCount, referenceCount)
  );
  assert.equal(samples[0], 0);
  assert.ok(samples.every((value) => value >= 0 && value < 1));
  assert.ok(samples.every((value, index) => index === 0 || value > samples[index - 1]));
});

test("absolute excitation impact fails closed on invalid scale inputs", () => {
  assert.throws(() => getAbsoluteExcitationImpact(-1, 0.75), RangeError);
  assert.throws(() => getAbsoluteExcitationImpact(1, 0), RangeError);
});

test("Earth-only counts produce a visible but slight crown response", () => {
  const weak = getDetectorVisualResponse(1, 0.02, 0.02, 0.08);
  const strongestEarthPixel = getDetectorVisualResponse(1, 0.08, 0.08, 0.08);
  assert.equal(weak.earthOnly, true);
  assert.ok(weak.impact >= 0.1 && weak.impact < strongestEarthPixel.impact);
  assert.ok(strongestEarthPixel.impact <= 0.26);
});

test("pixels without Earth albedo retain their normal visual response", () => {
  assert.deepEqual(
    getDetectorVisualResponse(0.72, 2, 0, 0),
    { impact: 0.72, earthOnly: false, normalizedEarth: 0 },
  );
});

test("Sun, Moon, or GRB excitation is not suppressed by simultaneous Earth albedo", () => {
  const response = getDetectorVisualResponse(0.91, 3, 0.04, 0.08);
  assert.equal(response.earthOnly, false);
  assert.equal(response.impact, 0.91);
  assert.equal(response.normalizedEarth, 0.5);
});

test("invalid visual response inputs fail closed", () => {
  assert.throws(() => getDetectorVisualResponse(0, -1, 0, 0), RangeError);
});
