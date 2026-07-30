"use client";

import {
  Activity,
  Aperture,
  ChevronRight,
  CircleDot,
  Download,
  Maximize2,
  Move,
  Orbit,
  Pause,
  Play,
  Radio,
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
import { Body, GeoVector, Illumination } from "astronomy-engine";

type Sample = {
  observed: number;
  background: number;
  source: number;
};

type PhotonRecord = Sample & {
  bin: number;
  elapsed: number;
  simulatedDate: string;
  sun: number;
  moon: number;
  earthAlbedo: number;
  activeBursts: number;
  hitPixels: number;
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
  latitude: number;
  longitude: number;
  total: number;
  captured: number;
  significance: number;
  grbActive: boolean;
  burstDirections: number[];
  burstPixelGroups: number[][];
  detector: number[];
  detectorHits: number[];
  simulatedDate: string;
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
  id: string;
  index: number;
  ring: number;
  slot: number;
  count: number;
  angle: number;
  radius: number;
};

type UnfoldedPixelLayout = {
  index: number;
  x: number;
  y: number;
  isSeam: boolean;
  isPentagon: boolean;
  rotationDeg: number;
};

type PixelConfigurationEntry = UnfoldedPixelLayout & {
  id: string;
  secondaryId: string;
};

type PixelConfiguration = {
  version: 1;
  pixels: PixelConfigurationEntry[];
};

type BurstEvent = {
  id: number;
  pixelIndex: number;
  pixelIndices: number[];
  transmission: number;
  intensity: number;
  raDeg: number;
  decDeg: number;
  ageTicks: number;
  ticksRemaining: number;
};

type TestBurstDraft = {
  raDeg: number;
  decDeg: number;
  intensity: number;
  spreadPixels: number;
  durationSeconds: number;
};

type CameraMode = "orbit" | "satellite";

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const PIXEL_CONFIGURATION_STORAGE_KEY = "crystal-eye.pixel-configuration.v1";
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
      id: `PX-${String(index + 1).padStart(3, "0")}`,
      index,
      ring,
      slot,
      count,
      angle: count === 1 ? 0 : (slot / count) * Math.PI * 2 + offset,
      radius: ring / (PIXEL_RING_COUNTS.length - 1),
    };
  }),
);
const UNFOLDED_PIXEL_LAYOUT: UnfoldedPixelLayout[] = (() => {
  const layout: UnfoldedPixelLayout[] = [];
  const clusterPattern: [number, number][] = [];
  [2, 3, 4, 4, 3].forEach((count, row) => {
    for (let column = 0; column < count; column += 1) {
      clusterPattern.push([
        (column - (count - 1) / 2) * 6.15,
        (row - 2) * 5.35,
      ]);
    }
  });

  const clusterCenters = [
    { x: 51, y: 50.5 },
    { x: 30, y: 20.5 },
    { x: 71.5, y: 20.5 },
    { x: 82, y: 53.5 },
    { x: 54, y: 79.5 },
    { x: 21.5, y: 53.5 },
  ];

  clusterCenters.forEach((center, clusterIndex) => {
    clusterPattern.forEach(([localX, localY], position) => {
      layout.push({
        index: clusterIndex * 16 + position,
        x: center.x + localX,
        y: center.y + localY,
        isSeam: false,
        isPentagon: position === 7,
        rotationDeg: 0,
      });
    });
  });

  const tripletPattern = [
    [-3.1, -2.75],
    [-3.1, 2.75],
    [3.05, 0],
  ] as const;
  const triplets = [
    { x: 51, y: 7.5, rotation: Math.PI / 2 },
    { x: 51, y: 31.5, rotation: -Math.PI / 2 },
    { x: 9.5, y: 35.5, rotation: -Math.PI / 2 },
    { x: 32.5, y: 42, rotation: Math.PI / 2 },
    { x: 70, y: 42, rotation: Math.PI / 2 },
    { x: 92, y: 35.5, rotation: -Math.PI / 2 },
    { x: 38, y: 62.5, rotation: -Math.PI / 2 },
    { x: 65, y: 62.5, rotation: -Math.PI / 2 },
    { x: 29, y: 81, rotation: Math.PI / 2 },
    { x: 77, y: 81, rotation: Math.PI / 2 },
  ];

  triplets.forEach((triplet, tripletIndex) => {
    tripletPattern.forEach(([localX, localY], position) => {
      const rotatedX =
        localX * Math.cos(triplet.rotation) -
        localY * Math.sin(triplet.rotation);
      const rotatedY =
        localX * Math.sin(triplet.rotation) +
        localY * Math.cos(triplet.rotation);
      layout.push({
        index: 96 + tripletIndex * 3 + position,
        x: triplet.x + rotatedX,
        y: triplet.y + rotatedY,
        isSeam: true,
        isPentagon: false,
        rotationDeg: 0,
      });
    });
  });

  return layout.sort((a, b) => a.index - b.index);
})();
const DEFAULT_PIXEL_CONFIGURATION: PixelConfiguration = {
  version: 1,
  pixels: UNFOLDED_PIXEL_LAYOUT.map((pixel) => ({
    ...pixel,
    id: PIXEL_LAYOUT[pixel.index].id,
    secondaryId: "",
  })),
};

function getPixelIdNumber(id: string, fallbackIndex: number) {
  const normalized = id.trim();
  const prefixedNumber = normalized.match(/^PX[-_\s]*(\d+)$/i);
  if (prefixedNumber) return prefixedNumber[1].padStart(3, "0");
  return normalized || String(fallbackIndex + 1).padStart(3, "0");
}

function getPentagonPixelIndices(configuration: PixelConfiguration) {
  return new Set(
    configuration.pixels
      .filter((pixel) => pixel.isPentagon)
      .map((pixel) => pixel.index),
  );
}

function normalizePixelConfiguration(value: unknown): PixelConfiguration | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { version?: unknown; pixels?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.pixels)) return null;
  if (candidate.pixels.length !== PIXEL_LAYOUT.length) return null;

  const normalized = candidate.pixels
    .map((entry, fallbackIndex) => {
      if (!entry || typeof entry !== "object") return null;
      const pixel = entry as {
        index?: unknown;
        id?: unknown;
        secondaryId?: unknown;
        x?: unknown;
        y?: unknown;
        isPentagon?: unknown;
        rotationDeg?: unknown;
      };
      const index =
        typeof pixel.index === "number" && Number.isInteger(pixel.index)
          ? pixel.index
          : fallbackIndex;
      if (
        index < 0 ||
        index >= PIXEL_LAYOUT.length ||
        typeof pixel.x !== "number" ||
        !Number.isFinite(pixel.x) ||
        typeof pixel.y !== "number" ||
        !Number.isFinite(pixel.y)
      ) {
        return null;
      }
      const id =
        typeof pixel.id === "string" && pixel.id.trim()
          ? pixel.id.trim().slice(0, 24)
          : PIXEL_LAYOUT[index].id;
      const secondaryId =
        typeof pixel.secondaryId === "string"
          ? pixel.secondaryId.trim().slice(0, 12)
          : "";
      return {
        index,
        id,
        secondaryId,
        x: THREE.MathUtils.clamp(pixel.x, 0.8, 99.2),
        y: THREE.MathUtils.clamp(pixel.y, 0.8, 99.2),
        isSeam: DEFAULT_PIXEL_CONFIGURATION?.pixels?.[index]?.isSeam ??
          UNFOLDED_PIXEL_LAYOUT[index].isSeam,
        isPentagon:
          index < GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE &&
          pixel.isPentagon === true,
        rotationDeg:
          typeof pixel.rotationDeg === "number" &&
          Number.isFinite(pixel.rotationDeg)
            ? ((pixel.rotationDeg % 360) + 360) % 360
            : 0,
      };
    })
    .filter((pixel): pixel is PixelConfigurationEntry => pixel !== null)
    .sort((a, b) => a.index - b.index);

  if (
    normalized.length !== PIXEL_LAYOUT.length ||
    normalized.some((pixel, index) => pixel.index !== index)
  ) {
    return null;
  }
  const pixels = normalized.map((pixel) => ({ ...pixel }));
  for (let cluster = 0; cluster < GRAY_CLUSTER_COUNT; cluster += 1) {
    const members = pixels.slice(
      cluster * GRAY_CLUSTER_SIZE,
      (cluster + 1) * GRAY_CLUSTER_SIZE,
    );
    const explicitlyAssigned = members.filter((pixel) => pixel.isPentagon);
    let pentagonIndex = explicitlyAssigned[0]?.index;
    if (pentagonIndex === undefined) {
      const center = members.reduce(
        (sum, pixel) => ({ x: sum.x + pixel.x, y: sum.y + pixel.y }),
        { x: 0, y: 0 },
      );
      center.x /= members.length;
      center.y /= members.length;
      pentagonIndex = members.reduce((best, pixel) =>
        Math.hypot(pixel.x - center.x, pixel.y - center.y) <
        Math.hypot(best.x - center.x, best.y - center.y)
          ? pixel
          : best,
      ).index;
    }
    members.forEach((pixel) => {
      pixel.isPentagon = pixel.index === pentagonIndex;
    });
  }
  pixels.slice(GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE).forEach((pixel) => {
    pixel.isPentagon = false;
  });
  return { version: 1, pixels };
}
const PIXEL_NORMALS: [number, number, number][] = PIXEL_LAYOUT.map((pixel) => {
  const polar = THREE.MathUtils.lerp(0.04, Math.PI / 2 - 0.045, pixel.radius);
  return normalizeVector(
    Math.sin(polar) * Math.cos(pixel.angle),
    Math.cos(polar),
    Math.sin(polar) * Math.sin(pixel.angle),
  );
});

