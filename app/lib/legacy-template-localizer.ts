import type { DetectorVector3 } from "./detector-geometry-v2r8";
import {
  RITABRATA_DETECTOR_FRAME,
  CELOC_UPCAL_RAW_COMPONENT_FRAME,
  createRitabrataDetectorVector,
  ritabrataDirectionFromAngles,
  ritabrataToThreeDetectorLocal,
  type CelocRawPixelVector3,
  type RitabrataDetectorVector3,
  type ThreeDetectorLocalVector3,
} from "./detector-local-frame-adapter.ts";

export const RITABRATA_KS_PIXEL_COUNT = 126;
export const RITABRATA_KS_GEOMETRY_VERSION = "CESimulation-V2R8-candidate" as const;

type NumericVector = ArrayLike<number>;

export type LegacyKsObservation = Readonly<{
  geometryVersion: typeof RITABRATA_KS_GEOMETRY_VERSION;
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  pixelIds: NumericVector;
  energyBinEdgesKeV: NumericVector;
  pixelCounts: NumericVector;
  pixelErrors: NumericVector;
  depositedEnergyCounts: NumericVector;
}>;
export type LegacyKsTemplate = Readonly<{
  templateId: string;
  thetaDeg: number;
  phiDeg: number;
}>;
export type LegacyKsEffectiveAreaRow = Readonly<{
  thetaDeg: number;
  areaByEnergyBin: NumericVector;
}>;
export type LegacyKsAssetBundle = Readonly<{
  geometryVersion: typeof RITABRATA_KS_GEOMETRY_VERSION;
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  pixelPositionFrame: typeof CELOC_UPCAL_RAW_COMPONENT_FRAME;
  /** Canonical ROOT histogram-bin identity, always 0..125. */
  pixelIds: NumericVector;
  /** Literal upCal.txt row IDs; CELoc ignores these IDs and preserves row order. */
  pixelPositionRowIds: NumericVector;
  pixelPositionVectors: readonly CelocRawPixelVector3[];
  energyBinEdgesKeV: NumericVector;
  templates: readonly LegacyKsTemplate[];
  templatePixelEnergyResponse: NumericVector;
  effectiveArea: readonly LegacyKsEffectiveAreaRow[];
  provenanceSha256: string;
  rootParity: Readonly<{
    verified: boolean;
    rootVersion: string;
    goldenFixtureId: string;
    goldenOutputSha256: string;
    assetProvenanceSha256: string;
  }>;
}>;
export type LegacyKsUnavailableReason =
  | "template-data-unavailable"
  | "energy-spectrum-unavailable"
  | "pixel-errors-unavailable"
  | "direction-frame-unavailable"
  | "dimension-mismatch"
  | "invalid-input"
  | "geometry-version-mismatch"
  | "zero-template-probability"
  | "root-ks-parity-unverified";
export type LegacyKsRankedTemplate = Readonly<{
  templateId: string;
  thetaDeg: number;
  phiDeg: number;
  probability: number;
  ksDistance: number;
}>;
export type LegacyKsComputedLocalization = Readonly<{
  /** Canonical result in the Ritabrata/ROOT +Z-polar detector frame. */
  rootLocalDirection: RitabrataDetectorVector3;
  rootWeightedDirectionVector: RitabrataDetectorVector3;
  /** Explicit adapter boundary for existing Three.js +Y-local consumers. */
  localDirection: ThreeDetectorLocalVector3;
  weightedDirectionVector: ThreeDetectorLocalVector3;
  thetaDeg: number;
  phiDeg: number;
  provisionalThetaDeg: number;
  effectiveAreaThetaDeg: number;
  maximumProbability: number;
  selectedTemplateCount: number;
  rankedTemplates: readonly LegacyKsRankedTemplate[];
}>;
export type LegacyKsLocalizationResult =
  | Readonly<{
      status: "available";
      method: "ritabrata-standalone-template-root-ks-parity-v1";
      reconstruction: LegacyKsComputedLocalization;
    }>
  | Readonly<{ status: "unavailable"; reason: LegacyKsUnavailableReason }>;

