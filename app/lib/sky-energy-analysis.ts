export const COUNT_CUBE_SCHEMA_VERSION = 1 as const;
export const COUNT_CUBE_PIXEL_COUNT = 126 as const;
export const SKY_ENERGY_ANALYSIS_VERSION = "ce-sky-energy-bookkeeping-v1";
export const INTEGRATED_BAND_ID = "integrated-existing-counts";

export type EnergyBand = Readonly<{
  id: string;
  label: string;
  kind: "integrated" | "synthetic-partition";
  fraction: number;
  calibrated: false;
}>;

export type CountCubeCell = Readonly<{
  observedCounts: number;
  expectedBackgroundCounts: number;
  sourceExpectedCounts: number;
}>;

export type PixelIcrsDirection = Readonly<{
  pixelId: number;
  raDeg: number;
  decDeg: number;
}>;

export type CountCubeFrameV1 = Readonly<{
  schemaVersion: typeof COUNT_CUBE_SCHEMA_VERSION;
  frameIndex: number;
  acquisitionTimeSeconds: number;
  simulatedAt: string;
  exposureSeconds: number;
  bands: readonly EnergyBand[];
  pixels: readonly (readonly CountCubeCell[])[];
  pixelDirectionsIcrs: readonly PixelIcrsDirection[];
  observationProvenance:
    | "simulation-seeded-conditional-multinomial-derived-allocation"
    | "reference-deterministic-proportional-derived-allocation";
}>;

export type SequentialResidualPoint = Readonly<{
  pixelId: number;
  bandId: string;
  sampleCount: number;
  correctedCounts: number;
  residualCounts: number;
  cumulativeMeanCorrectedCounts: number;
  sampleStdCorrectedCounts: number;
}>;

export type LocalizationInput = Readonly<{
  frame: CountCubeFrameV1;
  residuals: readonly SequentialResidualPoint[];
}>;

export type LocalizationResult = Readonly<{
  status: "not-operative";
  algorithmId: string;
  message: string;
}>;

export interface LocalizationAlgorithm {
  readonly id: string;
  readonly operative: boolean;
  localize(input: LocalizationInput): LocalizationResult;
}

class FutureLocalizationStub implements LocalizationAlgorithm {
  readonly operative = false;
  readonly id: string;
  constructor(id: string) { this.id = id; }
  localize(): LocalizationResult {
    return Object.freeze({
      status: "not-operative",
      algorithmId: this.id,
      message: "Future algorithm stub — no localization result is produced.",
    });
  }
}

export const LOCALIZATION_ALGORITHMS: readonly LocalizationAlgorithm[] =
  Object.freeze([
    new FutureLocalizationStub("template-ks"),
    new FutureLocalizationStub("cnn"),
    new FutureLocalizationStub("statistical-sky-estimator"),
  ]);

function requireFiniteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
  return value;
}

function requirePixelVector(values: readonly number[], label: string) {
  if (values.length !== COUNT_CUBE_PIXEL_COUNT) {
    throw new RangeError(`${label} must contain exactly ${COUNT_CUBE_PIXEL_COUNT} values.`);
  }
  values.forEach((value) => requireFiniteNonNegative(value, label));
}

function normalizedSeed(seed: number) {
  const value = Math.trunc(seed) >>> 0;
  return value === 0 ? 0x6d2b_79f5 : value;
}

