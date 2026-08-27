import {
  computeLegacyKsLocalization,
  type LegacyKsAssetBundle,
  type LegacyKsObservation,
} from "./legacy-template-localizer.ts";
import { loadRitabrataLocalizerAssets } from "./ritabrata-localizer-assets.ts";
import {
  generateRitabrataGrbResponse,
  type CutoffPowerLawParameters,
  type GeneratedGrbResponse,
} from "./ritabrata-grb-generator.ts";
import { loadRitabrataGrbGeneratorDirectionAssets } from "./ritabrata-grb-generator-assets.ts";
import {
  reconstructBurstDirection,
  rotateDetectorDirectionToScene,
  sceneDirectionToRaDec,
  type BurstDirectionReconstruction,
  type Vector3,
} from "./burst-direction-reconstruction.ts";
import { angularSeparationDeg } from "./burst-direction-truth-score.ts";
import {
  createThreeDetectorLocalVector,
  ritabrataAnglesFromDirection,
  ritabrataDirectionFromAngles,
  threeDetectorLocalToRitabrata,
} from "./detector-local-frame-adapter.ts";

export const RITABRATA_PROVISIONAL_PIPELINE_VERSION =
  "ritabrata-cegengrb-to-celoc-provisional-v1" as const;

const localizerAssetCache = new Map<string, Promise<LegacyKsAssetBundle>>();

function exactEdges(first: ArrayLike<number>, second: ArrayLike<number>): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

/**
 * Bridge CEGenGRB output into CELoc's canonical ROOT histogram-bin order.
 * `pixelMcSumw2ErrorsPerSecond` are the ROOT histogram MC Sumw2 errors, not
 * measurement noise or localization confidence.
 */
export function bridgeGeneratedGrbToLegacyObservation(
  generated: GeneratedGrbResponse,
  localizerAssets: LegacyKsAssetBundle,
): LegacyKsObservation {
  if (
    generated.pixelCountsPerSecond.length !== 126 ||
    generated.pixelMcSumw2ErrorsPerSecond.length !== 126 ||
    generated.depositedEnergyCountsPerSecond.length !==
      generated.depositedEnergyBinEdgesKeV.length - 1 ||
    !exactEdges(localizerAssets.energyBinEdgesKeV, generated.depositedEnergyBinEdgesKeV)
  ) {
    throw new RangeError("CEGenGRB and CELoc dimensions are incompatible.");
  }
  const pixelIds = Array.from({ length: 126 }, (_, pixelId) => pixelId);
  if (
    localizerAssets.pixelIds.length !== 126 ||
    pixelIds.some((pixelId) => localizerAssets.pixelIds[pixelId] !== pixelId)
  ) {
    throw new RangeError("CELoc histogram bins are not in canonical pixel-ID order.");
  }
  const pixelCounts = Array.from(generated.pixelCountsPerSecond);
  const pixelErrors = Array.from(generated.pixelMcSumw2ErrorsPerSecond);
  return Object.freeze({
    geometryVersion: localizerAssets.geometryVersion,
    directionFrame: generated.directionFrame,
    pixelIds: Object.freeze(pixelIds),
    energyBinEdgesKeV: Object.freeze(Array.from(localizerAssets.energyBinEdgesKeV)),
    pixelCounts: Object.freeze(pixelCounts),
    pixelErrors: Object.freeze(pixelErrors),
    depositedEnergyCounts: Object.freeze(Array.from(generated.depositedEnergyCountsPerSecond)),
  });
}

export type RitabrataPipelineAvailable = Readonly<{
  status: "available";
  validationStatus: "PROVISIONAL";
  method: typeof RITABRATA_PROVISIONAL_PIPELINE_VERSION;
  localizerRootParity: "PENDING_OFFICIAL_ROOT_OUTPUTS";
  requestedDirection: GeneratedGrbResponse["requestedDirection"];
  selectedDatabaseDirection: GeneratedGrbResponse["selectedDatabaseDirection"];
  quantizationErrorDeg: number;
  selectedDatabaseToReconstructedDeg: number;
  requestedToReconstructedDeg: number;
  spectrum: CutoffPowerLawParameters;
  ritabrata: Readonly<{
    thetaDeg: number;
    phiDeg: number;
    sceneDirection: Vector3;
    raDeg: number;
    decDeg: number;
    truthAngularErrorDeg: number;
    selectedTemplateCount: number;
    maximumKsProbability: number;
  }>;
  centroid: Readonly<{
    reconstruction: BurstDirectionReconstruction;
    thetaDeg: number;
    phiDeg: number;
    selectedDatabaseToReconstructedDeg: number;
    requestedToReconstructedDeg: number;
    truthAngularErrorDeg: number;
  }>;
}>;

export type RitabrataPipelineResult = RitabrataPipelineAvailable | Readonly<{
  status: "unavailable";
  reason: string;
}>;

