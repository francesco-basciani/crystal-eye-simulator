import assert from "node:assert/strict";
import test from "node:test";
import { SKY_REFERENCE_EVENT } from "../app/lib/sky-localization-examples.ts";

test("supplied reference has no fabricated reconstruction or event-specific errors", () => {
  assert.equal(SKY_REFERENCE_EVENT.dataOrigin, "reference");
  assert.equal(SKY_REFERENCE_EVENT.ks, null);
  assert.equal(SKY_REFERENCE_EVENT.centroid, null);
  assert.equal(SKY_REFERENCE_EVENT.ksErrorDeg, null);
  assert.equal(SKY_REFERENCE_EVENT.centroidErrorDeg, null);
  assert.ok(Math.abs(SKY_REFERENCE_EVENT.truth!.raDeg - 197.45) < 1e-10);
  assert.equal(SKY_REFERENCE_EVENT.truth!.decDeg, -23.38);
  assert.equal(SKY_REFERENCE_EVENT.referenceOverlay, "rito-gbm-bayestar");
  assert.match(SKY_REFERENCE_EVENT.reason!, /not a simulated burst/);
});
