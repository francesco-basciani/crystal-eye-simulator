import {
  RITABRATA_DETECTOR_FRAME,
  ritabrataDirectionFromAngles,
} from "./detector-local-frame-adapter.ts";

export const RITABRATA_GRB_PIXEL_COUNT = 126;
export const RITABRATA_GRB_SOURCE_AREA_CM2 = 4 * 18 * 18;
// Intentionally empty until the author approves one exact converted bundle.
// A downloaded manifest cannot authorize itself: activation requires a code change.
export const RITABRATA_GRB_APPROVED_PROVENANCE_SHA256 = "";
export const RITABRATA_GRB_APPROVED_GOLDEN_SHA256 = "";

type NumericVector = ArrayLike<number>;

export type CutoffPowerLawParameters = Readonly<{
  normalization: number;
  spectralIndex: number;
  peakEnergyKeV: number;
}>;

export type RitabrataGrbDatabaseDirection = Readonly<{
  sourceId: string;
  thetaDeg: number;
  phiDeg: number;
  responseKey: string;
}>;

export type RitabrataGrbGeneratorAssets = Readonly<{
  assetVersion: string;
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  pixelCount: number;
  sourceAreaCm2: number;
  primaryEnergyBinEdgesKeV: NumericVector;
  depositedEnergyBinEdgesKeV: NumericVector;
  directions: readonly RitabrataGrbDatabaseDirection[];
  /** Layout: direction, primary-energy bin, pixel. */
  pixelMeanKernel: NumericVector;
  /** Layout: direction, primary-energy bin, pixel. */
  pixelVarianceKernel: NumericVector;
  /** Layout: direction, primary-energy bin, deposited-energy bin. */
  depositedEnergyMeanKernel: NumericVector;
  /** Layout: direction, primary-energy bin, deposited-energy bin. */
  depositedEnergyVarianceKernel: NumericVector;
  provenanceSha256: string;
  rootParity: Readonly<{
    verified: boolean;
    goldenFixtureId: string;
    goldenOutputSha256: string;
    assetProvenanceSha256: string;
  }>;
}>;

export type GeneratedGrbResponse = Readonly<{
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  requestedDirection: Readonly<{ thetaDeg: number; phiDeg: number }>;
  selectedDatabaseDirection: RitabrataGrbDatabaseDirection;
  quantizationErrorDeg: number;
  spectrum: CutoffPowerLawParameters;
  pixelCountsPerSecond: Float64Array;
  pixelErrorsPerSecond: Float64Array;
  depositedEnergyCountsPerSecond: Float64Array;
  depositedEnergyErrorsPerSecond: Float64Array;
}>;

export type GrbGenerationUnavailableReason =
  | "asset-data-unavailable"
  | "asset-parity-unverified"
  | "asset-provenance-mismatch"
  | "direction-frame-unavailable"
  | "dimension-mismatch"
  | "invalid-direction"
  | "invalid-spectrum"
  | "invalid-kernel";

export type GrbGenerationResult =
  | Readonly<{
      status: "available";
      method: "ritabrata-cegengrb-nearest-template-cpl-v1";
      response: GeneratedGrbResponse;
    }>
  | Readonly<{ status: "unavailable"; reason: GrbGenerationUnavailableReason }>;

function unavailable(reason: GrbGenerationUnavailableReason): GrbGenerationResult {
  return Object.freeze({ status: "unavailable", reason });
}

function finiteStrictlyIncreasing(values: NumericVector): boolean {
  if (values.length < 2) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return false;
    if (index > 0 && values[index] <= values[index - 1]) return false;
  }
  return true;
}

function finiteNonNegative(values: NumericVector): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index]) || values[index] < 0) return false;
  }
  return true;
}

function normalizedPhi(phiDeg: number): number {
  return ((phiDeg % 360) + 360) % 360;
}

function directionVector(thetaDeg: number, phiDeg: number): readonly [number, number, number] {
  return ritabrataDirectionFromAngles(thetaDeg, phiDeg);
}

function angularSeparationDeg(
  firstThetaDeg: number,
  firstPhiDeg: number,
  secondThetaDeg: number,
  secondPhiDeg: number,
): number {
  const first = directionVector(firstThetaDeg, firstPhiDeg);
  const second = directionVector(secondThetaDeg, secondPhiDeg);
  const dot = Math.max(-1, Math.min(1,
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2],
  ));
  return Math.acos(dot) * 180 / Math.PI;
}