function allocationRandom(seed: number, frameIndex: number) {
  let state = normalizedSeed(seed ^ Math.imul(frameIndex + 1, 0x9e37_79b1));
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function allocateAggregateObservationByPixel({
  mode,
  aggregateObservedCounts,
  expectedByPixel,
  seed,
  frameIndex,
}: Readonly<{
  mode: "reference" | "simulation";
  aggregateObservedCounts: number;
  expectedByPixel: readonly number[];
  seed: number;
  frameIndex: number;
}>): Readonly<{
  values: readonly number[];
  provenance: CountCubeFrameV1["observationProvenance"];
}> {
  requirePixelVector(expectedByPixel, "Expected pixel allocation weights");
  requireFiniteNonNegative(aggregateObservedCounts, "Aggregate observed counts");
  const expectedTotal = expectedByPixel.reduce((sum, value) => sum + value, 0);
  if (aggregateObservedCounts > 0 && expectedTotal <= 0) {
    throw new RangeError("Positive aggregate observations require positive pixel support.");
  }
  if (aggregateObservedCounts === 0) {
    return Object.freeze({
      values: Object.freeze(expectedByPixel.map(() => 0)),
      provenance: mode === "simulation"
        ? "simulation-seeded-conditional-multinomial-derived-allocation"
        : "reference-deterministic-proportional-derived-allocation",
    });
  }
  if (mode === "reference") {
    const values = expectedByPixel.map((weight) =>
      aggregateObservedCounts * weight / expectedTotal,
    );
    // Reconcile at the last supported pixel so the ordinary left-to-right
    // reduction used by consumers terminates at the supplied aggregate. Pixels
    // after this index have zero support and therefore remain exactly zero.
    const correctionIndex = expectedByPixel.findLastIndex((weight) => weight > 0);
    const prefix = values
      .slice(0, correctionIndex)
      .reduce((sum, value) => sum + value, 0);
    values[correctionIndex] = aggregateObservedCounts - prefix;
    values.fill(0, correctionIndex + 1);
    return Object.freeze({
      values: Object.freeze(values),
      provenance: "reference-deterministic-proportional-derived-allocation",
    });
  }
  if (!Number.isSafeInteger(aggregateObservedCounts)) {
    throw new RangeError("Simulation aggregate observations must be safe integers.");
  }
  const cumulative: number[] = [];
  expectedByPixel.reduce((sum, weight, index) => {
    cumulative[index] = sum + weight / expectedTotal;
    return cumulative[index];
  }, 0);
  cumulative[cumulative.length - 1] = 1;
  const random = allocationRandom(seed, frameIndex);
  const values = expectedByPixel.map(() => 0);
  for (let count = 0; count < aggregateObservedCounts; count += 1) {
    const draw = random();
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (draw < cumulative[middle]) high = middle;
      else low = middle + 1;
    }
    values[low] += 1;
  }
  return Object.freeze({
    values: Object.freeze(values),
    provenance: "simulation-seeded-conditional-multinomial-derived-allocation",
  });
}

function partitionExact(total: number, bands: readonly EnergyBand[]) {
  const values = bands.map((band) => total * band.fraction);
  values[values.length - 1] = total - values.slice(0, -1).reduce((sum, value) => sum + value, 0);
  return values;
}

function validateEnergyBands(bands: readonly EnergyBand[]) {
  const fractionSum = bands.reduce((sum, band) => sum + band.fraction, 0);
  const bandIds = new Set<string>();
  bands.forEach((band) => {
    requireFiniteNonNegative(band.fraction, `Energy-band fraction ${band.id}`);
    if (!band.id.trim() || !band.label.trim() || band.calibrated !== false) {
      throw new RangeError("Energy bands require non-empty metadata and calibrated=false.");
    }
    if (band.kind !== "integrated" && band.kind !== "synthetic-partition") {
      throw new RangeError(`Unsupported energy-band kind for ${band.id}.`);
    }
    if (bandIds.has(band.id)) throw new RangeError(`Duplicate energy-band id ${band.id}.`);
    bandIds.add(band.id);
  });
  if (bands.length === 0 || Math.abs(fractionSum - 1) > 1e-10) {
    throw new RangeError("Energy-band fractions must sum to one.");
  }
}

export function createIntegratedEnergyBands(): readonly EnergyBand[] {
  return Object.freeze([
    Object.freeze({
      id: INTEGRATED_BAND_ID,
      label: "Integrated existing counts",
      kind: "integrated" as const,
      fraction: 1,
      calibrated: false as const,
    }),
  ]);
}

