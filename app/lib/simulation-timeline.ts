export const SIMULATION_START_OFFSET_SECONDS = 30 * 60;

export function getModeReplayStartMs(
  ephemerisStartMs: number,
  ephemerisEndMs: number,
  mode: "reference" | "simulation",
): number {
  if (
    !Number.isFinite(ephemerisStartMs) ||
    !Number.isFinite(ephemerisEndMs) ||
    ephemerisEndMs < ephemerisStartMs
  ) {
    throw new RangeError("Invalid ephemeris interval.");
  }
  const requested = mode === "simulation"
    ? ephemerisStartMs + SIMULATION_START_OFFSET_SECONDS * 1000
    : ephemerisStartMs;
  if (requested > ephemerisEndMs) {
    throw new RangeError("The simulation start offset exceeds the ephemeris interval.");
  }
  return requested;
}
