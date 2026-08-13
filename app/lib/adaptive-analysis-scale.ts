export type AnalysisScaleInput = Readonly<{
  observedCounts: number;
  configuredBackgroundCounts: number;
  lowerBackgroundCounts: number;
  upperBackgroundCounts: number;
}>;

export type AnalysisScale = Readonly<{
  minimum: number;
  maximum: number;
  ticks: readonly number[];
}>;

/** Display-only scale. It never changes an observation or filter state. */
export function deriveAnalysisScale(
  points: readonly AnalysisScaleInput[],
): AnalysisScale {
  if (points.length === 0) {
    return Object.freeze({
      minimum: 0,
      maximum: 1,
      ticks: Object.freeze([1, 0.75, 0.5, 0.25, 0]),
    });
  }
  const values = points.flatMap((point) => [
    point.observedCounts,
    point.configuredBackgroundCounts,
    point.lowerBackgroundCounts,
    point.upperBackgroundCounts,
  ]);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("Analysis scale inputs must be finite.");
  }
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const center = (rawMaximum + rawMinimum) / 2;
  const span = Math.max(rawMaximum - rawMinimum, Math.abs(center) * 0.25, 10);
  const minimum = Math.min(rawMinimum, center - span * 0.58);
  const maximum = Math.max(rawMaximum, center + span * 0.58);
  return Object.freeze({
    minimum,
    maximum,
    ticks: Object.freeze(
      [0, 0.25, 0.5, 0.75, 1].map(
        (fraction) => maximum - fraction * (maximum - minimum),
      ),
    ),
  });
}
