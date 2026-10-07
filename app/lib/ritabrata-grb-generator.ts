import {
  RITABRATA_DETECTOR_FRAME,
  ritabrataDirectionFromAngles,
} from "./detector-local-frame-adapter.ts";

export const RITABRATA_GRB_PIXEL_COUNT = 126;
export const RITABRATA_GRB_SOURCE_AREA_CM2 = 4 * 18 * 18;
/** Domain-author supplied accessible detector FoV for the updated generator. */
export const RITABRATA_GRB_MAXIMUM_REQUESTED_THETA_DEG = 113;
// Author-approved, code-pinned trust anchors for the converted web bundle.
// A downloaded manifest cannot authorize itself: changing either value requires code review.
export const RITABRATA_GRB_APPROVED_PROVENANCE_SHA256 =
  "ac3ecb79f205c1d7436e9343b01f61211800abf03f0cae0e06ff892980fb40ea";
export const RITABRATA_GRB_APPROVED_GOLDEN_SHA256 =
  "dc146bd6678ceb70667695f66180add745fd64946b4135ba95ab83ffbf897ffe";
export const RITABRATA_GRB_APPROVED_MANIFEST_SHA256 =
  "0c1c608ad0c541936d70ea3472ee4b164b1fd069c7b54ab7cb64d1cf2cd01922";
export const RITABRATA_GRB_V2_APPROVED_PROVENANCE_SHA256 =
  "d0874e93bbc81e6b21d395c84f987334c17e5d9549b34c6708bc0373976afb88";
export const RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256 =
  "0d9790bb74ecf5a15d53b99eb8008e8e353d470560bbe08c27c17e90d47bfbd5";

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
  manifestSha256: string;
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  pixelCount: number;
  sourceAreaCm2: number;
  primaryEnergyBinEdgesKeV: NumericVector;
  depositedEnergyBinEdgesKeV: NumericVector;
  directions: readonly RitabrataGrbDatabaseDirection[];
  /** Optional v2 layout: direction, primary-energy bin. */
  primaryCountsKernel?: NumericVector;
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
  selectedDatabaseDirections: readonly Readonly<{
    direction: RitabrataGrbDatabaseDirection;
    separationDeg: number;
    weight: number;
  }>[];
  quantizationErrorDeg: number;
  interpolationMethod: "nearest-template" | "three-neighbour-inverse-angular-distance";
  responseSemantics: "single-template" | "full-sample-expectation-approximation";
  containmentWarning: "degenerate-neighbour-triangle" | "outside-neighbour-triangle" | null;
  spectrum: CutoffPowerLawParameters;
  depositedEnergyBinEdgesKeV: readonly number[];
  pixelCountsPerSecond: Float64Array;
  /** ROOT hNormEdepPix errors derived from the converted MC Sumw2 kernel. */
  pixelMcSumw2ErrorsPerSecond: Float64Array;
  depositedEnergyCountsPerSecond: Float64Array;
  /** ROOT hNormEdepTotCal errors derived from the converted MC Sumw2 kernel. */
  depositedEnergyMcSumw2ErrorsPerSecond: Float64Array;
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
      method:
        | "ritabrata-cegengrb-nearest-template-cpl-v1"
        | "cegengrb-three-neighbour-expectation-cpl-v2";
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

export type RitabrataGrbDirectionSelection = Readonly<{
  selections: readonly Readonly<{
    direction: RitabrataGrbDatabaseDirection;
    separationDeg: number;
    weight: number;
  }>[];
  containmentWarning: "degenerate-neighbour-triangle" | "outside-neighbour-triangle" | null;
}>;