export function runRitabrataProvisionalPipelineFromAssets(input: Readonly<{
  requestedThetaDeg: number;
  requestedPhiDeg: number;
  spectrum: CutoffPowerLawParameters;
  radialBoresight: Vector3;
  truth: Readonly<{ raDeg: number; decDeg: number }>;
  detectorNormals: readonly Vector3[];
  frameIndex: number;
  acquisitionTimeSeconds: number;
  generatorAssets: Awaited<ReturnType<typeof loadRitabrataGrbGeneratorDirectionAssets>>;
  localizerAssets: LegacyKsAssetBundle;
}>): RitabrataPipelineResult {
  const generation = generateRitabrataGrbResponse(
    input.requestedThetaDeg,
    input.requestedPhiDeg,
    input.spectrum,
    input.generatorAssets,
  );
  if (generation.status === "unavailable") return generation;
  let observation: LegacyKsObservation;
  try {
    observation = bridgeGeneratedGrbToLegacyObservation(
      generation.response,
      input.localizerAssets,
    );
  } catch (error) {
    return Object.freeze({
      status: "unavailable",
      reason: error instanceof Error ? error.message : "bridge-failed",
    });
  }
  const localizer = computeLegacyKsLocalization(observation, input.localizerAssets);
  if ("status" in localizer) return localizer;
  const sceneDirection = rotateDetectorDirectionToScene(
    localizer.localDirection,
    input.radialBoresight,
  );
  const coordinates = sceneDirection ? sceneDirectionToRaDec(sceneDirection) : null;
  if (!sceneDirection || !coordinates) {
    return Object.freeze({ status: "unavailable", reason: "scene-adapter-failed" });
  }
  const centroid = reconstructBurstDirection({
    pixelValues: Array.from(generation.response.pixelCountsPerSecond),
    pixelBaseline: Array.from({ length: 126 }, () => 0),
    detectorNormals: input.detectorNormals,
    radialBoresight: input.radialBoresight,
    frameIndex: input.frameIndex,
    acquisitionTimeSeconds: input.acquisitionTimeSeconds,
  });
  if (centroid.status === "unavailable") return centroid;
  const reconstructedRoot = ritabrataDirectionFromAngles(localizer.thetaDeg, localizer.phiDeg);
  const selectedRoot = ritabrataDirectionFromAngles(
    generation.response.selectedDatabaseDirection.thetaDeg,
    generation.response.selectedDatabaseDirection.phiDeg,
  );
  const requestedRoot = ritabrataDirectionFromAngles(
    generation.response.requestedDirection.thetaDeg,
    generation.response.requestedDirection.phiDeg,
  );
  const rootSeparation = (first: Vector3, second: Vector3) => Math.acos(Math.max(-1, Math.min(1,
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2],
  ))) * 180 / Math.PI;
  const centroidRoot = threeDetectorLocalToRitabrata(
    createThreeDetectorLocalVector(...centroid.localDirection),
  );
  const centroidAngles = ritabrataAnglesFromDirection(centroidRoot);
  return Object.freeze({
    status: "available",
    validationStatus: "PROVISIONAL",
    method: RITABRATA_PROVISIONAL_PIPELINE_VERSION,
    localizerRootParity: "PENDING_OFFICIAL_ROOT_OUTPUTS",
    requestedDirection: generation.response.requestedDirection,
    selectedDatabaseDirection: generation.response.selectedDatabaseDirection,
    quantizationErrorDeg: generation.response.quantizationErrorDeg,
    selectedDatabaseToReconstructedDeg: rootSeparation(selectedRoot, reconstructedRoot),
    requestedToReconstructedDeg: rootSeparation(requestedRoot, reconstructedRoot),
    spectrum: generation.response.spectrum,
    ritabrata: Object.freeze({
      thetaDeg: localizer.thetaDeg,
      phiDeg: localizer.phiDeg,
      sceneDirection,
      ...coordinates,
      truthAngularErrorDeg: angularSeparationDeg(coordinates, input.truth),
      selectedTemplateCount: localizer.selectedTemplateCount,
      maximumKsProbability: localizer.maximumProbability,
    }),
    centroid: Object.freeze({
      reconstruction: centroid,
      ...centroidAngles,
      selectedDatabaseToReconstructedDeg: rootSeparation(selectedRoot, centroidRoot),
      requestedToReconstructedDeg: rootSeparation(requestedRoot, centroidRoot),
      truthAngularErrorDeg: angularSeparationDeg(centroid, input.truth),
    }),
  });
}

async function cachedLocalizerAssets(url: string): Promise<LegacyKsAssetBundle> {
  let pending = localizerAssetCache.get(url);
  if (!pending) {
    pending = loadRitabrataLocalizerAssets(url);
    localizerAssetCache.set(url, pending);
    pending.catch(() => localizerAssetCache.delete(url));
  }
  return pending;
}

export async function runRitabrataProvisionalPipeline(input: Readonly<{
  generatorManifestUrl: string;
  localizerManifestUrl: string;
  requestedThetaDeg: number;
  requestedPhiDeg: number;
  spectrum: CutoffPowerLawParameters;
  radialBoresight: Vector3;
  truth: Readonly<{ raDeg: number; decDeg: number }>;
  detectorNormals: readonly Vector3[];
  frameIndex: number;
  acquisitionTimeSeconds: number;
}>): Promise<RitabrataPipelineResult> {
  const [generatorAssets, localizerAssets] = await Promise.all([
    loadRitabrataGrbGeneratorDirectionAssets(
      input.generatorManifestUrl,
      input.requestedThetaDeg,
      input.requestedPhiDeg,
    ),
    cachedLocalizerAssets(input.localizerManifestUrl),
  ]);
  return runRitabrataProvisionalPipelineFromAssets({
    ...input,
    generatorAssets,
    localizerAssets,
  });
}