function finiteNonNegative(values: NumericVector): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || value < 0) return false;
  }
  return true;
}

function finiteStrictlyIncreasing(values: NumericVector): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return false;
    if (index > 0 && values[index] <= values[index - 1]) return false;
  }
  return true;
}

function hasCanonicalIds(ids: NumericVector): boolean {
  if (ids.length !== RITABRATA_KS_PIXEL_COUNT) return false;
  for (let index = 0; index < ids.length; index += 1) {
    if (ids[index] !== index) return false;
  }
  return true;
}

function hasPixelIdBijection(ids: NumericVector): boolean {
  if (ids.length !== RITABRATA_KS_PIXEL_COUNT) return false;
  const unique = new Set<number>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (!Number.isInteger(id) || id < 0 || id >= RITABRATA_KS_PIXEL_COUNT) return false;
    unique.add(id);
  }
  return unique.size === RITABRATA_KS_PIXEL_COUNT;
}

function unavailable(reason: LegacyKsUnavailableReason): Readonly<{
  status: "unavailable";
  reason: LegacyKsUnavailableReason;
}> {
  return Object.freeze({ status: "unavailable", reason });
}

function vectorFromRootAngles(thetaDeg: number, phiDeg: number): RitabrataDetectorVector3 {
  return ritabrataDirectionFromAngles(thetaDeg, phiDeg);
}

function normalized(vector: DetectorVector3): DetectorVector3 | null {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude];
}

/** Port of ROOT TMath::KolmogorovProb used by TH1::KolmogorovTest. */
export function rootKolmogorovProbability(z: number): number {
  const u = Math.abs(z);
  if (!Number.isFinite(u)) return 0;
  if (u < 0.2) return 1;
  if (u < 0.755) {
    const inverseSquare = 1 / (u * u);
    return 1 - 2.50662827 * (
      Math.exp(-1.2337005501361697 * inverseSquare) +
      Math.exp(-11.103304951225528 * inverseSquare) +
      Math.exp(-30.842513753404244 * inverseSquare)
    ) / u;
  }
  if (u < 6.8116) {
    const coefficients = [-2, -8, -18, -32] as const;
    const terms = [0, 0, 0, 0];
    const square = u * u;
    const termCount = Math.max(1, Math.floor(3 / u + 0.5));
    for (let index = 0; index < termCount; index += 1) {
      terms[index] = Math.exp(coefficients[index] * square);
    }
    return 2 * (terms[0] - terms[1] + terms[2] - terms[3]);
  }
  return 0;
}

/** ROOT TH1::KolmogorovTest shape-only semantics for two 1-D histograms. */
export function rootHistogramKsComparison(
  first: NumericVector,
  second: NumericVector,
  firstErrors: NumericVector,
  secondErrors: NumericVector,
): Readonly<{ probability: number; distance: number }> | null {
  if (
    first.length === 0 || first.length !== second.length ||
    firstErrors.length !== first.length || secondErrors.length !== second.length ||
    !finiteNonNegative(first) || !finiteNonNegative(second) ||
    !finiteNonNegative(firstErrors) || !finiteNonNegative(secondErrors)
  ) return null;

  let firstSum = 0;
  let secondSum = 0;
  let firstErrorSquareSum = 0;
  let secondErrorSquareSum = 0;
  for (let index = 0; index < first.length; index += 1) {
    firstSum += first[index];
    secondSum += second[index];
    firstErrorSquareSum += firstErrors[index] * firstErrors[index];
    secondErrorSquareSum += secondErrors[index] * secondErrors[index];
  }
  if (firstSum <= 0 || secondSum <= 0) return null;
  const firstIsFunction = firstErrorSquareSum === 0;
  const secondIsFunction = secondErrorSquareSum === 0;
  if (firstIsFunction && secondIsFunction) return null;

  const firstEffectiveEntries = firstIsFunction ? 0 : firstSum * firstSum / firstErrorSquareSum;
  const secondEffectiveEntries = secondIsFunction ? 0 : secondSum * secondSum / secondErrorSquareSum;
  let firstCumulative = 0;
  let secondCumulative = 0;
  let distance = 0;
  for (let index = 0; index < first.length; index += 1) {
    firstCumulative += first[index] / firstSum;
    secondCumulative += second[index] / secondSum;
    distance = Math.max(distance, Math.abs(firstCumulative - secondCumulative));
  }

  let z: number;
  if (firstIsFunction) {
    z = distance * Math.sqrt(secondEffectiveEntries);
  } else if (secondIsFunction) {
    z = distance * Math.sqrt(firstEffectiveEntries);
  } else {
    z = distance * Math.sqrt(
      firstEffectiveEntries * secondEffectiveEntries /
      (firstEffectiveEntries + secondEffectiveEntries),
    );
  }
  return Object.freeze({ probability: rootKolmogorovProbability(z), distance });
}