function getConfiguredPixelNormals(
  configuration: PixelConfiguration,
): [number, number, number][] {
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

  return Array.from(
    physicalSlotByPixel,
    (physicalSlot) => PIXEL_NORMALS[physicalSlot],
  );
}

function getConfiguredPixelDistance(
  configuration: PixelConfiguration,
  pixelIndex: number,
  sourcePixelIndex: number,
) {
  const pixel = configuration.pixels[pixelIndex];
  const source = configuration.pixels[sourcePixelIndex];
  return Math.hypot(pixel.x - source.x, pixel.y - source.y);
}

function getConfiguredBurstIncidence(
  configuration: PixelConfiguration,
  pixelIndex: number,
  sourcePixelIndex: number,
) {
  const distance = getConfiguredPixelDistance(
    configuration,
    pixelIndex,
    sourcePixelIndex,
  );
  return 1 / (1 + (distance / 8.5) ** 2);
}

function getBurstFootprint(
  configuration: PixelConfiguration,
  sourcePixelIndex: number,
  pixelCount: number,
) {
  return configuration.pixels
    .map((pixel) => ({
      index: pixel.index,
      distance: getConfiguredPixelDistance(
        configuration,
        pixel.index,
        sourcePixelIndex,
      ),
    }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, THREE.MathUtils.clamp(pixelCount, 1, PIXEL_LAYOUT.length))
    .map(({ index }) => index);
}

function getMountEdgeExposure(
  pixelIndex: number,
  mountX: number,
  mountZ: number,
) {
  const pixel = PIXEL_LAYOUT[pixelIndex];
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
  pixelIndex: number,
  mountX: number,
  mountZ: number,
) {
  const horizonWeight = PIXEL_LAYOUT[pixelIndex].radius ** 3.4;
  return THREE.MathUtils.lerp(
    1,
    getMountEdgeExposure(pixelIndex, mountX, mountZ),
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
  pixelIndex: number,
  illumination: number,
  azimuth: number,
  directional: number,
  mountX = 0,
  mountZ = 0,
) {
  const pixel = PIXEL_LAYOUT[pixelIndex];
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
    getMountEdgeExposure(pixelIndex, mountX, mountZ)
  );
}

function deterministicUnit(index: number, salt: number) {
  return Math.abs(Math.sin(index * 91.713 + salt * 47.117) * 43758.5453) % 1;
}

function isPixelLitByEarthAlbedo(
  pixelIndex: number,
  illumination: number,
  azimuth: number,
  directional: number,
  mountX = 0,
  mountZ = 0,
) {
  return getEarthAlbedoResponse(
    pixelIndex,
    illumination,
    azimuth,
    directional,
    mountX,
    mountZ,
  ) >= 0.12;
}

const DEFAULT_SIMULATION_EPOCH_MS = Date.UTC(2026, 6, 24, 12, 0, 0);
const BURST_DURATION_TICKS = 15;
const BASE_BACKGROUND_RATE = 360;
const DIRECT_SUN_BACKGROUND_RATE = 260;
const AU_KM = 149_597_870.7;
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
  elapsedSeconds: number,
  phase: number,
  inclination: number,
  altitude: number,
  epochMs = DEFAULT_SIMULATION_EPOCH_MS,
) {
  const date = new Date(epochMs + elapsedSeconds * 1000);
  const sun = GeoVector(Body.Sun, date, true);
  const moon = GeoVector(Body.Moon, date, true);
  const moonIllumination = Illumination(Body.Moon, date);
  const inclinationRad = THREE.MathUtils.degToRad(inclination);
  const satelliteDirection = normalizeVector(
    Math.cos(phase) * Math.cos(inclinationRad),
    Math.cos(phase) * Math.sin(inclinationRad),
    Math.sin(phase),
  );
  const observerDistanceAu = (6371 + altitude) / AU_KM;
  const mapFromEquatorial = (x: number, y: number, z: number) => [x, z, y] as const;
  const mappedSun = mapFromEquatorial(sun.x, sun.y, sun.z);
  const mappedMoon = mapFromEquatorial(moon.x, moon.y, moon.z);
  const sunDirection = normalizeVector(
    mappedSun[0] - satelliteDirection[0] * observerDistanceAu,
    mappedSun[1] - satelliteDirection[1] * observerDistanceAu,
    mappedSun[2] - satelliteDirection[2] * observerDistanceAu,
  );
  const moonDirection = normalizeVector(
    mappedMoon[0] - satelliteDirection[0] * observerDistanceAu,
    mappedMoon[1] - satelliteDirection[1] * observerDistanceAu,
    mappedMoon[2] - satelliteDirection[2] * observerDistanceAu,
  );
  const sunSeparation = angleBetween(satelliteDirection, sunDirection);
  const moonSeparation = angleBetween(satelliteDirection, moonDirection);
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
  const earthAngularScale = (6371 / (6371 + altitude)) ** 2;
  const earthAlbedoNoise =
    85 * earthAngularScale * earthIllumination ** 1.35;

  return {
    date,
    satelliteDirection,
    sunDirection,
    moonDirection,
    sunSeparation,
    moonSeparation,
    sunInFov,
    moonInFov,
    sunNoise,
    moonNoise,
    moonDistanceKm: Math.hypot(moon.x, moon.y, moon.z) * AU_KM,
    moonPhase: moonIllumination.phase_fraction,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
  };
}

const INITIAL_CELESTIAL = getCelestialGeometry(0, 0.72, 20, 550);
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
const INITIAL_DETECTOR_HITS = PIXEL_LAYOUT.map((pixel) => {
  const response = getEarthAlbedoResponse(
    pixel.index,
    INITIAL_CELESTIAL.earthIllumination,
    INITIAL_CELESTIAL.earthAlbedoAzimuth,
    INITIAL_CELESTIAL.earthAlbedoDirectional,
  );
  return response >= 0.12
    ? Math.max(1, Math.round((response * INITIAL_CELESTIAL.earthAlbedoNoise) / 18))
    : 0;
});