export function selectNearestRitabrataGrbDirection(
  thetaDeg: number,
  phiDeg: number,
  directions: readonly RitabrataGrbDatabaseDirection[],
): Readonly<{ direction: RitabrataGrbDatabaseDirection; separationDeg: number }> | null {
  if (!Number.isFinite(thetaDeg) || thetaDeg < 0 || thetaDeg > 90 || !Number.isFinite(phiDeg)) {
    return null;
  }
  const normalizedRequestPhi = normalizedPhi(phiDeg);
  let nearest: RitabrataGrbDatabaseDirection | null = null;
  let nearestSeparation = Number.POSITIVE_INFINITY;
  for (const candidate of directions) {
    if (
      !candidate.sourceId.trim() || !candidate.responseKey.trim() ||
      !Number.isFinite(candidate.thetaDeg) || candidate.thetaDeg < 0 || candidate.thetaDeg > 90 ||
      !Number.isFinite(candidate.phiDeg)
    ) return null;
    const separation = angularSeparationDeg(
      thetaDeg,
      normalizedRequestPhi,
      candidate.thetaDeg,
      candidate.phiDeg,
    );
    if (
      separation < nearestSeparation ||
      (separation === nearestSeparation && nearest &&
        (candidate.thetaDeg < nearest.thetaDeg ||
          (candidate.thetaDeg === nearest.thetaDeg && candidate.phiDeg < nearest.phiDeg)))
    ) {
      nearest = candidate;
      nearestSeparation = separation;
    }
  }
  return nearest ? Object.freeze({ direction: nearest, separationDeg: nearestSeparation }) : null;
}

/** CEGenGRB.cc cutoff power-law: A (E/100)^alpha exp(-(alpha+2) E/Epeak). */
export function cutoffPowerLawDifferentialFlux(
  energyKeV: number,
  parameters: CutoffPowerLawParameters,
): number {
  // CEGenGRB.cc receives the three user parameters through a Float_t array.
  const amplitude = Math.fround(parameters.normalization);
  const spectralIndex = Math.fround(parameters.spectralIndex);
  const peakEnergyKeV = Math.fround(parameters.peakEnergyKeV);
  if (
    !Number.isFinite(energyKeV) || energyKeV <= 0 ||
    !Number.isFinite(amplitude) || amplitude <= 0 ||
    !Number.isFinite(spectralIndex) || spectralIndex <= -2 ||
    !Number.isFinite(peakEnergyKeV) || peakEnergyKeV <= 0
  ) return Number.NaN;
  return amplitude *
    Math.pow(energyKeV / 100, spectralIndex) *
    Math.exp(-(spectralIndex + 2) * energyKeV / peakEnergyKeV);
}

function adaptiveSimpson(
  fn: (value: number) => number,
  lower: number,
  upper: number,
  tolerance: number,
  maximumDepth = 20,
): number {
  const midpoint = (lower + upper) / 2;
  const lowerValue = fn(lower);
  const midpointValue = fn(midpoint);
  const upperValue = fn(upper);
  const whole = (upper - lower) * (lowerValue + 4 * midpointValue + upperValue) / 6;
  const visit = (
    left: number,
    right: number,
    leftValue: number,
    centerValue: number,
    rightValue: number,
    estimate: number,
    remainingTolerance: number,
    depth: number,
  ): number => {
    const center = (left + right) / 2;
    const leftCenter = (left + center) / 2;
    const rightCenter = (center + right) / 2;
    const leftCenterValue = fn(leftCenter);
    const rightCenterValue = fn(rightCenter);
    const leftEstimate = (center - left) * (leftValue + 4 * leftCenterValue + centerValue) / 6;
    const rightEstimate = (right - center) * (centerValue + 4 * rightCenterValue + rightValue) / 6;
    const delta = leftEstimate + rightEstimate - estimate;
    if (depth <= 0 || Math.abs(delta) <= 15 * remainingTolerance) {
      return leftEstimate + rightEstimate + delta / 15;
    }
    return visit(
      left, center, leftValue, leftCenterValue, centerValue,
      leftEstimate, remainingTolerance / 2, depth - 1,
    ) + visit(
      center, right, centerValue, rightCenterValue, rightValue,
      rightEstimate, remainingTolerance / 2, depth - 1,
    );
  };
  return visit(
    lower, upper, lowerValue, midpointValue, upperValue,
    whole, tolerance, maximumDepth,
  );
}

