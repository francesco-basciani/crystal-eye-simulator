import assert from "node:assert/strict";
import test from "node:test";
import {
  DETECTOR_PIXEL_COUNT,
  createZeroDetectorFrame,
  resolveDetectorFrameVector,
} from "../app/lib/detector-frame.ts";

test("the transitional frame and valid frame always contain 126 values", () => {
  assert.equal(createZeroDetectorFrame().length, DETECTOR_PIXEL_COUNT);
  assert.equal(resolveDetectorFrameVector(undefined, "frame").length, 126);
  assert.equal(resolveDetectorFrameVector(Array.from({ length: 126 }, () => 0), "frame").length, 126);
});

test("malformed excitation frames fail loudly", () => {
  assert.throws(() => resolveDetectorFrameVector([0], "short"), /exactly 126/);
  assert.throws(() => resolveDetectorFrameVector(
    Array.from({ length: 126 }, (_, index) => index === 10 ? Number.NaN : 0),
    "invalid",
  ), /finite non-negative/);
});