export function createSyntheticEnergyBands(
  fractions: readonly number[] = Array.from({ length: 6 }, () => 1 / 6),
): readonly EnergyBand[] {
  if (fractions.length !== 6) {
    throw new RangeError("Synthetic visualization requires exactly six fractions.");
  }
  fractions.forEach((fraction) => requireFiniteNonNegative(fraction, "Band fraction"));
  const sum = fractions.reduce((total, fraction) => total + fraction, 0);
  if (sum <= 0) throw new RangeError("Synthetic band fractions must have a positive sum.");
  const normalizedFractions = fractions.map((fraction) => fraction / sum);
  normalizedFractions[normalizedFractions.length - 1] =
    1 - normalizedFractions.slice(0, -1).reduce((total, fraction) => total + fraction, 0);
  if (normalizedFractions.at(-1)! < 0) {
    throw new RangeError("Synthetic band fractions cannot be represented as a non-negative normalized partition.");
  }
  return Object.freeze(
    normalizedFractions.map((fraction, index) =>
      Object.freeze({
        id: `synthetic-band-${index + 1}`,
        label: `Synthetic band ${index + 1}`,
        kind: "synthetic-partition" as const,
        fraction,
        calibrated: false as const,
      }),
    ),
  );
}

type Vector3 = readonly [number, number, number];

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError("Attitude vectors must be finite and non-zero.");
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Current radial-attitude convention, matching the 3D viewer:
 * detector +Y is rotated onto the geocentric radial/boresight direction by
 * the shortest arc; the remaining roll is the deterministic minimum-rotation
 * convention. Scene axes map to ICRS-like ECI axes as [X,Y,Z]=[x,z,y], where
 * +X is RA 0°, +Y is RA 90°, and +Z is Dec +90°. This is an engineering
 * convention, not measured spacecraft attitude.
 */
export function mapDetectorNormalsToIcrs(
  detectorNormals: readonly Vector3[],
  sceneRadialBoresight: Vector3,
): readonly PixelIcrsDirection[] {
  if (detectorNormals.length !== COUNT_CUBE_PIXEL_COUNT) {
    throw new RangeError(`Detector normals must contain ${COUNT_CUBE_PIXEL_COUNT} vectors.`);
  }
  const from: Vector3 = [0, 1, 0];
  const to = normalize(sceneRadialBoresight);
  const axis = cross(from, to);
  const axisLengthSquared = dot(axis, axis);
  const cosine = Math.max(-1, Math.min(1, dot(from, to)));
  return Object.freeze(detectorNormals.map((rawNormal, pixelId) => {
    const normal = normalize(rawNormal);
    // Match Three.js Quaternion.setFromUnitVectors: its antipodal fallback is
    // selected when dot(from, to) + 1 < 1e-8.
    const rotated: Vector3 = cosine < -1 + 1e-8
      ? [-normal[0], -normal[1], normal[2]]
      : axisLengthSquared <= Number.EPSILON
      ? normal
      : (() => {
          const axisCrossNormal = cross(axis, normal);
          const scale = dot(axis, normal) * (1 - cosine) / axisLengthSquared;
          return [
            normal[0] * cosine + axisCrossNormal[0] + axis[0] * scale,
            normal[1] * cosine + axisCrossNormal[1] + axis[1] * scale,
            normal[2] * cosine + axisCrossNormal[2] + axis[2] * scale,
          ];
        })();
    const icrs = normalize([rotated[0], rotated[2], rotated[1]]);
    return Object.freeze({
      pixelId,
      raDeg: ((Math.atan2(icrs[1], icrs[0]) * 180 / Math.PI) + 360) % 360,
      decDeg: Math.asin(Math.max(-1, Math.min(1, icrs[2]))) * 180 / Math.PI,
    });
  }));
}

