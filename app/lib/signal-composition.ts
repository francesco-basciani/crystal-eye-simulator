export type SimulatorDataMode = "reference" | "simulation";

function requireCount(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
}

export function composeModeBackgroundCounts(
  mode: SimulatorDataMode,
  ritoCounts: number,
  sunCounts: number,
  moonCounts: number,
  earthCounts: number,
): number {
  [ritoCounts, sunCounts, moonCounts, earthCounts].forEach((value, index) =>
    requireCount(value, ["Rito", "Sun", "Moon", "Earth"][index]),
  );
  return (mode === "reference" ? ritoCounts : 0) + sunCounts + moonCounts + earthCounts;
}

/** Allocates a fixed aggregate; consumers use allocatedTotal from the actual JS sum. */
export function distributeSupportedTotal(
  total: number,
  weights: readonly number[],
): Readonly<{ values: readonly number[]; allocatedTotal: number; unsupportedTotal: number }> {
  requireCount(total, "Component total");
  const normalized = weights.map((weight) => Number.isFinite(weight) ? Math.max(0, weight) : 0);
  const weightSum = normalized.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) {
    return Object.freeze({ values: Object.freeze(normalized.map(() => 0)), allocatedTotal: 0, unsupportedTotal: 0 });
  }
  if (weightSum <= 0) {
    return Object.freeze({ values: Object.freeze(normalized.map(() => 0)), allocatedTotal: 0, unsupportedTotal: total });
  }
  const values = normalized.map((weight) => total * weight / weightSum);
  const allocatedTotal = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    values: Object.freeze(values),
    allocatedTotal,
    unsupportedTotal: Math.max(0, total - allocatedTotal),
  });
}

export function sumPixelComponents(...components: readonly (readonly number[])[]): readonly number[] {
  const length = components[0]?.length ?? 0;
  if (components.some((component) => component.length !== length)) {
    throw new RangeError("Pixel component arrays must have equal lengths.");
  }
  return Object.freeze(Array.from({ length }, (_, index) =>
    components.reduce((sum, component) => sum + component[index], 0),
  ));
}

export function composePixelSignalFrame({
  mode,
  rito,
  sun,
  moon,
  earth,
  source,
}: Readonly<{
  mode: SimulatorDataMode;
  rito: readonly number[];
  sun: readonly number[];
  moon: readonly number[];
  earth: readonly number[];
  source: readonly number[];
}>) {
  const pixelCount = rito.length;
  if ([sun, moon, earth, source].some((component) => component.length !== pixelCount)) {
    throw new RangeError("Pixel component arrays must have equal lengths.");
  }
  const modeRito = mode === "reference" ? Object.freeze([...rito]) : Object.freeze(rito.map(() => 0));
  const background = sumPixelComponents(modeRito, sun, moon, earth);
  const excitation = sumPixelComponents(sun, moon, earth, source);
  const expected = sumPixelComponents(background, source);
  const aggregateBackgroundCounts = background.reduce((sum, value) => sum + value, 0);
  const aggregateExpectedCounts = expected.reduce((sum, value) => sum + value, 0);
  const aggregateSourceCounts = aggregateExpectedCounts - aggregateBackgroundCounts;
  if (aggregateSourceCounts < 0) {
    throw new RangeError("Expected aggregate cannot be below background aggregate.");
  }
  return Object.freeze({
    components: Object.freeze({ rito: modeRito, sun, moon, earth, source }),
    background,
    source,
    expected,
    excitation,
    aggregateBackgroundCounts,
    aggregateSourceCounts,
    aggregateExpectedCounts,
    aggregateExcitationCounts: excitation.reduce((sum, value) => sum + value, 0),
  });
}
