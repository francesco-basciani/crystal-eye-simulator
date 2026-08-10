import assert from "node:assert/strict";
import test from "node:test";
import {
  DETECTOR_PIXEL_COUNT,
  createZeroDetectorFrame,
  resolveDetectorFrameVector,
} from "../app/lib/detector-frame.ts";

test("an absent transitional detector vector resolves to a complete zero frame", () => {
  const frame = resolveDetectorFrameVector(undefined, "test frame");
  assert.equal(frame.length, DETECTOR_PIXEL_COUNT);
  assert.ok(frame.every((value) => value === 0));
  assert.equal(createZeroDetectorFrame().length, DETECTOR_PIXEL_COUNT);
});

test("present malformed detector vectors fail loudly instead of hiding identity errors", () => {
  assert.throws(
    () => resolveDetectorFrameVector([0], "short frame"),
    /exactly 126/,
  );
  assert.throws(
    () =>
      resolveDetectorFrameVector(
        Array.from({ length: DETECTOR_PIXEL_COUNT }, (_, index) =>
          index === 12 ? Number.NaN : 0,
        ),
        "non-finite frame",
      ),
    /finite non-negative/,
  );
});