function dot(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

/**
 * Updated CEGenGRB direction selection. The supplied C++ uses the three
 * nearest spherical directions and normalized inverse-distance weights. An
 * exact database match is handled explicitly instead of dividing by zero.
 */
export function selectThreeNearestRitabrataGrbDirections(
  thetaDeg: number,
  phiDeg: number,
  directions: readonly RitabrataGrbDatabaseDirection[],
): RitabrataGrbDirectionSelection | null {
  if (
    !Number.isFinite(thetaDeg) || thetaDeg < 0 ||
    thetaDeg > RITABRATA_GRB_MAXIMUM_REQUESTED_THETA_DEG ||
    !Number.isFinite(phiDeg) || directions.length === 0
  ) return null;
  const requestPhi = normalizedPhi(phiDeg);
  const ranked = directions.map((direction, sourceIndex) => {
    if (
      !direction.sourceId.trim() || !direction.responseKey.trim() ||
      !Number.isFinite(direction.thetaDeg) || direction.thetaDeg < 0 || direction.thetaDeg > 180 ||
      !Number.isFinite(direction.phiDeg)
    ) return null;
    return {
      direction,
      sourceIndex,
      separationDeg: angularSeparationDeg(
        thetaDeg,
        requestPhi,
        direction.thetaDeg,
        direction.phiDeg,
      ),
    };
  });
  if (ranked.some((entry) => entry === null)) return null;
  const sorted = ranked.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) =>
      left.separationDeg - right.separationDeg ||
      left.direction.thetaDeg - right.direction.thetaDeg ||
      left.direction.phiDeg - right.direction.phiDeg ||
      left.sourceIndex - right.sourceIndex);
  const exact = sorted[0];
  if (!exact) return null;
  if (exact.separationDeg <= 1e-7) {
    return Object.freeze({
      selections: Object.freeze([Object.freeze({
        direction: exact.direction,
        separationDeg: exact.separationDeg,
        weight: 1,
      })]),
      containmentWarning: null,
    });
  }
  if (sorted.length < 3) return null;
  const nearest = sorted.slice(0, 3);
  const inverseTotal = nearest.reduce((sum, entry) => sum + 1 / entry.separationDeg, 0);
  if (!Number.isFinite(inverseTotal) || inverseTotal <= 0) return null;

  const vectors = nearest.map((entry) =>
    directionVector(entry.direction.thetaDeg, entry.direction.phiDeg));
  const target = directionVector(thetaDeg, requestPhi);
  const determinant = dot(vectors[0], cross(vectors[1], vectors[2]));
  let containmentWarning: RitabrataGrbDirectionSelection["containmentWarning"] = null;
  if (Math.abs(determinant) < 1e-9) {
    containmentWarning = "degenerate-neighbour-triangle";
  } else {
    const coefficients = [
      dot(target, cross(vectors[1], vectors[2])) / determinant,
      dot(vectors[0], cross(target, vectors[2])) / determinant,
      dot(vectors[0], cross(vectors[1], target)) / determinant,
    ];
    const allPositive = coefficients.every((value) => value >= -1e-9);
    const allNegative = coefficients.every((value) => value <= 1e-9);
    if (!allPositive && !allNegative) containmentWarning = "outside-neighbour-triangle";
  }
  return Object.freeze({
    selections: Object.freeze(nearest.map((entry) => Object.freeze({
      direction: entry.direction,
      separationDeg: entry.separationDeg,
      weight: (1 / entry.separationDeg) / inverseTotal,
    }))),
    containmentWarning,
  });
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
  if (
    assets.manifestSha256 !== RITABRATA_GRB_APPROVED_MANIFEST_SHA256 &&
    assets.manifestSha256 !== RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256
  ) {
    return "asset-provenance-mismatch";
  }
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
    (assets.primaryCountsKernel !== undefined &&
      assets.primaryCountsKernel.length !== assets.directions.length * primaryBins) ||
    assets.pixelMeanKernel.length !== pixelKernelLength ||
    assets.pixelVarianceKernel.length !== pixelKernelLength ||
    assets.depositedEnergyMeanKernel.length !== depositedKernelLength ||
    assets.depositedEnergyVarianceKernel.length !== depositedKernelLength
  ) return "dimension-mismatch";
  if (
    (assets.primaryCountsKernel !== undefined && !finiteNonNegative(assets.primaryCountsKernel)) ||
    !finiteNonNegative(assets.pixelMeanKernel) ||
    !finiteNonNegative(assets.pixelVarianceKernel) ||
    !finiteNonNegative(assets.depositedEnergyMeanKernel) ||
    !finiteNonNegative(assets.depositedEnergyVarianceKernel)
  ) return "invalid-kernel";
  return null;
}

/**
 * Offline numerical port of CEGenGRB.cc over pre-aggregated response kernels.
 * Use generateRitabrataGrbResponse for runtime. Legacy v1 assets remain gated
 * by their verified parity record; provisional v2 assets require their exact
 * manifest and provenance trust roots and report expectation semantics.
 */
