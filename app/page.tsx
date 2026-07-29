"use client";

import {
  Activity,
  Aperture,
  Atom,
  ChevronRight,
  CircleDot,
  Gauge,
  Orbit,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Satellite,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Moon,
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
};

type BurstEvent = {
  id: number;
  pixelIndex: number;
  pixelIndices: number[];
  transmission: number;
  ageTicks: number;
  ticksRemaining: number;
};

type CameraMode = "orbit" | "satellite";

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const PIXEL_RING_COUNTS = [1, 6, 12, 18, 24, 30, 35] as const;
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
  [3, 4, 4, 3, 2].forEach((count, row) => {
    for (let column = 0; column < count; column += 1) {
      clusterPattern.push([
        (column - (count - 1) / 2) * 3.85,
        (row - 2) * 4.05,
      ]);
    }
  });

  const outerClusterAngles = [-126, -54, 18, 90, 162].map(
    (degrees) => (degrees * Math.PI) / 180,
  );
  const clusterCenters = [
    { x: 50, y: 50, angle: 0 },
    ...outerClusterAngles.map((angle) => ({
      x: 50 + Math.cos(angle) * 31.5,
      y: 50 + Math.sin(angle) * 31.5,
      angle,
    })),
  ];

  clusterCenters.forEach((center, clusterIndex) => {
    clusterPattern.forEach(([localX, localY], position) => {
      const rotation = clusterIndex === 0 ? 0 : center.angle + Math.PI / 2;
      const rotatedX =
        localX * Math.cos(rotation) - localY * Math.sin(rotation);
      const rotatedY =
        localX * Math.sin(rotation) + localY * Math.cos(rotation);
      layout.push({
        index: clusterIndex * 16 + position,
        x: center.x + rotatedX,
        y: center.y + rotatedY,
        isSeam: false,
      });
    });
  });

  const tripletPattern = [
    [-2.05, -1.9],
    [-2.05, 1.9],
    [2.05, 0],
  ] as const;
  const innerTriplets = outerClusterAngles.map((angle) => ({
    angle,
    radius: 17.7,
  }));
  const outerTriplets = outerClusterAngles.map((angle, index) => {
    const nextAngle =
      index === outerClusterAngles.length - 1
        ? outerClusterAngles[0] + Math.PI * 2
        : outerClusterAngles[index + 1];
    return {
      angle: (angle + nextAngle) / 2,
      radius: 44,
    };
  });

  [...innerTriplets, ...outerTriplets].forEach((triplet, tripletIndex) => {
    tripletPattern.forEach(([localX, localY], position) => {
      const rotatedX =
        localX * Math.cos(triplet.angle) - localY * Math.sin(triplet.angle);
      const rotatedY =
        localX * Math.sin(triplet.angle) + localY * Math.cos(triplet.angle);
      layout.push({
        index: 96 + tripletIndex * 3 + position,
        x: 50 + Math.cos(triplet.angle) * triplet.radius + rotatedX,
        y: 50 + Math.sin(triplet.angle) * triplet.radius + rotatedY,
        isSeam: true,
      });
    });
  });

  return layout.sort((a, b) => a.index - b.index);
})();
const PIXEL_NORMALS: [number, number, number][] = PIXEL_LAYOUT.map((pixel) => {
  const polar = THREE.MathUtils.lerp(0.04, Math.PI / 2 - 0.045, pixel.radius);
  return normalizeVector(
    Math.sin(polar) * Math.cos(pixel.angle),
    Math.cos(polar),
    Math.sin(polar) * Math.sin(pixel.angle),
  );
});
function getBurstIncidence(pixelIndex: number, sourcePixelIndex: number) {
  const pixelNormal = PIXEL_NORMALS[pixelIndex];
  const sourceDirection = PIXEL_NORMALS[sourcePixelIndex];
  return Math.max(
    0,
    pixelNormal[0] * sourceDirection[0] +
      pixelNormal[1] * sourceDirection[1] +
      pixelNormal[2] * sourceDirection[2],
  );
}