export function integrateCutoffPowerLaw(
  lowerEnergyKeV: number,
  upperEnergyKeV: number,
  parameters: CutoffPowerLawParameters,
): number {
  if (
    !Number.isFinite(lowerEnergyKeV) || !Number.isFinite(upperEnergyKeV) ||
    lowerEnergyKeV < 20 || upperEnergyKeV > 1e6 || upperEnergyKeV <= lowerEnergyKeV ||
    !Number.isFinite(cutoffPowerLawDifferentialFlux(lowerEnergyKeV, parameters))
  ) return Number.NaN;
  const fn = (energyKeV: number) => cutoffPowerLawDifferentialFlux(energyKeV, parameters);
  const estimate = (upperEnergyKeV - lowerEnergyKeV) * fn((lowerEnergyKeV + upperEnergyKeV) / 2);
  return adaptiveSimpson(fn, lowerEnergyKeV, upperEnergyKeV, Math.max(1e-12, Math.abs(estimate) * 1e-10));
}

function validateAssets(assets: RitabrataGrbGeneratorAssets): GrbGenerationUnavailableReason | null {
  if (!assets.assetVersion.trim() || !assets.provenanceSha256.trim()) return "asset-data-unavailable";
  if (assets.directionFrame !== RITABRATA_DETECTOR_FRAME) return "direction-frame-unavailable";
  if (
    assets.pixelCount !== RITABRATA_GRB_PIXEL_COUNT ||
    assets.sourceAreaCm2 !== RITABRATA_GRB_SOURCE_AREA_CM2 ||
    !finiteStrictlyIncreasing(assets.primaryEnergyBinEdgesKeV) ||
    !finiteStrictlyIncreasing(assets.depositedEnergyBinEdgesKeV) ||
    assets.directions.length === 0
  ) return "dimension-mismatch";
  const primaryBins = assets.primaryEnergyBinEdgesKeV.length - 1;
  const depositedBins = assets.depositedEnergyBinEdgesKeV.length - 1;
  const pixelKernelLength = assets.directions.length * primaryBins * assets.pixelCount;
  const depositedKernelLength = assets.directions.length * primaryBins * depositedBins;
  if (
    assets.pixelMeanKernel.length !== pixelKernelLength ||
    assets.pixelVarianceKernel.length !== pixelKernelLength ||
    assets.depositedEnergyMeanKernel.length !== depositedKernelLength ||
    assets.depositedEnergyVarianceKernel.length !== depositedKernelLength
  ) return "dimension-mismatch";
  if (
    !finiteNonNegative(assets.pixelMeanKernel) ||
    !finiteNonNegative(assets.pixelVarianceKernel) ||
    !finiteNonNegative(assets.depositedEnergyMeanKernel) ||
    !finiteNonNegative(assets.depositedEnergyVarianceKernel)
  ) return "invalid-kernel";
  return null;
}

/**
 * Offline numerical port of CEGenGRB.cc over pre-aggregated response kernels.
 * Use generateRitabrataGrbResponse for runtime: it remains fail-closed until
 * ROOT golden parity is bound to the exact converted assets.
 */
