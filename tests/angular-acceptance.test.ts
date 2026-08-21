import assert from "node:assert/strict";
import test from "node:test";
import { getSmoothAngularAcceptance } from "../app/lib/angular-acceptance.ts";

test("angular acceptance is bounded monotonic and reaches zero continuously", () => {
  const halfAngleDeg = 65;
  const rolloffDeg = 10;
  const samples = Array.from(
    { length: 651 },
    (_, index) => getSmoothAngularAcceptance(
      index / 10,
      halfAngleDeg,
      rolloffDeg,
    ),
  );
  assert.equal(samples[0], 1);
  assert.equal(samples.at(-1), 0);
  assert.ok(samples.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(samples.every((value, index) => index === 0 || value <= samples[index - 1]));
  assert.ok(getSmoothAngularAcceptance(64.99, halfAngleDeg, rolloffDeg) < 1e-5);
});

test("edge rolloff preserves the cosine-squared interior", () => {
  const separationDeg = 30;
  const expected = Math.cos(separationDeg * Math.PI / 180) ** 2;
  assert.ok(Math.abs(
    getSmoothAngularAcceptance(separationDeg, 65, 10) - expected,
  ) < 1e-12);
});

test("angular acceptance fails closed on invalid parameters", () => {
  assert.throws(() => getSmoothAngularAcceptance(-1, 65, 10), RangeError);
  assert.throws(() => getSmoothAngularAcceptance(1, 0, 10), RangeError);
  assert.throws(() => getSmoothAngularAcceptance(1, 65, 0), RangeError);
  assert.throws(() => getSmoothAngularAcceptance(1, 65, 66), RangeError);
  assert.throws(() => getSmoothAngularAcceptance(Number.NaN, 65, 10), TypeError);
});
