import assert from "node:assert/strict";
import test from "node:test";
import { mergeSkyLocalizationHistory, skyEventFromDetection } from "../app/lib/sky-localization-archive.ts";
import { createSkyLocalizationEvent } from "../app/lib/sky-localization.ts";
import type { BurstDetectionRecord } from "../app/lib/burst-event-repository.ts";

// Only the historical localization fields consumed by the adapter are populated.
function detection(eventKey = "old:1"): BurstDetectionRecord {
  return { eventKey, burstId: 1, simulatedDate: "2033-01-01T00:00:00.000Z",
    classification: "injected-source-reconstruction", truthStatus: "available",
    truthRaDeg: 359, truthDecDeg: 0, truthAngularErrorDeg: 123,
    reconstructedRaDeg: 1, reconstructedDecDeg: 0,
  } as BurstDetectionRecord;
}

test("historical fallback preserves centroid and never fabricates missing KS", () => {
  const event = skyEventFromDetection(detection());
  assert.equal(event.dataOrigin, "archived-detection");
  assert.equal(event.ks, null);
  assert.equal(event.ksErrorDeg, null);
  assert.deepEqual(event.centroid, {raDeg:1,decDeg:0});
  assert.ok(Math.abs(event.centroidErrorDeg! - 2) < 1e-10);
  assert.match(event.reason!, /not retained/);
});

test("telemetry has a direction but no injected truth or truth error", () => {
  const event = skyEventFromDetection({...detection(),classification:"telemetry-reconstruction",truthStatus:"unavailable"});
  assert.equal(event.truth,null);
  assert.equal(event.centroidErrorDeg,null);
});

test("pipeline snapshots win as a unit, without blending historical centroid; run IDs are distinct", () => {
  const snapshot = createSkyLocalizationEvent({eventKey:"new:1",burstId:1,simulatedDate:"2033-01-02T00:00:00.000Z",raDeg:10,decDeg:20,gridLabel:"Updated · KS 5°"});
  const events = mergeSkyLocalizationHistory([snapshot], [detection(),detection("new:1")]);
  assert.equal(events.length,2);
  assert.equal(events[0],snapshot);
  assert.equal(events[0].centroid,null);
  assert.equal(events[1].eventKey,"old:1");
});