export function computeRitabrataGrbResponse(
  thetaDeg: number,
  phiDeg: number,
  spectrum: CutoffPowerLawParameters,
  assets: RitabrataGrbGeneratorAssets,
): GeneratedGrbResponse | Readonly<{ status: "unavailable"; reason: GrbGenerationUnavailableReason }> {
  const invalidAssets = validateAssets(assets);
  if (invalidAssets) return Object.freeze({ status: "unavailable", reason: invalidAssets });
  const selection = selectNearestRitabrataGrbDirection(thetaDeg, phiDeg, assets.directions);
  if (!selection) return Object.freeze({ status: "unavailable", reason: "invalid-direction" });
  if (!Number.isFinite(cutoffPowerLawDifferentialFlux(100, spectrum))) {
    return Object.freeze({ status: "unavailable", reason: "invalid-spectrum" });
  }

  const directionIndex = assets.directions.indexOf(selection.direction);
  const primaryBins = assets.primaryEnergyBinEdgesKeV.length - 1;
  const depositedBins = assets.depositedEnergyBinEdgesKeV.length - 1;
  const pixelCounts = new Float64Array(assets.pixelCount);
  const pixelVariances = new Float64Array(assets.pixelCount);
  const depositedCounts = new Float64Array(depositedBins);
  const depositedVariances = new Float64Array(depositedBins);

  for (let primaryIndex = 0; primaryIndex < primaryBins; primaryIndex += 1) {
    const incidentRate = integrateCutoffPowerLaw(
      assets.primaryEnergyBinEdgesKeV[primaryIndex],
      assets.primaryEnergyBinEdgesKeV[primaryIndex + 1],
      spectrum,
    ) * assets.sourceAreaCm2;
    if (!Number.isFinite(incidentRate) || incidentRate < 0) {
      return Object.freeze({ status: "unavailable", reason: "invalid-spectrum" });
    }
    const squaredIncidentRate = incidentRate * incidentRate;
    const pixelOffset = (directionIndex * primaryBins + primaryIndex) * assets.pixelCount;
    for (let pixelIndex = 0; pixelIndex < assets.pixelCount; pixelIndex += 1) {
      pixelCounts[pixelIndex] += incidentRate * assets.pixelMeanKernel[pixelOffset + pixelIndex];
      pixelVariances[pixelIndex] += squaredIncidentRate * assets.pixelVarianceKernel[pixelOffset + pixelIndex];
    }
    const depositedOffset = (directionIndex * primaryBins + primaryIndex) * depositedBins;
    for (let depositedIndex = 0; depositedIndex < depositedBins; depositedIndex += 1) {
      depositedCounts[depositedIndex] += incidentRate *
        assets.depositedEnergyMeanKernel[depositedOffset + depositedIndex];
      depositedVariances[depositedIndex] += squaredIncidentRate *
        assets.depositedEnergyVarianceKernel[depositedOffset + depositedIndex];
    }
  }

  return Object.freeze({
    directionFrame: RITABRATA_DETECTOR_FRAME,
    requestedDirection: Object.freeze({ thetaDeg, phiDeg: normalizedPhi(phiDeg) }),
    selectedDatabaseDirection: selection.direction,
    quantizationErrorDeg: selection.separationDeg,
    spectrum: Object.freeze({ ...spectrum }),
    pixelCountsPerSecond: pixelCounts,
    pixelErrorsPerSecond: Float64Array.from(pixelVariances, Math.sqrt),
    depositedEnergyCountsPerSecond: depositedCounts,
    depositedEnergyErrorsPerSecond: Float64Array.from(depositedVariances, Math.sqrt),
  });
}

export function generateRitabrataGrbResponse(
  thetaDeg: number,
  phiDeg: number,
  spectrum: CutoffPowerLawParameters,
  assets: RitabrataGrbGeneratorAssets | null,
): GrbGenerationResult {
  if (!assets) return unavailable("asset-data-unavailable");
  if (
    !assets.rootParity.verified ||
    !RITABRATA_GRB_APPROVED_PROVENANCE_SHA256 ||
    !RITABRATA_GRB_APPROVED_GOLDEN_SHA256
  ) return unavailable("asset-parity-unverified");
  if (
    assets.provenanceSha256 !== RITABRATA_GRB_APPROVED_PROVENANCE_SHA256 ||
    assets.rootParity.goldenOutputSha256 !== RITABRATA_GRB_APPROVED_GOLDEN_SHA256 ||
    assets.rootParity.assetProvenanceSha256 !== assets.provenanceSha256 ||
    !assets.rootParity.goldenFixtureId.trim() || !assets.rootParity.goldenOutputSha256.trim()
  ) return unavailable("asset-provenance-mismatch");
  const response = computeRitabrataGrbResponse(thetaDeg, phiDeg, spectrum, assets);
  if ("status" in response) return unavailable(response.reason);
  return Object.freeze({
    status: "available",
    method: "ritabrata-cegengrb-nearest-template-cpl-v1",
    response,
  });
}
