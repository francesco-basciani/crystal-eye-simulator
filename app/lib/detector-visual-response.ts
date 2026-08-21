const EARTH_ONLY_EPSILON_COUNTS = 1e-9;
const MINIMUM_VISIBLE_EARTH_IMPACT = 0.1;
const EARTH_VISUAL_IMPACT_SPAN = 0.16;

export type DetectorVisualResponse = Readonly<{
  impact: number;
  earthOnly: boolean;
  normalizedEarth: number;
}>;

export function getAbsoluteExcitationImpact(
  expectedCount: number,
  referenceCount: number,
): number {
  if (!Number.isFinite(expectedCount) || expectedCount < 0) {
    throw new RangeError("expectedCount must be finite and non-negative.");
  }
  if (!Number.isFinite(referenceCount) || referenceCount <= 0) {
    throw new RangeError("referenceCount must be finite and positive.");
  }
  return 1 - Math.exp(-expectedCount / referenceCount);
}

export function getDetectorVisualResponse(
  detectorImpact: number,
  excitationExpectedCount: number,
  earthExpectedCount: number,
  maximumEarthExpectedCount: number,
): DetectorVisualResponse {
  for (const [value, label] of [
    [detectorImpact, "detectorImpact"],
    [excitationExpectedCount, "excitationExpectedCount"],
    [earthExpectedCount, "earthExpectedCount"],
    [maximumEarthExpectedCount, "maximumEarthExpectedCount"],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${label} must be finite and non-negative.`);
    }
  }
  const normalizedEarth = maximumEarthExpectedCount > 0
    ? Math.min(1, earthExpectedCount / maximumEarthExpectedCount)
    : 0;
  const nonEarthExcitation = Math.max(
    0,
    excitationExpectedCount - earthExpectedCount,
  );
  const earthOnly = earthExpectedCount > 0 &&
    nonEarthExcitation <= EARTH_ONLY_EPSILON_COUNTS;
  return Object.freeze({
    impact: earthOnly
      ? MINIMUM_VISIBLE_EARTH_IMPACT +
        Math.sqrt(normalizedEarth) * EARTH_VISUAL_IMPACT_SPAN
      : Math.min(1, detectorImpact),
    earthOnly,
    normalizedEarth,
  });
}
