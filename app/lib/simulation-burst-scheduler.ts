export const FIRST_SOLAR_OVERLAP_BURST_SECONDS = 2 * 60;
export const MINIMUM_SOLAR_RATE_COUNTS_PER_SECOND = 1;
export const MINIMUM_RANDOM_BURST_INTERVAL_SECONDS = 15 * 60;
export const RANDOM_BURST_INTERVAL_SPAN_SECONDS = 10 * 60;
export const MINIMUM_RANDOM_BURST_WALL_INTERVAL_MS = 15_000;

export type AutomaticBurstSchedule = Readonly<{
  firstSolarBurstInjected: boolean;
  nextMissionElapsedSeconds: number;
  notBeforeWallClockMs: number;
}>;

export function createAutomaticBurstSchedule(): AutomaticBurstSchedule {
  return Object.freeze({
    firstSolarBurstInjected: false,
    nextMissionElapsedSeconds: FIRST_SOLAR_OVERLAP_BURST_SECONDS,
    notBeforeWallClockMs: 0,
  });
}

export function shouldInjectAutomaticBurst({
  schedule,
  missionElapsedSeconds,
  wallClockMs,
  directSunRateCountsPerSecond,
  activeBurstCount,
}: {
  schedule: AutomaticBurstSchedule;
  missionElapsedSeconds: number;
  wallClockMs: number;
  directSunRateCountsPerSecond: number;
  activeBurstCount: number;
}): "solar-overlap" | "random" | null {
  if (activeBurstCount > 0) return null;
  if (!schedule.firstSolarBurstInjected) {
    return missionElapsedSeconds >= FIRST_SOLAR_OVERLAP_BURST_SECONDS &&
      directSunRateCountsPerSecond >= MINIMUM_SOLAR_RATE_COUNTS_PER_SECOND
      ? "solar-overlap"
      : null;
  }
  return missionElapsedSeconds >= schedule.nextMissionElapsedSeconds &&
    wallClockMs >= schedule.notBeforeWallClockMs
    ? "random"
    : null;
}

export function advanceAutomaticBurstSchedule(
  missionElapsedSeconds: number,
  wallClockMs: number,
  randomUnit: number,
): AutomaticBurstSchedule {
  if (!Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit >= 1) {
    throw new RangeError("Automatic burst randomUnit must be within [0, 1).");
  }
  return Object.freeze({
    firstSolarBurstInjected: true,
    nextMissionElapsedSeconds:
      missionElapsedSeconds +
      MINIMUM_RANDOM_BURST_INTERVAL_SECONDS +
      randomUnit * RANDOM_BURST_INTERVAL_SPAN_SECONDS,
    notBeforeWallClockMs:
      wallClockMs + MINIMUM_RANDOM_BURST_WALL_INTERVAL_MS,
  });
}

export function nextAutomaticBurstRandomState(state: number): Readonly<{
  state: number;
  value: number;
}> {
  if (!Number.isInteger(state)) {
    throw new RangeError("Automatic burst random state must be an integer.");
  }
  const next = (Math.imul(state >>> 0, 1_664_525) + 1_013_904_223) >>> 0;
  return Object.freeze({ state: next, value: next / 0x1_0000_0000 });
}