function getBurstFootprint(sourcePixelIndex: number, pixelCount: number) {
  return PIXEL_LAYOUT
    .map((pixel) => ({
      index: pixel.index,
      incidence: getBurstIncidence(pixel.index, sourcePixelIndex),
    }))
    .sort((a, b) => b.incidence - a.incidence)
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
  selectedPixel,
  sunDirection,
  moonDirection,
  sunNoise,
  moonNoise,
  earthIllumination,
  earthAlbedoNoise,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
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
  selectedPixel: number;
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  sunNoise: number;
  moonNoise: number;
  earthIllumination: number;
  earthAlbedoNoise: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
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
    selectedPixel,
    sunDirection,
    moonDirection,
    sunNoise,
    moonNoise,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
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
      selectedPixel,
      sunDirection,
      moonDirection,
      sunNoise,
      moonNoise,
      earthIllumination,
      earthAlbedoNoise,
      earthAlbedoAzimuth,
      earthAlbedoDirectional,
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
    selectedPixel,
    sunDirection,
    moonDirection,
    sunNoise,
    moonNoise,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
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
    const pixelGeometry = new THREE.CylinderGeometry(0.0135, 0.015, 0.025, 6, 1, false);
    const pixelMaterials = PIXEL_LAYOUT.map((pixel) =>
      new THREE.MeshStandardMaterial({
        color: pixel.ring % 2 === 0 ? 0x4edfd4 : 0x54bedf,
        emissive: 0x086f79,
        emissiveIntensity: 0.65,
        metalness: 0.18,
        roughness: 0.3,
      }),
    );
    const upAxis = new THREE.Vector3(0, 1, 0);
    const crystalPixels = PIXEL_LAYOUT.map((pixel) => {
      const normal = new THREE.Vector3().fromArray(PIXEL_NORMALS[pixel.index]);
      const crystal = new THREE.Mesh(pixelGeometry, pixelMaterials[pixel.index]);
      crystal.position.copy(normal).multiplyScalar(0.173);
      crystal.quaternion.setFromUnitVectors(upAxis, normal.clone());
      crystal.userData.pixelIndex = pixel.index;
      crystal.userData.pixelId = pixel.id;
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
        const layout = PIXEL_LAYOUT[index];
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
        material.color.setHex(
          isOverlap
            ? 0xf4e9ff
            : isFired && isBurstPath
            ? 0xff4dbe
            : isFired && isEarthPath
              ? 0x7fd8ff
              : isFired
                ? 0x76efe0
                : isSelected
                  ? 0x665326
                  : layout.ring % 2 === 0
                    ? 0x24494e
                    : 0x24424c,
        );
        material.emissive.setHex(
          isOverlap
            ? 0x76539b
            : isFired && isBurstPath
            ? 0x8d124f
            : isFired && isEarthPath
              ? 0x155d83
              : isFired
                ? 0x0b766f
                : isSelected
                  ? 0x2a2105
                  : 0x03191d,
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
            ? 0.28
            : 0.12;
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
          .fromArray(PIXEL_NORMALS[directionPixel])
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
      pixelGeometry.dispose();
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
        for (let side = 0; side < 6; side += 1) {
          const angle = (side / 6) * Math.PI * 2 + Math.PI / 6;
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
  selectedPixel: number;
  earthIllumination: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
  mountX: number;
  mountZ: number;
  onSelect: (index: number) => void;
}) {
  const activeCluster = PIXEL_LAYOUT
    .filter((pixel) => (hits[pixel.index] ?? 0) > 0)
    .sort((a, b) => (hits[b.index] ?? 0) - (hits[a.index] ?? 0));
  const totalHits = hits.reduce((sum, value) => sum + value, 0);
  const selectedValue = values[selectedPixel] ?? 0;
  const selectedHits = hits[selectedPixel] ?? 0;
  const depositedEnergy =
    selectedHits > 0
      ? Math.round(8 + selectedValue * (grbActive ? 980 : 190))
      : 0;
  const upEnergy = Math.round(depositedEnergy * 0.61);
  const downEnergy = depositedEnergy - upEnergy;
  const [projection, setProjection] = useState<"dome" | "unfolded">("dome");

  return (
    <div className={`detector-module projection-${projection}`}>
      <div className="detector-projection-tabs">
        <div role="group" aria-label="Detector projection">
          <button
            type="button"
            className={projection === "dome" ? "active" : ""}
            aria-pressed={projection === "dome"}
            onClick={() => setProjection("dome")}
          >
            DOME
          </button>
          <button
            type="button"
            className={projection === "unfolded" ? "active" : ""}
            aria-pressed={projection === "unfolded"}
            onClick={() => setProjection("unfolded")}
          >
            UNFOLDED
          </button>
        </div>
        <span>
          {projection === "unfolded"
            ? "6×16 GRAY · 10×3 RED · PROVISIONAL IDs"
            : "HEMISPHERICAL RESPONSE"}
        </span>
      </div>
      <div
        className={`detector-map projection-${projection} ${
          grbActive ? "is-grb" : ""
        }`}
        aria-label={
          projection === "dome"
            ? "Hemispherical honeycomb map of the 126 pixels"
            : "Unfolded planar map of the 126 pixels with provisional IDs"
        }
      >
        {PIXEL_LAYOUT.map((pixel) => {
          const unfoldedPosition = UNFOLDED_PIXEL_LAYOUT[pixel.index];
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
              key={pixel.id}
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
                projection === "unfolded" && unfoldedPosition.isSeam
                  ? "is-unfolding-seam"
                  : ""
              }`}
              style={{
                "--heat": Math.min(1, value).toFixed(4),
                "--pixel-x":
                  projection === "dome"
                    ? `${50 + Math.cos(pixel.angle) * pixel.radius * 44}%`
                    : `${unfoldedPosition.x}%`,
                "--pixel-y":
                  projection === "dome"
                    ? `${50 + Math.sin(pixel.angle) * pixel.radius * 44}%`
                    : `${unfoldedPosition.y}%`,
                "--delay": `${(pixel.index % 17) * 24}ms`,
              } as React.CSSProperties}
              title={`${pixel.id}${
                projection === "unfolded" ? " · provisional position" : ""
              } · ${hitCount} photons detected in the current bin`}
              aria-label={`${pixel.id}, ${hitCount} photons detected`}
              onClick={() => onSelect(pixel.index)}
            >
              {String(pixel.index + 1).padStart(3, "0")}
            </button>
          );
        })}
        {projection === "dome" ? (
          <div className="detector-axis"><i /> Z</div>
        ) : (
          <>
            <div className="detector-axis unfolded-x"><i /> X</div>
            <div className="detector-axis unfolded-y"><i /> Y</div>
          </>
        )}
      </div>

      <div className="cluster-readout">
        <div className="cluster-heading">
          <span>
            <small>ACTIVE PIXELS · DETECTED HITS</small>
            <strong>{activeCluster.length} / 126</strong>
          </span>
          <em>Σ {totalHits} photons · Edep &gt; 30 keV</em>
        </div>
        <div className="cluster-ids">
          {activeCluster.length > 0 ? (
            activeCluster.map((pixel) => (
              <button
                key={pixel.id}
                type="button"
                className={pixel.index === selectedPixel ? "selected" : ""}
                onClick={() => onSelect(pixel.index)}
              >
                {pixel.id}
              </button>
            ))
          ) : (
            <span>no pixels selected by the trigger</span>
          )}
        </div>
      </div>

      <div className="pixel-detail">
        <div className="pixel-id-block">
          <small>SELECTED PIXEL</small>
          <strong>{PIXEL_LAYOUT[selectedPixel].id}</strong>
          <span>
            {selectedHits} hit · ring {PIXEL_LAYOUT[selectedPixel].ring} · slot{" "}
            {PIXEL_LAYOUT[selectedPixel].slot + 1}
          </span>
        </div>
        <div className="pixel-stack" aria-label="Selected pixel structure">
          <span className="pixel-layer up"><b>UP · GAGG</b><em>4 cm · {upEnergy} keV</em></span>
          <i className="pixel-sipm">SiPM</i>
          <span className="pixel-layer down"><b>DOWN · LYSO</b><em>3 cm · {downEnergy} keV</em></span>
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
  const [placementOpen, setPlacementOpen] = useState(false);
  const [mountX, setMountX] = useState(0);
  const [mountZ, setMountZ] = useState(0);
  const [epochMs, setEpochMs] = useState(() => Date.now());
  const [selectedPixel, setSelectedPixel] = useState(43);
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [samples, setSamples] = useState<Sample[]>(() =>
    Array.from({ length: 80 }, () => ({
      background: INITIAL_TELEMETRY.background,
      source: 0,
      observed: INITIAL_TELEMETRY.background,
    })),
  );
  const [eventLog, setEventLog] = useState([
    { time: "T+00:00", text: "Science acquisition started", kind: "system" },
    { time: "T+00:00", text: "Orbital background model initialized", kind: "background" },
  ]);
  const phaseRef = useRef(INITIAL_TELEMETRY.phase);
  const elapsedRef = useRef(0);
  const activeBurstsRef = useRef<BurstEvent[]>([]);
  const nextBurstIdRef = useRef(1);
  const totalRef = useRef(0);
  const capturedRef = useRef(0);
  const selectedPixelRef = useRef(43);
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
              burst.transmission *
              Math.exp(-burst.ageTicks / 5.5),
          0,
        ),
      );
      const observed = background + source;
      totalRef.current += observed;
      capturedRef.current += source;
      const detectorHits = PIXEL_LAYOUT.map((pixel) => {
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
        activeBursts.forEach((burst) => {
          if (!burst.pixelIndices.includes(pixel.index)) return;
          const incidence = getBurstIncidence(pixel.index, burst.pixelIndex);
          const burstAmplitude = 6.2 * Math.exp(-burst.ageTicks / 6);
          const mountVisibility = getMountSkyVisibility(
            pixel.index,
            settings.mountX,
            settings.mountZ,
          );
          hits += Math.max(
            1,
            Math.round(
              burstAmplitude *
                incidence ** 2.2 *
                mountVisibility,
            ),
          );
        });
        return hits;
      });
      const maxPixelHits = Math.max(1, ...detectorHits);
      const detector = detectorHits.map((hits) =>
        hits > 0 ? Math.min(1, 0.3 + (hits / maxPixelHits) * 0.7) : 0,
      );
      const next = { observed, background, source };
      setSamples((current) => [...current.slice(-119), next]);
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

  const injectGRB = useCallback(() => {
    const targetPixel = Math.floor(Math.random() * PIXEL_LAYOUT.length);
    const footprintCount = 4 + Math.floor(Math.random() * 25);
    const geometricFootprint = getBurstFootprint(targetPixel, footprintCount);
    const visibilityByPixel = geometricFootprint.map((pixelIndex) => ({
      pixelIndex,
      visibility: getMountSkyVisibility(
        pixelIndex,
        settingsRef.current.mountX,
        settingsRef.current.mountZ,
      ),
    }));
    let pixelIndices = visibilityByPixel
      .filter(({ visibility }) => visibility >= 0.12)
      .map(({ pixelIndex }) => pixelIndex);
    if (pixelIndices.length === 0) {
      pixelIndices = [
        visibilityByPixel.sort((a, b) => b.visibility - a.visibility)[0].pixelIndex,
      ];
    }
    const transmission =
      visibilityByPixel.reduce((sum, pixel) => sum + pixel.visibility, 0) /
      visibilityByPixel.length;
    selectPixel(targetPixel);
    const burstId = nextBurstIdRef.current;
    nextBurstIdRef.current += 1;
    activeBurstsRef.current = [
      ...activeBurstsRef.current,
      {
        id: burstId,
        pixelIndex: targetPixel,
        pixelIndices,
        transmission,
        ageTicks: 0,
        ticksRemaining: BURST_DURATION_TICKS,
      },
    ];
    setEventLog((current) => [
      ...current.slice(-4),
      {
        time: `T+${formatTime(elapsedRef.current).slice(3)}`,
        text: `GRB #${burstId} · direction ${PIXEL_LAYOUT[targetPixel].id} · ${pixelIndices.length}/${footprintCount} pixels visible`,
        kind: "grb",
      },
    ]);
  }, [selectPixel]);

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
    setEventLog([
      { time: "T+00:00", text: "Simulation reset", kind: "system" },
      { time: "T+00:00", text: "Science acquisition started", kind: "background" },
    ]);
  }, [altitude, inclination, mountX, mountZ, selectPixel]);

  const orbitPeriod = useMemo(() => {
    const earthRadius = 6371;
    const gravitationalParameter = 398600.4418;
    return (2 * Math.PI * Math.sqrt(((earthRadius + altitude) ** 3) / gravitationalParameter)) / 60;
  }, [altitude]);

  const occulted = Math.cos(telemetry.phase) < -0.45;
  const captureRate = telemetry.total > 0 ? (telemetry.captured / telemetry.total) * 100 : 0;
  const effectiveMountFov = useMemo(() => {
    return getMountEffectiveFov(mountX, mountZ);
  }, [mountX, mountZ]);
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
            onClick={() => setPlacementOpen(true)}
          >
            <SlidersHorizontal size={14} />
            PAYLOAD PLACEMENT
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

      {placementOpen && (
        <PayloadPlacementPanel
          mountX={mountX}
          mountZ={mountZ}
          onMountChange={(x, z) => {
            setMountX(THREE.MathUtils.clamp(x, -1, 1));
            setMountZ(THREE.MathUtils.clamp(z, -1, 1));
          }}
          onClose={() => setPlacementOpen(false)}
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

          <div className="control-section">
            <div className="section-label">PAYLOAD</div>
            <div className="payload-card">
              <div className="payload-visual">
                <div className="payload-dome">
                  {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
                </div>
                <div className="payload-bus" />
              </div>
              <div>
                <strong>Crystal Eye · Model 8</strong>
                <span>Ø 30 cm · hemisphere</span>
                <span>10 keV – 30 MeV</span>
                <span>126 pixel · SiPM array</span>
                <span>mount X {Math.round(mountX * 30)} cm · Z {Math.round(mountZ * 30)} cm</span>
              </div>
            </div>
          </div>

          <div className="control-section grow">
            <div className="section-label">OBSERVATION STATUS</div>
            <div className={`observation-state ${occulted ? "occulted" : ""}`}>
              <div className="state-icon"><Satellite size={19} /></div>
              <div>
                <small>EARTH OCCULTATION</small>
                <strong>{occulted ? "Source occulted" : "Field visible"}</strong>
              </div>
              <ChevronRight size={16} />
            </div>
            <div className="coordinates">
              <span>LAT <b>{telemetry.latitude >= 0 ? "N" : "S"} {Math.abs(telemetry.latitude).toFixed(2)}°</b></span>
              <span>LON <b>{telemetry.longitude >= 0 ? "E" : "W"} {Math.abs(telemetry.longitude).toFixed(2)}°</b></span>
            </div>
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
            selectedPixel={selectedPixel}
            sunDirection={telemetry.sunDirection}
            moonDirection={telemetry.moonDirection}
            sunNoise={telemetry.sunNoise}
            moonNoise={telemetry.moonNoise}
            earthIllumination={telemetry.earthIllumination}
            earthAlbedoNoise={telemetry.earthAlbedoNoise}
            earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
            earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
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
        </section>

        <aside className="control-panel right-panel">
          <div className="panel-heading">
            <span>PHOTON STREAM</span>
            <Activity size={17} />
          </div>

          <div className="photon-summary">
            <div className="primary-count">
              <small>COUNTS / 0.2 s</small>
              <strong>{telemetry.observed}</strong>
              <span className={telemetry.grbActive ? "hot" : ""}>
                {telemetry.grbActive ? "burst in progress" : "nominal stream"}
              </span>
            </div>
            <div className="stat-stack">
              <div><span className="legend-dot background-dot" /><small>BACKGROUND</small><strong>{telemetry.background}</strong></div>
              <div><span className="legend-dot source-dot" /><small>GRB EXCESS</small><strong>{telemetry.source}</strong></div>
            </div>
          </div>

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
            <div className="chart-header">
              <div>
                <small>DETECTOR RESPONSE</small>
                <strong>Hits above threshold · 0.2 s bin</strong>
              </div>
              <span>
                {telemetry.detectorHits.filter((hits) => hits > 0).length} PX ON
              </span>
            </div>
            <DetectorMap
              values={telemetry.detector}
              hits={telemetry.detectorHits}
              grbActive={telemetry.grbActive}
              burstPixelGroups={telemetry.burstPixelGroups}
              selectedPixel={selectedPixel}
              earthIllumination={telemetry.earthIllumination}
              earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
              earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
              mountX={mountX}
              mountZ={mountZ}
              onSelect={selectPixel}
            />
          </div>

          <div className="analysis-grid">
            <div>
              <Gauge size={15} />
              <span><small>SIGNIFICANCE</small><strong>{telemetry.significance.toFixed(2)}σ</strong></span>
            </div>
            <div>
              <Atom size={15} />
              <span><small>CAPTURE RATIO</small><strong>{captureRate.toFixed(2)}%</strong></span>
            </div>
          </div>

          <button className="grb-button" onClick={injectGRB}>
            <Sparkles size={17} />
            <span>
              <strong>INJECT GAMMA RAY BURST</strong>
              <small>
                random direction · 4–28 pixels · active{" "}
                {telemetry.burstDirections.length} · duration ≈ 3 s
              </small>
            </span>
          </button>
        </aside>
      </section>

      <footer className="bottom-panel">
        <div className="footer-label">
          <CircleDot size={15} />
          <span>EVENT LOG</span>
        </div>
        <div className="event-stream">
          {eventLog.map((event, index) => (
            <div key={`${event.time}-${index}`} className={`event-item ${event.kind}`}>
              <time>{event.time}</time>
              <i />
              <span>{event.text}</span>
            </div>
          ))}
        </div>
        <div className="data-model">
          <span>DATA MODEL</span>
          <strong>time × pixel × energy</strong>
        </div>
      </footer>
    </main>
  );
}
