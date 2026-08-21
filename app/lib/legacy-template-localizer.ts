import type { DetectorVector3 } from "./detector-geometry-v2r8";

const LEGACY_KS_PIXEL_COUNT = 126;
const LEGACY_KS_GEOMETRY_VERSION = "CESimulation-V2R8-candidate" as const;

export type LegacyKsObservation = Readonly<{
  pixelCounts: readonly number[];
  depositedEnergyCounts?: readonly number[];
  backgroundPixelCounts?: readonly number[];
  backgroundEnergyCounts?: readonly number[];
  exposureSeconds?: number;
}>;
export type LegacyKsTemplate = Readonly<{
  templateId: string;
  thetaDeg: number;
  phiDeg: number;
  pixelEnergyResponse: readonly number[];
}>;
export type LegacyKsEffectiveAreaRow = Readonly<{
  thetaDeg: number;
  areaByEnergyBin: readonly number[];
}>;
export type LegacyKsAssetBundle = Readonly<{
  geometryVersion: typeof LEGACY_KS_GEOMETRY_VERSION;
  directionFrame: string;
  pixelIds: readonly number[];
  energyBinEdgesKeV: readonly number[];
  templates: readonly LegacyKsTemplate[];
  effectiveArea: readonly LegacyKsEffectiveAreaRow[];
  provenanceSha256: string;
  rootParity: Readonly<{
    verified: boolean;
    rootVersion: string;
    goldenFixtureId: string;
  }>;
}>;
export type LegacyKsUnavailableReason =
  | "template-data-unavailable"
  | "energy-spectrum-unavailable"
  | "background-data-unavailable"
  | "exposure-unavailable"
  | "direction-frame-unavailable"
  | "dimension-mismatch"
  | "invalid-input"
  | "geometry-version-mismatch"
  | "unsupported-negative-residual"
  | "root-ks-parity-unverified"
  | "typescript-core-not-implemented";
export type LegacyKsLocalizationResult =
  | Readonly<{
      status: "available";
      method: "legacy-template-root-ks-parity-v1";
      localDirection: DetectorVector3;
      thetaDeg: number;
      phiDeg: number;
      rankedTemplates: readonly Readonly<{
        templateId: string;
        score: number;
      }>[];
    }>
  | Readonly<{ status: "unavailable"; reason: LegacyKsUnavailableReason }>;

function finiteNonNegative(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value >= 0);
}
function hasCanonicalIds(ids: readonly number[]): boolean {
  return ids.length === LEGACY_KS_PIXEL_COUNT &&
    ids.every((id, index) => id === index);
}
function unavailable(reason: LegacyKsUnavailableReason): LegacyKsLocalizationResult {
  return Object.freeze({ status: "unavailable", reason });
}

export function localizeWithLegacyKsTemplates(
  observation: LegacyKsObservation,
  assets?: LegacyKsAssetBundle | null,
): LegacyKsLocalizationResult {
  if (!assets || assets.templates.length === 0 || assets.effectiveArea.length === 0) {
    return unavailable("template-data-unavailable");
  }
  if (assets.geometryVersion !== LEGACY_KS_GEOMETRY_VERSION) {
    return unavailable("geometry-version-mismatch");
  }
  if (!assets.directionFrame.trim()) return unavailable("direction-frame-unavailable");
  if (!hasCanonicalIds(assets.pixelIds)) return unavailable("dimension-mismatch");
  if (!observation.depositedEnergyCounts?.length) {
    return unavailable("energy-spectrum-unavailable");
  }
  if (!observation.backgroundPixelCounts || !observation.backgroundEnergyCounts) {
    return unavailable("background-data-unavailable");
  }
  if (!Number.isFinite(observation.exposureSeconds) || observation.exposureSeconds! <= 0) {
    return unavailable("exposure-unavailable");
  }
  const energyBinCount = observation.depositedEnergyCounts.length;
  if (
    observation.pixelCounts.length !== LEGACY_KS_PIXEL_COUNT ||
    observation.backgroundPixelCounts.length !== LEGACY_KS_PIXEL_COUNT ||
    observation.backgroundEnergyCounts.length !== energyBinCount ||
    assets.energyBinEdgesKeV.length !== energyBinCount + 1 ||
    assets.effectiveArea.some((row) => row.areaByEnergyBin.length !== energyBinCount) ||
    assets.templates.some((template) =>
      template.pixelEnergyResponse.length !== LEGACY_KS_PIXEL_COUNT * energyBinCount)
  ) return unavailable("dimension-mismatch");
  const numericVectors = [
    observation.pixelCounts,
    observation.depositedEnergyCounts,
    observation.backgroundPixelCounts,
    observation.backgroundEnergyCounts,
    ...assets.effectiveArea.map((row) => row.areaByEnergyBin),
    ...assets.templates.map((template) => template.pixelEnergyResponse),
  ];
  if (
    !numericVectors.every(finiteNonNegative) ||
    !assets.energyBinEdgesKeV.every(Number.isFinite) ||
    assets.energyBinEdgesKeV.some((edge, index, edges) => index > 0 && edge <= edges[index - 1]) ||
    assets.effectiveArea.some((row) =>
      !Number.isFinite(row.thetaDeg) || row.thetaDeg < 0 || row.thetaDeg > 90 ||
      row.areaByEnergyBin.some((area) => area <= 0)) ||
    assets.templates.some((template) =>
      template.templateId.trim() === "" || !Number.isFinite(template.thetaDeg) ||
      template.thetaDeg < 0 || template.thetaDeg > 90 ||
      !Number.isFinite(template.phiDeg) || template.phiDeg < -180 || template.phiDeg > 180) ||
    assets.provenanceSha256.trim() === ""
  ) return unavailable("invalid-input");
  if (
    observation.pixelCounts.some((value, index) => value < observation.backgroundPixelCounts![index]) ||
    observation.depositedEnergyCounts.some((value, index) => value < observation.backgroundEnergyCounts![index])
  ) return unavailable("unsupported-negative-residual");
  if (!assets.rootParity.verified || !assets.rootParity.rootVersion.trim() ||
      !assets.rootParity.goldenFixtureId.trim()) {
    return unavailable("root-ks-parity-unverified");
  }
  return unavailable("typescript-core-not-implemented");
}