function validateInputs(
  observation: LegacyKsObservation,
  assets: LegacyKsAssetBundle,
): LegacyKsUnavailableReason | null {
  if (assets.geometryVersion !== RITABRATA_KS_GEOMETRY_VERSION) return "geometry-version-mismatch";
  if (observation.geometryVersion !== assets.geometryVersion) return "geometry-version-mismatch";
  if (assets.directionFrame !== RITABRATA_DETECTOR_FRAME) return "direction-frame-unavailable";
  if (assets.pixelPositionFrame !== CELOC_UPCAL_RAW_COMPONENT_FRAME) {
    return "direction-frame-unavailable";
  }
  if (observation.directionFrame !== RITABRATA_DETECTOR_FRAME) {
    return "direction-frame-unavailable";
  }
  if (!observation.depositedEnergyCounts.length) return "energy-spectrum-unavailable";
  if (!observation.pixelErrors.length) return "pixel-errors-unavailable";
  if (!hasCanonicalIds(assets.pixelIds)) return "dimension-mismatch";
  if (!hasPixelIdBijection(assets.pixelPositionRowIds)) return "dimension-mismatch";

  const energyBinCount = observation.depositedEnergyCounts.length;
  const expectedResponseLength = assets.templates.length * RITABRATA_KS_PIXEL_COUNT * energyBinCount;
  if (
    observation.pixelCounts.length !== RITABRATA_KS_PIXEL_COUNT ||
    observation.pixelErrors.length !== RITABRATA_KS_PIXEL_COUNT ||
    observation.pixelIds.length !== RITABRATA_KS_PIXEL_COUNT ||
    assets.pixelPositionVectors.length !== RITABRATA_KS_PIXEL_COUNT ||
    assets.pixelPositionRowIds.length !== RITABRATA_KS_PIXEL_COUNT ||
    observation.energyBinEdgesKeV.length !== energyBinCount + 1 ||
    assets.energyBinEdgesKeV.length !== energyBinCount + 1 ||
    assets.effectiveArea.length === 0 ||
    assets.effectiveArea.some((row) => row.areaByEnergyBin.length !== energyBinCount) ||
    assets.templatePixelEnergyResponse.length !== expectedResponseLength
  ) return "dimension-mismatch";

  for (let index = 0; index < assets.pixelIds.length; index += 1) {
    if (observation.pixelIds[index] !== assets.pixelIds[index]) return "dimension-mismatch";
  }
  for (let index = 0; index < assets.energyBinEdgesKeV.length; index += 1) {
    if (observation.energyBinEdgesKeV[index] !== assets.energyBinEdgesKeV[index]) {
      return "dimension-mismatch";
    }
  }

  if (
    !finiteNonNegative(observation.pixelCounts) ||
    !finiteNonNegative(observation.pixelErrors) ||
    !finiteNonNegative(observation.depositedEnergyCounts) ||
    !finiteStrictlyIncreasing(observation.energyBinEdgesKeV) ||
    !finiteStrictlyIncreasing(assets.energyBinEdgesKeV) ||
    assets.pixelPositionVectors.some((vector) =>
      vector.length !== 3 || vector.some((component) => !Number.isFinite(component))) ||
    assets.effectiveArea.some((row) => {
      if (!Number.isInteger(row.thetaDeg) || row.thetaDeg < 0 || row.thetaDeg > 90 ||
          !finiteNonNegative(row.areaByEnergyBin)) return true;
      for (let index = 0; index < row.areaByEnergyBin.length; index += 1) {
        if (row.areaByEnergyBin[index] <= 0) return true;
      }
      return false;
    }) ||
    assets.templates.some((template) =>
      template.templateId.trim() === "" || !Number.isFinite(template.thetaDeg) ||
      template.thetaDeg < 0 || template.thetaDeg > 90 || !Number.isFinite(template.phiDeg)) ||
    !finiteNonNegative(assets.templatePixelEnergyResponse) ||
    assets.provenanceSha256.trim() === ""
  ) return "invalid-input";
  return null;
}

