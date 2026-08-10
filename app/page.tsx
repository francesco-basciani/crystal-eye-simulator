"use client";

import {
  Activity,
  Aperture,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Download,
  Maximize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Moon,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Body, Illumination } from "astronomy-engine";
import { AppNav } from "./components/app-nav";
import {
  AdaptiveBackgroundPanel,
  type AdaptiveAnalysisSample,
} from "./components/adaptive-background-panel";
import { createSeededRandom, samplePoisson } from "./lib/kalman-scenarios";
import { deriveCelestialReferenceFrameDirections } from "./lib/celestial-reference-frames";
import {
  ECI_EPHEMERIS_INITIAL_SAMPLE,
  ECI_EPHEMERIS_START_MS,
  greenwichMeanSiderealTimeRadians,
  loadEciEphemerisProfile,
  sampleEciEphemeris,
  slerpUnitDirection,
  type EciEphemerisProfile,
  type EciEphemerisSample,
} from "./lib/eci-ephemeris";
import {
  PIXEL_BACKGROUND_BIN_SECONDS,
  loadPixelBackgroundProfile,
  rateToExpectedCountsPerBin,
  type PixelBackgroundProfile,
} from "./lib/pixel-background";
import {
  composeModeBackgroundRate,
  composePixelSignalFrame,
  distributeSupportedTotal,
} from "./lib/signal-composition";
import {
  createPhotonRunId,
  openPhotonRepository,
  type PhotonRepository,
} from "./lib/photon-repository";
import { createParametricOrbitOverride } from "./lib/orbital-overrides";
import {
  DEFAULT_PIXEL_CONFIGURATION,
  PIXEL_CONFIGURATION_STORAGE_KEY_V1,
  PIXEL_CONFIGURATION_STORAGE_KEY_V2,
  PIXEL_CONFIGURATION_STORAGE_KEY_V3,
  PIXEL_CONFIGURATION_STORAGE_KEY_V4,
  getPixelByPhysicalId,
  hasCanonicalPixelIdBijection,
  migrateStoredPixelConfigurationToAuthoritativeIds,
  migrateStoredPixelConfigurationToPhotoGeometry,
  normalizePixelConfiguration,
  swapPhysicalPixelIds,
  type PixelConfiguration,
  type PixelConfigurationEntry,
} from "./lib/pixel-configuration";

type Sample = {
  observed: number;
  background: number;
  source: number;
};

type SignalSample = Sample & {
  frameIndex: number;
  acquisitionTimeSeconds: number;
  simulationTimeSeconds: number;
  exposureSeconds: number;
};

type EventRecord = {
  time: string;
  utc: string;
  text: string;
  kind: "system" | "background" | "grb";
};

type Telemetry = Sample & {
  elapsed: number;
  phase: number;
  total: number;
  captured: number;
  significance: number;
  grbActive: boolean;
  burstDirections: number[];
  burstPixelGroups: number[][];
  detector: number[];
  detectorHits: number[];
  detectorBackgroundRates: number[];
  detectorBackgroundExpectedCounts: number[];
  simulatedDate: string;
  altitudeKm: number;
  canonicalAltitudeKm: number;
  canonicalSatelliteDirection: [number, number, number];
  satelliteDirection: [number, number, number];
  geocentricSunDirection: [number, number, number];
  geocentricMoonDirection: [number, number, number];
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  sunSeparation: number;
  moonSeparation: number;
  sunNoise: number;
  sunExposure: number;
  moonNoise: number;
  sunInFov: boolean;
  moonInFov: boolean;
  moonDistanceKm: number;
  moonPhase: number;
  earthIllumination: number;
  earthAlbedoNoise: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
};

type PixelLayout = {
  index: number;
  ring: number;
  slot: number;
  count: number;
  angle: number;
  radius: number;
};

type BurstEvent = {
  id: number;
  pixelId: number;
  pixelIds: number[];
  transmission: number;
  intensity: number;
  raDeg: number;
  decDeg: number;
  ageTicks: number;
  ticksRemaining: number;
  origin: "manual" | "automatic";
};

type TestBurstDraft = {
  raDeg: number;
  decDeg: number;
  intensity: number;
  spreadPixels: number;
  durationSeconds: number;
};

type CameraMode = "orbit" | "satellite";
type OrbitScenarioMode = "canonical" | "parametric";
type SimulatorMode = "reference" | "simulation";
type WorkspaceFocus = "analysis" | "detector" | null;

const DEFAULT_SIMULATION_SEED = 0x4345_1000;
const AUTOMATIC_GRB_INITIAL_DELAY_BINS = 50;
const AUTOMATIC_GRB_MINIMUM_GAP_BINS = 90;
const AUTOMATIC_GRB_GAP_RANGE_BINS = 61;
const AUTOMATIC_GRB_MINIMUM_DURATION_SECONDS = 0.8;
const AUTOMATIC_GRB_DURATION_RANGE_SECONDS = 1.6;

function createBaselineSamples(background: number, count = 80): SignalSample[] {
  return Array.from({ length: count }, (_, index) => ({
    frameIndex: index - count,
    acquisitionTimeSeconds:
      (index - count) * PIXEL_BACKGROUND_BIN_SECONDS,
    simulationTimeSeconds: (index - count) * PIXEL_BACKGROUND_BIN_SECONDS,
    exposureSeconds: PIXEL_BACKGROUND_BIN_SECONDS,
    background,
    source: 0,
    observed: background,
  }));
}

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const TIME_WARP_PRESETS = [1, 50, 200, 500] as const;
const DEFAULT_ORBIT_ALTITUDE_KM = 550;
const MIN_ORBIT_ALTITUDE_KM = 400;
const MAX_ORBIT_ALTITUDE_KM = 700;
const DEFAULT_ORBIT_INCLINATION_DEG = 20;
const MIN_ORBIT_INCLINATION_DEG = 0;
const MAX_ORBIT_INCLINATION_DEG = 60;
const MIN_TIME_WARP = 1;
const MAX_TIME_WARP = 500;
const PIXEL_RING_COUNTS = [1, 6, 12, 18, 24, 30, 35] as const;
const GRAY_CLUSTER_COUNT = 6;
const GRAY_CLUSTER_SIZE = 16;
const PIXEL_LAYOUT: PixelLayout[] = PIXEL_RING_COUNTS.flatMap((count, ring) =>
  Array.from({ length: count }, (_, slot) => {
    const index =
      PIXEL_RING_COUNTS.slice(0, ring).reduce((sum, value) => sum + value, 0) +
      slot;
    const offset = ring % 2 === 0 ? Math.PI / Math.max(1, count) : 0;
    return {
      index,
      ring,
      slot,
      count,
      angle: count === 1 ? 0 : (slot / count) * Math.PI * 2 + offset,
      radius: ring / (PIXEL_RING_COUNTS.length - 1),
    };
  }),
);

function getPentagonPixelIndices(configuration: PixelConfiguration) {
  return new Set(
    configuration.pixels
      .map((pixel, geometrySlot) => ({ pixel, geometrySlot }))
      .filter(({ pixel }) => pixel.isPentagon)
      .map(({ geometrySlot }) => geometrySlot),
  );
}
const PIXEL_NORMALS: [number, number, number][] = PIXEL_LAYOUT.map((pixel) => {
  const polar = THREE.MathUtils.lerp(0.04, Math.PI / 2 - 0.045, pixel.radius);
  return normalizeVector(
    Math.sin(polar) * Math.cos(pixel.angle),
    Math.cos(polar),
    Math.sin(polar) * Math.sin(pixel.angle),
  );
});

type ConfiguredPixelProjection = {
  normalsByPhysicalPixelId: [number, number, number][];
  sphereSlotByPhysicalPixelId: number[];
};

const configuredPixelProjectionCache = new WeakMap<
  PixelConfiguration,
  ConfiguredPixelProjection
>();

function getConfiguredPixelProjection(
  configuration: PixelConfiguration,
): ConfiguredPixelProjection {
  const cached = configuredPixelProjectionCache.get(configuration);
  if (cached) return cached;
  const planarCoordinates = configuration.pixels.map((pixel) => ({
    x: ((pixel.x - 50) / 50) * 1.18,
    z: (50 - pixel.y) / 50,
  }));
  const maximumRadius = Math.max(
    0.01,
    ...planarCoordinates.map(({ x, z }) => Math.hypot(x, z)),
  );

  const targetNormals = planarCoordinates.map(({ x, z }) => {
    const planarRadius = Math.hypot(x, z);
    if (planarRadius < 0.0001) return [0, 1, 0] as [number, number, number];
    const radialFraction = THREE.MathUtils.clamp(
      planarRadius / maximumRadius,
      0,
      1,
    );
    const polar = THREE.MathUtils.lerp(
      0.025,
      Math.PI / 2 - 0.045,
      radialFraction,
    );
    const horizontal = Math.sin(polar);
    return normalizeVector(
      horizontal * (x / planarRadius),
      Math.cos(polar),
      horizontal * (z / planarRadius),
    );
  });

  const size = targetNormals.length;
  const rowPotentials = new Float64Array(size + 1);
  const columnPotentials = new Float64Array(size + 1);
  const columnMatches = new Int32Array(size + 1);
  const previousColumns = new Int32Array(size + 1);

  for (let row = 1; row <= size; row += 1) {
    columnMatches[0] = row;
    let currentColumn = 0;
    const minimumReducedCosts = new Float64Array(size + 1);
    minimumReducedCosts.fill(Number.POSITIVE_INFINITY);
    const usedColumns = new Uint8Array(size + 1);

    do {
      usedColumns[currentColumn] = 1;
      const currentRow = columnMatches[currentColumn];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;

      for (let column = 1; column <= size; column += 1) {
        if (usedColumns[column]) continue;
        const target = targetNormals[currentRow - 1];
        const physical = PIXEL_NORMALS[column - 1];
        const angularCost =
          1 -
          (target[0] * physical[0] +
            target[1] * physical[1] +
            target[2] * physical[2]);
        const reducedCost =
          angularCost -
          rowPotentials[currentRow] -
          columnPotentials[column];

        if (reducedCost < minimumReducedCosts[column]) {
          minimumReducedCosts[column] = reducedCost;
          previousColumns[column] = currentColumn;
        }
        if (minimumReducedCosts[column] < delta) {
          delta = minimumReducedCosts[column];
          nextColumn = column;
        }
      }

      for (let column = 0; column <= size; column += 1) {
        if (usedColumns[column]) {
          rowPotentials[columnMatches[column]] += delta;
          columnPotentials[column] -= delta;
        } else {
          minimumReducedCosts[column] -= delta;
        }
      }
      currentColumn = nextColumn;
    } while (columnMatches[currentColumn] !== 0);

    do {
      const previousColumn = previousColumns[currentColumn];
      columnMatches[currentColumn] = columnMatches[previousColumn];
      currentColumn = previousColumn;
    } while (currentColumn !== 0);
  }

  const physicalSlotByPixel = new Int32Array(size);
  for (let column = 1; column <= size; column += 1) {
    physicalSlotByPixel[columnMatches[column] - 1] = column - 1;
  }

  const normalsByGeometrySlot = Array.from(
    physicalSlotByPixel,
    (physicalSlot) => PIXEL_NORMALS[physicalSlot],
  );
  const normalsByPhysicalPixelId: [number, number, number][] = Array.from(
    { length: size },
    () => [0, 1, 0],
  );
  const sphereSlotByPhysicalPixelId = Array.from({ length: size }, () => 0);
  configuration.pixels.forEach((pixel, geometrySlot) => {
    normalsByPhysicalPixelId[pixel.pixelId] = normalsByGeometrySlot[geometrySlot];
    sphereSlotByPhysicalPixelId[pixel.pixelId] =
      physicalSlotByPixel[geometrySlot];
  });
  const projection = {
    normalsByPhysicalPixelId,
    sphereSlotByPhysicalPixelId,
  };
  configuredPixelProjectionCache.set(configuration, projection);
  return projection;
}

function getConfiguredPixelNormals(
  configuration: PixelConfiguration,
): [number, number, number][] {
  return getConfiguredPixelProjection(configuration).normalsByPhysicalPixelId;
}

function getConfiguredPixelSphereSlots(
  configuration: PixelConfiguration,
): number[] {
  return getConfiguredPixelProjection(configuration).sphereSlotByPhysicalPixelId;
}

function getConfiguredPixelDistance(
  configuration: PixelConfiguration,
  pixelId: number,
  sourcePixelId: number,
) {
  const pixel = getPixelByPhysicalId(configuration, pixelId);
  const source = getPixelByPhysicalId(configuration, sourcePixelId);
  if (!pixel || !source) return Number.POSITIVE_INFINITY;
  return Math.hypot(pixel.x - source.x, pixel.y - source.y);
}

function getConfiguredBurstIncidence(
  configuration: PixelConfiguration,
  pixelId: number,
  sourcePixelId: number,
) {
  const distance = getConfiguredPixelDistance(
    configuration,
    pixelId,
    sourcePixelId,
  );
  return 1 / (1 + (distance / 8.5) ** 2);
}

function getBurstFootprint(
  configuration: PixelConfiguration,
  sourcePixelId: number,
  pixelCount: number,
) {
  return configuration.pixels
    .map((pixel) => ({
      pixelId: pixel.pixelId,
      distance: getConfiguredPixelDistance(
        configuration,
        pixel.pixelId,
        sourcePixelId,
      ),
    }))
    .sort((a, b) => a.distance - b.distance || a.pixelId - b.pixelId)
    .slice(0, THREE.MathUtils.clamp(pixelCount, 1, PIXEL_LAYOUT.length))
    .map(({ pixelId }) => pixelId);
}

function getMountEdgeExposure(
  sphereSlot: number,
  mountX: number,
  mountZ: number,
) {
  const pixel = PIXEL_LAYOUT[sphereSlot];
  const satelliteHalfSizeCm = 30;
  const detectorRadiusCm = 15;
  const centerX = mountX * satelliteHalfSizeCm;
  const centerZ = mountZ * satelliteHalfSizeCm;
  const rimX = centerX + Math.cos(pixel.angle) * detectorRadiusCm;
  const rimZ = centerZ + Math.sin(pixel.angle) * detectorRadiusCm;
  const clearanceCm = Math.min(
    satelliteHalfSizeCm - Math.abs(rimX),
    satelliteHalfSizeCm - Math.abs(rimZ),
  );
  if (clearanceCm <= 0) return 1;
  return THREE.MathUtils.clamp(Math.exp(-clearanceCm / 4.5) * 0.12, 0.015, 1);
}

function getMountSkyVisibility(
  sphereSlot: number,
  mountX: number,
  mountZ: number,
) {
  const horizonWeight = PIXEL_LAYOUT[sphereSlot].radius ** 3.4;
  return THREE.MathUtils.lerp(
    1,
    getMountEdgeExposure(sphereSlot, mountX, mountZ),
    horizonWeight,
  );
}

function getMountAlbedoTransmission(mountX: number, mountZ: number) {
  const rimPixels = PIXEL_LAYOUT.filter(
    (pixel) => pixel.ring === PIXEL_RING_COUNTS.length - 1,
  );
  return (
    rimPixels.reduce(
      (sum, pixel) => sum + getMountEdgeExposure(pixel.index, mountX, mountZ),
      0,
    ) / rimPixels.length
  );
}

function getMountHorizonVisibility(mountX: number, mountZ: number) {
  const horizonPixels = PIXEL_LAYOUT.filter((pixel) => pixel.ring >= 5);
  return (
    horizonPixels.reduce(
      (sum, pixel) =>
        sum + getMountSkyVisibility(pixel.index, mountX, mountZ),
      0,
    ) / horizonPixels.length
  );
}

function getMountEffectiveFov(mountX: number, mountZ: number) {
  return 92 + getMountHorizonVisibility(mountX, mountZ) * 38;
}

function getEarthAlbedoResponse(
  sphereSlot: number,
  illumination: number,
  azimuth: number,
  directional: number,
  mountX = 0,
  mountZ = 0,
) {
  const pixel = PIXEL_LAYOUT[sphereSlot];
  const rimWeight = pixel.ring === PIXEL_RING_COUNTS.length - 1 ? 1 : 0;
  if (rimWeight === 0 || illumination <= 0.01) return 0;
  const delta = Math.atan2(
    Math.sin(pixel.angle - azimuth),
    Math.cos(pixel.angle - azimuth),
  );
  const directionalLobe = Math.max(0, Math.cos(delta)) ** 1.7;
  const azimuthWeight = THREE.MathUtils.lerp(
    0.42,
    0.08 + directionalLobe * 0.92,
    directional,
  );
  return (
    rimWeight *
    illumination *
    azimuthWeight *
    getMountEdgeExposure(sphereSlot, mountX, mountZ)
  );
}

function deterministicUnit(index: number, salt: number) {
  return Math.abs(Math.sin(index * 91.713 + salt * 47.117) * 43758.5453) % 1;
}

function isPixelLitByEarthAlbedo(
  sphereSlot: number,
  illumination: number,
  azimuth: number,
  directional: number,
  mountX = 0,
  mountZ = 0,
) {
  return getEarthAlbedoResponse(
    sphereSlot,
    illumination,
    azimuth,
    directional,
    mountX,
    mountZ,
  ) >= 0.12;
}

function getDirectionalPixelWeights(
  direction: [number, number, number],
  boresight: [number, number, number],
  configuration: PixelConfiguration,
  mountX: number,
  mountZ: number,
) {
  const inverseOrientation = new THREE.Quaternion()
    .setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3().fromArray(boresight),
    )
    .invert();
  const localDirection = new THREE.Vector3()
    .fromArray(direction)
    .applyQuaternion(inverseOrientation)
    .normalize();
  const normals = getConfiguredPixelNormals(configuration);
  const sphereSlots = getConfiguredPixelSphereSlots(configuration);
  return normals.map((normal, pixelId) => {
    const incidence = Math.max(
      0,
      normal[0] * localDirection.x +
        normal[1] * localDirection.y +
        normal[2] * localDirection.z,
    );
    return (
      incidence ** 2 *
      getMountSkyVisibility(sphereSlots[pixelId], mountX, mountZ)
    );
  });
}

function getAggregateBurstSourceCounts(activeBursts: readonly BurstEvent[]) {
  return Math.round(
    activeBursts.reduce(
      (sum, burst) =>
        sum +
        135 *
          (burst.intensity / 100) *
          burst.transmission *
          Math.exp(-burst.ageTicks / 5.5),
      0,
    ),
  );
}

function createDetectorExpectedResponse({
  mode,
  pixelBackground,
  configuration,
  boresight,
  sunDirection,
  moonDirection,
  sunRateCountsPerSecond,
  moonRateCountsPerSecond,
  earthRateCountsPerSecond,
  earthIllumination,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
  mountX,
  mountZ,
  activeBursts,
  aggregateSourceCounts,
}: {
  mode: SimulatorMode;
  pixelBackground: PixelBackgroundProfile | null;
  configuration: PixelConfiguration;
  boresight: [number, number, number];
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  sunRateCountsPerSecond: number;
  moonRateCountsPerSecond: number;
  earthRateCountsPerSecond: number;
  earthIllumination: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
  mountX: number;
  mountZ: number;
  activeBursts: readonly BurstEvent[];
  aggregateSourceCounts: number;
}) {
  if (mode === "reference" && !pixelBackground) {
    throw new Error("Reference Mode requires the Rito pixel background profile.");
  }
  const pixelCount = configuration.pixels.length;
  const sphereSlots = getConfiguredPixelSphereSlots(configuration);
  const sunAllocation = distributeSupportedTotal(
    rateToExpectedCountsPerBin(sunRateCountsPerSecond),
    getDirectionalPixelWeights(
      sunDirection,
      boresight,
      configuration,
      mountX,
      mountZ,
    ),
  );
  const moonAllocation = distributeSupportedTotal(
    rateToExpectedCountsPerBin(moonRateCountsPerSecond),
    getDirectionalPixelWeights(
      moonDirection,
      boresight,
      configuration,
      mountX,
      mountZ,
    ),
  );
  const earthWeights = Array.from({ length: pixelCount }, (_, pixelId) => {
    const response = getEarthAlbedoResponse(
      sphereSlots[pixelId],
      earthIllumination,
      earthAlbedoAzimuth,
      earthAlbedoDirectional,
      mountX,
      mountZ,
    );
    return response >= 0.12 ? response : 0;
  });
  const earthAllocation = distributeSupportedTotal(
    rateToExpectedCountsPerBin(earthRateCountsPerSecond),
    earthWeights,
  );
  const burstWeights = Array.from({ length: pixelCount }, () => 0);
  activeBursts.forEach((burst) => {
    const temporalResponse = Math.exp(-burst.ageTicks / 5.5);
    const componentWeight =
      (burst.intensity / 100) * burst.transmission * temporalResponse;
    burst.pixelIds.forEach((pixelId) => {
      burstWeights[pixelId] +=
        componentWeight *
        getConfiguredBurstIncidence(configuration, pixelId, burst.pixelId) ** 2.2;
    });
  });
  const sourceAllocation = distributeSupportedTotal(
    aggregateSourceCounts,
    burstWeights,
  );
  const composedPixels = composePixelSignalFrame({
    mode,
    pixelCount,
    ritoExpectedCountsPerBin: pixelBackground?.expectedCountsPerBin ?? null,
    sunExpectedCountsPerBin: sunAllocation.values,
    moonExpectedCountsPerBin: moonAllocation.values,
    earthExpectedCountsPerBin: earthAllocation.values,
    sourceExpectedCountsPerBin: sourceAllocation.values,
  });
  const detectorImpact = Array.from({ length: pixelCount }, (_, pixelId) => {
    const earthImpact = THREE.MathUtils.clamp(earthWeights[pixelId] * 0.42, 0, 0.42);
    const burstImpact = activeBursts.reduce((maximum, burst) => {
      if (!burst.pixelIds.includes(pixelId)) return maximum;
      const incidence = getConfiguredBurstIncidence(
        configuration,
        pixelId,
        burst.pixelId,
      );
      return Math.max(
        maximum,
        (burst.intensity / 100) *
          incidence ** 2.2 *
          Math.exp(-Math.max(0, burst.ageTicks - 1) / 5),
      );
    }, 0);
    return THREE.MathUtils.clamp(Math.max(earthImpact, burstImpact), 0, 1);
  });

  return {
    detectorHits: composedPixels.expected,
    detectorImpact,
    backgroundExpectedCounts: composedPixels.background,
    aggregateBackgroundExpectedCounts: composedPixels.background.reduce(
      (sum, counts) => sum + counts,
      0,
    ),
    aggregateSourceExpectedCounts: sourceAllocation.allocatedTotal,
    backgroundRates: composedPixels.background.map(
      (counts) => counts / PIXEL_BACKGROUND_BIN_SECONDS,
    ),
    componentExpectedCounts: {
      rito: composedPixels.components.rito,
      sun: sunAllocation.values,
      moon: moonAllocation.values,
      earth: earthAllocation.values,
      source: sourceAllocation.values,
    },
    unsupportedExpectedCounts: {
      sun: sunAllocation.unsupportedTotal,
      moon: moonAllocation.unsupportedTotal,
      earth: earthAllocation.unsupportedTotal,
      source: sourceAllocation.unsupportedTotal,
    },
  };
}

