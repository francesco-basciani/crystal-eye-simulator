import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_SOLAR_OVERLAP_BURST_SECONDS,
  MINIMUM_RANDOM_BURST_INTERVAL_SECONDS,
  MINIMUM_RANDOM_BURST_WALL_INTERVAL_MS,
  RANDOM_BURST_INTERVAL_SPAN_SECONDS,
  advanceAutomaticBurstSchedule,
  createAutomaticBurstSchedule,
  nextAutomaticBurstRandomState,
  shouldInjectAutomaticBurst,
} from "../app/lib/simulation-burst-scheduler.ts";

test("first automatic burst waits for both the initial minutes and direct Sun exposure", () => {
  const schedule = createAutomaticBurstSchedule();
  const evaluate = (missionElapsedSeconds: number, directSunRateCountsPerSecond: number) =>
    shouldInjectAutomaticBurst({
      schedule,
      missionElapsedSeconds,
      wallClockMs: 10_000,
      directSunRateCountsPerSecond,
      activeBurstCount: 0,
    });

  assert.equal(evaluate(FIRST_SOLAR_OVERLAP_BURST_SECONDS - 1, 100), null);
  assert.equal(evaluate(FIRST_SOLAR_OVERLAP_BURST_SECONDS, 0), null);
  assert.equal(
    evaluate(FIRST_SOLAR_OVERLAP_BURST_SECONDS, 100),
    "solar-overlap",
  );
});

test("later automatic bursts are sparse in mission time and wall-clock time", () => {
  const advanced = advanceAutomaticBurstSchedule(300, 20_000, 0.5);
  assert.equal(
    advanced.nextMissionElapsedSeconds,
    300 + MINIMUM_RANDOM_BURST_INTERVAL_SECONDS +
      RANDOM_BURST_INTERVAL_SPAN_SECONDS * 0.5,
  );
  assert.equal(
    advanced.notBeforeWallClockMs,
    20_000 + MINIMUM_RANDOM_BURST_WALL_INTERVAL_MS,
  );

  const evaluate = (missionElapsedSeconds: number, wallClockMs: number) =>
    shouldInjectAutomaticBurst({
      schedule: advanced,
      missionElapsedSeconds,
      wallClockMs,
      directSunRateCountsPerSecond: 0,
      activeBurstCount: 0,
    });
  assert.equal(evaluate(advanced.nextMissionElapsedSeconds - 1, 100_000), null);
  assert.equal(evaluate(advanced.nextMissionElapsedSeconds, advanced.notBeforeWallClockMs - 1), null);
  assert.equal(evaluate(advanced.nextMissionElapsedSeconds, advanced.notBeforeWallClockMs), "random");
});

test("an active burst suppresses all automatic injections", () => {
  const schedule = advanceAutomaticBurstSchedule(0, 0, 0);
  assert.equal(
    shouldInjectAutomaticBurst({
      schedule,
      missionElapsedSeconds: schedule.nextMissionElapsedSeconds + 1,
      wallClockMs: schedule.notBeforeWallClockMs + 1,
      directSunRateCountsPerSecond: 100,
      activeBurstCount: 1,
    }),
    null,
  );
});

test("automatic burst random sequence is reproducible", () => {
  const first = nextAutomaticBurstRandomState(0x1234_5678);
  const repeated = nextAutomaticBurstRandomState(0x1234_5678);
  assert.deepEqual(first, repeated);
  assert.ok(first.value >= 0 && first.value < 1);
  assert.throws(() => advanceAutomaticBurstSchedule(0, 0, 1), RangeError);
});