/**
 * Numerical port of CELoc.cc. It deliberately does not assert ROOT parity.
 * Runtime callers must use localizeWithLegacyKsTemplates, which fails closed
 * until independent golden-output parity is recorded in the asset bundle.
 */
export function computeLegacyKsLocalization(
  observation: LegacyKsObservation,
  assets: LegacyKsAssetBundle,
): LegacyKsComputedLocalization | Readonly<{ status: "unavailable"; reason: LegacyKsUnavailableReason }> {
  const invalidReason = validateInputs(observation, assets);
  if (invalidReason) return unavailable(invalidReason);

  let sampleTotal = 0;
  for (let pixelIndex = 0; pixelIndex < RITABRATA_KS_PIXEL_COUNT; pixelIndex += 1) {
    sampleTotal += observation.pixelCounts[pixelIndex];
  }
  // CELoc.cc assigns TH1::Integral() to Float_t before calculating weights.
  sampleTotal = Math.fround(sampleTotal);
  if (sampleTotal <= 0) return unavailable("invalid-input");
  const centroid: [number, number, number] = [0, 0, 0];
  for (let pixelIndex = 0; pixelIndex < RITABRATA_KS_PIXEL_COUNT; pixelIndex += 1) {
    const position = assets.pixelPositionVectors[pixelIndex];
    const weight = observation.pixelCounts[pixelIndex] / sampleTotal;
    centroid[0] += weight * position[0];
    centroid[1] += weight * position[1];
    centroid[2] += weight * position[2];
  }
  const centroidDirection = normalized(centroid);
  if (!centroidDirection) return unavailable("invalid-input");
  const provisionalThetaDeg = Math.acos(
    Math.max(-1, Math.min(1, centroidDirection[2])),
  ) * 180 / Math.PI;
  const effectiveAreaThetaDeg = Math.trunc(Math.min(provisionalThetaDeg, 90));
  const effectiveArea = assets.effectiveArea.find((row) => row.thetaDeg === effectiveAreaThetaDeg);
  if (!effectiveArea) return unavailable("dimension-mismatch");

  const energyBinCount = observation.depositedEnergyCounts.length;
  const incidentFlux = new Float64Array(energyBinCount);
  for (let energyIndex = 0; energyIndex < energyBinCount; energyIndex += 1) {
    const binWidth = assets.energyBinEdgesKeV[energyIndex + 1] - assets.energyBinEdgesKeV[energyIndex];
    // hSamCal is TH1F: both Divide and subsequent SetBinContent round to Float_t.
    incidentFlux[energyIndex] = Math.fround(
      Math.fround(
        observation.depositedEnergyCounts[energyIndex] /
        effectiveArea.areaByEnergyBin[energyIndex],
      ) / binWidth,
    );
  }

  const templatePixelCounts = new Float64Array(RITABRATA_KS_PIXEL_COUNT);
  const rankedTemplates: LegacyKsRankedTemplate[] = [];
  const response = assets.templatePixelEnergyResponse;
  for (let templateIndex = 0; templateIndex < assets.templates.length; templateIndex += 1) {
    const templateOffset = templateIndex * RITABRATA_KS_PIXEL_COUNT * energyBinCount;
    for (let pixelIndex = 0; pixelIndex < RITABRATA_KS_PIXEL_COUNT; pixelIndex += 1) {
      let projectedCount = 0;
      const pixelOffset = templateOffset + pixelIndex * energyBinCount;
      for (let energyIndex = 0; energyIndex < energyBinCount; energyIndex += 1) {
        // hTemPix is TH2F, so every scaled cell is rounded before ProjectionX.
        projectedCount += Math.fround(
          response[pixelOffset + energyIndex] * incidentFlux[energyIndex],
        );
      }
      templatePixelCounts[pixelIndex] = projectedCount;
    }
    const comparison = rootHistogramKsComparison(
      observation.pixelCounts,
      templatePixelCounts,
      observation.pixelErrors,
      observation.pixelErrors,
    );
    if (!comparison) return unavailable("invalid-input");
    const template = assets.templates[templateIndex];
    rankedTemplates.push(Object.freeze({
      templateId: template.templateId,
      thetaDeg: template.thetaDeg,
      phiDeg: template.phiDeg,
      // fVProb stores the Double_t ROOT probability in pair<Float_t,...>.
      probability: Math.fround(comparison.probability),
      ksDistance: comparison.distance,
    }));
  }
  rankedTemplates.sort((left, right) => right.probability - left.probability);
  const maximumProbability = rankedTemplates[0]?.probability ?? 0;
  if (maximumProbability <= 0) return unavailable("zero-template-probability");
  const selected = rankedTemplates.filter(
    (template) => template.probability >= maximumProbability * 1e-2,
  );
  let probabilityTotal = 0;
  for (const template of selected) {
    // sProb is Float_t in CELoc.cc.
    probabilityTotal = Math.fround(probabilityTotal + template.probability);
  }
  if (probabilityTotal <= 0) return unavailable("zero-template-probability");
  const weighted: [number, number, number] = [0, 0, 0];
  for (const template of selected) {
    const direction = vectorFromRootAngles(template.thetaDeg, template.phiDeg);
    const weight = Math.fround(template.probability / probabilityTotal);
    weighted[0] += direction[0] * weight;
    weighted[1] += direction[1] * weight;
    weighted[2] += direction[2] * weight;
  }
  const normalizedRootDirection = normalized(weighted);
  if (!normalizedRootDirection) return unavailable("zero-template-probability");
  const rootLocalDirection = createRitabrataDetectorVector(...normalizedRootDirection);
  const rootWeightedDirectionVector = createRitabrataDetectorVector(...weighted);
  const localDirection = ritabrataToThreeDetectorLocal(rootLocalDirection);
  const weightedDirectionVector = ritabrataToThreeDetectorLocal(rootWeightedDirectionVector);
  const thetaDeg = Math.acos(Math.max(-1, Math.min(1, rootLocalDirection[2]))) * 180 / Math.PI;
  const phiDeg = Math.atan2(rootLocalDirection[1], rootLocalDirection[0]) * 180 / Math.PI;
  return Object.freeze({
    rootLocalDirection,
    rootWeightedDirectionVector,
    localDirection,
    weightedDirectionVector,
    thetaDeg,
    phiDeg,
    provisionalThetaDeg,
    effectiveAreaThetaDeg,
    maximumProbability,
    selectedTemplateCount: selected.length,
    rankedTemplates: Object.freeze(rankedTemplates),
  });
}

export function localizeWithLegacyKsTemplates(
  observation: LegacyKsObservation,
  assets?: LegacyKsAssetBundle | null,
): LegacyKsLocalizationResult {
  if (!assets || assets.templates.length === 0 || assets.effectiveArea.length === 0) {
    return unavailable("template-data-unavailable");
  }
  const invalidReason = validateInputs(observation, assets);
  if (invalidReason) return unavailable(invalidReason);
  if (!assets.rootParity.verified || !assets.rootParity.rootVersion.trim() ||
      !assets.rootParity.goldenFixtureId.trim() ||
      !/^[a-f0-9]{64}$/.test(assets.rootParity.goldenOutputSha256) ||
      assets.rootParity.assetProvenanceSha256 !== assets.provenanceSha256) {
    return unavailable("root-ks-parity-unverified");
  }
  const reconstruction = computeLegacyKsLocalization(observation, assets);
  if ("status" in reconstruction) return reconstruction;
  return Object.freeze({
    status: "available",
    method: "ritabrata-standalone-template-root-ks-parity-v1",
    reconstruction,
  });
}
