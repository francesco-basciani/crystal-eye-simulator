export type SimulatorDataMode = "reference" | "simulation";

export type EnvironmentalRates = Readonly<{
  sunRateCountsPerSecond: number;
  moonRateCountsPerSecond: number;
  earthRateCountsPerSecond: number;
}>;

function requireNonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
  return value;
}

/**
 * Selects the aggregate background data contract without changing any
 * component amplitude. Reference Mode retains the supplied Rito reference;
 * Simulation Mode is environment-only and therefore independent of Rito.
 */
export function composeModeBackgroundRate(
  mode: SimulatorDataMode,
  ritoRateCountsPerSecond: number | null,
  environment: EnvironmentalRates,
): number {
  const sun = requireNonNegativeFinite(
    environment.sunRateCountsPerSecond,
    "Sun rate",
  );
  const moon = requireNonNegativeFinite(
    environment.moonRateCountsPerSecond,
    "Moon rate",
  );
  const earth = requireNonNegativeFinite(
    environment.earthRateCountsPerSecond,
    "Earth rate",
  );
  const rito =
    mode === "reference"
      ? requireNonNegativeFinite(
          ritoRateCountsPerSecond ?? Number.NaN,
          "Rito reference rate",
        )
      : 0;
  return rito + sun + moon + earth;
}

export function selectModeReferencePixelCounts(
  mode: SimulatorDataMode,
  ritoExpectedCountsPerBin: readonly number[] | null,
  pixelCount: number,
): readonly number[] {
  if (!Number.isInteger(pixelCount) || pixelCount < 0) {
    throw new RangeError("Pixel count must be a non-negative integer.");
  }
  if (mode === "simulation") {
    return Object.freeze(Array.from({ length: pixelCount }, () => 0));
  }
  if (!ritoExpectedCountsPerBin || ritoExpectedCountsPerBin.length !== pixelCount) {
    throw new RangeError("Reference Mode requires one Rito count for every pixel.");
  }
  return Object.freeze(
    ritoExpectedCountsPerBin.map((counts) =>
      requireNonNegativeFinite(counts, "Rito pixel count"),
    ),
  );
}

/**
 * Distributes an already-defined component total using non-negative relative
 * weights. The correction on the largest-weight bin removes floating-point
 * summation residue; it does not alter the aggregate model amplitude.
 */
export function distributeNormalizedTotal(
  total: number,
  weights: readonly number[],
): readonly number[] {
  requireNonNegativeFinite(total, "Component total");
  const normalizedWeights = weights.map((weight) =>
    Number.isFinite(weight) ? Math.max(0, weight) : 0,
  );
  if (total === 0) return Object.freeze(normalizedWeights.map(() => 0));

  const weightSum = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) {
    throw new RangeError("A positive component total requires a positive pixel weight.");
  }

  const allocated = normalizedWeights.map((weight) => (total * weight) / weightSum);
  const correction = total - allocated.reduce((sum, value) => sum + value, 0);
  let correctionIndex = 0;
  for (let index = 1; index < normalizedWeights.length; index += 1) {
    if (normalizedWeights[index] > normalizedWeights[correctionIndex]) {
      correctionIndex = index;
    }
  }
  allocated[correctionIndex] += correction;
  return Object.freeze(allocated);
}

export function sumPixelComponents(
  ...components: readonly (readonly number[])[]
): readonly number[] {
  const length = components[0]?.length ?? 0;
  if (components.some((component) => component.length !== length)) {
    throw new RangeError("Pixel component arrays must have equal lengths.");
  }
  return Object.freeze(
    Array.from({ length }, (_, index) =>
      components.reduce((sum, component) => sum + component[index], 0),
    ),
  );
}

export function composePixelSignalFrame({
  mode,
  pixelCount,
  ritoExpectedCountsPerBin,
  sunExpectedCountsPerBin,
  moonExpectedCountsPerBin,
  earthExpectedCountsPerBin,
  sourceExpectedCountsPerBin,
}: Readonly<{
  mode: SimulatorDataMode;
  pixelCount: number;
  ritoExpectedCountsPerBin: readonly number[] | null;
  sunExpectedCountsPerBin: readonly number[];
  moonExpectedCountsPerBin: readonly number[];
  earthExpectedCountsPerBin: readonly number[];
  sourceExpectedCountsPerBin: readonly number[];
}>) {
  const rito = selectModeReferencePixelCounts(
    mode,
    ritoExpectedCountsPerBin,
    pixelCount,
  );
  const background = sumPixelComponents(
    rito,
    sunExpectedCountsPerBin,
    moonExpectedCountsPerBin,
    earthExpectedCountsPerBin,
  );
  const expected = sumPixelComponents(background, sourceExpectedCountsPerBin);
  return Object.freeze({
    components: Object.freeze({
      rito,
      sun: sunExpectedCountsPerBin,
      moon: moonExpectedCountsPerBin,
      earth: earthExpectedCountsPerBin,
      source: sourceExpectedCountsPerBin,
    }),
    background,
    source: sourceExpectedCountsPerBin,
    expected,
  });
}