const INITIAL_TELEMETRY: Telemetry = {
  observed: Math.round(
    BASE_BACKGROUND_RATE +
      INITIAL_MOUNT_SUN_NOISE +
      INITIAL_MOUNT_MOON_NOISE +
      INITIAL_MOUNT_ALBEDO_NOISE,
  ),
  background: Math.round(
    BASE_BACKGROUND_RATE +
      INITIAL_MOUNT_SUN_NOISE +
      INITIAL_MOUNT_MOON_NOISE +
      INITIAL_MOUNT_ALBEDO_NOISE,
  ),
  source: 0,
  elapsed: 0,
  phase: 0.72,
  latitude: 13.2,
  longitude: 41.3,
  total: 0,
  captured: 0,
  significance: 0,
  grbActive: false,
  burstDirections: [],
  burstPixelGroups: [],
  detector: INITIAL_DETECTOR_HITS.map((hits) => (hits > 0 ? 0.55 : 0)),
  detectorHits: INITIAL_DETECTOR_HITS,
  simulatedDate: INITIAL_CELESTIAL.date.toISOString(),
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
  inclination,
  speed,
  paused,
  phase,
  grbActive,
  burstDirections,
  burstPixelGroups,
  pixelConfiguration,
  selectedPixel,
  sunDirection,
  moonDirection,
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
  inclination: number;
  speed: number;
  paused: boolean;
  phase: number;
  grbActive: boolean;
  burstDirections: number[];
  burstPixelGroups: number[][];
  pixelConfiguration: PixelConfiguration;
  selectedPixel: number;
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
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
    inclination,
    speed,
    paused,
    phase,
    grbActive,
    burstDirections,
    burstPixelGroups,
    pixelConfiguration,
    selectedPixel,
    sunDirection,
    moonDirection,
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
    phaseUpdatedAt: 0,
  });

  useEffect(() => {
    settingsRef.current = {
      altitude,
      inclination,
      speed,
      paused,
      phase,
      grbActive,
      burstDirections,
      burstPixelGroups,
      pixelConfiguration,
      selectedPixel,
      sunDirection,
      moonDirection,
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
      phaseUpdatedAt: performance.now(),
    };
  }, [
    altitude,
    inclination,
    speed,
    paused,
    phase,
    grbActive,
    burstDirections,
    burstPixelGroups,
    pixelConfiguration,
    selectedPixel,
    sunDirection,
    moonDirection,
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
    earthSystem.rotation.z = THREE.MathUtils.degToRad(23.4);
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
    const orbitPoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 256; index += 1) {
      const angle = (index / 256) * Math.PI * 2;
      orbitPoints.push(new THREE.Vector3(Math.cos(angle) * 3.1, 0, Math.sin(angle) * 3.1));
    }
    const orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(orbitPoints),
      new THREE.LineBasicMaterial({
        color: 0x51c6e9,
        transparent: true,
        opacity: 0.42,
      }),
    );
    orbitGroup.add(orbitLine);

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
    let pentagonPixelIndices = getPentagonPixelIndices(
      settingsRef.current.pixelConfiguration,
    );
    let appliedPixelConfiguration = settingsRef.current.pixelConfiguration;
    const crystalPixels = PIXEL_LAYOUT.map((pixel) => {
      const normal = new THREE.Vector3().fromArray(
        configuredPixelNormals[pixel.index],
      );
      const crystal = new THREE.Mesh(
        pentagonPixelIndices.has(pixel.index)
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
              settingsRef.current.pixelConfiguration.pixels[pixel.index]
                .rotationDeg,
            ),
          ),
        );
      crystal.userData.pixelIndex = pixel.index;
      crystal.userData.pixelId =
        settingsRef.current.pixelConfiguration.pixels[pixel.index].id;
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
    let renderedPhase = settingsRef.current.phase;
    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      const settings = settingsRef.current;
      if (appliedPixelConfiguration !== settings.pixelConfiguration) {
        configuredPixelNormals = getConfiguredPixelNormals(
          settings.pixelConfiguration,
        );
        pentagonPixelIndices = getPentagonPixelIndices(
          settings.pixelConfiguration,
        );
        crystalPixels.forEach((crystal, index) => {
          const normal = new THREE.Vector3().fromArray(
            configuredPixelNormals[index],
          );
          crystal.position.copy(normal).multiplyScalar(0.173);
          crystal.quaternion
            .setFromUnitVectors(upAxis, normal)
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(
                upAxis,
                THREE.MathUtils.degToRad(
                  settings.pixelConfiguration.pixels[index].rotationDeg,
                ),
              ),
            );
          crystal.userData.pixelId =
            settings.pixelConfiguration.pixels[index].id;
          crystal.geometry = pentagonPixelIndices.has(index)
            ? pentagonPixelGeometry
            : hexPixelGeometry;
        });
        appliedPixelConfiguration = settings.pixelConfiguration;
      }
      const orbitRadius = 3.1 + (settings.altitude - 550) / 1500;
      const extrapolation =
        !settings.paused && settings.phaseUpdatedAt > 0
          ? ((performance.now() - settings.phaseUpdatedAt) / 1000) *
            (settings.speed / 910)
          : 0;
      const predictedPhase = settings.phase + extrapolation;
      const phaseError = Math.atan2(
        Math.sin(predictedPhase - renderedPhase),
        Math.cos(predictedPhase - renderedPhase),
      );
      renderedPhase += phaseError * (1 - Math.exp(-delta * 18));
      const angle = renderedPhase;
      orbitGroup.rotation.z = THREE.MathUtils.degToRad(settings.inclination);
      orbitLine.scale.setScalar(orbitRadius / 3.1);
      satelliteGroup.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius);
      payloadMountGroup.position.set(settings.mountX * 0.15, 0, settings.mountZ * 0.15);
      outwardLocal.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
      satelliteGroup.quaternion.setFromUnitVectors(upAxis, outwardLocal);
      satelliteGroup.getWorldPosition(satWorld);
      satelliteGroup.getWorldQuaternion(satelliteWorldQuaternion);
      sunSceneDirection.fromArray(settings.sunDirection).normalize();
      moonSceneDirection.fromArray(settings.moonDirection).normalize();
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

      if (!settings.paused) {
        earthSystem.rotation.y += delta * 0.025;
        clouds.rotation.y += delta * 0.004;
        stars.rotation.y -= delta * 0.002;
      }

      pulse.visible = settings.grbActive;
      const pulseScale = 1 + Math.sin(clock.elapsedTime * 9) * 0.22;
      pulse.scale.setScalar(pulseScale);
      (pulse.material as THREE.MeshBasicMaterial).opacity = settings.grbActive
        ? 0.55 + Math.sin(clock.elapsedTime * 8) * 0.25
        : 0;

      crystalPixels.forEach((crystal, index) => {
        const material = pixelMaterials[index];
        const isSelected = index === settings.selectedPixel;
        const impact = settings.detectorIntensity[index] ?? 0;
        const hitCount = settings.detectorHits[index] ?? 0;
        const isFired = hitCount > 0;
        const isBurstPath =
          settings.burstPixelGroups.some((group) => group.includes(index));
        const albedoResponse = getEarthAlbedoResponse(
          index,
          settings.earthIllumination,
          settings.earthAlbedoAzimuth,
          settings.earthAlbedoDirectional,
          settings.mountX,
          settings.mountZ,
        );
        const isEarthPath =
          isPixelLitByEarthAlbedo(
            index,
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
        if (!dragging) yaw += settings.paused ? 0 : delta * 0.018;
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
        <span className="hud-tag"><CircleDot size={12} /> LEO ORBIT</span>
        <span>{altitude} km</span>
        <span>{inclination}° inc.</span>
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

function SignalChart({ data }: { data: Sample[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.scale(ratio, ratio);
    const width = rect.width;
    const height = rect.height;
    context.clearRect(0, 0, width, height);

    context.strokeStyle = "rgba(126, 170, 194, 0.12)";
    context.lineWidth = 1;
    for (let row = 1; row < 4; row += 1) {
      const y = (height / 4) * row;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const max = Math.max(520, ...data.map((point) => point.observed)) * 1.08;
    const drawSeries = (
      getValue: (point: Sample) => number,
      color: string,
      lineWidth: number,
      fill?: string,
    ) => {
      context.beginPath();
      data.forEach((point, index) => {
        const x = (index / Math.max(1, data.length - 1)) * width;
        const y = height - (getValue(point) / max) * (height - 8) - 4;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      if (fill) {
        context.lineTo(width, height);
        context.lineTo(0, height);
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        context.beginPath();
        data.forEach((point, index) => {
          const x = (index / Math.max(1, data.length - 1)) * width;
          const y = height - (getValue(point) / max) * (height - 8) - 4;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
      }
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.stroke();
    };

    drawSeries(
      (point) => point.observed,
      "#62d9ff",
      1.35,
      "rgba(52, 181, 223, 0.07)",
    );
    drawSeries(
      (point) => point.background,
      "rgba(190, 209, 217, 0.88)",
      1.15,
    );

    let index = 0;
    while (index < data.length) {
      while (index < data.length && data[index].source <= 0) index += 1;
      const start = index;
      while (index < data.length && data[index].source > 0) index += 1;
      const end = index - 1;
      if (start > end) continue;

      context.beginPath();
      for (let pointIndex = start; pointIndex <= end; pointIndex += 1) {
        const point = data[pointIndex];
        const x = (pointIndex / Math.max(1, data.length - 1)) * width;
        const y = height - (point.observed / max) * (height - 8) - 4;
        if (pointIndex === start) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      for (let pointIndex = end; pointIndex >= start; pointIndex -= 1) {
        const point = data[pointIndex];
        const x = (pointIndex / Math.max(1, data.length - 1)) * width;
        const y = height - (point.background / max) * (height - 8) - 4;
        context.lineTo(x, y);
      }
      context.closePath();
      context.fillStyle = "rgba(255, 200, 87, 0.18)";
      context.fill();

      context.beginPath();
      for (let pointIndex = start; pointIndex <= end; pointIndex += 1) {
        const point = data[pointIndex];
        const x = (pointIndex / Math.max(1, data.length - 1)) * width;
        const y = height - (point.observed / max) * (height - 8) - 4;
        if (pointIndex === start) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = "#ffc857";
      context.lineWidth = 2;
      context.stroke();
    }
  }, [data]);

  return <canvas ref={canvasRef} className="signal-canvas" aria-label="Photon count time series" />;
}

function HistoryDialog({
  mode,
  events,
  photons,
  onClose,
}: {
  mode: "events" | "photons";
  events: EventRecord[];
  photons: PhotonRecord[];
  onClose: () => void;
}) {
  const pageSize = 100;
  const [page, setPage] = useState(0);
  const records = mode === "events" ? events : photons;
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = Math.max(0, records.length - (safePage + 1) * pageSize);
  const pageEnd = records.length - safePage * pageSize;
  const visibleEvents =
    mode === "events" ? events.slice(pageStart, pageEnd).reverse() : [];
  const visiblePhotons =
    mode === "photons" ? photons.slice(pageStart, pageEnd).reverse() : [];

  const downloadCsv = () => {
    const rows =
      mode === "events"
        ? [
            ["mission_time", "simulated_utc", "type", "description"],
            ...events.map((event) => [
              event.time,
              event.utc,
              event.kind,
              event.text,
            ]),
          ]
        : [
            [
              "bin",
              "mission_elapsed_s",
              "simulated_utc",
              "background_c_s",
              "source_c_s",
              "observed_c_s",
              "sun_c_s",
              "moon_c_s",
              "earth_albedo_c_s",
              "active_bursts",
              "hit_pixels",
            ],
            ...photons.map((sample) => [
              sample.bin,
              sample.elapsed.toFixed(1),
              sample.simulatedDate,
              sample.background,
              sample.source,
              sample.observed,
              sample.sun.toFixed(3),
              sample.moon.toFixed(3),
              sample.earthAlbedo.toFixed(3),
              sample.activeBursts,
              sample.hitPixels,
            ]),
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
    anchor.download =
      mode === "events"
        ? "crystal-eye-event-history.csv"
        : "crystal-eye-photon-stream.csv";
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
            <strong id="history-dialog-title">
              {mode === "events" ? "Event History" : "Photon Stream History"}
            </strong>
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
            <strong>{records.length.toLocaleString("en-US")}</strong> stored records
          </span>
          <span>Newest records first · 100 rows per page</span>
        </div>

        <div className="history-table-wrap">
          {mode === "events" ? (
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
          ) : (
            <table className="history-table photon-history-table">
              <thead>
                <tr>
                  <th>BIN</th>
                  <th>MISSION TIME</th>
                  <th>SIMULATED UTC</th>
                  <th>BACKGROUND</th>
                  <th>SOURCE</th>
                  <th>OBSERVED</th>
                  <th>SUN</th>
                  <th>MOON</th>
                  <th>EARTH ALBEDO</th>
                  <th>GRB</th>
                  <th>HIT PIXELS</th>
                </tr>
              </thead>
              <tbody>
                {visiblePhotons.map((sample) => (
                  <tr key={sample.bin}>
                    <td>{sample.bin}</td>
                    <td>T+{formatTime(sample.elapsed).slice(3)}</td>
                    <td>{sample.simulatedDate.replace("T", " ").replace(".000Z", " Z")}</td>
                    <td>{sample.background.toFixed(0)} c/s</td>
                    <td className={sample.source > 0 ? "source-value" : ""}>
                      {sample.source.toFixed(0)} c/s
                    </td>
                    <td>{sample.observed.toFixed(0)} c/s</td>
                    <td>{sample.sun.toFixed(1)}</td>
                    <td>{sample.moon.toFixed(1)}</td>
                    <td>{sample.earthAlbedo.toFixed(1)}</td>
                    <td>{sample.activeBursts}</td>
                    <td>{sample.hitPixels}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {records.length === 0 && (
            <div className="history-empty">Waiting for acquisition records…</div>
          )}
        </div>

        <footer>
          <span>
            Rows {records.length === 0 ? 0 : pageStart + 1}–{pageEnd} of{" "}
            {records.length.toLocaleString("en-US")}
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
  phase,
  inclination,
  sunDirection,
  moonDirection,
  sunInFov,
  moonInFov,
  moonPhase,
  detector,
  detectorHits,
  pentagonPixelIndices,
  pixelRotations,
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
  phase: number;
  inclination: number;
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  sunInFov: boolean;
  moonInFov: boolean;
  moonPhase: number;
  detector: number[];
  detectorHits: number[];
  pentagonPixelIndices: Set<number>;
  pixelRotations: number[];
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
    const inclinationRad = THREE.MathUtils.degToRad(inclination);
    const boresight = normalizeVector(
      Math.cos(phase) * Math.cos(inclinationRad),
      Math.cos(phase) * Math.sin(inclinationRad),
      Math.sin(phase),
    );
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
        const seedA = Math.abs(Math.sin(index * 91.713 + phase * 0.37));
        const seedB = Math.abs(Math.sin(index * 47.117 + inclination * 0.021));
        const starRadius = Math.sqrt(seedA) * radius * 0.96;
        const starAngle = seedB * Math.PI * 2 + phase * 0.11;
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
        const value = detector[pixel.index] ?? 0;
        const hitCount = detectorHits[pixel.index] ?? 0;
        const isFired = hitCount > 0;
        const x = cx + Math.cos(pixel.angle) * pixel.radius * radius * 0.88;
        const y = cy + Math.sin(pixel.angle) * pixel.radius * radius * 0.88;
        const cellRadius = Math.max(2.2, radius * (0.036 - pixel.ring * 0.0008));
        const isSelected = pixel.index === selectedPixel;
        const isOnBurstFootprint =
          burstPixelGroups.some((group) => group.includes(pixel.index));
        const isOnEarthAlbedo =
          isPixelLitByEarthAlbedo(
            pixel.index,
            earthIllumination,
            earthAlbedoAzimuth,
            earthAlbedoDirectional,
            mountX,
            mountZ,
          );
        const isOverlap = isFired && isOnBurstFootprint && isOnEarthAlbedo;
        context.beginPath();
        const sideCount = pentagonPixelIndices.has(pixel.index) ? 5 : 6;
        for (let side = 0; side < sideCount; side += 1) {
          const angle =
            (side / sideCount) * Math.PI * 2 +
            (sideCount === 5 ? Math.PI / 2 : -Math.PI / 2) +
            THREE.MathUtils.degToRad(pixelRotations[pixel.index] ?? 0);
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
        const burst = PIXEL_LAYOUT[directionPixel];
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
    inclination,
    mode,
    moonDirection,
    moonPhase,
    moonInFov,
    mountX,
    mountZ,
    pentagonPixelIndices,
    pixelRotations,
    phase,
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
            phase={phase}
            sunDirection={sunDirection}
            moonDirection={moonDirection}
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
  grbActive,
  burstPixelGroups,
  pixelConfiguration,
  selectedPixel,
  earthIllumination,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
  mountX,
  mountZ,
  onSelect,
}: {
  values: number[];
  hits: number[];
  grbActive: boolean;
  burstPixelGroups: number[][];
  pixelConfiguration: PixelConfiguration;
  selectedPixel: number;
  earthIllumination: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
  mountX: number;
  mountZ: number;
  onSelect: (index: number) => void;
}) {
  const pentagonPixelIndices = useMemo(
    () => getPentagonPixelIndices(pixelConfiguration),
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
          const value = values[pixel.index] ?? 0;
          const hitCount = hits[pixel.index] ?? 0;
          const isActive = hitCount > 0;
          const isBurstHit =
            isActive &&
            burstPixelGroups.some((group) => group.includes(pixel.index));
          const isEarthAlbedo =
            isActive &&
            isPixelLitByEarthAlbedo(
              pixel.index,
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
                selectedPixel === pixel.index ? "is-selected" : ""
              } ${
                configuredPixel.isSeam ? "is-unfolding-seam" : ""
              } ${
                pentagonPixelIndices.has(pixel.index) ? "is-pentagon" : ""
              }`}
              style={{
                "--heat": Math.min(1, value).toFixed(4),
                "--impact-color": getImpactColor(value),
                "--pixel-x": `${configuredPixel.x}%`,
                "--pixel-y": `${configuredPixel.y}%`,
                "--pixel-rotation": `${configuredPixel.rotationDeg}deg`,
                "--pixel-label-rotation": `${-configuredPixel.rotationDeg}deg`,
                "--delay": `${(pixel.index % 17) * 24}ms`,
              } as React.CSSProperties}
              title={`${configuredPixel.id} · ${
                pentagonPixelIndices.has(pixel.index)
                  ? "central pentagon"
                  : "hexagon"
              } · ${hitCount} photons detected in the current bin`}
              aria-label={`${configuredPixel.id}, ${
                pentagonPixelIndices.has(pixel.index)
                  ? "central pentagon"
                  : "hexagon"
              }, ${hitCount} photons detected`}
              onClick={() => onSelect(pixel.index)}
            >
              <span>{String(pixel.index + 1).padStart(3, "0")}</span>
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
  phase,
  sunDirection,
  moonDirection,
  moonPhase,
  earthIllumination,
  effectiveFov,
}: {
  phase: number;
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
      const satelliteX = cx + Math.cos(phase) * orbitX;
      const satelliteY = cy + Math.sin(phase) * orbitY;
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
  }, [earthIllumination, effectiveFov, moonDirection, phase, sunDirection]);

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
  onOpenPayload,
  onOpenPixels,
  onClose,
}: {
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
    version: 1,
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
    (index: number, updates: Partial<PixelConfigurationEntry>) => {
      setDraft((current) => ({
        ...current,
        pixels: current.pixels.map((pixel) =>
          pixel.index === index ? { ...pixel, ...updates } : pixel,
        ),
      }));
    },
    [],
  );

  const assignClusterPentagon = useCallback((index: number) => {
    if (index >= GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE) return;
    const cluster = Math.floor(index / GRAY_CLUSTER_SIZE);
    const clusterStart = cluster * GRAY_CLUSTER_SIZE;
    const clusterEnd = clusterStart + GRAY_CLUSTER_SIZE;
    setDraft((current) => ({
      ...current,
      pixels: current.pixels.map((pixel) =>
        pixel.index >= clusterStart && pixel.index < clusterEnd
          ? { ...pixel, isPentagon: pixel.index === index }
          : pixel,
      ),
    }));
    setMessage(
      `Pixel ${String(index + 1).padStart(3, "0")} is now the permanent pentagon for gray cluster ${cluster + 1}.`,
    );
  }, []);

  const rotatePixels = useCallback((indices: number[], deltaDegrees: number) => {
    const rotating = new Set(indices);
    setDraft((current) => ({
      ...current,
      pixels: current.pixels.map((pixel) =>
        rotating.has(pixel.index)
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
        pixels: current.pixels.map((pixel) => {
          if (pixel.index >= GRAY_CLUSTER_COUNT * GRAY_CLUSTER_SIZE) {
            return pixel;
          }
          const targetCluster = Math.floor(
            pixel.index / GRAY_CLUSTER_SIZE,
          );
          const position = pixel.index % GRAY_CLUSTER_SIZE;
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
          pixels: current.pixels.map((pixel) =>
            movingSet.has(pixel.index)
              ? { ...pixel, x: pixel.x + deltaX, y: pixel.y + deltaY }
              : pixel,
          ),
        };
      });
    },
    [],
  );

  const saveConfiguration = () => {
    const ids = draft.pixels.map((pixel) => pixel.id.trim());
    if (ids.some((id) => !id)) {
      setMessage("Every pixel must have an ID before saving.");
      return;
    }
    if (new Set(ids).size !== ids.length) {
      setMessage("Pixel IDs must be unique. Resolve duplicates before saving.");
      return;
    }
    onSave({
      version: 1,
      pixels: draft.pixels.map((pixel) => ({
        ...pixel,
        id: pixel.id.trim(),
        secondaryId: pixel.secondaryId.trim(),
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
                    setSelectedIndices(draft.pixels.map((pixel) => pixel.index));
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
              {draft.pixels.map((pixel) => (
                <button
                  key={pixel.index}
                  type="button"
                  className={`pixel-editor-node ${
                    pixel.isSeam ? "is-red" : "is-gray"
                  } ${
                    pentagonPixelIndices.has(pixel.index) ? "is-pentagon" : ""
                  } ${selectedIndexSet.has(pixel.index) ? "selected" : ""} ${
                    pixel.index === primarySelectedIndex ? "primary-selected" : ""
                  }`}
                  style={{
                    "--editor-x": `${pixel.x}%`,
                    "--editor-y": `${pixel.y}%`,
                    "--pixel-rotation": `${pixel.rotationDeg}deg`,
                    "--pixel-label-rotation": `${-pixel.rotationDeg}deg`,
                  } as React.CSSProperties}
                  title={`Internal index ${pixel.index + 1} · ${pixel.id}`}
                  aria-label={`Pixel ${pixel.index + 1}, ID ${pixel.id}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    const additiveSelection =
                      event.shiftKey || event.ctrlKey || event.metaKey;
                    let dragIndices: number[];
                    if (additiveSelection) {
                      dragIndices = selectedIndexSet.has(pixel.index)
                        ? selectedIndices.filter((index) => index !== pixel.index)
                        : [...selectedIndices, pixel.index];
                      if (dragIndices.length === 0) dragIndices = [pixel.index];
                      setSelectedIndices(dragIndices);
                    } else if (selectedIndexSet.has(pixel.index)) {
                      dragIndices = selectedIndices;
                    } else {
                      dragIndices = [pixel.index];
                      setSelectedIndices(dragIndices);
                    }
                    setPrimarySelectedIndex(
                      dragIndices.includes(pixel.index)
                        ? pixel.index
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
                      pixels: current.pixels.map((currentPixel) => {
                        if (!dragSet.has(currentPixel.index)) return currentPixel;
                        const initial = drag.initialPositions.find(
                          (position) => position.index === currentPixel.index,
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
                    const keyboardSelection = selectedIndexSet.has(pixel.index)
                      ? selectedIndices
                      : [pixel.index];
                    movePixels(keyboardSelection, delta[0], delta[1]);
                  }}
                >
                  <span>{getPixelIdNumber(pixel.id, pixel.index)}</span>
                  {pixel.secondaryId ? (
                    <small>{pixel.secondaryId}</small>
                  ) : null}
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
                  ? `#${String(selectedPixel.index + 1).padStart(3, "0")}`
                  : `${selectedIndices.length} PIXELS`}
              </strong>
              <em>
                {selectedIndices.length === 1
                  ? selectedPixel.isSeam
                    ? "RED TRIPLET"
                    : pentagonPixelIndices.has(selectedPixel.index)
                      ? "GRAY CLUSTER · CENTRAL PENTAGON"
                      : "GRAY CLUSTER · HEXAGON"
                  : "DRAG OR NUDGE AS A GROUP"}
              </em>
            </div>

            <section
              className="pixel-geometry-card"
              aria-label={`Geometric internal structure for ${selectedPixel.id}`}
            >
              <header>
                <span>PIXEL GEOMETRY</span>
                <strong>{selectedPixel.id}</strong>
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

            <label htmlFor="pixel-config-id">DETECTOR ID</label>
            <input
              id="pixel-config-id"
              value={
                selectedIndices.length === 1
                  ? selectedPixel.id
                  : "Select one pixel to edit its ID"
              }
              maxLength={24}
              spellCheck={false}
              disabled={selectedIndices.length !== 1}
              onChange={(event) =>
                updatePixel(primarySelectedIndex, { id: event.target.value })
              }
              onFocus={(event) => event.currentTarget.select()}
            />

            <label htmlFor="pixel-config-secondary-id">SECONDARY NUMBER</label>
            <input
              id="pixel-config-secondary-id"
              className="pixel-secondary-id-input"
              value={
                selectedIndices.length === 1
                  ? selectedPixel.secondaryId
                  : "Select one pixel to edit its secondary number"
              }
              maxLength={12}
              inputMode="numeric"
              spellCheck={false}
              placeholder="Not assigned"
              disabled={selectedIndices.length !== 1}
              onChange={(event) =>
                updatePixel(primarySelectedIndex, {
                  secondaryId: event.target.value.replace(/[^\d]/g, ""),
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
                      pixels: current.pixels.map((pixel) =>
                        rotating.has(pixel.index)
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
                  version: 1,
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
  const [altitude, setAltitude] = useState(550);
  const [inclination, setInclination] = useState(20);
  const [speed, setSpeed] = useState(50);
  const [paused, setPaused] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [systemZoom, setSystemZoom] = useState(55);
  const [configurationView, setConfigurationView] = useState<
    "hub" | "payload" | "pixels" | null
  >(null);
  const [pixelConfiguration, setPixelConfiguration] =
    useState<PixelConfiguration>(DEFAULT_PIXEL_CONFIGURATION);
  const [mountX, setMountX] = useState(0);
  const [mountZ, setMountZ] = useState(0);
  const [epochMs, setEpochMs] = useState(() => Date.now());
  const [selectedPixel, setSelectedPixel] = useState(43);
  const [detectorExpanded, setDetectorExpanded] = useState(false);
  const [historyView, setHistoryView] = useState<"events" | "photons" | null>(null);
  const [testBurstDraft, setTestBurstDraft] = useState<TestBurstDraft>({
    raDeg: 0,
    decDeg: 0,
    intensity: 100,
    spreadPixels: 18,
    durationSeconds: 1.2,
  });
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [samples, setSamples] = useState<Sample[]>(() =>
    Array.from({ length: 80 }, () => ({
      background: INITIAL_TELEMETRY.background,
      source: 0,
      observed: INITIAL_TELEMETRY.background,
    })),
  );
  const [photonHistory, setPhotonHistory] = useState<PhotonRecord[]>([]);
  const [eventLog, setEventLog] = useState<EventRecord[]>(() => {
    const utc = new Date().toISOString();
    return [
      { time: "T+00:00", utc, text: "Science acquisition started", kind: "system" },
      { time: "T+00:00", utc, text: "Orbital background model initialized", kind: "background" },
    ];
  });
  const phaseRef = useRef(INITIAL_TELEMETRY.phase);
  const elapsedRef = useRef(0);
  const photonBinRef = useRef(0);
  const activeBurstsRef = useRef<BurstEvent[]>([]);
  const nextBurstIdRef = useRef(1);
  const totalRef = useRef(0);
  const capturedRef = useRef(0);
  const selectedPixelRef = useRef(43);
  const pixelConfigurationRef = useRef(DEFAULT_PIXEL_CONFIGURATION);
  const settingsRef = useRef({
    altitude,
    inclination,
    speed,
    paused,
    epochMs,
    mountX,
    mountZ,
  });

  useEffect(() => {
    let timer: number | undefined;
    try {
      const stored = window.localStorage.getItem(PIXEL_CONFIGURATION_STORAGE_KEY);
      if (!stored) return;
      const configuration = normalizePixelConfiguration(JSON.parse(stored));
      if (configuration) {
        timer = window.setTimeout(() => {
          pixelConfigurationRef.current = configuration;
          setPixelConfiguration(configuration);
        }, 0);
      }
    } catch {
      // A malformed local draft should never prevent the simulator from opening.
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    settingsRef.current = {
      altitude,
      inclination,
      speed,
      paused,
      epochMs,
      mountX,
      mountZ,
    };
  }, [altitude, inclination, speed, paused, epochMs, mountX, mountZ]);

  useEffect(() => {
    if (!detectorExpanded && !historyView) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetectorExpanded(false);
      if (event.key === "Escape") setHistoryView(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detectorExpanded, historyView]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const settings = settingsRef.current;
      if (settings.paused) return;
      const dt = 0.2 * settings.speed;
      elapsedRef.current += dt;
      phaseRef.current = (phaseRef.current + dt / 910) % (Math.PI * 2);
      const phase = phaseRef.current;
      const latitude = settings.inclination * Math.sin(phase);
      const longitude = ((phase * 180) / Math.PI * 1.07 + elapsedRef.current * 0.018 + 180) % 360 - 180;
      const celestial = getCelestialGeometry(
        elapsedRef.current,
        phase,
        settings.inclination,
        settings.altitude,
        settings.epochMs,
      );
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
      const backgroundMean =
        BASE_BACKGROUND_RATE +
        mountedSunNoise +
        mountedMoonNoise +
        mountedEarthAlbedoNoise;
      const activeBursts = activeBurstsRef.current.filter(
        (burst) => burst.ticksRemaining > 0,
      );
      const burstDirections = activeBursts.map((burst) => burst.pixelIndex);
      const burstPixelGroups = activeBursts.map((burst) => burst.pixelIndices);
      const isGRB = activeBursts.length > 0;
      const background = Math.round(backgroundMean);
      const source = Math.round(
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
      const observed = background + source;
      totalRef.current += observed;
      capturedRef.current += source;
      const detectorResponse = PIXEL_LAYOUT.map((pixel) => {
        const albedoResponse = getEarthAlbedoResponse(
          pixel.index,
          celestial.earthIllumination,
          celestial.earthAlbedoAzimuth,
          celestial.earthAlbedoDirectional,
          settings.mountX,
          settings.mountZ,
        );
        let hits =
          albedoResponse >= 0.12
            ? Math.max(
                1,
                Math.round(
                  (albedoResponse * celestial.earthAlbedoNoise) / 18,
                ),
              )
            : 0;
        let impact =
          hits > 0
            ? THREE.MathUtils.clamp(albedoResponse * 0.42, 0.04, 0.42)
            : 0;
        activeBursts.forEach((burst) => {
          if (!burst.pixelIndices.includes(pixel.index)) return;
          const incidence = getConfiguredBurstIncidence(
            pixelConfigurationRef.current,
            pixel.index,
            burst.pixelIndex,
          );
          const temporalResponse = Math.exp(
            -Math.max(0, burst.ageTicks - 1) / 5,
          );
          const normalizedImpact =
            (burst.intensity / 100) *
            incidence ** 2.2 *
            temporalResponse;
          const burstAmplitude =
            10.5 * (burst.intensity / 100) * temporalResponse;
          hits += Math.max(
            1,
            Math.round(
                burstAmplitude *
                  incidence ** 2.2 *
                  burst.transmission,
            ),
          );
          impact = Math.max(impact, normalizedImpact);
        });
        return {
          hits,
          impact: THREE.MathUtils.clamp(impact, 0, 1),
        };
      });
      const detectorHits = detectorResponse.map((pixel) => pixel.hits);
      const detector = detectorResponse.map((pixel) => pixel.impact);
      const next = { observed, background, source };
      photonBinRef.current += 1;
      setSamples((current) => [...current.slice(-119), next]);
      setPhotonHistory((current) => [
        ...current,
        {
          ...next,
          bin: photonBinRef.current,
          elapsed: elapsedRef.current,
          simulatedDate: celestial.date.toISOString(),
          sun: mountedSunNoise,
          moon: mountedMoonNoise,
          earthAlbedo: mountedEarthAlbedoNoise,
          activeBursts: activeBursts.length,
          hitPixels: detectorHits.filter((hits) => hits > 0).length,
        },
      ]);
      setTelemetry({
        ...next,
        elapsed: elapsedRef.current,
        phase,
        latitude,
        longitude,
        total: totalRef.current,
        captured: capturedRef.current,
        significance: source / Math.sqrt(Math.max(1, background)),
        grbActive: isGRB,
        burstDirections,
        burstPixelGroups,
        detector,
        detectorHits,
        simulatedDate: celestial.date.toISOString(),
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

  const selectPixel = useCallback((index: number) => {
    selectedPixelRef.current = index;
    setSelectedPixel(index);
  }, []);

  const savePixelConfiguration = useCallback(
    (configuration: PixelConfiguration) => {
      pixelConfigurationRef.current = configuration;
      setPixelConfiguration(configuration);
      window.localStorage.setItem(
        PIXEL_CONFIGURATION_STORAGE_KEY,
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
  }: {
    targetPixel: number;
    footprintCount: number;
    intensity: number;
    durationSeconds: number;
    raDeg: number;
    decDeg: number;
    transmission: number;
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
        pixelIndex: targetPixel,
        pixelIndices,
        transmission,
        intensity,
        raDeg,
        decDeg,
        ageTicks: 0,
        ticksRemaining: Math.max(1, Math.round(durationSeconds / 0.2)),
      },
    ];
    setEventLog((current) => [
      ...current,
      {
        time: `T+${formatTime(elapsedRef.current).slice(3)}`,
        utc: new Date(
          settingsRef.current.epochMs + elapsedRef.current * 1000,
        ).toISOString(),
        text: `GRB #${burstId} · RA ${raDeg.toFixed(2)}° · Dec ${decDeg.toFixed(2)}° · ${intensity.toFixed(0)}% · ${durationSeconds.toFixed(1)} s · ${pixelIndices.length} px · ${(transmission * 100).toFixed(0)}% transmission · target ${pixelConfigurationRef.current.pixels[targetPixel].id}`,
        kind: "grb",
      },
    ]);
  }, [selectPixel]);

  const injectGRB = useCallback(() => {
    const configuration = pixelConfigurationRef.current;
    const configuredNormals = getConfiguredPixelNormals(configuration);
    const halfFovCosine = Math.cos(
      THREE.MathUtils.degToRad(
        getMountEffectiveFov(
          settingsRef.current.mountX,
          settingsRef.current.mountZ,
        ) / 2,
      ),
    );
    const visibleTargets = PIXEL_LAYOUT.filter((pixel) => {
      const normal = configuredNormals[pixel.index];
      return (
        normal[1] >= halfFovCosine &&
        getMountSkyVisibility(
          pixel.index,
          settingsRef.current.mountX,
          settingsRef.current.mountZ,
        ) >= 0.12
      );
    });
    const targetPixel =
      visibleTargets[Math.floor(Math.random() * visibleTargets.length)]?.index ??
      0;
    const footprintCount = 4 + Math.floor(Math.random() * 25);
    const intensity = 72 + Math.random() * 28;
    const boresight = normalizeVector(
      Math.cos(phaseRef.current) *
        Math.cos(THREE.MathUtils.degToRad(settingsRef.current.inclination)),
      Math.cos(phaseRef.current) *
        Math.sin(THREE.MathUtils.degToRad(settingsRef.current.inclination)),
      Math.sin(phaseRef.current),
    );
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
          targetPixel,
          settingsRef.current.mountX,
          settingsRef.current.mountZ,
        ),
    });
  }, [launchBurst]);

  const aimTestBurstAtBoresight = useCallback(() => {
    const boresight = normalizeVector(
      Math.cos(phaseRef.current) *
        Math.cos(THREE.MathUtils.degToRad(settingsRef.current.inclination)),
      Math.cos(phaseRef.current) *
        Math.sin(THREE.MathUtils.degToRad(settingsRef.current.inclination)),
      Math.sin(phaseRef.current),
    );
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
    const boresight = normalizeVector(
      Math.cos(phaseRef.current) *
        Math.cos(THREE.MathUtils.degToRad(settingsRef.current.inclination)),
      Math.cos(phaseRef.current) *
        Math.sin(THREE.MathUtils.degToRad(settingsRef.current.inclination)),
      Math.sin(phaseRef.current),
    );
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
            targetPixel,
            settingsRef.current.mountX,
            settingsRef.current.mountZ,
          )
        : 0,
    });
  }, [launchBurst, testBurstDraft]);

  const setEphemerisUtc = useCallback((value: string) => {
    const requestedTime = Date.parse(`${value}Z`);
    if (!Number.isFinite(requestedTime)) return;
    setEpochMs(requestedTime - elapsedRef.current * 1000);
  }, []);

  const setEphemerisToNow = useCallback(() => {
    setEpochMs(Date.now() - elapsedRef.current * 1000);
  }, []);

  const resetSimulation = useCallback(() => {
    const now = Date.now();
    phaseRef.current = 0.72;
    elapsedRef.current = 0;
    totalRef.current = 0;
    capturedRef.current = 0;
    activeBurstsRef.current = [];
    nextBurstIdRef.current = 1;
    setEpochMs(now);
    selectPixel(43);
    const celestial = getCelestialGeometry(0, 0.72, inclination, altitude, now);
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
    const detectorHits = PIXEL_LAYOUT.map((pixel) => {
      const response = getEarthAlbedoResponse(
        pixel.index,
        celestial.earthIllumination,
        celestial.earthAlbedoAzimuth,
        celestial.earthAlbedoDirectional,
        mountX,
        mountZ,
      );
      return response >= 0.12
        ? Math.max(1, Math.round((response * celestial.earthAlbedoNoise) / 18))
        : 0;
    });
    const background = Math.round(
      BASE_BACKGROUND_RATE +
        mountedSunNoise +
        mountedMoonNoise +
        mountedEarthAlbedoNoise,
    );
    setTelemetry({
      ...INITIAL_TELEMETRY,
      observed: background,
      background,
      detectorHits,
      detector: detectorHits.map((hits) => (hits > 0 ? 0.55 : 0)),
      simulatedDate: celestial.date.toISOString(),
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
    });
    setEventLog((current) => [
      ...current,
      { time: "T+00:00", utc: new Date(now).toISOString(), text: "Simulation reset", kind: "system" },
      { time: "T+00:00", utc: new Date(now).toISOString(), text: "Science acquisition started", kind: "background" },
    ]);
  }, [altitude, inclination, mountX, mountZ, selectPixel]);

  const orbitPeriod = useMemo(() => {
    const earthRadius = 6371;
    const gravitationalParameter = 398600.4418;
    return (2 * Math.PI * Math.sqrt(((earthRadius + altitude) ** 3) / gravitationalParameter)) / 60;
  }, [altitude]);

  const effectiveMountFov = useMemo(() => {
    return getMountEffectiveFov(mountX, mountZ);
  }, [mountX, mountZ]);
  const pentagonPixelIndices = useMemo(
    () => getPentagonPixelIndices(pixelConfiguration),
    [pixelConfiguration],
  );
  const configuredPixelRotations = useMemo(
    () => pixelConfiguration.pixels.map((pixel) => pixel.rotationDeg),
    [pixelConfiguration],
  );
  const mountedSunInFov =
    telemetry.sunSeparation <= effectiveMountFov / 2 && telemetry.sunNoise > 0.1;
  const mountedMoonInFov =
    telemetry.moonSeparation <= effectiveMountFov / 2 && telemetry.moonNoise > 0.1;

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
        <div className="mission-status">
          <button
            type="button"
            className="placement-settings-button"
            onClick={() => setConfigurationView("hub")}
          >
            <SlidersHorizontal size={14} />
            CONFIGURATION
          </button>
          <span className="status-live"><i /> SCIENCE MODE</span>
          <div className="header-metric">
            <small>MISSION ELAPSED</small>
            <strong>{formatTime(telemetry.elapsed)}</strong>
          </div>
          <div className="header-metric celestial-time">
            <small>EPHEMERIS DATE AND TIME · UTC</small>
            <strong>
              {new Date(telemetry.simulatedDate)
                .toISOString()
                .slice(0, 19)
                .replace("T", " · ")}
            </strong>
          </div>
          <div className="header-metric">
            <small>LINK</small>
            <strong className="link-ok"><Radio size={13} /> NOMINAL</strong>
          </div>
        </div>
      </header>

      {configurationView === "hub" && (
        <ConfigurationHub
          onOpenPayload={() => setConfigurationView("payload")}
          onOpenPixels={() => setConfigurationView("pixels")}
          onClose={() => setConfigurationView(null)}
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

      <section className="workspace">
        <aside className="control-panel left-panel">
          <div className="panel-heading">
            <span>MISSION CONTROL</span>
            <Orbit size={17} />
          </div>

          <div className="control-section">
            <div className="section-label">ORBITAL CONFIGURATION</div>
            <RangeControl label="Altitude" value={altitude} min={400} max={700} step={10} suffix=" km" onChange={setAltitude} />
            <RangeControl label="Inclination" value={inclination} min={0} max={60} step={1} suffix="°" onChange={setInclination} />
            <RangeControl label="Physical time warp" value={speed} min={1} max={500} step={1} suffix="×" onChange={setSpeed} />
            <div className="warp-presets" aria-label="Time warp presets">
              {[1, 50, 200, 500].map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className={speed === preset ? "active" : ""}
                  onClick={() => setSpeed(preset)}
                >
                  {preset}×
                </button>
              ))}
            </div>
            <div className="ephemeris-control">
              <label htmlFor="ephemeris-utc">SIMULATED DATE AND TIME · UTC</label>
              <div>
                <input
                  id="ephemeris-utc"
                  type="datetime-local"
                  step="1"
                  value={new Date(telemetry.simulatedDate).toISOString().slice(0, 19)}
                  onChange={(event) => setEphemerisUtc(event.target.value)}
                />
                <button type="button" onClick={setEphemerisToNow}>
                  NOW
                </button>
              </div>
            </div>
            <div className="mini-grid">
              <div><small>PERIOD</small><strong>{orbitPeriod.toFixed(1)} min</strong></div>
              <div><small>GEOMETRIC FOV</small><strong>&gt; 2π sr</strong></div>
              <div><small>EFFECTIVE CONE</small><strong>{effectiveMountFov.toFixed(0)}°</strong></div>
              <div><small>POINTING</small><strong>anti-Earth</strong></div>
            </div>
          </div>

          <div className="left-sensor-slot">
            <SensorView
              phase={telemetry.phase}
              inclination={inclination}
              sunDirection={telemetry.sunDirection}
              moonDirection={telemetry.moonDirection}
              sunInFov={mountedSunInFov}
              moonInFov={mountedMoonInFov}
              moonPhase={telemetry.moonPhase}
              detector={telemetry.detector}
              detectorHits={telemetry.detectorHits}
              pentagonPixelIndices={pentagonPixelIndices}
              pixelRotations={configuredPixelRotations}
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

          <div className="button-row">
            <button className="secondary-button" onClick={() => setPaused((value) => !value)}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="icon-button" aria-label="Reset simulation" onClick={resetSimulation}>
              <RotateCcw size={16} />
            </button>
          </div>
        </aside>

        <section className="simulation-stage">
          <GlobeScene
            altitude={altitude}
            inclination={inclination}
            speed={speed}
            paused={paused}
            phase={telemetry.phase}
            grbActive={telemetry.grbActive}
            burstDirections={telemetry.burstDirections}
            burstPixelGroups={telemetry.burstPixelGroups}
            pixelConfiguration={pixelConfiguration}
            selectedPixel={selectedPixel}
            sunDirection={telemetry.sunDirection}
            moonDirection={telemetry.moonDirection}
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
            <span className="eyebrow">ORBITAL PHOTON CAPTURE</span>
            <h2>Earth · LEO <em>{altitude} km</em></h2>
          </div>
          <div className={`grb-alert ${telemetry.grbActive ? "visible" : ""}`}>
            <Zap size={18} />
            <div><small>TRANSIENT DETECTED</small><strong>GRB candidate · {telemetry.significance.toFixed(2)}σ</strong></div>
          </div>
          <div className="orbit-readout">
            <span>ORB {((telemetry.phase / (Math.PI * 2)) * 100).toFixed(1)}%</span>
            <div><i style={{ width: `${(telemetry.phase / (Math.PI * 2)) * 100}%` }} /></div>
          </div>
        </section>

        <aside className="control-panel right-panel">
          <button
            type="button"
            className="panel-heading history-launch"
            onClick={() => setHistoryView("photons")}
            aria-label="Open photon stream history table"
          >
            <span>PHOTON STREAM</span>
            <span className="history-launch-icon">
              <small>{photonHistory.length.toLocaleString("en-US")} ROWS</small>
              <Activity size={17} />
              <ChevronRight size={13} />
            </span>
          </button>

          <div className="chart-card">
            <div className="chart-header">
              <div>
                <small>LIGHT CURVE</small>
                <strong>Observed total = background + GRB excess</strong>
              </div>
              <span>0.2 s bins</span>
            </div>
            <SignalChart data={samples} />
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
                  <strong>
                    {telemetry.sunSeparation.toFixed(1)}° · {(telemetry.sunExposure * 100).toFixed(0)}% exposure
                  </strong>
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
            <p>Real astronomical geometry; parametric interference amplitudes require calibration.</p>
          </div>

          <div className="detector-section">
            <div className="detector-section-header">
              <div>
                <small>DETECTOR RESPONSE</small>
                <strong>Configured pixel impact · 0–100</strong>
              </div>
              <button
                type="button"
                className="detector-expand-button"
                onClick={() => setDetectorExpanded(true)}
                aria-label="Open enlarged detector map"
                title="Open enlarged detector map"
              >
                <Maximize2 size={13} />
              </button>
            </div>
            <DetectorMap
              values={telemetry.detector}
              hits={telemetry.detectorHits}
              grbActive={telemetry.grbActive}
              burstPixelGroups={telemetry.burstPixelGroups}
              pixelConfiguration={pixelConfiguration}
              selectedPixel={selectedPixel}
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
              <button type="button" className="random-grb-mini" onClick={injectGRB}>
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
          mode={historyView}
          events={eventLog}
          photons={photonHistory}
          onClose={() => setHistoryView(null)}
        />
      )}

      {detectorExpanded && (
        <div
          className="detector-expanded-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setDetectorExpanded(false);
          }}
        >
          <section
            className="detector-expanded-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Enlarged configured detector map"
          >
            <button
              type="button"
              className="detector-expand-button close-expanded"
              onClick={() => setDetectorExpanded(false)}
              aria-label="Close enlarged detector map"
              title="Close enlarged detector map"
            >
              <X size={18} />
            </button>
            <DetectorMap
              values={telemetry.detector}
              hits={telemetry.detectorHits}
              grbActive={telemetry.grbActive}
              burstPixelGroups={telemetry.burstPixelGroups}
              pixelConfiguration={pixelConfiguration}
              selectedPixel={selectedPixel}
              earthIllumination={telemetry.earthIllumination}
              earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
              earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
              mountX={mountX}
              mountZ={mountZ}
              onSelect={selectPixel}
            />
          </section>
        </div>
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