export function computeRitabrataGrbResponse(
  thetaDeg: number,
  phiDeg: number,
  spectrum: CutoffPowerLawParameters,
  assets: RitabrataGrbGeneratorAssets,
): GeneratedGrbResponse | Readonly<{ status: "unavailable"; reason: GrbGenerationUnavailableReason }> {
  const invalidAssets = validateAssets(assets);
  if (invalidAssets) return Object.freeze({ status: "unavailable", reason: invalidAssets });
  const selection = assets.primaryCountsKernel
    ? selectThreeNearestRitabrataGrbDirections(thetaDeg, phiDeg, assets.directions)
    : (() => {
        const nearest = selectNearestRitabrataGrbDirection(thetaDeg, phiDeg, assets.directions);
        return nearest ? Object.freeze({
          selections: Object.freeze([Object.freeze({ ...nearest, weight: 1 })]),
          containmentWarning: null,
        }) : null;
      })();
  if (!selection) return Object.freeze({ status: "unavailable", reason: "invalid-direction" });
  if (!Number.isFinite(cutoffPowerLawDifferentialFlux(100, spectrum))) {
    return Object.freeze({ status: "unavailable", reason: "invalid-spectrum" });
  }

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
    let mixedPrimaryCount = 1;
    if (assets.primaryCountsKernel) {
      mixedPrimaryCount = selection.selections.reduce((sum, selected) => {
        const directionIndex = assets.directions.indexOf(selected.direction);
        return sum + selected.weight * assets.primaryCountsKernel![
          directionIndex * primaryBins + primaryIndex
        ];
      }, 0);
      if (!Number.isFinite(mixedPrimaryCount) || mixedPrimaryCount <= 0) {
        return Object.freeze({ status: "unavailable", reason: "invalid-kernel" });
      }
    }
    for (let pixelIndex = 0; pixelIndex < assets.pixelCount; pixelIndex += 1) {
      let mixedMean = 0;
      let mixedVariance = 0;
      for (const selected of selection.selections) {
        const directionIndex = assets.directions.indexOf(selected.direction);
        const offset = (directionIndex * primaryBins + primaryIndex) * assets.pixelCount + pixelIndex;
        const primaryCount = assets.primaryCountsKernel?.[
          directionIndex * primaryBins + primaryIndex
        ] ?? 1;
        mixedMean += selected.weight * assets.pixelMeanKernel[offset] * primaryCount;
        // Fractional expected event counts scale Sumw2 linearly with the mixture weight.
        mixedVariance += selected.weight * assets.pixelVarianceKernel[offset] *
          primaryCount * primaryCount;
      }
      pixelCounts[pixelIndex] += incidentRate * mixedMean / mixedPrimaryCount;
      pixelVariances[pixelIndex] += squaredIncidentRate * mixedVariance /
        (mixedPrimaryCount * mixedPrimaryCount);
    }
    for (let depositedIndex = 0; depositedIndex < depositedBins; depositedIndex += 1) {
      let mixedMean = 0;
      let mixedVariance = 0;
      for (const selected of selection.selections) {
        const directionIndex = assets.directions.indexOf(selected.direction);
        const offset = (directionIndex * primaryBins + primaryIndex) * depositedBins + depositedIndex;
        const primaryCount = assets.primaryCountsKernel?.[
          directionIndex * primaryBins + primaryIndex
        ] ?? 1;
        mixedMean += selected.weight * assets.depositedEnergyMeanKernel[offset] * primaryCount;
        mixedVariance += selected.weight * assets.depositedEnergyVarianceKernel[offset] *
          primaryCount * primaryCount;
      }
      depositedCounts[depositedIndex] += incidentRate * mixedMean / mixedPrimaryCount;
      depositedVariances[depositedIndex] += squaredIncidentRate * mixedVariance /
        (mixedPrimaryCount * mixedPrimaryCount);
    }
  }

  return Object.freeze({
    directionFrame: RITABRATA_DETECTOR_FRAME,
    requestedDirection: Object.freeze({ thetaDeg, phiDeg: normalizedPhi(phiDeg) }),
    selectedDatabaseDirection: selection.selections[0].direction,
    selectedDatabaseDirections: selection.selections,
    quantizationErrorDeg: selection.selections[0].separationDeg,
    interpolationMethod: selection.selections.length === 1
      ? "nearest-template"
      : "three-neighbour-inverse-angular-distance",
    responseSemantics: assets.primaryCountsKernel
      ? "full-sample-expectation-approximation"
      : "single-template",
    containmentWarning: selection.containmentWarning,
    spectrum: Object.freeze({ ...spectrum }),
    depositedEnergyBinEdgesKeV: Object.freeze(Array.from(assets.depositedEnergyBinEdgesKeV)),
    pixelCountsPerSecond: pixelCounts,
    pixelMcSumw2ErrorsPerSecond: Float64Array.from(pixelVariances, Math.sqrt),
    depositedEnergyCountsPerSecond: depositedCounts,
    depositedEnergyMcSumw2ErrorsPerSecond: Float64Array.from(depositedVariances, Math.sqrt),
  });
}

export function generateRitabrataGrbResponse(
  thetaDeg: number,
  phiDeg: number,
  spectrum: CutoffPowerLawParameters,
  assets: RitabrataGrbGeneratorAssets | null,
): GrbGenerationResult {
  if (!assets) return unavailable("asset-data-unavailable");
  const updatedExpectationAssets = assets.primaryCountsKernel !== undefined;
  if (updatedExpectationAssets) {
    if (
      assets.manifestSha256 !== RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256 ||
      assets.provenanceSha256 !== RITABRATA_GRB_V2_APPROVED_PROVENANCE_SHA256
    ) return unavailable("asset-provenance-mismatch");
    const response = computeRitabrataGrbResponse(thetaDeg, phiDeg, spectrum, assets);
    if ("status" in response) return unavailable(response.reason);
    return Object.freeze({
      status: "available",
      method: "cegengrb-three-neighbour-expectation-cpl-v2",
      response,
    });
  }
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
