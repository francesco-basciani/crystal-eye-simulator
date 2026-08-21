import assert from "node:assert/strict";
import test from "node:test";
import {
  SIMULATION_START_OFFSET_SECONDS,
  getModeReplayStartMs,
} from "../app/lib/simulation-timeline.ts";

test("Simulation Mode starts exactly 30 minutes after the ECI origin", () => {
  const start = Date.parse("2033-01-01T00:00:00Z");
  const end = Date.parse("2033-03-01T00:00:00Z");
  assert.equal(SIMULATION_START_OFFSET_SECONDS, 1800);
  assert.equal(getModeReplayStartMs(start, end, "simulation"), start + 1_800_000);
});

test("Reference Replay remains at the canonical ECI origin", () => {
  const start = 1_000;
  assert.equal(getModeReplayStartMs(start, 3_000_000, "reference"), start);
});

test("timeline offsets fail closed outside a valid ephemeris interval", () => {
  assert.throws(() => getModeReplayStartMs(10, 5, "simulation"), /Invalid/);
  assert.throws(() => getModeReplayStartMs(0, 100, "simulation"), /exceeds/);
});