export function createCountCubeFrame({
  frameIndex,
  acquisitionTimeSeconds,
  simulatedAt,
  exposureSeconds,
  observedByPixel,
  expectedBackgroundByPixel,
  sourceExpectedByPixel,
  detectorNormals,
  sceneRadialBoresight,
  bands = createIntegratedEnergyBands(),
  observationProvenance,
}: Readonly<{
  frameIndex: number;
  acquisitionTimeSeconds: number;
  simulatedAt: string;
  exposureSeconds: number;
  observedByPixel: readonly number[];
  expectedBackgroundByPixel: readonly number[];
  sourceExpectedByPixel: readonly number[];
  detectorNormals: readonly Vector3[];
  sceneRadialBoresight: Vector3;
  bands?: readonly EnergyBand[];
  observationProvenance: CountCubeFrameV1["observationProvenance"];
}>): CountCubeFrameV1 {
  requirePixelVector(observedByPixel, "Observed pixel vector");
  requirePixelVector(expectedBackgroundByPixel, "Expected-background pixel vector");
  requirePixelVector(sourceExpectedByPixel, "Source pixel vector");
  requireFiniteNonNegative(exposureSeconds, "Exposure");
  if (exposureSeconds === 0) throw new RangeError("Exposure must be positive.");
  validateEnergyBands(bands);
  return Object.freeze({
    schemaVersion: COUNT_CUBE_SCHEMA_VERSION,
    frameIndex,
    acquisitionTimeSeconds,
    simulatedAt,
    exposureSeconds,
    bands,
    pixels: Object.freeze(observedByPixel.map((observed, pixelId) => {
      const observedPartition = partitionExact(observed, bands);
      const backgroundPartition = partitionExact(expectedBackgroundByPixel[pixelId], bands);
      const sourcePartition = partitionExact(sourceExpectedByPixel[pixelId], bands);
      return Object.freeze(bands.map((_band, bandIndex) => Object.freeze({
        observedCounts: observedPartition[bandIndex],
        expectedBackgroundCounts: backgroundPartition[bandIndex],
        sourceExpectedCounts: sourcePartition[bandIndex],
      })));
    })),
    pixelDirectionsIcrs: mapDetectorNormalsToIcrs(detectorNormals, sceneRadialBoresight),
    observationProvenance,
  });
}

export function repartitionCountCubeFrame(
  frame: CountCubeFrameV1,
  bands: readonly EnergyBand[],
): CountCubeFrameV1 {
  validateEnergyBands(bands);
  return Object.freeze({
    ...frame,
    bands,
    pixels: Object.freeze(frame.pixels.map((pixelBands) => {
      const observed = pixelBands.reduce((sum, cell) => sum + cell.observedCounts, 0);
      const background = pixelBands.reduce((sum, cell) => sum + cell.expectedBackgroundCounts, 0);
      const source = pixelBands.reduce((sum, cell) => sum + cell.sourceExpectedCounts, 0);
      const observedPartition = partitionExact(observed, bands);
      const backgroundPartition = partitionExact(background, bands);
      const sourcePartition = partitionExact(source, bands);
      return Object.freeze(bands.map((_band, bandIndex) => Object.freeze({
        observedCounts: observedPartition[bandIndex],
        expectedBackgroundCounts: backgroundPartition[bandIndex],
        sourceExpectedCounts: sourcePartition[bandIndex],
      })));
    })),
  });
}

/** Parameter-free cumulative Welford bookkeeping; this is not a detector. */
export function runSequentialResidualBaseline(
  frames: readonly CountCubeFrameV1[],
): readonly SequentialResidualPoint[] {
  const states = new Map<string, { count: number; mean: number; m2: number }>();
  let latest: SequentialResidualPoint[] = [];
  for (const frame of frames) {
    latest = [];
    frame.pixels.forEach((bands, pixelId) => bands.forEach((cell, bandIndex) => {
      const bandId = frame.bands[bandIndex].id;
      const key = `${pixelId}:${bandId}`;
      const corrected = cell.observedCounts - cell.expectedBackgroundCounts;
      const state = states.get(key) ?? { count: 0, mean: 0, m2: 0 };
      const residual = state.count === 0 ? 0 : corrected - state.mean;
      const count = state.count + 1;
      const delta = corrected - state.mean;
      const mean = state.mean + delta / count;
      const m2 = state.m2 + delta * (corrected - mean);
      states.set(key, { count, mean, m2 });
      latest.push(Object.freeze({
        pixelId,
        bandId,
        sampleCount: count,
        correctedCounts: corrected,
        residualCounts: residual,
        cumulativeMeanCorrectedCounts: mean,
        sampleStdCorrectedCounts: count > 1 ? Math.sqrt(m2 / (count - 1)) : 0,
      }));
    }));
  }
  return Object.freeze(latest);
}