const BURST_DURATION_TICKS = 15;
const DIRECT_SUN_BACKGROUND_RATE = 260;
const EARTH_RADIUS_KM = 6371;
const DISPLAY_INTERPOLATION_MS = 220;
const EFFECTIVE_FOV_DEG = 130;
const EFFECTIVE_HALF_ANGLE_DEG = EFFECTIVE_FOV_DEG / 2;
const BASE_PIXEL_COLOR = "#1739b8";
const ACTIVE_IMPACT_COLOR_STOPS = [
  { value: 0, color: "#00bce8" },
  { value: 0.38, color: "#28d66f" },
  { value: 0.72, color: "#f2e616" },
  { value: 1, color: "#ff2217" },
] as const;

function normalizeVector(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function angleBetween(
  a: [number, number, number],
  b: [number, number, number],
) {
  const cosine = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return THREE.MathUtils.radToDeg(Math.acos(cosine));
}

function getImpactColor(value: number) {
  const normalized = THREE.MathUtils.clamp(value, 0, 1);
  if (normalized <= 0) return BASE_PIXEL_COLOR;
  const upperIndex = ACTIVE_IMPACT_COLOR_STOPS.findIndex(
    (stop) => stop.value >= normalized,
  );
  if (upperIndex <= 0) return ACTIVE_IMPACT_COLOR_STOPS[0].color;
  const lower = ACTIVE_IMPACT_COLOR_STOPS[upperIndex - 1];
  const upper = ACTIVE_IMPACT_COLOR_STOPS[upperIndex];
  const fraction = (normalized - lower.value) / (upper.value - lower.value);
  return `#${new THREE.Color(lower.color)
    .lerp(new THREE.Color(upper.color), fraction)
    .getHexString()}`;
}

function getBackgroundBlueColor(value: number) {
  return `#${new THREE.Color("#102d91")
    .lerp(new THREE.Color("#2389cf"), THREE.MathUtils.clamp(value, 0, 1))
    .getHexString()}`;
}

const IMPACT_THREE_COLORS = Array.from(
  { length: 101 },
  (_, index) => new THREE.Color(getImpactColor(index / 100)),
);
const WHITE_THREE_COLOR = new THREE.Color(0xffffff);

function equatorialToSceneDirection(raDeg: number, decDeg: number) {
  const rightAscension = THREE.MathUtils.degToRad(
    ((raDeg % 360) + 360) % 360,
  );
  const declination = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(decDeg, -90, 90),
  );
  const equatorialX = Math.cos(declination) * Math.cos(rightAscension);
  const equatorialY = Math.cos(declination) * Math.sin(rightAscension);
  const equatorialZ = Math.sin(declination);
  return normalizeVector(equatorialX, equatorialZ, equatorialY);
}

function sceneDirectionToEquatorial(direction: [number, number, number]) {
  return {
    raDeg:
      ((THREE.MathUtils.radToDeg(Math.atan2(direction[2], direction[0])) %
        360) +
        360) %
      360,
    decDeg: THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(direction[1], -1, 1)),
    ),
  };
}

function getMountedDirectionVisibility(
  direction: [number, number, number],
  boresight: [number, number, number],
  mountX: number,
  mountZ: number,
) {
  const inverseOrientation = new THREE.Quaternion()
    .setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3().fromArray(boresight),
    )
    .invert();
  const localDirection = new THREE.Vector3()
    .fromArray(direction)
    .applyQuaternion(inverseOrientation)
    .normalize();
  let bestPixelIndex = 0;
  let bestDot = -Infinity;
  PIXEL_NORMALS.forEach((normal, index) => {
    const dot =
      normal[0] * localDirection.x +
      normal[1] * localDirection.y +
      normal[2] * localDirection.z;
    if (dot > bestDot) {
      bestDot = dot;
      bestPixelIndex = index;
    }
  });
  return getMountSkyVisibility(bestPixelIndex, mountX, mountZ);
}

function getCelestialGeometry(
  sample: EciEphemerisSample,
  scenarioMode: OrbitScenarioMode = "canonical",
  altitudeOverrideKm = DEFAULT_ORBIT_ALTITUDE_KM,
  inclinationOverrideDeg = DEFAULT_ORBIT_INCLINATION_DEG,
) {
  const date = new Date(sample.timestampMs);
  const moonIllumination = Illumination(Body.Moon, date);
  const mapFromEquatorial = (x: number, y: number, z: number) => [x, z, y] as const;
  const mappedCanonicalSatellite = mapFromEquatorial(...sample.satelliteKm);
  const canonicalSatelliteDirection = normalizeVector(...mappedCanonicalSatellite);
  const canonicalSatelliteRadiusKm = Math.hypot(...sample.satelliteKm);
  const canonicalAltitudeKm = canonicalSatelliteRadiusKm - EARTH_RADIUS_KM;
  const selectedSatelliteEciKm =
    scenarioMode === "canonical"
      ? sample.satelliteKm
      : createParametricOrbitOverride(
          sample,
          EARTH_RADIUS_KM + altitudeOverrideKm,
          inclinationOverrideDeg,
        ).satelliteEciKm;
  const referenceFrames = deriveCelestialReferenceFrameDirections(
    sample,
    selectedSatelliteEciKm,
  );
  const satelliteRadiusKm = Math.hypot(...selectedSatelliteEciKm);
  const altitudeKm = satelliteRadiusKm - EARTH_RADIUS_KM;
  const satelliteDirection = normalizeVector(
    ...mapFromEquatorial(...referenceFrames.satelliteGeocentric),
  );
  const geocentricSunDirection = normalizeVector(
    ...mapFromEquatorial(...referenceFrames.sunGeocentric),
  );
  const geocentricMoonDirection = normalizeVector(
    ...mapFromEquatorial(...referenceFrames.moonGeocentric),
  );
  const sunDirection = normalizeVector(
    ...mapFromEquatorial(...referenceFrames.sunTopocentric),
  );
  const moonDirection = normalizeVector(
    ...mapFromEquatorial(...referenceFrames.moonTopocentric),
  );
  const sunSeparation = referenceFrames.sunBoresightSeparationDeg;
  const moonSeparation = referenceFrames.moonBoresightSeparationDeg;
  const sunInFov = sunSeparation <= EFFECTIVE_HALF_ANGLE_DEG;
  const moonInFov = moonSeparation <= EFFECTIVE_HALF_ANGLE_DEG;
  const angularResponse = (separation: number) =>
    Math.max(0, Math.cos(THREE.MathUtils.degToRad(separation))) ** 2;
  const sunNoise = sunInFov
    ? DIRECT_SUN_BACKGROUND_RATE * angularResponse(sunSeparation)
    : 0;
  const moonNoise = moonInFov
    ? 22 * angularResponse(moonSeparation) * (0.3 + 0.7 * moonIllumination.phase_fraction)
    : 0;
  const sunBoresightDot =
    sunDirection[0] * satelliteDirection[0] +
    sunDirection[1] * satelliteDirection[1] +
    sunDirection[2] * satelliteDirection[2];
  const earthIllumination = THREE.MathUtils.clamp(
    (1 + sunBoresightDot) / 2,
    0,
    1,
  );
  const detectorOrientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3().fromArray(satelliteDirection),
  );
  const localSun = new THREE.Vector3()
    .fromArray(sunDirection)
    .applyQuaternion(detectorOrientation.invert());
  const earthAlbedoDirectional = THREE.MathUtils.clamp(
    Math.hypot(localSun.x, localSun.z),
    0,
    1,
  );
  const earthAlbedoAzimuth =
    earthAlbedoDirectional > 1e-4 ? Math.atan2(localSun.z, localSun.x) : 0;
  const earthAngularScale = (EARTH_RADIUS_KM / satelliteRadiusKm) ** 2;
  const earthAlbedoNoise =
    85 * earthAngularScale * earthIllumination ** 1.35;

  return {
    date,
    altitudeKm,
    canonicalAltitudeKm,
    canonicalSatelliteDirection,
    satelliteDirection,
    geocentricSunDirection,
    geocentricMoonDirection,
    sunDirection,
    moonDirection,
    sunSeparation,
    moonSeparation,
    sunInFov,
    moonInFov,
    sunNoise,
    moonNoise,
    moonDistanceKm: Math.hypot(
      sample.moonKm[0] - selectedSatelliteEciKm[0],
      sample.moonKm[1] - selectedSatelliteEciKm[1],
      sample.moonKm[2] - selectedSatelliteEciKm[2],
    ),
    moonPhase: moonIllumination.phase_fraction,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
  };
}

const INITIAL_CELESTIAL = getCelestialGeometry(ECI_EPHEMERIS_INITIAL_SAMPLE);
const INITIAL_MOUNT_SUN_NOISE =
  INITIAL_CELESTIAL.sunSeparation <= getMountEffectiveFov(0, 0) / 2
    ? INITIAL_CELESTIAL.sunNoise *
      getMountedDirectionVisibility(
        INITIAL_CELESTIAL.sunDirection,
        INITIAL_CELESTIAL.satelliteDirection,
        0,
        0,
      )
    : 0;
const INITIAL_MOUNT_MOON_NOISE =
  INITIAL_CELESTIAL.moonNoise *
  getMountedDirectionVisibility(
    INITIAL_CELESTIAL.moonDirection,
    INITIAL_CELESTIAL.satelliteDirection,
    0,
    0,
  );
const INITIAL_MOUNT_ALBEDO_NOISE =
  INITIAL_CELESTIAL.earthAlbedoNoise * getMountAlbedoTransmission(0, 0);
const DEFAULT_PIXEL_SPHERE_SLOTS = getConfiguredPixelSphereSlots(
  DEFAULT_PIXEL_CONFIGURATION,
);
const INITIAL_DETECTOR_HITS = PIXEL_LAYOUT.map((pixel) => {
  const response = getEarthAlbedoResponse(
    DEFAULT_PIXEL_SPHERE_SLOTS[pixel.index],
    INITIAL_CELESTIAL.earthIllumination,
    INITIAL_CELESTIAL.earthAlbedoAzimuth,
    INITIAL_CELESTIAL.earthAlbedoDirectional,
  );
  return response >= 0.12
    ? Math.max(1, Math.round((response * INITIAL_CELESTIAL.earthAlbedoNoise) / 18))
    : 0;
});

const INITIAL_TELEMETRY: Telemetry = {
  observed: 0,
  background: 0,
  source: 0,
  elapsed: 0,
  phase: 0,
  total: 0,
  captured: 0,
  significance: 0,
  grbActive: false,
  burstDirections: [],
  burstPixelGroups: [],
  detector: INITIAL_DETECTOR_HITS.map((hits) => (hits > 0 ? 0.55 : 0)),
  detectorHits: INITIAL_DETECTOR_HITS,
  detectorBackgroundRates: PIXEL_LAYOUT.map(() => 0),
  detectorBackgroundExpectedCounts: PIXEL_LAYOUT.map(() => 0),
  simulatedDate: INITIAL_CELESTIAL.date.toISOString(),
  altitudeKm: INITIAL_CELESTIAL.altitudeKm,
  canonicalAltitudeKm: INITIAL_CELESTIAL.canonicalAltitudeKm,
  canonicalSatelliteDirection: INITIAL_CELESTIAL.canonicalSatelliteDirection,
  satelliteDirection: INITIAL_CELESTIAL.satelliteDirection,
  geocentricSunDirection: INITIAL_CELESTIAL.geocentricSunDirection,
  geocentricMoonDirection: INITIAL_CELESTIAL.geocentricMoonDirection,
  sunDirection: INITIAL_CELESTIAL.sunDirection,
  moonDirection: INITIAL_CELESTIAL.moonDirection,
  sunSeparation: INITIAL_CELESTIAL.sunSeparation,
  moonSeparation: INITIAL_CELESTIAL.moonSeparation,
  sunNoise: INITIAL_MOUNT_SUN_NOISE,
  sunExposure: INITIAL_MOUNT_SUN_NOISE / DIRECT_SUN_BACKGROUND_RATE,
  moonNoise: INITIAL_MOUNT_MOON_NOISE,
  sunInFov: INITIAL_CELESTIAL.sunInFov,
  moonInFov: INITIAL_CELESTIAL.moonInFov,
  moonDistanceKm: INITIAL_CELESTIAL.moonDistanceKm,
  moonPhase: INITIAL_CELESTIAL.moonPhase,
  earthIllumination: INITIAL_CELESTIAL.earthIllumination,
  earthAlbedoNoise: INITIAL_MOUNT_ALBEDO_NOISE,
  earthAlbedoAzimuth: INITIAL_CELESTIAL.earthAlbedoAzimuth,
  earthAlbedoDirectional: INITIAL_CELESTIAL.earthAlbedoDirectional,
};

function formatTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function GlobeScene({
  altitude,
  scenarioMode,
  simulatorMode,
  paused,
  simulatedTimestampMs,
  grbActive,
  burstDirections,
  burstPixelGroups,
  pixelConfiguration,
  selectedPixel,
  satelliteDirection,
  geocentricSunDirection,
  geocentricMoonDirection,
  sunNoise,
  moonNoise,
  earthIllumination,
  earthAlbedoNoise,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
  detectorIntensity,
  detectorHits,
  mountX,
  mountZ,
  cameraMode,
  onCameraModeChange,
  systemZoom,
  onSystemZoomChange,
}: {
  altitude: number;
  scenarioMode: OrbitScenarioMode;
  simulatorMode: SimulatorMode;
  paused: boolean;
  simulatedTimestampMs: number;
  grbActive: boolean;
  burstDirections: number[];
  burstPixelGroups: number[][];
  pixelConfiguration: PixelConfiguration;
  selectedPixel: number;
  satelliteDirection: [number, number, number];
  geocentricSunDirection: [number, number, number];
  geocentricMoonDirection: [number, number, number];
  sunNoise: number;
  moonNoise: number;
  earthIllumination: number;
  earthAlbedoNoise: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
  detectorIntensity: number[];
  detectorHits: number[];
  mountX: number;
  mountZ: number;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  systemZoom: number;
  onSystemZoomChange: (value: number) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef({
    altitude,
    paused,
    simulatedTimestampMs,
    grbActive,
    burstDirections,
    burstPixelGroups,
    pixelConfiguration,
    selectedPixel,
    satelliteDirection,
    sunDirection: geocentricSunDirection,
    moonDirection: geocentricMoonDirection,
    sunNoise,
    moonNoise,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
    detectorIntensity,
    detectorHits,
    mountX,
    mountZ,
    cameraMode,
    systemZoom,
  });

  useEffect(() => {
    settingsRef.current = {
      altitude,
      paused,
      simulatedTimestampMs,
      grbActive,
      burstDirections,
      burstPixelGroups,
      pixelConfiguration,
      selectedPixel,
      satelliteDirection,
      sunDirection: geocentricSunDirection,
      moonDirection: geocentricMoonDirection,
      sunNoise,
      moonNoise,
      earthIllumination,
      earthAlbedoNoise,
      earthAlbedoAzimuth,
      earthAlbedoDirectional,
      detectorIntensity,
      detectorHits,
      mountX,
      mountZ,
      cameraMode,
      systemZoom,
    };
  }, [
    altitude,
    paused,
    simulatedTimestampMs,
    grbActive,
    burstDirections,
    burstPixelGroups,
    pixelConfiguration,
    selectedPixel,
    satelliteDirection,
    geocentricSunDirection,
    geocentricMoonDirection,
    sunNoise,
    moonNoise,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
    detectorIntensity,
    detectorHits,
    mountX,
    mountZ,
    cameraMode,
    systemZoom,
  ]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02070d, 0.045);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0.2, 2.3, 8.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
    renderer.setClearColor(0x02070d, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x4f7191, 0.38);
    const sunLight = new THREE.DirectionalLight(0xfff4dc, 3.8);
    sunLight.position.set(-5, 3, 5);
    scene.add(ambient, sunLight);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(900 * 3);
    for (let index = 0; index < 900; index += 1) {
      const radius = 14 + deterministicUnit(index, 1) * 22;
      const theta = deterministicUnit(index, 2) * Math.PI * 2;
      const phi = Math.acos(2 * deterministicUnit(index, 3) - 1);
      starPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[index * 3 + 1] = radius * Math.cos(phi);
      starPositions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xc8e7ff,
        size: 0.025,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true,
      }),
    );
    scene.add(stars);

    const textureLoader = new THREE.TextureLoader();
    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const prepareTexture = (texture: THREE.Texture, colorTexture = false) => {
      texture.anisotropy = maxAnisotropy;
      if (colorTexture) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    };
    const earthDayTexture = prepareTexture(
      textureLoader.load(`${PUBLIC_BASE_PATH}/textures/earth/day.jpg`),
      true,
    );
    const earthNightTexture = prepareTexture(
      textureLoader.load(`${PUBLIC_BASE_PATH}/textures/earth/night.png`),
      true,
    );
    const earthNormalTexture = prepareTexture(
      textureLoader.load(`${PUBLIC_BASE_PATH}/textures/earth/normal.jpg`),
    );
    const earthSpecularTexture = prepareTexture(
      textureLoader.load(`${PUBLIC_BASE_PATH}/textures/earth/specular.jpg`),
    );
    const earthCloudTexture = prepareTexture(
      textureLoader.load(`${PUBLIC_BASE_PATH}/textures/earth/clouds.png`),
      true,
    );

    const earthGeometry = new THREE.SphereGeometry(2.05, 96, 64);
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: earthDayTexture,
      normalMap: earthNormalTexture,
      normalScale: new THREE.Vector2(0.48, 0.48),
      specularMap: earthSpecularTexture,
      specular: new THREE.Color(0x6f91a8),
      shininess: 18,
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);

    const nightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        nightMap: { value: earthNightTexture },
        lightDirection: { value: new THREE.Vector3(-1, 0.5, 1).normalize() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D nightMap;
        uniform vec3 lightDirection;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          float sunlight = dot(normalize(vWorldNormal), normalize(lightDirection));
          float darkness = 1.0 - smoothstep(-0.22, 0.16, sunlight);
          float twilight = 1.0 - smoothstep(-0.35, -0.05, sunlight);
          vec3 cities = texture2D(nightMap, vUv).rgb;
          float luminance = max(cities.r, max(cities.g, cities.b));
          vec3 warmLights = cities * vec3(1.12, 0.86, 0.58);
          gl_FragColor = vec4(warmLights * darkness * (1.15 + twilight * 0.35), luminance * darkness);
        }
      `,
    });
    const nightLights = new THREE.Mesh(
      new THREE.SphereGeometry(2.056, 96, 64),
      nightMaterial,
    );

    const cloudMaterial = new THREE.MeshPhongMaterial({
      map: earthCloudTexture,
      alphaMap: earthCloudTexture,
      color: 0xf5fbff,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      alphaTest: 0.025,
      shininess: 2,
    });
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(2.075, 96, 64),
      cloudMaterial,
    );

    const earthSystem = new THREE.Group();
    earthSystem.add(earth, nightLights, clouds);
    scene.add(earthSystem);

    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        lightDirection: { value: new THREE.Vector3(-1, 0.5, 1).normalize() },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 lightDirection;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vec3 normal = normalize(vWorldNormal);
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.15);
          float solar = smoothstep(-0.35, 0.35, dot(normal, normalize(lightDirection)));
          vec3 sunset = mix(vec3(0.16, 0.38, 0.95), vec3(0.34, 0.72, 1.0), solar);
          gl_FragColor = vec4(sunset, rim * mix(0.18, 0.82, solar));
        }
      `,
    });
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.17, 72, 48),
      atmosphereMaterial,
    );
    scene.add(atmosphere);

    const sunBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 36, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe78f }),
    );
    const sunCorona = new THREE.Mesh(
      new THREE.SphereGeometry(0.76, 36, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sunBody.add(sunCorona);
    scene.add(sunBody);

    const moonBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 32, 20),
      new THREE.MeshStandardMaterial({
        color: 0x9aa3a7,
        roughness: 0.94,
        metalness: 0,
      }),
    );
    scene.add(moonBody);

    const createCelestialLabel = (text: string, color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 48;
      const context = canvas.getContext("2d");
      if (context) {
        context.font = "500 20px monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = color;
        context.fillText(text, canvas.width / 2, canvas.height / 2);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.62,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.1, 0.275, 1);
      sprite.renderOrder = 20;
      scene.add(sprite);
      return { sprite, material, texture };
    };
    const sunLabel = createCelestialLabel("SUN", "#ffd77a");
    const moonLabel = createCelestialLabel("MOON", "#c8d8ff");

    const orbitGroup = new THREE.Group();
    scene.add(orbitGroup);

    const satelliteGroup = new THREE.Group();
    orbitGroup.add(satelliteGroup);
    satelliteGroup.scale.setScalar(2.5);

    const busMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aaab6,
      metalness: 0.8,
      roughness: 0.3,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x111c25,
      metalness: 0.65,
      roughness: 0.48,
    });
    const detectorShellMaterial = new THREE.MeshStandardMaterial({
      color: 0x102e39,
      emissive: 0x06333c,
      emissiveIntensity: 0.8,
      metalness: 0.3,
      roughness: 0.35,
      transparent: true,
      opacity: 0.72,
    });
    const bus = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), busMaterial);
    satelliteGroup.add(bus);
    const payloadMountGroup = new THREE.Group();
    satelliteGroup.add(payloadMountGroup);
    const domeShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      detectorShellMaterial,
    );
    domeShell.position.y = 0.155;
    payloadMountGroup.add(domeShell);

    const pixelGroup = new THREE.Group();
    pixelGroup.position.y = 0.155;
    payloadMountGroup.add(pixelGroup);
    const hexPixelGeometry = new THREE.CylinderGeometry(
      0.0135,
      0.015,
      0.025,
      6,
      1,
      false,
    );
    const pentagonPixelGeometry = new THREE.CylinderGeometry(
      0.0135,
      0.015,
      0.025,
      5,
      1,
      false,
      Math.PI / 10,
    );
    const pixelMaterials = PIXEL_LAYOUT.map(() =>
      new THREE.MeshStandardMaterial({
        color: 0x1739b8,
        emissive: 0x0b247d,
        emissiveIntensity: 0.9,
        metalness: 0.18,
        roughness: 0.3,
      }),
    );
    const upAxis = new THREE.Vector3(0, 1, 0);
    let configuredPixelNormals = getConfiguredPixelNormals(
      settingsRef.current.pixelConfiguration,
    );
    let configuredPixelSphereSlots = getConfiguredPixelSphereSlots(
      settingsRef.current.pixelConfiguration,
    );
    let appliedPixelConfiguration = settingsRef.current.pixelConfiguration;
    const crystalPixels = PIXEL_LAYOUT.map((pixel) => {
      const configuredPixel = getPixelByPhysicalId(
        settingsRef.current.pixelConfiguration,
        pixel.index,
      )!;
      const normal = new THREE.Vector3().fromArray(
        configuredPixelNormals[pixel.index],
      );
      const crystal = new THREE.Mesh(
        configuredPixel.isPentagon
          ? pentagonPixelGeometry
          : hexPixelGeometry,
        pixelMaterials[pixel.index],
      );
      crystal.position.copy(normal).multiplyScalar(0.173);
      crystal.quaternion
        .setFromUnitVectors(upAxis, normal.clone())
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            upAxis,
            THREE.MathUtils.degToRad(
              configuredPixel.rotationDeg,
            ),
          ),
        );
      crystal.userData.pixelId = pixel.index;
      pixelGroup.add(crystal);
      return crystal;
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.035, 32), darkMaterial);
    base.position.y = 0.13;
    payloadMountGroup.add(base);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x174d86,
      emissive: 0x062548,
      emissiveIntensity: 0.6,
      metalness: 0.35,
      roughness: 0.34,
    });
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.025), busMaterial);
      arm.position.x = side * 0.22;
      satelliteGroup.add(arm);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.025, 0.22), panelMaterial);
      panel.position.x = side * 0.48;
      satelliteGroup.add(panel);
    }

    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.23, 36),
      new THREE.MeshBasicMaterial({
        color: 0xe4ff7b,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    pulse.rotation.x = Math.PI / 2;
    pulse.position.y = 0.36;
    satelliteGroup.add(pulse);

    const particleCount = 120;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    const particleLife = new Float32Array(particleCount);
    const particleSeed = new Float32Array(particleCount * 3);
    const magenta = new THREE.Color(0xff4dbe);
    for (let index = 0; index < particleCount; index += 1) {
      particleLife[index] = deterministicUnit(index, 4);
      particleSeed[index * 3] = (deterministicUnit(index, 5) - 0.5) * 2;
      particleSeed[index * 3 + 1] = (deterministicUnit(index, 6) - 0.5) * 2;
      particleSeed[index * 3 + 2] = (deterministicUnit(index, 7) - 0.5) * 2;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        size: 0.045,
        vertexColors: true,
        transparent: true,
        opacity: 0.86,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(particles);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let yaw = 0;
    let pitch = 0.18;
    const onPointerDown = (event: PointerEvent) => {
      if (settingsRef.current.cameraMode === "satellite") return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      yaw += (event.clientX - lastX) * 0.005;
      pitch = THREE.MathUtils.clamp(pitch + (event.clientY - lastY) * 0.005, -0.85, 0.9);
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onSystemZoomChange(
        THREE.MathUtils.clamp(
          settingsRef.current.systemZoom - event.deltaY * 0.045,
          0,
          100,
        ),
      );
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const clock = new THREE.Clock();
    const satWorld = new THREE.Vector3();
    const outwardLocal = new THREE.Vector3();
    const sunSceneDirection = new THREE.Vector3();
    const moonSceneDirection = new THREE.Vector3();
    const satelliteWorldQuaternion = new THREE.Quaternion();
    const burstWorldDirection = new THREE.Vector3();
    const transverseOffset = new THREE.Vector3();
    const desiredCameraPosition = new THREE.Vector3();
    const cameraTarget = new THREE.Vector3();
    const desiredCameraTarget = new THREE.Vector3();
    const radialWorld = new THREE.Vector3();
    const renderedSatelliteDirection = new THREE.Vector3()
      .fromArray(settingsRef.current.satelliteDirection)
      .normalize();
    const renderedSunDirection = new THREE.Vector3()
      .fromArray(settingsRef.current.sunDirection)
      .normalize();
    const renderedMoonDirection = new THREE.Vector3()
      .fromArray(settingsRef.current.moonDirection)
      .normalize();
    const startSatelliteDirection = renderedSatelliteDirection.clone();
    const startSunDirection = renderedSunDirection.clone();
    const startMoonDirection = renderedMoonDirection.clone();
    const targetSatelliteDirection = renderedSatelliteDirection.clone();
    const targetSunDirection = renderedSunDirection.clone();
    const targetMoonDirection = renderedMoonDirection.clone();
    let renderedTimestampMs = settingsRef.current.simulatedTimestampMs;
    let startTimestampMs = renderedTimestampMs;
    let targetTimestampMs = renderedTimestampMs;
    let renderedAltitude = settingsRef.current.altitude;
    let startAltitude = renderedAltitude;
    let targetAltitude = renderedAltitude;
    let displayTransitionStartedAt = performance.now();
    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      const settings = settingsRef.current;
      if (appliedPixelConfiguration !== settings.pixelConfiguration) {
        configuredPixelNormals = getConfiguredPixelNormals(
          settings.pixelConfiguration,
        );
        configuredPixelSphereSlots = getConfiguredPixelSphereSlots(
          settings.pixelConfiguration,
        );
        crystalPixels.forEach((crystal, pixelId) => {
          const configuredPixel = getPixelByPhysicalId(
            settings.pixelConfiguration,
            pixelId,
          )!;
          const normal = new THREE.Vector3().fromArray(
            configuredPixelNormals[pixelId],
          );
          crystal.position.copy(normal).multiplyScalar(0.173);
          crystal.quaternion
            .setFromUnitVectors(upAxis, normal)
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(
                upAxis,
                THREE.MathUtils.degToRad(
                  configuredPixel.rotationDeg,
                ),
              ),
            );
          crystal.userData.pixelId = pixelId;
          crystal.geometry = configuredPixel.isPentagon
            ? pentagonPixelGeometry
            : hexPixelGeometry;
        });
        appliedPixelConfiguration = settings.pixelConfiguration;
      }
      const now = performance.now();
      if (settings.simulatedTimestampMs !== targetTimestampMs) {
        startSatelliteDirection.copy(renderedSatelliteDirection);
        startSunDirection.copy(renderedSunDirection);
        startMoonDirection.copy(renderedMoonDirection);
        targetSatelliteDirection.fromArray(settings.satelliteDirection).normalize();
        targetSunDirection.fromArray(settings.sunDirection).normalize();
        targetMoonDirection.fromArray(settings.moonDirection).normalize();
        startTimestampMs = renderedTimestampMs;
        targetTimestampMs = settings.simulatedTimestampMs;
        startAltitude = renderedAltitude;
        targetAltitude = settings.altitude;
        displayTransitionStartedAt = now;
      }
      const displayFraction = THREE.MathUtils.clamp(
        (now - displayTransitionStartedAt) / DISPLAY_INTERPOLATION_MS,
        0,
        1,
      );
      renderedSatelliteDirection.fromArray(
        slerpUnitDirection(
          startSatelliteDirection.toArray() as [number, number, number],
          targetSatelliteDirection.toArray() as [number, number, number],
          displayFraction,
        ),
      );
      renderedSunDirection.fromArray(
        slerpUnitDirection(
          startSunDirection.toArray() as [number, number, number],
          targetSunDirection.toArray() as [number, number, number],
          displayFraction,
        ),
      );
      renderedMoonDirection.fromArray(
        slerpUnitDirection(
          startMoonDirection.toArray() as [number, number, number],
          targetMoonDirection.toArray() as [number, number, number],
          displayFraction,
        ),
      );
      renderedTimestampMs = THREE.MathUtils.lerp(
        startTimestampMs,
        targetTimestampMs,
        displayFraction,
      );
      renderedAltitude = THREE.MathUtils.lerp(
        startAltitude,
        targetAltitude,
        displayFraction,
      );
      const orbitRadius = 3.1 + (renderedAltitude - 550) / 1500;
      earthSystem.rotation.set(
        0,
        -greenwichMeanSiderealTimeRadians(renderedTimestampMs),
        0,
      );
      satelliteGroup.position
        .copy(renderedSatelliteDirection)
        .multiplyScalar(orbitRadius);
      payloadMountGroup.position.set(settings.mountX * 0.15, 0, settings.mountZ * 0.15);
      outwardLocal.copy(renderedSatelliteDirection);
      satelliteGroup.quaternion.setFromUnitVectors(upAxis, outwardLocal);
      satelliteGroup.getWorldPosition(satWorld);
      satelliteGroup.getWorldQuaternion(satelliteWorldQuaternion);
      sunSceneDirection.copy(renderedSunDirection);
      moonSceneDirection.copy(renderedMoonDirection);
      sunBody.position.copy(sunSceneDirection).multiplyScalar(12.5);
      sunLabel.sprite.position
        .copy(sunBody.position)
        .addScaledVector(camera.up, 0.52);
      sunLight.position.copy(sunSceneDirection).multiplyScalar(9);
      sunLight.intensity = 2.7 + Math.min(1.2, settings.sunNoise / 90);
      nightMaterial.uniforms.lightDirection.value.copy(sunSceneDirection);
      atmosphereMaterial.uniforms.lightDirection.value.copy(sunSceneDirection);
      moonBody.position.copy(moonSceneDirection).multiplyScalar(5.4);
      moonLabel.sprite.position
        .copy(moonBody.position)
        .addScaledVector(camera.up, 0.34);

      pulse.visible = settings.grbActive;
      const pulseScale = 1 + Math.sin(clock.elapsedTime * 9) * 0.22;
      pulse.scale.setScalar(pulseScale);
      (pulse.material as THREE.MeshBasicMaterial).opacity = settings.grbActive
        ? 0.55 + Math.sin(clock.elapsedTime * 8) * 0.25
        : 0;

      crystalPixels.forEach((crystal, pixelId) => {
        const material = pixelMaterials[pixelId];
        const isSelected = pixelId === settings.selectedPixel;
        const impact = settings.detectorIntensity[pixelId] ?? 0;
        const hitCount = settings.detectorHits[pixelId] ?? 0;
        const isFired = hitCount > 0;
        const isBurstPath =
          settings.burstPixelGroups.some((group) => group.includes(pixelId));
        const sphereSlot = configuredPixelSphereSlots[pixelId];
        const albedoResponse = getEarthAlbedoResponse(
          sphereSlot,
          settings.earthIllumination,
          settings.earthAlbedoAzimuth,
          settings.earthAlbedoDirectional,
          settings.mountX,
          settings.mountZ,
        );
        const isEarthPath =
          isPixelLitByEarthAlbedo(
            sphereSlot,
            settings.earthIllumination,
            settings.earthAlbedoAzimuth,
            settings.earthAlbedoDirectional,
            settings.mountX,
            settings.mountZ,
          );
        const isOverlap = isFired && isBurstPath && isEarthPath;
        const impactColor =
          IMPACT_THREE_COLORS[Math.round(THREE.MathUtils.clamp(impact, 0, 1) * 100)];
        material.color.copy(impactColor);
        if (isSelected && !isFired) {
          material.color.lerp(WHITE_THREE_COLOR, 0.32);
        }
        material.emissive.copy(impactColor).multiplyScalar(
          isFired ? 0.5 : isSelected ? 0.34 : 0.28,
        );
        material.emissiveIntensity = isFired
          ? isOverlap
            ? 2.65
            : isBurstPath
            ? 1.8 + Math.min(4, hitCount) * 0.28
            : isEarthPath
              ? 0.8 + albedoResponse * 1.4 + Math.min(4, hitCount) * 0.22
              : 0.9 + Math.min(4, hitCount) * 0.22
          : isSelected
            ? 0.9
            : 0.72;
        crystal.scale.setScalar(
          isFired ? 1.06 + Math.min(3, hitCount) * 0.018 : isSelected ? 1.035 : 1,
        );
      });

      particles.visible = settings.burstDirections.length > 0;
      for (let index = 0; index < particleCount; index += 1) {
        if (!settings.paused && particles.visible) {
          particleLife[index] -= delta * 0.55;
          if (particleLife[index] <= 0) particleLife[index] = 1;
        }
        const life = particleLife[index];
        const directionPixel =
          settings.burstDirections[index % Math.max(1, settings.burstDirections.length)] ??
          settings.selectedPixel;
        burstWorldDirection
          .fromArray(configuredPixelNormals[directionPixel])
          .applyQuaternion(satelliteWorldQuaternion)
          .normalize();
        const spread = 0.32;
        const travel = 0.12 + life * 4.8;
        transverseOffset.set(
          particleSeed[index * 3],
          particleSeed[index * 3 + 1],
          particleSeed[index * 3 + 2],
        );
        transverseOffset.addScaledVector(
          burstWorldDirection,
          -transverseOffset.dot(burstWorldDirection),
        );
        particlePositions[index * 3] =
          satWorld.x +
          burstWorldDirection.x * travel +
          transverseOffset.x * spread * life;
        particlePositions[index * 3 + 1] =
          satWorld.y +
          burstWorldDirection.y * travel +
          transverseOffset.y * spread * life;
        particlePositions[index * 3 + 2] =
          satWorld.z +
          burstWorldDirection.z * travel +
          transverseOffset.z * spread * life;
        particleColors[index * 3] = magenta.r;
        particleColors[index * 3 + 1] = magenta.g;
        particleColors[index * 3 + 2] = magenta.b;
      }
      particleGeometry.attributes.position.needsUpdate = true;
      particleGeometry.attributes.color.needsUpdate = true;

      const zoomFraction = settings.systemZoom / 100;
      const distance = THREE.MathUtils.lerp(12.8, 5.1, zoomFraction);
      const followDistance = THREE.MathUtils.lerp(12, 1.15, zoomFraction);
      if (settings.cameraMode === "satellite") {
        radialWorld.copy(satWorld).normalize();
        desiredCameraPosition
          .copy(satWorld)
          .addScaledVector(radialWorld, followDistance);
        desiredCameraTarget.copy(satWorld);
      } else {
        desiredCameraPosition.set(
          Math.sin(yaw) * Math.cos(pitch) * distance,
          Math.sin(pitch) * distance,
          Math.cos(yaw) * Math.cos(pitch) * distance,
        );
        desiredCameraTarget.set(0, 0, 0);
      }
      const cameraEase = 1 - Math.exp(-delta * 6);
      camera.position.lerp(desiredCameraPosition, cameraEase);
      cameraTarget.lerp(desiredCameraTarget, cameraEase);
      camera.lookAt(cameraTarget);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      earthGeometry.dispose();
      earthMaterial.dispose();
      nightLights.geometry.dispose();
      nightMaterial.dispose();
      clouds.geometry.dispose();
      cloudMaterial.dispose();
      atmosphere.geometry.dispose();
      atmosphereMaterial.dispose();
      earthDayTexture.dispose();
      earthNightTexture.dispose();
      earthNormalTexture.dispose();
      earthSpecularTexture.dispose();
      earthCloudTexture.dispose();
      particleGeometry.dispose();
      starGeometry.dispose();
      hexPixelGeometry.dispose();
      pentagonPixelGeometry.dispose();
      pixelMaterials.forEach((material) => material.dispose());
      detectorShellMaterial.dispose();
      sunLabel.material.dispose();
      sunLabel.texture.dispose();
      moonLabel.material.dispose();
      moonLabel.texture.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [onSystemZoomChange]);

  return (
    <div className="globe-scene" ref={mountRef} aria-label="Three-dimensional orbital simulation">
      <div className="scene-hud scene-hud-top">
        <span className="hud-tag">
          <CircleDot size={12} />
          {simulatorMode === "simulation"
            ? "SIMULATION MODE"
            : scenarioMode === "canonical"
              ? "REFERENCE REPLAY"
              : "REFERENCE PARAMETRIC REPLAY"}
        </span>
        <span>{altitude.toFixed(1)} km</span>
      </div>
      <div className="camera-modes" aria-label="Camera mode">
        <button
          type="button"
          className={cameraMode === "orbit" ? "active" : ""}
          onClick={() => onCameraModeChange("orbit")}
        >
          ORBIT
        </button>
        <button
          type="button"
          className={cameraMode === "satellite" ? "active" : ""}
          onClick={() => onCameraModeChange("satellite")}
        >
          SATELLITE TOP VIEW
        </button>
      </div>
      <label className="system-zoom-control">
        <span>
          <b>SYSTEM ZOOM</b>
          <em>{Math.round(systemZoom)}%</em>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={systemZoom}
          style={{ "--zoom-progress": `${systemZoom}%` } as React.CSSProperties}
          aria-label="Zoom the complete Earth and satellite system"
          onChange={(event) => onSystemZoomChange(Number(event.target.value))}
        />
      </label>
      <div className="scene-hud scene-hud-bottom">
        <span><span className="legend-dot background-dot" /> background</span>
        <span><span className="legend-dot albedo-dot" /> Earth albedo</span>
        <span><span className="legend-dot source-dot" /> source</span>
        <span><span className="legend-dot grb-dot" /> GRB</span>
      </div>
      <div className="celestial-scene-status">
        <span className={sunNoise > 0 ? "interfering" : ""}>
          <Sun size={12} /> Sun {sunNoise > 0 ? `+${sunNoise.toFixed(0)} c/s` : "outside cone"}
        </span>
        <span className={moonNoise > 0 ? "interfering moon" : ""}>
          <Moon size={12} /> Moon {moonNoise > 0 ? `+${moonNoise.toFixed(0)} c/s` : "outside cone"}
        </span>
        <span className={earthAlbedoNoise > 1 ? "interfering earth" : ""}>
          <CircleDot size={12} /> Earth albedo {earthAlbedoNoise > 1 ? `+${earthAlbedoNoise.toFixed(0)} c/s` : "minimum"}
        </span>
      </div>
      <div className="drag-hint">
        {cameraMode === "satellite"
          ? "camera locked to satellite · scroll to zoom"
          : "drag to rotate · scroll to zoom"}
      </div>
    </div>
  );
}

function HistoryDialog({
  events,
  onClose,
}: {
  events: EventRecord[];
  onClose: () => void;
}) {
  const pageSize = 100;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(events.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = Math.max(0, events.length - (safePage + 1) * pageSize);
  const pageEnd = events.length - safePage * pageSize;
  const visibleEvents = events.slice(pageStart, pageEnd).reverse();

  const downloadCsv = () => {
    const rows = [
      ["mission_time", "simulated_utc", "type", "description"],
      ...events.map((event) => [event.time, event.utc, event.kind, event.text]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "crystal-eye-event-history.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="history-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-dialog-title"
      >
        <header>
          <div>
            <small>ACQUISITION ARCHIVE · CURRENT SIMULATION SESSION</small>
            <strong id="history-dialog-title">Event History</strong>
          </div>
          <div className="history-header-actions">
            <button type="button" onClick={downloadCsv}>
              <Download size={14} /> EXPORT CSV
            </button>
            <button type="button" onClick={onClose} aria-label="Close history table">
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="history-summary">
          <span>
            <strong>{events.length.toLocaleString("en-US")}</strong> stored records
          </span>
          <span>Newest records first · 100 rows per page</span>
        </div>

        <div className="history-table-wrap">
          <table className="history-table event-history-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>MISSION TIME</th>
                  <th>SIMULATED UTC</th>
                  <th>TYPE</th>
                  <th>EVENT DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event, index) => (
                  <tr key={`${event.utc}-${pageEnd - index}`}>
                    <td>{pageEnd - index}</td>
                    <td>{event.time}</td>
                    <td>{event.utc.replace("T", " ").replace(".000Z", " Z")}</td>
                    <td><span className={`history-kind ${event.kind}`}>{event.kind}</span></td>
                    <td>{event.text}</td>
                  </tr>
                ))}
              </tbody>
          </table>
          {events.length === 0 && (
            <div className="history-empty">Waiting for acquisition records…</div>
          )}
        </div>

        <footer>
          <span>
            Rows {events.length === 0 ? 0 : pageStart + 1}–{pageEnd} of{" "}
            {events.length.toLocaleString("en-US")}
          </span>
          <div>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((current) => current + 1)}
            >
              OLDER
            </button>
            <strong>{safePage + 1} / {pageCount}</strong>
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              NEWER
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

type SensorViewMode = "sky" | "mask" | "events" | "geometry";

function SensorView({
  satelliteDirection,
  sunDirection,
  moonDirection,
  geocentricSunDirection,
  geocentricMoonDirection,
  sunInFov,
  moonInFov,
  moonPhase,
  detector,
  detectorHits,
  pixelConfiguration,
  selectedPixel,
  burstDirections,
  burstPixelGroups,
  earthIllumination,
  earthAlbedoNoise,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
  mountX,
  mountZ,
  effectiveFov,
}: {
  satelliteDirection: [number, number, number];
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  geocentricSunDirection: [number, number, number];
  geocentricMoonDirection: [number, number, number];
  sunInFov: boolean;
  moonInFov: boolean;
  moonPhase: number;
  detector: number[];
  detectorHits: number[];
  pixelConfiguration: PixelConfiguration;
  selectedPixel: number;
  burstDirections: number[];
  burstPixelGroups: number[][];
  earthIllumination: number;
  earthAlbedoNoise: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
  mountX: number;
  mountZ: number;
  effectiveFov: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<SensorViewMode>("mask");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const width = rect.width;
    const height = rect.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(20, Math.min(width, height) * 0.43);
    const sphereSlots = getConfiguredPixelSphereSlots(pixelConfiguration);
    const boresight = satelliteDirection;
    const right = normalizeVector(boresight[2], 0, -boresight[0]);
    const up = normalizeVector(
      boresight[1] * right[2] - boresight[2] * right[1],
      boresight[2] * right[0] - boresight[0] * right[2],
      boresight[0] * right[1] - boresight[1] * right[0],
    );
    const dot = (a: [number, number, number], b: [number, number, number]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const project = (direction: [number, number, number]) => {
      const cosine = THREE.MathUtils.clamp(dot(direction, boresight), -1, 1);
      const theta = Math.acos(cosine);
      const sinTheta = Math.max(1e-5, Math.sin(theta));
      const projectedRadius =
        (theta / THREE.MathUtils.degToRad(effectiveFov / 2)) * radius;
      return {
        visible: theta <= THREE.MathUtils.degToRad(effectiveFov / 2),
        x: cx + (dot(direction, right) / sinTheta) * projectedRadius,
        y: cy - (dot(direction, up) / sinTheta) * projectedRadius,
        angle: theta,
      };
    };
    const sun = project(sunDirection);
    const moon = project(moonDirection);
    context.clearRect(0, 0, width, height);
    const fieldGradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    fieldGradient.addColorStop(0, mode === "mask" ? "#071828" : "#02070f");
    fieldGradient.addColorStop(0.72, mode === "mask" ? "#081426" : "#030811");
    fieldGradient.addColorStop(1, "#01040a");
    context.fillStyle = fieldGradient;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();

    if (mode !== "events") {
      for (let index = 0; index < 110; index += 1) {
        const seedA = Math.abs(
          Math.sin(index * 91.713 + satelliteDirection[0] * 0.37),
        );
        const seedB = Math.abs(
          Math.sin(index * 47.117 + satelliteDirection[1] * 0.021),
        );
        const starRadius = Math.sqrt(seedA) * radius * 0.96;
        const starAngle = seedB * Math.PI * 2 + satelliteDirection[2] * 0.11;
        const x = cx + Math.cos(starAngle) * starRadius;
        const y = cy + Math.sin(starAngle) * starRadius;
        const size = 0.35 + Math.abs(Math.sin(index * 13.17)) * 1.05;
        context.fillStyle =
          mode === "mask"
            ? "rgba(115, 140, 175, 0.18)"
            : `rgba(205, 228, 255, ${0.3 + size * 0.35})`;
        context.beginPath();
        context.arc(x, y, size, 0, Math.PI * 2);
        context.fill();
      }
      if (mode === "mask") {
        context.fillStyle = "rgba(130, 164, 207, 0.55)";
        context.font = "6px monospace";
        context.textAlign = "left";
        context.fillText("DIFFUSE BACKGROUND", cx - radius + 11, cy - radius + 17);
      }
    }

    if (earthAlbedoNoise > 1 && mode !== "events") {
      const lobeWidth = THREE.MathUtils.lerp(
        Math.PI * 0.92,
        Math.PI * 0.48,
        earthAlbedoDirectional,
      );
      context.strokeStyle =
        mode === "mask"
          ? `rgba(100, 205, 255, ${0.28 + earthIllumination * 0.62})`
          : `rgba(115, 210, 255, ${0.12 + earthIllumination * 0.34})`;
      context.lineWidth = mode === "mask" ? radius * 0.12 : radius * 0.065;
      context.beginPath();
      context.arc(
        cx,
        cy,
        radius * 0.91,
        earthAlbedoAzimuth - lobeWidth,
        earthAlbedoAzimuth + lobeWidth,
      );
      context.stroke();
      if (mode === "mask") {
        const labelX = cx + Math.cos(earthAlbedoAzimuth) * radius * 0.72;
        const labelY = cy + Math.sin(earthAlbedoAzimuth) * radius * 0.72;
        context.fillStyle = "#a6e3ff";
        context.font = "6px monospace";
        context.textAlign = "center";
        context.fillText("EARTH ALBEDO", labelX, labelY);
      }
    }

    const drawHalo = (
      x: number,
      y: number,
      inner: string,
      outer: string,
      size: number,
    ) => {
      const halo = context.createRadialGradient(x, y, 0, x, y, size);
      halo.addColorStop(0, inner);
      halo.addColorStop(1, outer);
      context.fillStyle = halo;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    };

    if (mode === "events") {
      PIXEL_LAYOUT.forEach((pixel) => {
        const configuredPixel = getPixelByPhysicalId(
          pixelConfiguration,
          pixel.index,
        )!;
        const sphereSlot = sphereSlots[pixel.index];
        const spherePixel = PIXEL_LAYOUT[sphereSlot];
        const value = detector[pixel.index] ?? 0;
        const hitCount = detectorHits[pixel.index] ?? 0;
        const isFired = hitCount > 0;
        const x = cx + Math.cos(spherePixel.angle) * spherePixel.radius * radius * 0.88;
        const y = cy + Math.sin(spherePixel.angle) * spherePixel.radius * radius * 0.88;
        const cellRadius = Math.max(
          2.2,
          radius * (0.036 - spherePixel.ring * 0.0008),
        );
        const isSelected = pixel.index === selectedPixel;
        const isOnBurstFootprint =
          burstPixelGroups.some((group) => group.includes(pixel.index));
        const isOnEarthAlbedo =
          isPixelLitByEarthAlbedo(
            sphereSlot,
            earthIllumination,
            earthAlbedoAzimuth,
            earthAlbedoDirectional,
            mountX,
            mountZ,
          );
        const isOverlap = isFired && isOnBurstFootprint && isOnEarthAlbedo;
        context.beginPath();
        const sideCount = configuredPixel.isPentagon ? 5 : 6;
        for (let side = 0; side < sideCount; side += 1) {
          const angle =
            (side / sideCount) * Math.PI * 2 +
            (sideCount === 5 ? Math.PI / 2 : -Math.PI / 2) +
            THREE.MathUtils.degToRad(configuredPixel.rotationDeg);
          const px = x + Math.cos(angle) * cellRadius;
          const py = y + Math.sin(angle) * cellRadius;
          if (side === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.fillStyle = !isFired
          ? "rgba(19, 45, 55, 0.58)"
          : isOverlap
            ? `rgba(242, 225, 255, ${0.58 + value * 0.42})`
            : isOnBurstFootprint
            ? `rgba(255, 77, 190, ${0.5 + value * 0.5})`
            : isOnEarthAlbedo
              ? `rgba(112, 215, 255, ${0.42 + value * 0.58})`
              : `rgba(91, 239, 218, ${0.42 + value * 0.58})`;
        context.fill();
        context.strokeStyle = isSelected ? "#ffc857" : "rgba(159, 224, 245, 0.16)";
        context.lineWidth = isSelected ? 1.4 : 0.55;
        context.stroke();
      });
    } else {
      if (sun.visible) {
        drawHalo(
          sun.x,
          sun.y,
          mode === "mask" ? "rgba(255, 183, 38, 0.9)" : "rgba(255, 235, 148, 0.95)",
          "rgba(255, 168, 45, 0)",
          mode === "mask" ? radius * 0.31 : radius * 0.16,
        );
        context.fillStyle = mode === "mask" ? "#ff9f1c" : "#fff2b0";
        context.beginPath();
        context.arc(sun.x, sun.y, Math.max(3.2, radius * 0.028), 0, Math.PI * 2);
        context.fill();
        if (mode === "mask") {
          context.fillStyle = "#ffe09a";
          context.font = "6px monospace";
          context.textAlign = "center";
          context.fillText("SUN", sun.x, sun.y - radius * 0.055);
        }
      }
      if (moon.visible) {
        drawHalo(
          moon.x,
          moon.y,
          "rgba(174, 206, 255, 0.6)",
          "rgba(103, 150, 228, 0)",
          mode === "mask" ? radius * 0.2 : radius * 0.09,
        );
        context.fillStyle = "#d7e0e5";
        context.beginPath();
        context.arc(moon.x, moon.y, Math.max(2.6, radius * 0.021), 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "rgba(8, 15, 24, 0.86)";
        context.beginPath();
        context.arc(
          moon.x + (moonPhase - 0.5) * radius * 0.035,
          moon.y,
          Math.max(2.5, radius * 0.019),
          0,
          Math.PI * 2,
        );
        context.fill();
        if (mode === "mask") {
          context.fillStyle = "#d7e5ff";
          context.font = "6px monospace";
          context.textAlign = "center";
          context.fillText("MOON", moon.x, moon.y - radius * 0.05);
        }
      }
      burstDirections.forEach((directionPixel, burstIndex) => {
        const burst = PIXEL_LAYOUT[sphereSlots[directionPixel]];
        const burstX = cx + Math.cos(burst.angle) * burst.radius * radius * 0.78;
        const burstY = cy + Math.sin(burst.angle) * burst.radius * radius * 0.78;
        drawHalo(
          burstX,
          burstY,
          "rgba(255, 77, 190, 0.95)",
          "rgba(255, 77, 190, 0)",
          radius * 0.23,
        );
        context.strokeStyle = "#ff72c9";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(burstX - 7, burstY);
        context.lineTo(burstX + 7, burstY);
        context.moveTo(burstX, burstY - 7);
        context.lineTo(burstX, burstY + 7);
        context.stroke();
        if (mode === "mask") {
          context.fillStyle = "#ff9bda";
          context.font = "6px monospace";
          context.textAlign = "center";
          context.fillText(`GRB ${burstIndex + 1}`, burstX, burstY - 10);
        }
      });
    }

    context.restore();
    context.strokeStyle = "rgba(119, 211, 244, 0.52)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "rgba(119, 211, 244, 0.11)";
    context.setLineDash([2, 4]);
    for (const fraction of [0.33, 0.66]) {
      context.beginPath();
      context.arc(cx, cy, radius * fraction, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([]);
    context.fillStyle = "rgba(121, 163, 183, 0.65)";
    context.font = "7px monospace";
    context.textAlign = "center";
    context.fillText("BORESIGHT", cx, cy + 3);

    const drawOutOfField = (
      projected: ReturnType<typeof project>,
      label: string,
      color: string,
    ) => {
      if (projected.visible) return;
      const x = cx + Math.cos(Math.atan2(projected.y - cy, projected.x - cx)) * radius;
      const y = cy + Math.sin(Math.atan2(projected.y - cy, projected.x - cx)) * radius;
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, 2.5, 0, Math.PI * 2);
      context.fill();
      context.font = "6px monospace";
      context.fillText(`${label} OUT`, x, y - 6);
    };
    drawOutOfField(sun, "SUN", "#ffc857");
    drawOutOfField(moon, "MOON", "#b9ceff");
  }, [
    detector,
    detectorHits,
    burstDirections,
    burstPixelGroups,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
    earthAlbedoNoise,
    earthIllumination,
    effectiveFov,
    mode,
    moonDirection,
    moonPhase,
    moonInFov,
    mountX,
    mountZ,
    pixelConfiguration,
    satelliteDirection,
    selectedPixel,
    sunDirection,
    sunInFov,
  ]);

  return (
    <section className="sensor-view" aria-label="Instantaneous Crystal Eye field of view">
      <div className="sensor-view-header">
        <div>
          <small>CRYSTAL EYE VIEW</small>
          <strong>
            {mode === "geometry"
              ? "Earth · satellite · Sun · Moon"
              : `Instantaneous FOV · ${effectiveFov.toFixed(0)}°`}
          </strong>
        </div>
        <span><i /> LIVE</span>
      </div>
      <div className="sensor-view-tabs" role="group" aria-label="Sensor view mode">
        {([
          ["sky", "Sky"],
          ["mask", "Mask"],
          ["events", "Events"],
          ["geometry", "Geometry"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? "active" : ""}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={`sensor-canvas-wrap mode-${mode}`}>
        {mode === "geometry" ? (
          <SystemGeometryCanvas
            satelliteDirection={satelliteDirection}
            sunDirection={geocentricSunDirection}
            moonDirection={geocentricMoonDirection}
            moonPhase={moonPhase}
            earthIllumination={earthIllumination}
            effectiveFov={effectiveFov}
          />
        ) : (
          <>
            <canvas ref={canvasRef} />
            <span className="sensor-north">+Y</span>
            <span className="sensor-earth-shield">EARTH BEHIND PAYLOAD</span>
          </>
        )}
      </div>
      <div className="sensor-view-footer">
        <span className={sunInFov ? "active sun" : ""}><i /> Sun</span>
        <span className={moonInFov ? "active moon" : ""}><i /> Moon</span>
        <span className={earthAlbedoNoise > 1 ? "active earth" : ""}><i /> Earth</span>
        <span className={burstDirections.length > 0 ? "active grb" : ""}>
          <i /> GRB ×{burstDirections.length}
        </span>
        <em>
          {mode === "events"
            ? `${detectorHits.filter((hits) => hits > 0).length} PX ON`
            : mode === "geometry"
              ? `FOV ${effectiveFov.toFixed(0)}° · top-down`
              : "reconstruction · non-RGB"}
        </em>
      </div>
    </section>
  );
}

function DetectorMap({
  values,
  hits,
  backgroundRates,
  backgroundExpectedCounts,
  grbActive,
  burstPixelGroups,
  pixelConfiguration,
  selectedPixelId,
  earthIllumination,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
  mountX,
  mountZ,
  onSelect,
}: {
  values: number[];
  hits: number[];
  backgroundRates: number[];
  backgroundExpectedCounts: number[];
  grbActive: boolean;
  burstPixelGroups: number[][];
  pixelConfiguration: PixelConfiguration;
  selectedPixelId: number;
  earthIllumination: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
  mountX: number;
  mountZ: number;
  onSelect: (index: number) => void;
}) {
  const backgroundRateRange = useMemo(() => {
    const validRates = backgroundRates.filter(Number.isFinite);
    return {
      minimum: validRates.length > 0 ? Math.min(...validRates) : 0,
      maximum: validRates.length > 0 ? Math.max(...validRates) : 0,
    };
  }, [backgroundRates]);
  const pentagonPixelIndices = useMemo(
    () => getPentagonPixelIndices(pixelConfiguration),
    [pixelConfiguration],
  );
  const sphereSlots = useMemo(
    () => getConfiguredPixelSphereSlots(pixelConfiguration),
    [pixelConfiguration],
  );
  return (
    <div className="detector-module projection-unfolded">
      <div
        className={`detector-map projection-unfolded ${
          grbActive ? "is-grb" : ""
        }`}
        aria-label="Configured planar map of the 126 pixels"
      >
        {PIXEL_LAYOUT.map((pixel) => {
          const configuredPixel = pixelConfiguration.pixels[pixel.index];
          const physicalPixelId = configuredPixel.pixelId;
          const value = values[physicalPixelId] ?? 0;
          const hitCount = hits[physicalPixelId] ?? 0;
          const backgroundRate = backgroundRates[physicalPixelId] ?? 0;
          const backgroundExpectedCount =
            backgroundExpectedCounts[physicalPixelId] ?? 0;
          const backgroundSpan =
            backgroundRateRange.maximum - backgroundRateRange.minimum;
          const normalizedBackgroundRate =
            backgroundSpan > 0
              ? (backgroundRate - backgroundRateRange.minimum) / backgroundSpan
              : 0;
          const isActive = hitCount > 0;
          const isBurstHit =
            isActive &&
            burstPixelGroups.some((group) => group.includes(physicalPixelId));
          const isEarthAlbedo =
            isActive &&
            isPixelLitByEarthAlbedo(
              sphereSlots[physicalPixelId],
              earthIllumination,
              earthAlbedoAzimuth,
              earthAlbedoDirectional,
              mountX,
              mountZ,
            );
          return (
            <button
              key={pixel.index}
              type="button"
              className={`detector-pixel ${isActive ? "is-active" : ""} ${
                isBurstHit ? "is-burst-hit" : ""
              } ${
                isEarthAlbedo ? "is-albedo" : ""
              } ${
                isBurstHit && isEarthAlbedo ? "is-overlap" : ""
              } ${
                selectedPixelId === physicalPixelId ? "is-selected" : ""
              } ${
                configuredPixel.isSeam ? "is-unfolding-seam" : ""
              } ${
                pentagonPixelIndices.has(pixel.index) ? "is-pentagon" : ""
              }`}
              style={{
                "--heat": Math.min(
                  1,
                  isBurstHit || isEarthAlbedo
                    ? value
                    : 0.08 + normalizedBackgroundRate * 0.12,
                ).toFixed(4),
                "--impact-color":
                  isBurstHit || isEarthAlbedo
                    ? getImpactColor(value)
                    : getBackgroundBlueColor(normalizedBackgroundRate),
                "--pixel-x": `${configuredPixel.x}%`,
                "--pixel-y": `${configuredPixel.y}%`,
                "--pixel-rotation": `${configuredPixel.rotationDeg}deg`,
                "--pixel-label-rotation": `${-configuredPixel.rotationDeg}deg`,
                "--delay": `${(pixel.index % 17) * 24}ms`,
              } as React.CSSProperties}
              title={`Physical pixel ID ${physicalPixelId} · ${
                pentagonPixelIndices.has(pixel.index)
                  ? "central pentagon"
                  : "hexagon"
              } · ${backgroundRate.toFixed(4)} c/s baseline · ${backgroundExpectedCount.toFixed(4)} expected baseline counts / ${PIXEL_BACKGROUND_BIN_SECONDS.toFixed(1)} s · ${hitCount.toFixed(4)} total expected counts`}
              aria-label={`Physical pixel ID ${physicalPixelId}, ${
                pentagonPixelIndices.has(pixel.index)
                  ? "central pentagon"
                  : "hexagon"
              }, background ${backgroundRate.toFixed(4)} counts per second, ${hitCount.toFixed(4)} total expected counts`}
              onClick={() => onSelect(physicalPixelId)}
            >
              <span>{physicalPixelId}</span>
            </button>
          );
        })}
        <div
          className="detector-color-scale"
          aria-label="Impact intensity color scale from background 0 to maximum impact 100"
        >
          <span>0</span><i /><span>100</span>
        </div>
      </div>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="range-control">
      <span>
        {label}
        <strong>{value}{suffix}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--progress": `${progress}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SystemGeometryCanvas({
  satelliteDirection,
  sunDirection,
  moonDirection,
  moonPhase,
  earthIllumination,
  effectiveFov,
}: {
  satelliteDirection: [number, number, number];
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  moonPhase: number;
  earthIllumination: number;
  effectiveFov: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const width = rect.width;
      const height = rect.height;
      const cx = width * 0.5;
      const cy = height * 0.52;
      const orbitX = width * 0.29;
      const orbitY = height * 0.34;
      const earthRadius = Math.min(width, height) * 0.115;
      const projectDirection = (direction: [number, number, number]) => {
        const length = Math.hypot(direction[0], direction[2]) || 1;
        return [direction[0] / length, direction[2] / length] as const;
      };
      const sun = projectDirection(sunDirection);
      const moon = projectDirection(moonDirection);
      const satellite = projectDirection(satelliteDirection);
      const satelliteX = cx + satellite[0] * orbitX;
      const satelliteY = cy + satellite[1] * orbitY;
      const radialAngle = Math.atan2(satelliteY - cy, satelliteX - cx);

      context.clearRect(0, 0, width, height);
      const background = context.createRadialGradient(cx, cy, 0, cx, cy, width * 0.65);
      background.addColorStop(0, "rgba(20, 72, 94, 0.16)");
      background.addColorStop(1, "rgba(1, 5, 10, 0)");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      context.strokeStyle = "rgba(102, 201, 232, 0.28)";
      context.lineWidth = 1;
      context.setLineDash([4, 5]);
      context.beginPath();
      context.ellipse(cx, cy, orbitX, orbitY, 0, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);

      const drawCelestialVector = (
        direction: readonly [number, number],
        distance: number,
        color: string,
        label: string,
        radius: number,
      ) => {
        const x = cx + direction[0] * distance;
        const y = cy + direction[1] * distance * 0.72;
        context.strokeStyle = color;
        context.globalAlpha = 0.38;
        context.setLineDash([3, 5]);
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(x, y);
        context.stroke();
        context.setLineDash([]);
        context.globalAlpha = 1;
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = color;
        context.font = "7px monospace";
        context.textAlign = "center";
        context.fillText(label, x, y - radius - 5);
      };

      drawCelestialVector(sun, Math.min(width, height) * 0.53, "#ffc857", "SUN", 6);
      drawCelestialVector(moon, Math.min(width, height) * 0.43, "#b9ceff", "MOON", 4);

      const dayOffsetX = sun[0] * earthRadius * 0.38;
      const dayOffsetY = sun[1] * earthRadius * 0.38;
      const earthGradient = context.createRadialGradient(
        cx + dayOffsetX,
        cy + dayOffsetY,
        earthRadius * 0.08,
        cx,
        cy,
        earthRadius,
      );
      earthGradient.addColorStop(0, "#66d5f2");
      earthGradient.addColorStop(Math.max(0.3, earthIllumination * 0.68), "#16769f");
      earthGradient.addColorStop(1, "#061c2a");
      context.fillStyle = earthGradient;
      context.beginPath();
      context.arc(cx, cy, earthRadius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(126, 223, 249, 0.7)";
      context.stroke();

      context.fillStyle = "rgba(98, 217, 255, 0.1)";
      context.beginPath();
      context.moveTo(satelliteX, satelliteY);
      context.arc(
        satelliteX,
        satelliteY,
        Math.min(width, height) * 0.22,
        radialAngle - THREE.MathUtils.degToRad(effectiveFov / 2),
        radialAngle + THREE.MathUtils.degToRad(effectiveFov / 2),
      );
      context.closePath();
      context.fill();

      context.strokeStyle = "#62d9ff";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(satelliteX, satelliteY);
      context.lineTo(
        satelliteX + Math.cos(radialAngle) * 34,
        satelliteY + Math.sin(radialAngle) * 34,
      );
      context.stroke();

      context.save();
      context.translate(satelliteX, satelliteY);
      context.rotate(radialAngle);
      context.fillStyle = "#e4fbff";
      context.fillRect(-4, -3, 8, 6);
      context.fillStyle = "#3eacc8";
      context.fillRect(-11, -2, 6, 4);
      context.fillRect(5, -2, 6, 4);
      context.restore();

      context.fillStyle = "#b8dce7";
      context.font = "7px monospace";
      context.textAlign = "center";
      context.fillText("EARTH", cx, cy + 3);
      context.fillStyle = "#62d9ff";
      context.fillText("CRYSTAL EYE", satelliteX, satelliteY - 9);
      context.fillStyle = "rgba(119, 155, 169, 0.75)";
      context.textAlign = "left";
      context.fillText("TOP-DOWN GEOMETRY · NOT TO SCALE", 8, height - 7);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [earthIllumination, effectiveFov, moonDirection, satelliteDirection, sunDirection]);

  return (
    <div className="system-geometry-view" aria-label="Earth, satellite, Sun, and Moon geometry">
      <canvas ref={canvasRef} />
      <div className="system-geometry-metrics">
        <span>FOV <b>{effectiveFov.toFixed(0)}°</b></span>
        <span>EARTH LIGHT <b>{(earthIllumination * 100).toFixed(0)}%</b></span>
        <span>MOON PHASE <b>{(moonPhase * 100).toFixed(0)}%</b></span>
      </div>
    </div>
  );
}

function ConfigurationHub({
  onOpenOrbit,
  onOpenPayload,
  onOpenPixels,
  onClose,
}: {
  onOpenOrbit: () => void;
  onOpenPayload: () => void;
  onOpenPixels: () => void;
  onClose: () => void;
}) {
  return (
    <div className="configuration-hub-backdrop" role="presentation">
      <section
        className="configuration-hub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="configuration-hub-title"
      >
        <header>
          <div>
            <small>SIMULATOR CONFIGURATION</small>
            <strong id="configuration-hub-title">Crystal Eye configuration</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close configuration">
            <X size={17} />
          </button>
        </header>
        <div>
          <button type="button" onClick={onOpenOrbit}>
            <RotateCcw size={24} />
            <span>
              <small>ORBITAL CONFIGURATION</small>
              <strong>Orbit and physical time</strong>
              <em>Select canonical ECI replay or an explicit parametric satellite scenario, plus physical time warp.</em>
            </span>
            <ChevronRight size={18} />
          </button>
          <button type="button" onClick={onOpenPayload}>
            <SlidersHorizontal size={24} />
            <span>
              <small>MECHANICAL CONFIGURATION</small>
              <strong>Payload placement</strong>
              <em>Position the Crystal Eye on the 60 × 60 cm satellite surface.</em>
            </span>
            <ChevronRight size={18} />
          </button>
          <button type="button" onClick={onOpenPixels}>
            <Move size={24} />
            <span>
              <small>DETECTOR CONFIGURATION</small>
              <strong>Pixel map and IDs</strong>
              <em>Arrange, group, identify, save, import, and export all 126 pixels.</em>
            </span>
            <ChevronRight size={18} />
          </button>
        </div>
        <footer>
          Configuration changes are applied to the simulator and retained by their
          respective controls.
        </footer>
      </section>
    </div>
  );
}

function OrbitalConfigurationPanel({
  scenarioMode,
  altitudeKm,
  inclinationDeg,
  speed,
  canonicalAltitudeKm,
  ephemerisProfile,
  ephemerisError,
  onScenarioModeChange,
  onAltitudeChange,
  onInclinationChange,
  onSpeedChange,
  onReset,
  onClose,
}: {
  scenarioMode: OrbitScenarioMode;
  altitudeKm: number;
  inclinationDeg: number;
  speed: number;
  canonicalAltitudeKm: number;
  ephemerisProfile: EciEphemerisProfile | null;
  ephemerisError: string | null;
  onScenarioModeChange: (mode: OrbitScenarioMode) => void;
  onAltitudeChange: (value: number) => void;
  onInclinationChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="configuration-hub-backdrop" role="presentation">
      <section
        className="configuration-hub orbital-configuration-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="orbital-configuration-title"
      >
        <header>
          <div>
            <small>ORBITAL CONFIGURATION</small>
            <strong id="orbital-configuration-title">Orbit and physical time controls</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Back to configuration">
            <X size={17} />
          </button>
        </header>
        <div className="orbital-configuration-body">
          <div className="warp-presets" role="group" aria-label="Satellite trajectory mode">
            <button
              type="button"
              className={scenarioMode === "canonical" ? "active" : ""}
              aria-pressed={scenarioMode === "canonical"}
              onClick={() => onScenarioModeChange("canonical")}
            >
              CANONICAL ECI REPLAY · RECOMMENDED
            </button>
            <button
              type="button"
              className={scenarioMode === "parametric" ? "active" : ""}
              aria-pressed={scenarioMode === "parametric"}
              onClick={() => onScenarioModeChange("parametric")}
            >
              PARAMETRIC SATELLITE SCENARIO
            </button>
          </div>
          <div className="orbital-control-grid">
            {scenarioMode === "parametric" && (
              <>
                <RangeControl
                  label="Altitude override · reference 550 km"
                  value={altitudeKm}
                  min={MIN_ORBIT_ALTITUDE_KM}
                  max={MAX_ORBIT_ALTITUDE_KM}
                  step={1}
                  suffix=" km"
                  onChange={onAltitudeChange}
                />
                <RangeControl
                  label="Parametric orbit-plane inclination · original/default 20°"
                  value={inclinationDeg}
                  min={MIN_ORBIT_INCLINATION_DEG}
                  max={MAX_ORBIT_INCLINATION_DEG}
                  step={1}
                  suffix="°"
                  onChange={onInclinationChange}
                />
              </>
            )}
            <RangeControl
              label="Physical time warp"
              value={speed}
              min={MIN_TIME_WARP}
              max={MAX_TIME_WARP}
              step={1}
              suffix="×"
              onChange={onSpeedChange}
            />
            <div className="warp-presets" aria-label="Orbital configuration time warp presets">
              {TIME_WARP_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className={speed === preset ? "active" : ""}
                  aria-pressed={speed === preset}
                  onClick={() => onSpeedChange(preset)}
                >
                  {preset}×
                </button>
              ))}
            </div>
          </div>
          <div className="orbit-override-notice" role={ephemerisError ? "alert" : "status"}>
            <strong>
              {scenarioMode === "canonical"
                ? "CANONICAL SATELLITE, SUN, AND MOON ECI REPLAY"
                : "PARAMETRIC SATELLITE SCENARIO · NOT A VALIDATED PROPAGATOR"}
            </strong>
            <span>
              {ephemerisError ??
                (ephemerisProfile
                  ? `${ephemerisProfile.records.length.toLocaleString("en-US")} timestamped ECI SAT/SUN/MOON records retained · canonical sample altitude ${canonicalAltitudeKm.toFixed(1)} km. `
                  : "Loading the timestamped ECI SAT/SUN/MOON source. ")}
              {scenarioMode === "canonical" ? (
                " Satellite, Sun, and Moon positions use the source ECI rows without an orbit override."
              ) : (
                <>
                  Altitude changes satellite radius; inclination uses
                  <code> u = atan2(SAT_y, SAT_x)</code> with RAAN 0° by convention.
                  Sun and Moon remain on their canonical ECI trajectories.
                </>
              )}
            </span>
          </div>
        </div>
        <footer className="orbital-configuration-footer">
          <span>Reset returns to the first ECI timestamp and keeps the selected trajectory mode.</span>
          <button type="button" onClick={onReset} disabled={!ephemerisProfile}>
            <RotateCcw size={13} /> RESET ECI TIMELINE
          </button>
        </footer>
      </section>
    </div>
  );
}

function PixelConfigurationEditor({
  configuration,
  onSave,
  onClose,
}: {
  configuration: PixelConfiguration;
  onSave: (configuration: PixelConfiguration) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PixelConfiguration>(() => ({
    version: 2,
    pixels: configuration.pixels.map((pixel) => ({ ...pixel })),
  }));
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0]);
  const [primarySelectedIndex, setPrimarySelectedIndex] = useState(0);
  const [message, setMessage] = useState(
    "Shift/Ctrl/Cmd-click to select multiple pixels, then drag the group.",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    indices: number[];
    startClientX: number;
    startClientY: number;
    canvasWidth: number;
    canvasHeight: number;
    initialPositions: { index: number; x: number; y: number }[];
  } | null>(null);
  const selectedPixel = draft.pixels[primarySelectedIndex];
  const selectedIndexSet = useMemo(
    () => new Set(selectedIndices),
    [selectedIndices],
  );
  const pentagonPixelIndices = useMemo(
    () => getPentagonPixelIndices(draft),
    [draft],
  );

  const updatePixel = useCallback(
    (geometrySlot: number, updates: Partial<PixelConfigurationEntry>) => {
      setDraft((current) => ({
        ...current,
        pixels: current.pixels.map((pixel, slot) =>
          slot === geometrySlot ? { ...pixel, ...updates } : pixel,
        ),
      }));
    },
    [],
  );

  const assignClusterPentagon = useCallback((geometrySlot: number) => {
    if (geometrySlot >= GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE) return;
    const cluster = Math.floor(geometrySlot / GRAY_CLUSTER_SIZE);
    const clusterStart = cluster * GRAY_CLUSTER_SIZE;
    const clusterEnd = clusterStart + GRAY_CLUSTER_SIZE;
    setDraft((current) => ({
      ...current,
      pixels: current.pixels.map((pixel, slot) =>
        slot >= clusterStart && slot < clusterEnd
          ? { ...pixel, isPentagon: slot === geometrySlot }
          : pixel,
      ),
    }));
    setMessage(
      `Physical pixel ID ${draft.pixels[geometrySlot].pixelId} is now the permanent pentagon for gray cluster ${cluster + 1}.`,
    );
  }, [draft.pixels]);

  const rotatePixels = useCallback((indices: number[], deltaDegrees: number) => {
    const rotating = new Set(indices);
    setDraft((current) => ({
      ...current,
      pixels: current.pixels.map((pixel, geometrySlot) =>
        rotating.has(geometrySlot)
          ? {
              ...pixel,
              rotationDeg:
                ((pixel.rotationDeg + deltaDegrees) % 360 + 360) % 360,
            }
          : pixel,
      ),
    }));
  }, []);

  const copySelectedClusterToAll = useCallback(() => {
    if (primarySelectedIndex >= GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE) {
      setMessage("Select a pixel from one of the six gray clusters first.");
      return;
    }
    const sourceCluster = Math.floor(
      primarySelectedIndex / GRAY_CLUSTER_SIZE,
    );
    setDraft((current) => {
      const sourceStart = sourceCluster * GRAY_CLUSTER_SIZE;
      const sourceMembers = current.pixels.slice(
        sourceStart,
        sourceStart + GRAY_CLUSTER_SIZE,
      );
      const sourceCenter = sourceMembers.reduce(
        (center, pixel) => ({
          x: center.x + pixel.x / GRAY_CLUSTER_SIZE,
          y: center.y + pixel.y / GRAY_CLUSTER_SIZE,
        }),
        { x: 0, y: 0 },
      );
      const targetCenters = Array.from(
        { length: GRAY_CLUSTER_COUNT },
        (_, cluster) =>
          current.pixels
            .slice(
              cluster * GRAY_CLUSTER_SIZE,
              (cluster + 1) * GRAY_CLUSTER_SIZE,
            )
            .reduce(
              (center, pixel) => ({
                x: center.x + pixel.x / GRAY_CLUSTER_SIZE,
                y: center.y + pixel.y / GRAY_CLUSTER_SIZE,
              }),
              { x: 0, y: 0 },
            ),
      );
      return {
        ...current,
        pixels: current.pixels.map((pixel, geometrySlot) => {
          if (geometrySlot >= GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE) {
            return pixel;
          }
          const targetCluster = Math.floor(
            geometrySlot / GRAY_CLUSTER_SIZE,
          );
          const position = geometrySlot % GRAY_CLUSTER_SIZE;
          const template = sourceMembers[position];
          const targetCenter = targetCenters[targetCluster];
          return {
            ...pixel,
            x: THREE.MathUtils.clamp(
              targetCenter.x + template.x - sourceCenter.x,
              1.2,
              98.8,
            ),
            y: THREE.MathUtils.clamp(
              targetCenter.y + template.y - sourceCenter.y,
              1.2,
              98.8,
            ),
            rotationDeg: template.rotationDeg,
            isPentagon: template.isPentagon,
          };
        }),
      };
    });
    setMessage(
      `Gray cluster ${sourceCluster + 1} copied to all six clusters: relative positions, rotations, and pentagon placement now match.`,
    );
  }, [primarySelectedIndex]);

  const movePixels = useCallback(
    (indices: number[], requestedDeltaX: number, requestedDeltaY: number) => {
      if (indices.length === 0) return;
      setDraft((current) => {
        const moving = indices.map((index) => current.pixels[index]);
        const deltaX = THREE.MathUtils.clamp(
          requestedDeltaX,
          Math.max(...moving.map((pixel) => 1.2 - pixel.x)),
          Math.min(...moving.map((pixel) => 98.8 - pixel.x)),
        );
        const deltaY = THREE.MathUtils.clamp(
          requestedDeltaY,
          Math.max(...moving.map((pixel) => 1.2 - pixel.y)),
          Math.min(...moving.map((pixel) => 98.8 - pixel.y)),
        );
        const movingSet = new Set(indices);
        return {
          ...current,
          pixels: current.pixels.map((pixel, geometrySlot) =>
            movingSet.has(geometrySlot)
              ? { ...pixel, x: pixel.x + deltaX, y: pixel.y + deltaY }
              : pixel,
          ),
        };
      });
    },
    [],
  );

  const saveConfiguration = () => {
    if (!hasCanonicalPixelIdBijection(draft.pixels)) {
      setMessage("Physical pixel IDs must be the exact unique set 0–125.");
      return;
    }
    onSave({
      version: 2,
      pixels: draft.pixels.map((pixel) => ({
        ...pixel,
        legacyAnnotation: pixel.legacyAnnotation.trim(),
      })),
    });
  };

  const exportConfiguration = () => {
    const payload = JSON.stringify(draft, null, 2);
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "crystal-eye-pixel-configuration.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Configuration exported as JSON.");
  };

  const importConfiguration = async (file: File) => {
    try {
      const imported = normalizePixelConfiguration(JSON.parse(await file.text()));
      if (!imported) throw new Error("Invalid configuration");
      setDraft(imported);
      setSelectedIndices([0]);
      setPrimarySelectedIndex(0);
      setMessage("Configuration imported. Review it, then press Save configuration.");
    } catch {
      setMessage("The selected file is not a valid 126-pixel configuration.");
    }
  };

  return (
    <div className="pixel-editor-backdrop" role="presentation">
      <section
        className="pixel-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pixel-editor-title"
      >
        <header>
          <div>
            <small>DETECTOR MAP CONFIGURATOR</small>
            <strong id="pixel-editor-title">Crystal Eye · 126 pixel layout</strong>
          </div>
          <div className="pixel-editor-header-actions">
            <button type="button" onClick={exportConfiguration}>
              <Download size={14} /> EXPORT JSON
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} /> IMPORT JSON
            </button>
            <button
              type="button"
              className="icon-only"
              onClick={onClose}
              aria-label="Close pixel configurator"
            >
              <X size={17} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importConfiguration(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </header>

        <div className="pixel-editor-body">
          <div className="pixel-editor-workspace">
            <div className="pixel-editor-toolbar">
              <span><Move size={13} /> DRAG TO POSITION</span>
              <span>SHIFT / CTRL / CMD + CLICK · MULTI-SELECT</span>
              <div>
                <button
                  type="button"
                  disabled={
                    primarySelectedIndex >=
                    GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE
                  }
                  onClick={copySelectedClusterToAll}
                  title="Use the selected gray cluster as the geometric template for all six clusters"
                >
                  COPY CLUSTER TO ALL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIndices(draft.pixels.map((_, geometrySlot) => geometrySlot));
                    setPrimarySelectedIndex(0);
                  }}
                >
                  SELECT ALL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIndices([primarySelectedIndex]);
                  }}
                >
                  CLEAR GROUP
                </button>
              </div>
              <b>{selectedIndices.length} / 126 SELECTED</b>
            </div>
            <div
              className="pixel-editor-canvas"
              role="application"
              aria-label="Draggable planar map of all 126 Crystal Eye pixels"
            >
              <div className="pixel-editor-axis axis-x">X</div>
              <div className="pixel-editor-axis axis-y">Y</div>
              {draft.pixels.map((pixel, geometrySlot) => (
                <button
                  key={geometrySlot}
                  type="button"
                  className={`pixel-editor-node ${
                    pixel.isSeam ? "is-red" : "is-gray"
                  } ${
                    pentagonPixelIndices.has(geometrySlot) ? "is-pentagon" : ""
                  } ${selectedIndexSet.has(geometrySlot) ? "selected" : ""} ${
                    geometrySlot === primarySelectedIndex ? "primary-selected" : ""
                  }`}
                  style={{
                    "--editor-x": `${pixel.x}%`,
                    "--editor-y": `${pixel.y}%`,
                    "--pixel-rotation": `${pixel.rotationDeg}deg`,
                    "--pixel-label-rotation": `${-pixel.rotationDeg}deg`,
                  } as React.CSSProperties}
                  title={`Physical pixel ID ${pixel.pixelId}`}
                  aria-label={`Physical pixel ID ${pixel.pixelId}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    const additiveSelection =
                      event.shiftKey || event.ctrlKey || event.metaKey;
                    let dragIndices: number[];
                    if (additiveSelection) {
                      dragIndices = selectedIndexSet.has(geometrySlot)
                        ? selectedIndices.filter((slot) => slot !== geometrySlot)
                        : [...selectedIndices, geometrySlot];
                      if (dragIndices.length === 0) dragIndices = [geometrySlot];
                      setSelectedIndices(dragIndices);
                    } else if (selectedIndexSet.has(geometrySlot)) {
                      dragIndices = selectedIndices;
                    } else {
                      dragIndices = [geometrySlot];
                      setSelectedIndices(dragIndices);
                    }
                    setPrimarySelectedIndex(
                      dragIndices.includes(geometrySlot)
                        ? geometrySlot
                        : dragIndices[0],
                    );
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const canvas = event.currentTarget.parentElement;
                    if (canvas) {
                      const rect = canvas.getBoundingClientRect();
                      dragRef.current = {
                        indices: dragIndices,
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        canvasWidth: rect.width,
                        canvasHeight: rect.height,
                        initialPositions: dragIndices.map((index) => ({
                          index,
                          x: draft.pixels[index].x,
                          y: draft.pixels[index].y,
                        })),
                      };
                    }
                  }}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const drag = dragRef.current;
                    if (!drag) return;
                    const requestedDeltaX =
                      ((event.clientX - drag.startClientX) / drag.canvasWidth) * 100;
                    const requestedDeltaY =
                      ((event.clientY - drag.startClientY) / drag.canvasHeight) * 100;
                    const deltaX = THREE.MathUtils.clamp(
                      requestedDeltaX,
                      Math.max(
                        ...drag.initialPositions.map((position) => 1.2 - position.x),
                      ),
                      Math.min(
                        ...drag.initialPositions.map((position) => 98.8 - position.x),
                      ),
                    );
                    const deltaY = THREE.MathUtils.clamp(
                      requestedDeltaY,
                      Math.max(
                        ...drag.initialPositions.map((position) => 1.2 - position.y),
                      ),
                      Math.min(
                        ...drag.initialPositions.map((position) => 98.8 - position.y),
                      ),
                    );
                    const dragSet = new Set(drag.indices);
                    setDraft((current) => ({
                      ...current,
                      pixels: current.pixels.map((currentPixel, currentSlot) => {
                        if (!dragSet.has(currentSlot)) return currentPixel;
                        const initial = drag.initialPositions.find(
                          (position) => position.index === currentSlot,
                        );
                        return initial
                          ? {
                              ...currentPixel,
                              x: initial.x + deltaX,
                              y: initial.y + deltaY,
                            }
                          : currentPixel;
                      }),
                    }));
                  }}
                  onPointerUp={(event) => {
                    dragRef.current = null;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                  onPointerCancel={() => {
                    dragRef.current = null;
                  }}
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 1 : 0.25;
                    const delta = {
                      ArrowLeft: [-step, 0],
                      ArrowRight: [step, 0],
                      ArrowUp: [0, -step],
                      ArrowDown: [0, step],
                    }[event.key];
                    if (!delta) return;
                    event.preventDefault();
                    const keyboardSelection = selectedIndexSet.has(geometrySlot)
                      ? selectedIndices
                      : [geometrySlot];
                    movePixels(keyboardSelection, delta[0], delta[1]);
                  }}
                >
                  <span>{pixel.pixelId}</span>
                </button>
              ))}
            </div>
          </div>

          <aside className="pixel-editor-inspector">
            <div className="pixel-editor-selected">
              <small>
                {selectedIndices.length === 1 ? "SELECTED PIXEL" : "MULTIPLE SELECTION"}
              </small>
              <strong>
                {selectedIndices.length === 1
                  ? `PIXEL ID ${selectedPixel.pixelId}`
                  : `${selectedIndices.length} PIXELS`}
              </strong>
              <em>
                {selectedIndices.length === 1
                  ? selectedPixel.isSeam
                    ? "RED TRIPLET"
                    : pentagonPixelIndices.has(primarySelectedIndex)
                      ? "GRAY CLUSTER · CENTRAL PENTAGON"
                      : "GRAY CLUSTER · HEXAGON"
                  : "DRAG OR NUDGE AS A GROUP"}
              </em>
            </div>

            <section
              className="pixel-geometry-card"
              aria-label={`Geometric internal structure for physical pixel ID ${selectedPixel.pixelId}`}
            >
              <header>
                <span>PIXEL GEOMETRY</span>
                <strong>PIXEL ID {selectedPixel.pixelId}</strong>
                <em>LONGITUDINAL HALF-SECTION · GEOMETRY ONLY</em>
              </header>
              <div className="pixel-geometry-stack">
                <i className="pixel-geometry-axis" />
                <div className="pixel-geometry-stage tacs-stage">
                  <div className="pixel-geometry-shape geometry-tacs" />
                  <span>
                    <strong>T-ACS<sub>0</sub></strong>
                    <small>UPPER FRUSTUM · CH 0–1</small>
                  </span>
                </div>
                <div className="pixel-geometry-stage up-stage">
                  <div className="pixel-geometry-shape geometry-up" />
                  <span>
                    <strong>UP<sub>0</sub></strong>
                    <small>MIDDLE FRUSTUM · CH 2–4</small>
                  </span>
                </div>
                <div className="pixel-geometry-stage down-stage">
                  <div className="pixel-geometry-shape geometry-down" />
                  <span>
                    <strong>DOWN<sub>0</sub></strong>
                    <small>LOWER FRUSTUM · CH 5–7</small>
                  </span>
                </div>
              </div>
            </section>

            <label htmlFor="pixel-config-id">PHYSICAL PIXEL ID · pixbkg pixel_id</label>
            <input
              key={`${primarySelectedIndex}-${selectedPixel.pixelId}`}
              id="pixel-config-id"
              type="number"
              min={0}
              max={125}
              step={1}
              defaultValue={
                selectedIndices.length === 1
                  ? selectedPixel.pixelId
                  : ""
              }
              disabled={selectedIndices.length !== 1}
              aria-describedby="pixel-config-id-help"
              onBlur={(event) => {
                const requestedValue = event.target.value.trim();
                const requestedPixelId = Number(requestedValue);
                if (
                  requestedValue === "" ||
                  !Number.isInteger(requestedPixelId) ||
                  requestedPixelId < 0 ||
                  requestedPixelId > 125
                ) {
                  event.currentTarget.value = String(selectedPixel.pixelId);
                  setMessage("Physical pixel ID must be an integer from 0 through 125.");
                  return;
                }
                setDraft((current) =>
                  swapPhysicalPixelIds(
                    current,
                    primarySelectedIndex,
                    requestedPixelId,
                  ),
                );
                setMessage(
                  `Physical pixel ID ${selectedPixel.pixelId} swapped with ${requestedPixelId}; the 0–125 bijection is preserved.`,
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onFocus={(event) => event.currentTarget.select()}
            />
            <small id="pixel-config-id-help">
              Changing to an occupied ID swaps the two physical IDs atomically.
            </small>

            <label htmlFor="pixel-config-secondary-id">LEGACY NOTE · NOT PIXEL ID</label>
            <input
              id="pixel-config-secondary-id"
              className="pixel-secondary-id-input"
              value={
                selectedIndices.length === 1
                  ? selectedPixel.legacyAnnotation
                  : "Select one pixel to edit its legacy note"
              }
              maxLength={12}
              inputMode="numeric"
              spellCheck={false}
              placeholder="Not assigned"
              disabled={selectedIndices.length !== 1}
              onChange={(event) =>
                updatePixel(primarySelectedIndex, {
                  legacyAnnotation: event.target.value,
                })
              }
              onFocus={(event) => event.currentTarget.select()}
            />

            <div className="pixel-editor-shape-control">
              <span>PIXEL SHAPE</span>
              <strong>
                {selectedPixel.isSeam
                  ? "HEXAGON · RED TRIPLET"
                  : selectedPixel.isPentagon
                    ? "PENTAGON · FIXED IDENTITY"
                    : "HEXAGON · GRAY CLUSTER"}
              </strong>
              <button
                type="button"
                disabled={
                  selectedIndices.length !== 1 ||
                  selectedPixel.isSeam ||
                  selectedPixel.isPentagon
                }
                onClick={() => assignClusterPentagon(primarySelectedIndex)}
              >
                {selectedPixel.isPentagon
                  ? "CLUSTER PENTAGON"
                  : selectedPixel.isSeam
                    ? "RED PIXELS STAY HEXAGONAL"
                    : "SET AS CLUSTER PENTAGON"}
              </button>
              <small>
                One permanent pentagon per gray cluster. Moving pixels never
                changes their shape.
              </small>
            </div>

            <div
              className={`pixel-editor-coordinates ${
                selectedIndices.length !== 1 ? "is-disabled" : ""
              }`}
            >
              <label>
                <span>X POSITION</span>
                <input
                  type="number"
                  min={1.2}
                  max={98.8}
                  step={0.1}
                  value={selectedPixel.x.toFixed(2)}
                  disabled={selectedIndices.length !== 1}
                  onChange={(event) =>
                    updatePixel(primarySelectedIndex, {
                      x: THREE.MathUtils.clamp(Number(event.target.value), 1.2, 98.8),
                    })
                  }
                />
              </label>
              <label>
                <span>Y POSITION</span>
                <input
                  type="number"
                  min={1.2}
                  max={98.8}
                  step={0.1}
                  value={selectedPixel.y.toFixed(2)}
                  disabled={selectedIndices.length !== 1}
                  onChange={(event) =>
                    updatePixel(primarySelectedIndex, {
                      y: THREE.MathUtils.clamp(Number(event.target.value), 1.2, 98.8),
                    })
                  }
                />
              </label>
            </div>

            <div className="pixel-editor-rotation">
              <div>
                <span>PIXEL ROTATION</span>
                <strong>
                  {selectedIndices.length === 1
                    ? `${selectedPixel.rotationDeg.toFixed(1)}°`
                    : `${selectedIndices.length} PIXELS`}
                </strong>
              </div>
              <input
                type="number"
                min={0}
                max={359.9}
                step={0.5}
                value={selectedPixel.rotationDeg.toFixed(1)}
                disabled={selectedIndices.length !== 1}
                aria-label="Selected pixel rotation in degrees"
                onChange={(event) =>
                  updatePixel(primarySelectedIndex, {
                    rotationDeg:
                      ((Number(event.target.value) % 360) + 360) % 360,
                  })
                }
              />
              <div>
                <button
                  type="button"
                  onClick={() => rotatePixels(selectedIndices, -5)}
                >
                  −5°
                </button>
                <button
                  type="button"
                  onClick={() => rotatePixels(selectedIndices, -1)}
                >
                  −1°
                </button>
                <button
                  type="button"
                  onClick={() => rotatePixels(selectedIndices, 1)}
                >
                  +1°
                </button>
                <button
                  type="button"
                  onClick={() => rotatePixels(selectedIndices, 5)}
                >
                  +5°
                </button>
              </div>
              <button
                type="button"
                className="rotation-reset"
                onClick={() =>
                  setDraft((current) => {
                    const rotating = new Set(selectedIndices);
                    return {
                      ...current,
                      pixels: current.pixels.map((pixel, geometrySlot) =>
                        rotating.has(geometrySlot)
                          ? { ...pixel, rotationDeg: 0 }
                          : pixel,
                      ),
                    };
                  })
                }
              >
                RESET ROTATION
              </button>
            </div>

            <div className="pixel-editor-nudge">
              <span>FINE POSITION</span>
              <div>
                <button
                  type="button"
                  aria-label="Move selection up"
                  onClick={() =>
                    movePixels(selectedIndices, 0, -0.25)
                  }
                >↑</button>
                <button
                  type="button"
                  aria-label="Move selection left"
                  onClick={() =>
                    movePixels(selectedIndices, -0.25, 0)
                  }
                >←</button>
                <button
                  type="button"
                  aria-label="Move selection right"
                  onClick={() =>
                    movePixels(selectedIndices, 0.25, 0)
                  }
                >→</button>
                <button
                  type="button"
                  aria-label="Move selection down"
                  onClick={() =>
                    movePixels(selectedIndices, 0, 0.25)
                  }
                >↓</button>
              </div>
            </div>

            <button
              type="button"
              className="pixel-editor-reset"
              onClick={() => {
                setDraft({
                  version: 2,
                  pixels: DEFAULT_PIXEL_CONFIGURATION.pixels.map((pixel) => ({
                    ...pixel,
                  })),
                });
                setSelectedIndices([0]);
                setPrimarySelectedIndex(0);
                setMessage("Default draft restored. Press Save to make it permanent.");
              }}
            >
              <RotateCcw size={14} /> RESTORE DEFAULT DRAFT
            </button>

            <p>
              Save stores the map in this browser. Export the JSON to back it up,
              move it to another computer, or share it with collaborators.
            </p>
          </aside>
        </div>

        <footer>
          <span>{message}</span>
          <div>
            <button type="button" className="secondary" onClick={onClose}>
              CANCEL
            </button>
            <button type="button" className="primary" onClick={saveConfiguration}>
              <Save size={14} /> SAVE CONFIGURATION
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function PayloadPlacementPanel({
  mountX,
  mountZ,
  onMountChange,
  onClose,
}: {
  mountX: number;
  mountZ: number;
  onMountChange: (x: number, z: number) => void;
  onClose: () => void;
}) {
  const placementStats = useMemo(() => {
    const horizonVisibility = getMountHorizonVisibility(mountX, mountZ);
    const earthExposure = getMountAlbedoTransmission(mountX, mountZ);
    return {
      effectiveFov: getMountEffectiveFov(mountX, mountZ),
      earthExposure,
      horizonVisibility,
    };
  }, [mountX, mountZ]);

  const updateFromPointer = (
    clientX: number,
    clientY: number,
    element: HTMLDivElement,
  ) => {
    const rect = element.getBoundingClientRect();
    const x = THREE.MathUtils.clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const z = THREE.MathUtils.clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    onMountChange(x, z);
  };

  return (
    <div className="placement-dialog-backdrop" role="presentation">
      <section
        className="placement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="placement-title"
      >
        <header>
          <div>
            <small>PAYLOAD CONFIGURATION</small>
            <strong id="placement-title">Crystal Eye placement</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close payload placement">
            <X size={16} />
          </button>
        </header>

        <div className="placement-dialog-body">
          <div className="placement-map-column">
            <div className="placement-map-frame">
              <div
                className="satellite-top-surface"
                role="application"
                aria-label="Satellite top surface. Click or drag to position the Crystal Eye."
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  updateFromPointer(event.clientX, event.clientY, event.currentTarget);
                }}
                onPointerMove={(event) => {
                  if (event.buttons !== 1) return;
                  updateFromPointer(event.clientX, event.clientY, event.currentTarget);
                }}
              >
                <span className="surface-axis surface-axis-x">60 cm</span>
                <span className="surface-axis surface-axis-z">60 cm</span>
                <div
                  className="detector-footprint"
                  style={{
                    "--mount-x": `${50 + mountX * 50}%`,
                    "--mount-z": `${50 + mountZ * 50}%`,
                  } as React.CSSProperties}
                >
                  <i />
                  <b>CE</b>
                  <span>Ø 30</span>
                </div>
              </div>
            </div>
            <p>Top view · detector center can move across the full 60 × 60 cm surface.</p>
          </div>

          <div className="placement-controls">
            <div className="placement-presets">
              <button type="button" onClick={() => onMountChange(0, 0)}>CENTER</button>
              <button type="button" onClick={() => onMountChange(1, 0)}>EDGE</button>
              <button type="button" onClick={() => onMountChange(1, -1)}>CORNER</button>
            </div>

            <RangeControl
              label="X position"
              value={Math.round(mountX * 30)}
              min={-30}
              max={30}
              step={1}
              suffix=" cm"
              onChange={(value) => onMountChange(value / 30, mountZ)}
            />
            <RangeControl
              label="Z position"
              value={Math.round(mountZ * 30)}
              min={-30}
              max={30}
              step={1}
              suffix=" cm"
              onChange={(value) => onMountChange(mountX, value / 30)}
            />

            <div className="placement-results">
              <div>
                <small>EFFECTIVE FOV</small>
                <strong>{placementStats.effectiveFov.toFixed(0)}°</strong>
              </div>
              <div>
                <small>HORIZON VISIBILITY</small>
                <strong>{(placementStats.horizonVisibility * 100).toFixed(0)}%</strong>
              </div>
              <div>
                <small>EARTH-LIGHT EXPOSURE</small>
                <strong>{(placementStats.earthExposure * 100).toFixed(0)}%</strong>
              </div>
            </div>

            <div className="placement-physical-model">
              <span><b>Crystal Eye</b> Ø 30 cm dome + 30 cm base</span>
              <span><b>Satellite</b> 60 × 60 cm top surface</span>
              <p>
                First-order geometric shadowing model. Edge and corner placements expose
                more horizon-facing pixels while the satellite structure still blocks the
                inward-facing sector.
              </p>
            </div>
          </div>
        </div>

        <footer>
          <span>Changes are applied live to photon detection.</span>
          <button type="button" onClick={onClose}>DONE</button>
        </footer>
      </section>
    </div>
  );
}

export default function Home() {
  const [orbitScenarioMode, setOrbitScenarioMode] =
    useState<OrbitScenarioMode>("canonical");
  const [orbitAltitudeKm, setOrbitAltitudeKm] = useState(
    DEFAULT_ORBIT_ALTITUDE_KM,
  );
  const [orbitInclinationDeg, setOrbitInclinationDeg] = useState(
    DEFAULT_ORBIT_INCLINATION_DEG,
  );
  const [speed, setSpeed] = useState(50);
  const [paused, setPaused] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [systemZoom, setSystemZoom] = useState(55);
  const [configurationView, setConfigurationView] = useState<
    "hub" | "orbit" | "payload" | "pixels" | null
  >(null);
  const [pixelConfiguration, setPixelConfiguration] =
    useState<PixelConfiguration>(DEFAULT_PIXEL_CONFIGURATION);
  const [mountX, setMountX] = useState(0);
  const [mountZ, setMountZ] = useState(0);
  const [epochMs, setEpochMs] = useState(ECI_EPHEMERIS_START_MS);
  const [selectedPixel, setSelectedPixel] = useState(43);
  const [workspaceFocus, setWorkspaceFocus] = useState<WorkspaceFocus>(null);
  const [leftColumnVisible, setLeftColumnVisible] = useState(true);
  const [rightColumnVisible, setRightColumnVisible] = useState(true);
  const [historyView, setHistoryView] = useState<"events" | null>(null);
  const [simulatorMode, setSimulatorMode] =
    useState<SimulatorMode>("reference");
  const [simulationSeed, setSimulationSeed] = useState(DEFAULT_SIMULATION_SEED);
  const [testBurstDraft, setTestBurstDraft] = useState<TestBurstDraft>({
    raDeg: 0,
    decDeg: 0,
    intensity: 100,
    spreadPixels: 18,
    durationSeconds: 1.2,
  });
  const [backgroundProfile, setBackgroundProfile] =
    useState<PixelBackgroundProfile | null>(null);
  const [backgroundProfileError, setBackgroundProfileError] =
    useState<string | null>(null);
  const [ephemerisProfile, setEphemerisProfile] =
    useState<EciEphemerisProfile | null>(null);
  const [ephemerisError, setEphemerisError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [samples, setSamples] = useState<SignalSample[]>(() =>
    createBaselineSamples(INITIAL_TELEMETRY.background),
  );
  const [photonRecordCount, setPhotonRecordCount] = useState(0);
  const [persistenceStatus, setPersistenceStatus] = useState<
    "initializing" | "persisting" | "not-persisting"
  >("initializing");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<EventRecord[]>(() => {
    const utc = new Date().toISOString();
    return [
      { time: "T+00:00", utc, text: "Science acquisition started", kind: "system" },
      { time: "T+00:00", utc, text: "Orbital background model initialized", kind: "background" },
    ];
  });
  const phaseRef = useRef(0);
  const satelliteDirectionRef = useRef(
    INITIAL_CELESTIAL.satelliteDirection,
  );
  const elapsedRef = useRef(0);
  const photonBinRef = useRef(0);
  const photonRepositoryRef = useRef<PhotonRepository | null>(null);
  const photonRunIdRef = useRef("");
  const persistenceFailedRef = useRef(false);
  const activeBurstsRef = useRef<BurstEvent[]>([]);
  const nextBurstIdRef = useRef(1);
  const observationRandomRef = useRef(createSeededRandom(DEFAULT_SIMULATION_SEED));
  const burstRandomRef = useRef(
    createSeededRandom(DEFAULT_SIMULATION_SEED ^ 0xa5a5_5a5a),
  );
  const nextAutomaticBurstBinRef = useRef(AUTOMATIC_GRB_INITIAL_DELAY_BINS);
  const totalRef = useRef(0);
  const capturedRef = useRef(0);
  const pixelConfigurationRef = useRef(DEFAULT_PIXEL_CONFIGURATION);
  const backgroundProfileRef = useRef<PixelBackgroundProfile | null>(null);
  const ephemerisProfileRef = useRef<EciEphemerisProfile | null>(null);
  const settingsRef = useRef({
    speed,
    paused,
    epochMs,
    orbitScenarioMode,
    orbitAltitudeKm,
    orbitInclinationDeg,
    mountX,
    mountZ,
    simulatorMode,
    simulationSeed,
  });

  useEffect(() => {
    let cancelled = false;
    photonRunIdRef.current = createPhotonRunId();
    openPhotonRepository()
      .then(async (repository) => {
        if (cancelled) {
          repository.close();
          return;
        }
        photonRepositoryRef.current = repository;
        const count = await repository.count();
        if (cancelled) return;
        setPhotonRecordCount(count);
        setPersistenceStatus("persisting");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        persistenceFailedRef.current = true;
        photonRepositoryRef.current?.close();
        photonRepositoryRef.current = null;
        setPersistenceError(
          error instanceof Error ? error.message : "Unknown IndexedDB error.",
        );
        setPersistenceStatus("not-persisting");
      });
    return () => {
      cancelled = true;
      photonRepositoryRef.current?.close();
      photonRepositoryRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPixelBackgroundProfile(`${PUBLIC_BASE_PATH}/data/pixbkg.txt`)
      .then((profile) => {
        if (cancelled) return;
        backgroundProfileRef.current = profile;
        setBackgroundProfile(profile);
        setBackgroundProfileError(null);
        if (settingsRef.current.simulatorMode === "reference") {
          setSamples(createBaselineSamples(profile.totalExpectedCountsPerBin));
        }
        setEventLog((current) => [
          ...current,
          {
            time: "T+00:00",
            utc: new Date().toISOString(),
            text: `Pixel background loaded · ${profile.totalRateCountsPerSecond.toFixed(4)} c/s · deterministic ${profile.binSeconds.toFixed(1)} s bins · status documented in provenance`,
            kind: "background",
          },
        ]);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        backgroundProfileRef.current = null;
        setBackgroundProfile(null);
        setBackgroundProfileError(
          error instanceof Error ? error.message : "Unknown pixel background error.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadEciEphemerisProfile(
      `${PUBLIC_BASE_PATH}/data/eci-ephemeris-2033.tsv`,
    )
      .then((profile) => {
        if (cancelled) return;
        ephemerisProfileRef.current = profile;
        setEphemerisProfile(profile);
        setEphemerisError(null);
        setEventLog((current) => [
          ...current,
          {
            time: "T+00:00",
            utc: new Date(profile.startMs).toISOString(),
            text: `ECI replay loaded · ${profile.records.length.toLocaleString("en-US")} SAT/SUN/MOON records`,
            kind: "system",
          },
        ]);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        ephemerisProfileRef.current = null;
        setEphemerisProfile(null);
        setEphemerisError(
          error instanceof Error ? error.message : "Unknown ECI ephemeris error.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    try {
      const readStoredConfiguration = (key: string) => {
        const stored = window.localStorage.getItem(key);
        if (!stored) return null;
        try {
          return normalizePixelConfiguration(JSON.parse(stored));
        } catch {
          return null;
        }
      };
      const storedV4 = readStoredConfiguration(
        PIXEL_CONFIGURATION_STORAGE_KEY_V4,
      );
      const readV3StoredConfiguration = (key: string) => {
        const stored = window.localStorage.getItem(key);
        if (!stored) return null;
        try {
          return migrateStoredPixelConfigurationToAuthoritativeIds(
            JSON.parse(stored),
          );
        } catch {
          return null;
        }
      };
      const readLegacyStoredConfiguration = (key: string) => {
        const stored = window.localStorage.getItem(key);
        if (!stored) return null;
        try {
          const photoAligned = migrateStoredPixelConfigurationToPhotoGeometry(
            JSON.parse(stored),
          );
          return photoAligned
            ? migrateStoredPixelConfigurationToAuthoritativeIds(photoAligned)
            : null;
        } catch {
          return null;
        }
      };
      const configuration =
        storedV4 ??
        readV3StoredConfiguration(PIXEL_CONFIGURATION_STORAGE_KEY_V3) ??
        readLegacyStoredConfiguration(PIXEL_CONFIGURATION_STORAGE_KEY_V2) ??
        readLegacyStoredConfiguration(PIXEL_CONFIGURATION_STORAGE_KEY_V1);
      if (configuration) {
        window.localStorage.setItem(
          PIXEL_CONFIGURATION_STORAGE_KEY_V4,
          JSON.stringify(configuration),
        );
        timer = window.setTimeout(() => {
          pixelConfigurationRef.current = configuration;
          setPixelConfiguration(configuration);
        }, 0);
      }
    } catch {
      // Unavailable browser storage should never prevent the simulator from opening.
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    settingsRef.current = {
      speed,
      paused,
      epochMs,
      orbitScenarioMode,
      orbitAltitudeKm,
      orbitInclinationDeg,
      mountX,
      mountZ,
      simulatorMode,
      simulationSeed,
    };
  }, [
    speed,
    paused,
    epochMs,
    orbitScenarioMode,
    orbitAltitudeKm,
    orbitInclinationDeg,
    mountX,
    mountZ,
    simulatorMode,
    simulationSeed,
  ]);

  useEffect(() => {
    const ephemeris = ephemerisProfileRef.current;
    if (!ephemeris) return;
    const timestampMs = THREE.MathUtils.clamp(
      settingsRef.current.epochMs + elapsedRef.current * 1000,
      ephemeris.startMs,
      ephemeris.endMs,
    );
    const celestial = getCelestialGeometry(
      sampleEciEphemeris(ephemeris, timestampMs),
      orbitScenarioMode,
      orbitAltitudeKm,
      orbitInclinationDeg,
    );
    const mountedEffectiveFov = getMountEffectiveFov(mountX, mountZ);
    const mountedSunNoise =
      celestial.sunSeparation <= mountedEffectiveFov / 2
        ? celestial.sunNoise *
          getMountedDirectionVisibility(
            celestial.sunDirection,
            celestial.satelliteDirection,
            mountX,
            mountZ,
          )
        : 0;
    const mountedMoonNoise =
      celestial.moonSeparation <= mountedEffectiveFov / 2
        ? celestial.moonNoise *
          getMountedDirectionVisibility(
            celestial.moonDirection,
            celestial.satelliteDirection,
            mountX,
            mountZ,
          )
        : 0;
    const mountedEarthAlbedoNoise =
      celestial.earthAlbedoNoise * getMountAlbedoTransmission(mountX, mountZ);
    const pixelBackground = backgroundProfileRef.current;
    const background =
      simulatorMode === "reference" && !pixelBackground
        ? null
        : rateToExpectedCountsPerBin(
            composeModeBackgroundRate(
              simulatorMode,
              pixelBackground?.totalRateCountsPerSecond ?? null,
              {
                sunRateCountsPerSecond: mountedSunNoise,
                moonRateCountsPerSecond: mountedMoonNoise,
                earthRateCountsPerSecond: mountedEarthAlbedoNoise,
              },
            ),
          );

    satelliteDirectionRef.current = celestial.satelliteDirection;
    setTelemetry((current) => ({
      ...current,
      ...(background === null
        ? {}
        : {
            background,
            observed: background + current.source,
            significance: current.source / Math.sqrt(Math.max(1, background)),
          }),
      simulatedDate: celestial.date.toISOString(),
      altitudeKm: celestial.altitudeKm,
      canonicalAltitudeKm: celestial.canonicalAltitudeKm,
      canonicalSatelliteDirection: celestial.canonicalSatelliteDirection,
      satelliteDirection: celestial.satelliteDirection,
      geocentricSunDirection: celestial.geocentricSunDirection,
      geocentricMoonDirection: celestial.geocentricMoonDirection,
      sunDirection: celestial.sunDirection,
      moonDirection: celestial.moonDirection,
      sunSeparation: celestial.sunSeparation,
      moonSeparation: celestial.moonSeparation,
      sunNoise: mountedSunNoise,
      sunExposure: mountedSunNoise / DIRECT_SUN_BACKGROUND_RATE,
      moonNoise: mountedMoonNoise,
      sunInFov: celestial.sunInFov,
      moonInFov: celestial.moonInFov,
      moonDistanceKm: celestial.moonDistanceKm,
      moonPhase: celestial.moonPhase,
      earthIllumination: celestial.earthIllumination,
      earthAlbedoNoise: mountedEarthAlbedoNoise,
      earthAlbedoAzimuth: celestial.earthAlbedoAzimuth,
      earthAlbedoDirectional: celestial.earthAlbedoDirectional,
    }));
  }, [
    ephemerisProfile,
    mountX,
    mountZ,
    orbitScenarioMode,
    orbitAltitudeKm,
    orbitInclinationDeg,
    simulatorMode,
  ]);

  useEffect(() => {
    if (!workspaceFocus && !historyView) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceFocus(null);
      if (event.key === "Escape") setHistoryView(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [workspaceFocus, historyView]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const settings = settingsRef.current;
      const pixelBackground = backgroundProfileRef.current;
      const ephemeris = ephemerisProfileRef.current;
      if (
        settings.paused ||
        !ephemeris ||
        (settings.simulatorMode === "reference" && !pixelBackground)
      ) return;
      const dt = 0.2 * settings.speed;
      const requestedTimestampMs =
        settings.epochMs + (elapsedRef.current + dt) * 1000;
      const timestampMs = Math.min(requestedTimestampMs, ephemeris.endMs);
      elapsedRef.current = (timestampMs - settings.epochMs) / 1000;
      const celestial = getCelestialGeometry(
        sampleEciEphemeris(ephemeris, timestampMs),
        settings.orbitScenarioMode,
        settings.orbitAltitudeKm,
        settings.orbitInclinationDeg,
      );
      const phase =
        ((timestampMs - ephemeris.startMs) /
          (ephemeris.endMs - ephemeris.startMs)) *
        Math.PI * 2;
      phaseRef.current = phase;
      satelliteDirectionRef.current = celestial.satelliteDirection;
      if (requestedTimestampMs >= ephemeris.endMs) {
        settingsRef.current.paused = true;
        setPaused(true);
        setEventLog((current) => [
          ...current,
          {
            time: `T+${formatTime(elapsedRef.current).slice(3)}`,
            utc: new Date(ephemeris.endMs).toISOString(),
            text: "ECI replay reached the final available sample and stopped",
            kind: "system",
          },
        ]);
      }
      const mountedEffectiveFov = getMountEffectiveFov(
        settings.mountX,
        settings.mountZ,
      );
      const mountedSunNoise =
        celestial.sunSeparation <= mountedEffectiveFov / 2
          ? celestial.sunNoise *
            getMountedDirectionVisibility(
              celestial.sunDirection,
              celestial.satelliteDirection,
              settings.mountX,
              settings.mountZ,
            )
          : 0;
      const mountedMoonNoise =
        celestial.moonSeparation <= mountedEffectiveFov / 2
          ? celestial.moonNoise *
            getMountedDirectionVisibility(
              celestial.moonDirection,
              celestial.satelliteDirection,
              settings.mountX,
              settings.mountZ,
            )
          : 0;
      const mountedEarthAlbedoNoise =
        celestial.earthAlbedoNoise *
        getMountAlbedoTransmission(settings.mountX, settings.mountZ);
      if (
        settings.simulatorMode === "simulation" &&
        photonBinRef.current >= nextAutomaticBurstBinRef.current &&
        !activeBurstsRef.current.some(
          (burst) => burst.origin === "automatic" && burst.ticksRemaining > 0,
        )
      ) {
        const random = burstRandomRef.current;
        const configuration = pixelConfigurationRef.current;
        const configuredNormals = getConfiguredPixelNormals(configuration);
        const configuredSphereSlots = getConfiguredPixelSphereSlots(configuration);
        const halfFovCosine = Math.cos(
          THREE.MathUtils.degToRad(
            getMountEffectiveFov(settings.mountX, settings.mountZ) / 2,
          ),
        );
        const visibleTargets = configuration.pixels.filter((configuredPixel) => {
          const normal = configuredNormals[configuredPixel.pixelId];
          return (
            normal[1] >= halfFovCosine &&
            getMountSkyVisibility(
              configuredSphereSlots[configuredPixel.pixelId],
              settings.mountX,
              settings.mountZ,
            ) >= 0.12
          );
        });
        const targetPixel =
          visibleTargets[Math.floor(random() * visibleTargets.length)]?.pixelId ?? 0;
        const footprintCount = 4 + Math.floor(random() * 25);
        const intensity = 72 + random() * 28;
        const durationSeconds =
          AUTOMATIC_GRB_MINIMUM_DURATION_SECONDS +
          random() * AUTOMATIC_GRB_DURATION_RANGE_SECONDS;
        const transmission =
          Math.max(0, configuredNormals[targetPixel][1]) ** 2 *
          getMountSkyVisibility(
            configuredSphereSlots[targetPixel],
            settings.mountX,
            settings.mountZ,
          );
        const sourceDirection = new THREE.Vector3()
          .fromArray(configuredNormals[targetPixel])
          .applyQuaternion(
            new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              new THREE.Vector3().fromArray(celestial.satelliteDirection),
            ),
          )
          .normalize();
        const coordinates = sceneDirectionToEquatorial(
          sourceDirection.toArray() as [number, number, number],
        );
        const burstId = nextBurstIdRef.current;
        nextBurstIdRef.current += 1;
        const pixelIds = getBurstFootprint(
          configuration,
          targetPixel,
          footprintCount,
        );
        activeBurstsRef.current = [
          ...activeBurstsRef.current,
          {
            id: burstId,
            pixelId: targetPixel,
            pixelIds,
            transmission,
            intensity,
            raDeg: coordinates.raDeg,
            decDeg: coordinates.decDeg,
            ageTicks: 0,
            ticksRemaining: Math.max(1, Math.round(durationSeconds / 0.2)),
            origin: "automatic",
          },
        ];
        setEventLog((current) => [
          ...current,
          {
            time: `T+${formatTime(elapsedRef.current).slice(3)}`,
            utc: celestial.date.toISOString(),
            text: `Automatic synthetic GRB #${burstId} · seed ${settings.simulationSeed} · ${intensity.toFixed(0)}% · ${durationSeconds.toFixed(1)} s · ${pixelIds.length} px`,
            kind: "grb",
          },
        ]);
        nextAutomaticBurstBinRef.current =
          photonBinRef.current +
          AUTOMATIC_GRB_MINIMUM_GAP_BINS +
          Math.floor(random() * AUTOMATIC_GRB_GAP_RANGE_BINS);
      }
      const activeBursts = activeBurstsRef.current.filter(
        (burst) => burst.ticksRemaining > 0,
      );
      const burstDirections = activeBursts.map((burst) => burst.pixelId);
      const burstPixelGroups = activeBursts.map((burst) => burst.pixelIds);
      const isGRB = activeBursts.length > 0;
      const requestedSourceCounts = getAggregateBurstSourceCounts(activeBursts);
      const currentPixelConfiguration = pixelConfigurationRef.current;
      const detectorResponse = createDetectorExpectedResponse({
        mode: settings.simulatorMode,
        pixelBackground,
        configuration: currentPixelConfiguration,
        boresight: celestial.satelliteDirection,
        sunDirection: celestial.sunDirection,
        moonDirection: celestial.moonDirection,
        sunRateCountsPerSecond: mountedSunNoise,
        moonRateCountsPerSecond: mountedMoonNoise,
        earthRateCountsPerSecond: mountedEarthAlbedoNoise,
        earthIllumination: celestial.earthIllumination,
        earthAlbedoAzimuth: celestial.earthAlbedoAzimuth,
        earthAlbedoDirectional: celestial.earthAlbedoDirectional,
        mountX: settings.mountX,
        mountZ: settings.mountZ,
        activeBursts,
        aggregateSourceCounts: requestedSourceCounts,
      });
      const background = detectorResponse.aggregateBackgroundExpectedCounts;
      const source = detectorResponse.aggregateSourceExpectedCounts;
      const expectedCounts = background + source;
      const observed =
        settings.simulatorMode === "simulation"
          ? samplePoisson(expectedCounts, observationRandomRef.current)
          : expectedCounts;
      totalRef.current += observed;
      capturedRef.current += source;
      const detectorHits = detectorResponse.detectorHits;
      const detector = detectorResponse.detectorImpact;
      const effectiveSunCounts = detectorResponse.componentExpectedCounts.sun.reduce(
        (sum, counts) => sum + counts,
        0,
      );
      const effectiveMoonCounts = detectorResponse.componentExpectedCounts.moon.reduce(
        (sum, counts) => sum + counts,
        0,
      );
      const effectiveEarthCounts = detectorResponse.componentExpectedCounts.earth.reduce(
        (sum, counts) => sum + counts,
        0,
      );
      const effectiveSunRate = effectiveSunCounts / PIXEL_BACKGROUND_BIN_SECONDS;
      const effectiveMoonRate = effectiveMoonCounts / PIXEL_BACKGROUND_BIN_SECONDS;
      const effectiveEarthRate = effectiveEarthCounts / PIXEL_BACKGROUND_BIN_SECONDS;
      const next = { observed, background, source };
      const nextSignalSample: SignalSample = {
        ...next,
        frameIndex: photonBinRef.current + 1,
        acquisitionTimeSeconds:
          (photonBinRef.current + 1) * PIXEL_BACKGROUND_BIN_SECONDS,
        simulationTimeSeconds: elapsedRef.current,
        exposureSeconds: PIXEL_BACKGROUND_BIN_SECONDS,
      };
      photonBinRef.current += 1;
      setSamples((current) => [...current.slice(-119), nextSignalSample]);
      const repository = photonRepositoryRef.current;
      if (repository && !persistenceFailedRef.current) {
        const simulatedDate = celestial.date.toISOString();
        void repository.append({
          schemaVersion: 1,
          runId: photonRunIdRef.current,
          ...next,
          bin: photonBinRef.current,
          elapsed: elapsedRef.current,
          capturedAtMs: Date.now(),
          simulatedAtMs: celestial.date.getTime(),
          simulatedDate,
          sun: effectiveSunCounts,
          moon: effectiveMoonCounts,
          earthAlbedo: effectiveEarthCounts,
          activeBursts: activeBursts.length,
          hitPixels: detectorHits.filter((hits) => hits > 0).length,
        }).then(() => {
          setPhotonRecordCount((current) => current + 1);
        }).catch((error: unknown) => {
          persistenceFailedRef.current = true;
          photonRepositoryRef.current?.close();
          photonRepositoryRef.current = null;
          setPersistenceError(
            error instanceof Error ? error.message : "Unknown IndexedDB write error.",
          );
          setPersistenceStatus("not-persisting");
        });
      }
      setTelemetry({
        ...next,
        elapsed: elapsedRef.current,
        phase,
        total: totalRef.current,
        captured: capturedRef.current,
        significance: source / Math.sqrt(Math.max(1, background)),
        grbActive: isGRB,
        burstDirections,
        burstPixelGroups,
        detector: [...detector],
        detectorHits: [...detectorHits],
        detectorBackgroundRates: [...detectorResponse.backgroundRates],
        detectorBackgroundExpectedCounts: [
          ...detectorResponse.backgroundExpectedCounts,
        ],
        simulatedDate: celestial.date.toISOString(),
        altitudeKm: celestial.altitudeKm,
        canonicalAltitudeKm: celestial.canonicalAltitudeKm,
        canonicalSatelliteDirection: celestial.canonicalSatelliteDirection,
        satelliteDirection: celestial.satelliteDirection,
        geocentricSunDirection: celestial.geocentricSunDirection,
        geocentricMoonDirection: celestial.geocentricMoonDirection,
        sunDirection: celestial.sunDirection,
        moonDirection: celestial.moonDirection,
        sunSeparation: celestial.sunSeparation,
        moonSeparation: celestial.moonSeparation,
        sunNoise: effectiveSunRate,
        sunExposure: effectiveSunRate / DIRECT_SUN_BACKGROUND_RATE,
        moonNoise: effectiveMoonRate,
        sunInFov: celestial.sunInFov,
        moonInFov: celestial.moonInFov,
        moonDistanceKm: celestial.moonDistanceKm,
        moonPhase: celestial.moonPhase,
        earthIllumination: celestial.earthIllumination,
        earthAlbedoNoise: effectiveEarthRate,
        earthAlbedoAzimuth: celestial.earthAlbedoAzimuth,
        earthAlbedoDirectional: celestial.earthAlbedoDirectional,
      });
      activeBurstsRef.current = activeBursts
        .map((burst) => ({
          ...burst,
          ageTicks: burst.ageTicks + 1,
          ticksRemaining: burst.ticksRemaining - 1,
        }))
        .filter((burst) => burst.ticksRemaining > 0);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  const selectPixel = useCallback((physicalPixelId: number) => {
    setSelectedPixel(physicalPixelId);
  }, []);

  const savePixelConfiguration = useCallback(
    (configuration: PixelConfiguration) => {
      pixelConfigurationRef.current = configuration;
      setPixelConfiguration(configuration);
      window.localStorage.setItem(
        PIXEL_CONFIGURATION_STORAGE_KEY_V4,
        JSON.stringify(configuration),
      );
      setConfigurationView("hub");
    },
    [],
  );

  const launchBurst = useCallback(({
    targetPixel,
    footprintCount,
    intensity,
    durationSeconds,
    raDeg,
    decDeg,
    transmission,
    origin = "manual",
  }: {
    targetPixel: number;
    footprintCount: number;
    intensity: number;
    durationSeconds: number;
    raDeg: number;
    decDeg: number;
    transmission: number;
    origin?: "manual" | "automatic";
  }) => {
    const pixelIndices = getBurstFootprint(
      pixelConfigurationRef.current,
      targetPixel,
      footprintCount,
    );
    selectPixel(targetPixel);
    const burstId = nextBurstIdRef.current;
    nextBurstIdRef.current += 1;
    if (transmission <= 0) {
      setEventLog((current) => [
        ...current,
        {
          time: `T+${formatTime(elapsedRef.current).slice(3)}`,
          utc: new Date(
            settingsRef.current.epochMs + elapsedRef.current * 1000,
          ).toISOString(),
          text: `Test GRB #${burstId} · RA ${raDeg.toFixed(2)}° · Dec ${decDeg.toFixed(2)}° · ${intensity.toFixed(0)}% · ${durationSeconds.toFixed(1)} s · ${pixelIndices.length} px footprint · outside current FOV`,
          kind: "grb",
        },
      ]);
      return;
    }
    activeBurstsRef.current = [
      ...activeBurstsRef.current,
      {
        id: burstId,
        pixelId: targetPixel,
        pixelIds: pixelIndices,
        transmission,
        intensity,
        raDeg,
        decDeg,
        ageTicks: 0,
        ticksRemaining: Math.max(1, Math.round(durationSeconds / 0.2)),
        origin,
      },
    ];
    setEventLog((current) => [
      ...current,
      {
        time: `T+${formatTime(elapsedRef.current).slice(3)}`,
        utc: new Date(
          settingsRef.current.epochMs + elapsedRef.current * 1000,
        ).toISOString(),
        text: `GRB #${burstId} · RA ${raDeg.toFixed(2)}° · Dec ${decDeg.toFixed(2)}° · ${intensity.toFixed(0)}% · ${durationSeconds.toFixed(1)} s · ${pixelIndices.length} px · ${(transmission * 100).toFixed(0)}% transmission · target physical pixel ID ${targetPixel}`,
        kind: "grb",
      },
    ]);
  }, [selectPixel]);

  const injectGRB = useCallback(() => {
    if (settingsRef.current.simulatorMode !== "simulation") return;
    const random = burstRandomRef.current;
    const configuration = pixelConfigurationRef.current;
    const configuredNormals = getConfiguredPixelNormals(configuration);
    const configuredSphereSlots = getConfiguredPixelSphereSlots(configuration);
    const halfFovCosine = Math.cos(
      THREE.MathUtils.degToRad(
        getMountEffectiveFov(
          settingsRef.current.mountX,
          settingsRef.current.mountZ,
        ) / 2,
      ),
    );
    const visibleTargets = configuration.pixels.filter((configuredPixel) => {
      const normal = configuredNormals[configuredPixel.pixelId];
      return (
        normal[1] >= halfFovCosine &&
        getMountSkyVisibility(
          configuredSphereSlots[configuredPixel.pixelId],
          settingsRef.current.mountX,
          settingsRef.current.mountZ,
        ) >= 0.12
      );
    });
    const targetPixel =
      visibleTargets[Math.floor(random() * visibleTargets.length)]?.pixelId ??
      0;
    const footprintCount = 4 + Math.floor(random() * 25);
    const intensity = 72 + random() * 28;
    const boresight = satelliteDirectionRef.current;
    const sourceDirection = new THREE.Vector3()
      .fromArray(configuredNormals[targetPixel])
      .applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3().fromArray(boresight),
        ),
      )
      .normalize();
    const coordinates = sceneDirectionToEquatorial(
      sourceDirection.toArray() as [number, number, number],
    );
    const angularResponse = Math.max(
      0,
      configuredNormals[targetPixel][1],
    ) ** 2;
    launchBurst({
      targetPixel,
      footprintCount,
      intensity,
      durationSeconds: BURST_DURATION_TICKS * 0.2,
      raDeg: coordinates.raDeg,
      decDeg: coordinates.decDeg,
      transmission:
        angularResponse *
        getMountSkyVisibility(
          configuredSphereSlots[targetPixel],
          settingsRef.current.mountX,
          settingsRef.current.mountZ,
        ),
    });
  }, [launchBurst]);

  const aimTestBurstAtBoresight = useCallback(() => {
    const boresight = satelliteDirectionRef.current;
    const coordinates = sceneDirectionToEquatorial(boresight);
    setTestBurstDraft((current) => ({
      ...current,
      raDeg: Number(coordinates.raDeg.toFixed(3)),
      decDeg: Number(coordinates.decDeg.toFixed(3)),
    }));
  }, []);

  const injectTestBurst = useCallback(() => {
    const raDeg = ((testBurstDraft.raDeg % 360) + 360) % 360;
    const decDeg = THREE.MathUtils.clamp(testBurstDraft.decDeg, -90, 90);
    const intensity = THREE.MathUtils.clamp(
      testBurstDraft.intensity,
      0,
      100,
    );
    const footprintCount = Math.round(
      THREE.MathUtils.clamp(testBurstDraft.spreadPixels, 1, 60),
    );
    const durationSeconds = THREE.MathUtils.clamp(
      testBurstDraft.durationSeconds,
      0.2,
      10,
    );
    const sourceDirection = equatorialToSceneDirection(raDeg, decDeg);
    const boresight = satelliteDirectionRef.current;
    const sourceVector = new THREE.Vector3().fromArray(sourceDirection);
    const localSource = sourceVector
      .clone()
      .applyQuaternion(
        new THREE.Quaternion()
          .setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3().fromArray(boresight),
          )
          .invert(),
      )
      .normalize();
    const configuredNormals = getConfiguredPixelNormals(
      pixelConfigurationRef.current,
    );
    let targetPixel = 0;
    let bestDot = -Infinity;
    configuredNormals.forEach((normal, index) => {
      const dot =
        normal[0] * localSource.x +
        normal[1] * localSource.y +
        normal[2] * localSource.z;
      if (dot > bestDot) {
        bestDot = dot;
        targetPixel = index;
      }
    });
    const separation = angleBetween(sourceDirection, boresight);
    const inField =
      separation <=
      getMountEffectiveFov(
        settingsRef.current.mountX,
        settingsRef.current.mountZ,
      ) /
        2;
    launchBurst({
      targetPixel,
      footprintCount,
      intensity,
      durationSeconds,
      raDeg,
      decDeg,
      transmission: inField
        ? Math.max(0, localSource.y) ** 2 *
          getMountSkyVisibility(
            getConfiguredPixelSphereSlots(pixelConfigurationRef.current)[targetPixel],
            settingsRef.current.mountX,
            settingsRef.current.mountZ,
          )
        : 0,
    });
  }, [launchBurst, testBurstDraft]);

  const setEphemerisUtc = useCallback((value: string) => {
    const ephemeris = ephemerisProfileRef.current;
    if (!ephemeris) return;
    const requestedTime = Date.parse(`${value}Z`);
    if (
      !Number.isFinite(requestedTime) ||
      requestedTime < ephemeris.startMs ||
      requestedTime > ephemeris.endMs
    ) {
      setEphemerisError("Requested UTC is outside the available ECI replay interval.");
      return;
    }
    setEphemerisError(null);
    setEpochMs(requestedTime - elapsedRef.current * 1000);
  }, []);

  const resetSimulation = useCallback((targetMode?: SimulatorMode) => {
    const pixelBackground = backgroundProfileRef.current;
    const ephemeris = ephemerisProfileRef.current;
    const mode = targetMode ?? settingsRef.current.simulatorMode;
    if (!ephemeris || (mode === "reference" && !pixelBackground)) return;
    phaseRef.current = 0;
    elapsedRef.current = 0;
    totalRef.current = 0;
    capturedRef.current = 0;
    activeBurstsRef.current = [];
    nextBurstIdRef.current = 1;
    photonBinRef.current = 0;
    photonRunIdRef.current = createPhotonRunId();
    settingsRef.current.epochMs = ephemeris.startMs;
    setEpochMs(ephemeris.startMs);
    setEphemerisError(null);
    selectPixel(43);
    const celestial = getCelestialGeometry(
      sampleEciEphemeris(ephemeris, ephemeris.startMs),
      orbitScenarioMode,
      orbitAltitudeKm,
      orbitInclinationDeg,
    );
    satelliteDirectionRef.current = celestial.satelliteDirection;
    const mountedEffectiveFov = getMountEffectiveFov(mountX, mountZ);
    const mountedSunNoise =
      celestial.sunSeparation <= mountedEffectiveFov / 2
        ? celestial.sunNoise *
          getMountedDirectionVisibility(
            celestial.sunDirection,
            celestial.satelliteDirection,
            mountX,
            mountZ,
          )
        : 0;
    const mountedMoonNoise =
      celestial.moonSeparation <= mountedEffectiveFov / 2
        ? celestial.moonNoise *
          getMountedDirectionVisibility(
            celestial.moonDirection,
            celestial.satelliteDirection,
            mountX,
            mountZ,
          )
        : 0;
    const mountedEarthAlbedoNoise =
      celestial.earthAlbedoNoise * getMountAlbedoTransmission(mountX, mountZ);
    const currentPixelConfiguration = pixelConfigurationRef.current;
    const detectorResponse = createDetectorExpectedResponse({
      mode,
      pixelBackground,
      configuration: currentPixelConfiguration,
      boresight: celestial.satelliteDirection,
      sunDirection: celestial.sunDirection,
      moonDirection: celestial.moonDirection,
      sunRateCountsPerSecond: mountedSunNoise,
      moonRateCountsPerSecond: mountedMoonNoise,
      earthRateCountsPerSecond: mountedEarthAlbedoNoise,
      earthIllumination: celestial.earthIllumination,
      earthAlbedoAzimuth: celestial.earthAlbedoAzimuth,
      earthAlbedoDirectional: celestial.earthAlbedoDirectional,
      mountX,
      mountZ,
      activeBursts: [],
      aggregateSourceCounts: 0,
    });
    const detectorHits = detectorResponse.detectorHits;
    const background = detectorResponse.aggregateBackgroundExpectedCounts;
    const effectiveSunRate =
      detectorResponse.componentExpectedCounts.sun.reduce(
        (sum, counts) => sum + counts,
        0,
      ) / PIXEL_BACKGROUND_BIN_SECONDS;
    const effectiveMoonRate =
      detectorResponse.componentExpectedCounts.moon.reduce(
        (sum, counts) => sum + counts,
        0,
      ) / PIXEL_BACKGROUND_BIN_SECONDS;
    const effectiveEarthRate =
      detectorResponse.componentExpectedCounts.earth.reduce(
        (sum, counts) => sum + counts,
        0,
      ) / PIXEL_BACKGROUND_BIN_SECONDS;
    setSamples(createBaselineSamples(background));
    setTelemetry({
      ...INITIAL_TELEMETRY,
      observed: background,
      background,
      detectorHits: [...detectorHits],
      detector: [...detectorResponse.detectorImpact],
      detectorBackgroundRates: [...detectorResponse.backgroundRates],
      detectorBackgroundExpectedCounts: [
        ...detectorResponse.backgroundExpectedCounts,
      ],
      simulatedDate: celestial.date.toISOString(),
      altitudeKm: celestial.altitudeKm,
      canonicalAltitudeKm: celestial.canonicalAltitudeKm,
      canonicalSatelliteDirection: celestial.canonicalSatelliteDirection,
      satelliteDirection: celestial.satelliteDirection,
      geocentricSunDirection: celestial.geocentricSunDirection,
      geocentricMoonDirection: celestial.geocentricMoonDirection,
      sunDirection: celestial.sunDirection,
      moonDirection: celestial.moonDirection,
      sunSeparation: celestial.sunSeparation,
      moonSeparation: celestial.moonSeparation,
      sunNoise: effectiveSunRate,
      sunExposure: effectiveSunRate / DIRECT_SUN_BACKGROUND_RATE,
      moonNoise: effectiveMoonRate,
      sunInFov: celestial.sunInFov,
      moonInFov: celestial.moonInFov,
      moonDistanceKm: celestial.moonDistanceKm,
      moonPhase: celestial.moonPhase,
      earthIllumination: celestial.earthIllumination,
      earthAlbedoNoise: effectiveEarthRate,
      earthAlbedoAzimuth: celestial.earthAlbedoAzimuth,
      earthAlbedoDirectional: celestial.earthAlbedoDirectional,
    });
    setEventLog((current) => [
      ...current,
      { time: "T+00:00", utc: new Date(ephemeris.startMs).toISOString(), text: "Simulation reset to ECI replay start", kind: "system" },
      { time: "T+00:00", utc: new Date(ephemeris.startMs).toISOString(), text: "Science acquisition started", kind: "background" },
    ]);
  }, [
    mountX,
    mountZ,
    orbitScenarioMode,
    orbitAltitudeKm,
    orbitInclinationDeg,
    selectPixel,
  ]);

  const startSimulationMode = useCallback(() => {
    resetSimulation("simulation");
    observationRandomRef.current = createSeededRandom(simulationSeed);
    burstRandomRef.current = createSeededRandom(simulationSeed ^ 0xa5a5_5a5a);
    nextAutomaticBurstBinRef.current = AUTOMATIC_GRB_INITIAL_DELAY_BINS;
    settingsRef.current.simulatorMode = "simulation";
    settingsRef.current.simulationSeed = simulationSeed;
    settingsRef.current.paused = false;
    setPaused(false);
    setSimulatorMode("simulation");
    setEventLog((current) => [
      ...current,
      {
        time: "T+00:00",
        utc: new Date(ECI_EPHEMERIS_START_MS).toISOString(),
        text: `Simulation Mode started · deterministic seed ${simulationSeed} · automatic synthetic GRBs enabled`,
        kind: "system",
      },
    ]);
  }, [resetSimulation, simulationSeed]);

  const stopSimulationMode = useCallback(() => {
    activeBurstsRef.current = activeBurstsRef.current.filter(
      (burst) => burst.origin !== "automatic",
    );
    resetSimulation("reference");
    settingsRef.current.simulatorMode = "reference";
    setSimulatorMode("reference");
    setEventLog((current) => [
      ...current,
      {
        time: `T+${formatTime(elapsedRef.current).slice(3)}`,
        utc: new Date(
          settingsRef.current.epochMs + elapsedRef.current * 1000,
        ).toISOString(),
        text: "Reference Mode restored · automatic synthetic GRBs disabled",
        kind: "system",
      },
    ]);
  }, [resetSimulation]);

  const effectiveMountFov = useMemo(() => {
    return getMountEffectiveFov(mountX, mountZ);
  }, [mountX, mountZ]);
  const mountedSunInFov =
    telemetry.sunSeparation <= effectiveMountFov / 2 && telemetry.sunNoise > 0.1;
  const mountedMoonInFov =
    telemetry.moonSeparation <= effectiveMountFov / 2 && telemetry.moonNoise > 0.1;
  const adaptiveAnalysisSamples = useMemo<readonly AdaptiveAnalysisSample[]>(
    () =>
      samples.map((sample) => ({
        frameIndex: sample.frameIndex,
        acquisitionTimeSeconds: sample.acquisitionTimeSeconds,
        simulationTimeSeconds: sample.simulationTimeSeconds,
        exposureSeconds: sample.exposureSeconds,
        expectedBackgroundCounts: sample.background,
        expectedSourceCounts: sample.source,
        observedCounts: sample.observed,
      })),
    [samples],
  );
  const changeTimeWarp = useCallback((direction: -1 | 1) => {
    setSpeed((current) => {
      if (direction < 0) {
        return [...TIME_WARP_PRESETS].reverse().find((preset) => preset < current) ??
          TIME_WARP_PRESETS[0];
      }
      return TIME_WARP_PRESETS.find((preset) => preset > current) ??
        TIME_WARP_PRESETS[TIME_WARP_PRESETS.length - 1];
    });
  }, []);
  const setPhysicalTimeWarp = useCallback((value: number) => {
    setSpeed(Math.round(THREE.MathUtils.clamp(value, MIN_TIME_WARP, MAX_TIME_WARP)));
  }, []);
  const selectedConfiguredPixel = getPixelByPhysicalId(
    pixelConfiguration,
    selectedPixel,
  )!;
  const selectedExpectedCounts = telemetry.detectorHits[selectedPixel] ?? 0;
  const selectedBackgroundCounts =
    telemetry.detectorBackgroundExpectedCounts[selectedPixel] ?? 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Aperture size={25} /></div>
          <div>
            <div className="eyebrow">GSSI · VISION DIGITAL TWIN</div>
            <h1>CRYSTAL <span>EYE</span></h1>
          </div>
        </div>
        <AppNav current="/" />
        <div className="mission-status">
          <button
            type="button"
            className={`simulation-mode-button ${simulatorMode}`}
            onClick={
              simulatorMode === "simulation"
                ? stopSimulationMode
                : startSimulationMode
            }
          >
            {simulatorMode === "simulation" ? "STOP SIMULATION" : "START SIMULATION"}
          </button>
          <button
            type="button"
            className="placement-settings-button"
            onClick={() => setConfigurationView("hub")}
          >
            <SlidersHorizontal size={14} />
            CONFIGURATION
          </button>
          <div className="header-metric">
            <small>MISSION ELAPSED</small>
            <strong>{formatTime(telemetry.elapsed)}</strong>
          </div>
          <div className="header-metric celestial-time">
            <label htmlFor="topbar-ephemeris-utc">SIMULATED DATE AND TIME · UTC</label>
            <input
              id="topbar-ephemeris-utc"
              type="datetime-local"
              step="1"
              min="2033-01-01T00:00:00"
              max="2033-03-01T23:50:39"
              value={new Date(telemetry.simulatedDate).toISOString().slice(0, 19)}
              disabled={!ephemerisProfile}
              aria-invalid={Boolean(ephemerisError)}
              onChange={(event) => setEphemerisUtc(event.target.value)}
            />
          </div>
          <div className="time-warp-controls" aria-label="Simulation playback controls">
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? "Resume simulation" : "Pause simulation"}
              aria-pressed={paused}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
            <button type="button" onClick={() => changeTimeWarp(-1)} aria-label="Slower time warp">−</button>
            <div className="time-warp-presets" aria-label="Time warp presets">
              {TIME_WARP_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className={speed === preset ? "active" : ""}
                  aria-pressed={speed === preset}
                  onClick={() => setPhysicalTimeWarp(preset)}
                >
                  {preset}×
                </button>
              ))}
            </div>
            <button type="button" onClick={() => changeTimeWarp(1)} aria-label="Faster time warp">+</button>
          </div>
        </div>
      </header>

      {configurationView === "hub" && (
        <ConfigurationHub
          onOpenOrbit={() => setConfigurationView("orbit")}
          onOpenPayload={() => setConfigurationView("payload")}
          onOpenPixels={() => setConfigurationView("pixels")}
          onClose={() => setConfigurationView(null)}
        />
      )}

      {configurationView === "orbit" && (
        <OrbitalConfigurationPanel
          scenarioMode={orbitScenarioMode}
          altitudeKm={orbitAltitudeKm}
          inclinationDeg={orbitInclinationDeg}
          speed={speed}
          canonicalAltitudeKm={telemetry.canonicalAltitudeKm}
          ephemerisProfile={ephemerisProfile}
          ephemerisError={ephemerisError}
          onScenarioModeChange={setOrbitScenarioMode}
          onAltitudeChange={(value) =>
            setOrbitAltitudeKm(
              Math.round(
                THREE.MathUtils.clamp(
                  value,
                  MIN_ORBIT_ALTITUDE_KM,
                  MAX_ORBIT_ALTITUDE_KM,
                ),
              ),
            )
          }
          onInclinationChange={(value) =>
            setOrbitInclinationDeg(
              Math.round(
                THREE.MathUtils.clamp(
                  value,
                  MIN_ORBIT_INCLINATION_DEG,
                  MAX_ORBIT_INCLINATION_DEG,
                ),
              ),
            )
          }
          onSpeedChange={setPhysicalTimeWarp}
          onReset={resetSimulation}
          onClose={() => setConfigurationView("hub")}
        />
      )}

      {configurationView === "payload" && (
        <PayloadPlacementPanel
          mountX={mountX}
          mountZ={mountZ}
          onMountChange={(x, z) => {
            setMountX(THREE.MathUtils.clamp(x, -1, 1));
            setMountZ(THREE.MathUtils.clamp(z, -1, 1));
          }}
          onClose={() => setConfigurationView("hub")}
        />
      )}

      {configurationView === "pixels" && (
        <PixelConfigurationEditor
          configuration={pixelConfiguration}
          onSave={savePixelConfiguration}
          onClose={() => setConfigurationView("hub")}
        />
      )}

      <section
        className={`workspace ${leftColumnVisible ? "" : "left-column-hidden"} ${
          rightColumnVisible ? "" : "right-column-hidden"
        } ${workspaceFocus ? `split-focus focus-${workspaceFocus}` : ""}`}
      >
        {workspaceFocus ? (
          <button
            type="button"
            className="split-restore-control"
            onClick={() => setWorkspaceFocus(null)}
            aria-label="Restore three-column dashboard"
            title="Restore dashboard"
          >
            RESTORE DASHBOARD
          </button>
        ) : (
          <>
            <button
              type="button"
              className="workspace-edge-toggle left-edge-toggle"
              aria-label={leftColumnVisible ? "Hide left dashboard column" : "Show left dashboard column"}
              title={leftColumnVisible ? "Hide left column" : "Show left column"}
              aria-pressed={leftColumnVisible}
              onClick={() => setLeftColumnVisible((visible) => !visible)}
            >
              {leftColumnVisible ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
            </button>
            <button
              type="button"
              className="workspace-edge-toggle right-edge-toggle"
              aria-label={rightColumnVisible ? "Hide right dashboard column" : "Show right dashboard column"}
              title={rightColumnVisible ? "Hide right column" : "Show right column"}
              aria-pressed={rightColumnVisible}
              onClick={() => setRightColumnVisible((visible) => !visible)}
            >
              {rightColumnVisible ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          </>
        )}

        <aside
          className="control-panel left-panel"
          aria-hidden={!leftColumnVisible || workspaceFocus !== null}
          inert={!leftColumnVisible || workspaceFocus !== null}
        >
          <div className="left-sensor-slot">
            <SensorView
              satelliteDirection={telemetry.satelliteDirection}
              sunDirection={telemetry.sunDirection}
              moonDirection={telemetry.moonDirection}
              geocentricSunDirection={telemetry.geocentricSunDirection}
              geocentricMoonDirection={telemetry.geocentricMoonDirection}
              sunInFov={mountedSunInFov}
              moonInFov={mountedMoonInFov}
              moonPhase={telemetry.moonPhase}
              detector={telemetry.detector}
              detectorHits={telemetry.detectorHits}
              pixelConfiguration={pixelConfiguration}
              selectedPixel={selectedPixel}
              burstDirections={telemetry.burstDirections}
              burstPixelGroups={telemetry.burstPixelGroups}
              earthIllumination={telemetry.earthIllumination}
              earthAlbedoNoise={telemetry.earthAlbedoNoise}
              earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
              earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
              mountX={mountX}
              mountZ={mountZ}
              effectiveFov={effectiveMountFov}
            />
          </div>

          <div className="celestial-card">
            <div className="chart-header">
              <div>
                <small>CELESTIAL INTERFERENCE</small>
                <strong>Sun, Moon, and Earth albedo</strong>
              </div>
              <span>FOV {effectiveMountFov.toFixed(0)}°</span>
            </div>
            <div className="celestial-rows">
              <div className={mountedSunInFov ? "in-fov sun" : ""}>
                <Sun size={16} />
                <span>
                  <small>SUN · DIRECT PHOTONS</small>
                  <strong>{telemetry.sunSeparation.toFixed(1)}° · {(telemetry.sunExposure * 100).toFixed(0)}% exposure</strong>
                </span>
                <em>{mountedSunInFov ? `+${telemetry.sunNoise.toFixed(0)} c/s` : "OUT"}</em>
              </div>
              <div className={mountedMoonInFov ? "in-fov moon" : ""}>
                <Moon size={16} />
                <span><small>MOON · {(telemetry.moonPhase * 100).toFixed(0)}% illum.</small><strong>{telemetry.moonSeparation.toFixed(1)}° · {(telemetry.moonDistanceKm / 1000).toFixed(0)}k km</strong></span>
                <em>{mountedMoonInFov ? `+${telemetry.moonNoise.toFixed(0)} c/s` : "OUT"}</em>
              </div>
              <div className={telemetry.earthAlbedoNoise > 1 ? "in-fov earth" : ""}>
                <CircleDot size={16} />
                <span>
                  <small>EARTH · {(telemetry.earthIllumination * 100).toFixed(0)}% illuminated</small>
                  <strong>albedo on peripheral pixels</strong>
                </span>
                <em>+{telemetry.earthAlbedoNoise.toFixed(0)} c/s</em>
              </div>
            </div>
            <p>
              {simulatorMode === "simulation"
                ? "Environment-only synthetic counts: Sun, Moon, and Earth terms; Rito reference excluded. All amplitudes are PROVISIONAL."
                : "Rito pixel reference plus separate additive Sun, Moon, and Earth terms; calibration limits are recorded in provenance."}
            </p>
          </div>
        </aside>

        <section className="simulation-stage">
          <GlobeScene
            altitude={telemetry.altitudeKm}
            scenarioMode={orbitScenarioMode}
            simulatorMode={simulatorMode}
            paused={paused}
            simulatedTimestampMs={Date.parse(telemetry.simulatedDate)}
            grbActive={telemetry.grbActive}
            burstDirections={telemetry.burstDirections}
            burstPixelGroups={telemetry.burstPixelGroups}
            pixelConfiguration={pixelConfiguration}
            selectedPixel={selectedPixel}
            satelliteDirection={telemetry.satelliteDirection}
            geocentricSunDirection={telemetry.geocentricSunDirection}
            geocentricMoonDirection={telemetry.geocentricMoonDirection}
            sunNoise={telemetry.sunNoise}
            moonNoise={telemetry.moonNoise}
            earthIllumination={telemetry.earthIllumination}
            earthAlbedoNoise={telemetry.earthAlbedoNoise}
            earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
            earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
            detectorIntensity={telemetry.detector}
            detectorHits={telemetry.detectorHits}
            mountX={mountX}
            mountZ={mountZ}
            cameraMode={cameraMode}
            onCameraModeChange={setCameraMode}
            systemZoom={systemZoom}
            onSystemZoomChange={setSystemZoom}
          />
          <div className="stage-title">
            <span className="eyebrow">
              {simulatorMode === "simulation"
                ? "SIMULATION MODE · ENVIRONMENT-ONLY SEEDED SYNTHETIC OBSERVATIONS"
                : "REFERENCE MODE · RITO BACKGROUND REFERENCE"}
            </span>
            <h2>
              {simulatorMode === "simulation" ? "Simulation Mode" : "Reference Replay"}
              <em>
                {orbitScenarioMode === "canonical"
                  ? ` CANONICAL ECI · ${telemetry.altitudeKm.toFixed(1)} km`
                  : ` LEO OVERRIDE · ${orbitAltitudeKm.toFixed(0)} km · ${orbitInclinationDeg.toFixed(0)}°`}
              </em>
            </h2>
          </div>
          <div className={`grb-alert ${telemetry.grbActive ? "visible" : ""}`}>
            <Zap size={18} />
            <div><small>SYNTHETIC SOURCE ACTIVE</small><strong>Injected GRB model · source / √background {telemetry.significance.toFixed(2)} (not a detection significance)</strong></div>
          </div>
          <div className="orbit-readout">
            <span>ECI TIMELINE {((telemetry.phase / (Math.PI * 2)) * 100).toFixed(1)}%</span>
            <div><i style={{ width: `${(telemetry.phase / (Math.PI * 2)) * 100}%` }} /></div>
          </div>
        </section>

        <aside
          className="control-panel right-panel"
          aria-hidden={workspaceFocus ? false : !rightColumnVisible}
          inert={!workspaceFocus && !rightColumnVisible}
        >
          <a
            className="panel-heading history-launch"
            href={`${PUBLIC_BASE_PATH}/photon-history/`}
            aria-label="Open photon stream history table"
          >
            <span>PHOTON STREAM</span>
            <span className="history-launch-icon">
              <small>{photonRecordCount.toLocaleString("en-US")} ROWS</small>
              <Activity size={17} />
              <ChevronRight size={13} />
            </span>
          </a>

          <AdaptiveBackgroundPanel
            samples={adaptiveAnalysisSamples}
            mode={simulatorMode}
            seed={simulationSeed}
            onSeedChange={setSimulationSeed}
            onExpand={() => setWorkspaceFocus("analysis")}
          />

          <div
            className={`persistence-status ${persistenceStatus}`}
            role={persistenceStatus === "not-persisting" ? "alert" : "status"}
          >
            <small>PHOTON ARCHIVE · INDEXEDDB</small>
            <strong>
              {persistenceStatus === "persisting"
                ? "PERSISTING"
                : persistenceStatus === "initializing"
                  ? "INITIALIZING…"
                  : `NOT PERSISTING · ${persistenceError ?? "storage unavailable"}`}
            </strong>
          </div>

          <div
            className={`background-model-status ${
              backgroundProfileError ? "error" : backgroundProfile ? "ready" : "loading"
            }`}
            role={backgroundProfileError ? "alert" : "status"}
          >
            <small>RITO BACKGROUND REFERENCE</small>
            <strong>
              {backgroundProfileError
                ? `UNAVAILABLE · ${backgroundProfileError}`
                : backgroundProfile
                  ? `${backgroundProfile.totalRateCountsPerSecond.toFixed(4)} c/s · 126 pixels · deterministic`
                  : "VALIDATING pixbkg.txt…"}
            </strong>
          </div>

          <div className="detector-section">
            <div className="detector-section-header">
              <div>
                <small>DETECTOR RESPONSE</small>
                <strong>Configured planar pixel map · actual expected response / 0.2 s</strong>
              </div>
              <button
                type="button"
                className="detector-expand-button"
                onClick={() => setWorkspaceFocus("detector")}
                aria-label="Open detector split focus"
                title="Open detector alongside the 3D viewer"
              >
                <Maximize2 size={13} />
              </button>
            </div>
            <div className="detector-response-summary" aria-live="polite">
              <span><small>SELECTED PIXEL</small><strong>PIXEL ID {selectedConfiguredPixel.pixelId}</strong></span>
              <span><small>TOTAL RESPONSE</small><strong>{selectedExpectedCounts.toFixed(4)}</strong></span>
              <span><small>BACKGROUND</small><strong>{selectedBackgroundCounts.toFixed(4)}</strong></span>
            </div>
            <DetectorMap
              values={telemetry.detector}
              hits={telemetry.detectorHits}
              backgroundRates={telemetry.detectorBackgroundRates}
              backgroundExpectedCounts={
                telemetry.detectorBackgroundExpectedCounts
              }
              grbActive={telemetry.grbActive}
              burstPixelGroups={telemetry.burstPixelGroups}
              pixelConfiguration={pixelConfiguration}
              selectedPixelId={selectedPixel}
              earthIllumination={telemetry.earthIllumination}
              earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
              earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
              mountX={mountX}
              mountZ={mountZ}
              onSelect={selectPixel}
            />
          </div>

          <form
            className="burst-inline-panel"
            onSubmit={(event) => {
              event.preventDefault();
              injectTestBurst();
            }}
          >
            <div className="burst-inline-header">
              <div>
                <small>TEST BURST CONFIGURATION</small>
                <strong>Equatorial source · current epoch</strong>
              </div>
              <button type="button" onClick={aimTestBurstAtBoresight}>
                AIM BORESIGHT
              </button>
            </div>

            <div className="burst-inline-fields burst-coordinate-fields">
              <label>
                <span>RIGHT ASCENSION · RA</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    max="360"
                    step="0.001"
                    value={testBurstDraft.raDeg}
                    onChange={(event) =>
                      setTestBurstDraft((current) => ({
                        ...current,
                        raDeg: Number(event.target.value),
                      }))
                    }
                  />
                  <em>deg</em>
                </div>
              </label>
              <label>
                <span>DECLINATION · DEC</span>
                <div>
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="0.001"
                    value={testBurstDraft.decDeg}
                    onChange={(event) =>
                      setTestBurstDraft((current) => ({
                        ...current,
                        decDeg: Number(event.target.value),
                      }))
                    }
                  />
                  <em>deg</em>
                </div>
              </label>
            </div>

            <div className="burst-inline-fields burst-response-fields">
              <label>
                <span>PEAK IMPACT</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={testBurstDraft.intensity}
                    onChange={(event) =>
                      setTestBurstDraft((current) => ({
                        ...current,
                        intensity: Number(event.target.value),
                      }))
                    }
                  />
                  <em>%</em>
                </div>
              </label>
              <label>
                <span>FOOTPRINT</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    step="1"
                    value={testBurstDraft.spreadPixels}
                    onChange={(event) =>
                      setTestBurstDraft((current) => ({
                        ...current,
                        spreadPixels: Number(event.target.value),
                      }))
                    }
                  />
                  <em>px</em>
                </div>
              </label>
              <label>
                <span>DURATION</span>
                <div>
                  <input
                    type="number"
                    min="0.2"
                    max="10"
                    step="0.2"
                    value={testBurstDraft.durationSeconds}
                    onChange={(event) =>
                      setTestBurstDraft((current) => ({
                        ...current,
                        durationSeconds: Number(event.target.value),
                      }))
                    }
                  />
                  <em>s</em>
                </div>
              </label>
            </div>

            <div className="burst-inline-scale">
              <span>0</span>
              <i />
              <span>100</span>
            </div>

            <div className="burst-inline-actions">
              <button
                type="button"
                className="random-grb-mini"
                onClick={injectGRB}
                disabled={simulatorMode !== "simulation"}
                title={
                  simulatorMode === "simulation"
                    ? "Add a seeded random GRB"
                    : "Random GRBs are available only in Simulation Mode"
                }
              >
                <Sparkles size={12} /> RANDOM GRB
              </button>
              <button type="submit" className="inject-test-inline">
                <Sparkles size={13} /> INJECT TEST BURST
              </button>
            </div>
          </form>
        </aside>
      </section>

      {historyView && (
        <HistoryDialog
          events={eventLog}
          onClose={() => setHistoryView(null)}
        />
      )}

      <footer className="bottom-panel">
        <button
          type="button"
          className="footer-label history-launch"
          onClick={() => setHistoryView("events")}
          aria-label="Open complete event history table"
        >
          <CircleDot size={15} />
          <span>EVENT LOG</span>
          <ChevronRight size={12} className="footer-open-icon" />
        </button>
        <button
          type="button"
          className="event-stream event-stream-button"
          onClick={() => setHistoryView("events")}
          aria-label="Open complete event history table"
        >
          {eventLog.slice(-5).map((event, index) => (
            <div key={`${event.time}-${index}`} className={`event-item ${event.kind}`}>
              <time>{event.time}</time>
              <i />
              <span>{event.text}</span>
            </div>
          ))}
        </button>
        <div className="data-model">
          <span>DATA MODEL</span>
          <strong>time × pixel × energy</strong>
        </div>
      </footer>
    </main>
  );
}
