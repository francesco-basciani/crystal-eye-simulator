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
  Sparkles,
  Sun,
  Moon,
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
  detector: number[];
  simulatedDate: string;
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  sunSeparation: number;
  moonSeparation: number;
  sunNoise: number;
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
const PIXEL_NORMALS: [number, number, number][] = PIXEL_LAYOUT.map((pixel) => {
  const polar = THREE.MathUtils.lerp(0.04, Math.PI / 2 - 0.045, pixel.radius);
  return normalizeVector(
    Math.sin(polar) * Math.cos(pixel.angle),
    Math.cos(polar),
    Math.sin(polar) * Math.sin(pixel.angle),
  );
});
const BURST_FOOTPRINT_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(38));

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

function isPixelOnBurstFootprint(pixelIndex: number, sourcePixelIndex: number) {
  return getBurstIncidence(pixelIndex, sourcePixelIndex) >= BURST_FOOTPRINT_THRESHOLD;
}

function getEarthAlbedoResponse(
  pixelIndex: number,
  illumination: number,
  azimuth: number,
  directional: number,
) {
  const pixel = PIXEL_LAYOUT[pixelIndex];
  const rimWeight = THREE.MathUtils.clamp((pixel.ring - 4) / 2, 0, 1) ** 1.25;
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
  return rimWeight * illumination * azimuthWeight;
}

function isPixelLitByEarthAlbedo(
  pixelIndex: number,
  illumination: number,
  azimuth: number,
  directional: number,
) {
  return getEarthAlbedoResponse(
    pixelIndex,
    illumination,
    azimuth,
    directional,
  ) >= 0.12;
}

const SIMULATION_EPOCH_MS = Date.UTC(2026, 6, 23, 12, 0, 0);
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

function getCelestialGeometry(
  elapsedSeconds: number,
  phase: number,
  inclination: number,
  altitude: number,
) {
  const date = new Date(SIMULATION_EPOCH_MS + elapsedSeconds * 1000);
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
  const sunNoise = sunInFov ? 115 * angularResponse(sunSeparation) : 0;
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

const INITIAL_TELEMETRY: Telemetry = {
  observed: 421,
  background: 414,
  source: 7,
  elapsed: 0,
  phase: 0.72,
  latitude: 13.2,
  longitude: 41.3,
  total: 0,
  captured: 0,
  significance: 0.34,
  grbActive: false,
  detector: Array.from({ length: 126 }, (_, index) =>
    Math.max(0, Math.sin(index * 0.63) * 0.18 + 0.2),
  ),
  simulatedDate: INITIAL_CELESTIAL.date.toISOString(),
  sunDirection: INITIAL_CELESTIAL.sunDirection,
  moonDirection: INITIAL_CELESTIAL.moonDirection,
  sunSeparation: INITIAL_CELESTIAL.sunSeparation,
  moonSeparation: INITIAL_CELESTIAL.moonSeparation,
  sunNoise: INITIAL_CELESTIAL.sunNoise,
  moonNoise: INITIAL_CELESTIAL.moonNoise,
  sunInFov: INITIAL_CELESTIAL.sunInFov,
  moonInFov: INITIAL_CELESTIAL.moonInFov,
  moonDistanceKm: INITIAL_CELESTIAL.moonDistanceKm,
  moonPhase: INITIAL_CELESTIAL.moonPhase,
  earthIllumination: INITIAL_CELESTIAL.earthIllumination,
  earthAlbedoNoise: INITIAL_CELESTIAL.earthAlbedoNoise,
  earthAlbedoAzimuth: INITIAL_CELESTIAL.earthAlbedoAzimuth,
  earthAlbedoDirectional: INITIAL_CELESTIAL.earthAlbedoDirectional,
};

function poissonLike(mean: number) {
  const u = Math.max(1e-7, Math.random());
  const v = Math.max(1e-7, Math.random());
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal));
}

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
  selectedPixel,
  sunDirection,
  moonDirection,
  sunNoise,
  moonNoise,
  earthIllumination,
  earthAlbedoNoise,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
}: {
  altitude: number;
  inclination: number;
  speed: number;
  paused: boolean;
  phase: number;
  grbActive: boolean;
  selectedPixel: number;
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  sunNoise: number;
  moonNoise: number;
  earthIllumination: number;
  earthAlbedoNoise: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef({
    altitude,
    inclination,
    speed,
    paused,
    phase,
    grbActive,
    selectedPixel,
    sunDirection,
    moonDirection,
    sunNoise,
    moonNoise,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
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
      selectedPixel,
      sunDirection,
      moonDirection,
      sunNoise,
      moonNoise,
      earthIllumination,
      earthAlbedoNoise,
      earthAlbedoAzimuth,
      earthAlbedoDirectional,
      phaseUpdatedAt: performance.now(),
    };
  }, [
    altitude,
    inclination,
    speed,
    paused,
    phase,
    grbActive,
    selectedPixel,
    sunDirection,
    moonDirection,
    sunNoise,
    moonNoise,
    earthIllumination,
    earthAlbedoNoise,
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
  ]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02070d, 0.045);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0.2, 2.3, 8.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x02070d, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x4f7191, 0.38);
    const sunLight = new THREE.DirectionalLight(0xfff4dc, 3.8);
    sunLight.position.set(-5, 3, 5);
    scene.add(ambient, sunLight);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(1500 * 3);
    for (let index = 0; index < 1500; index += 1) {
      const radius = 14 + Math.random() * 22;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
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
      textureLoader.load("/textures/earth/day.jpg"),
      true,
    );
    const earthNightTexture = prepareTexture(
      textureLoader.load("/textures/earth/night.png"),
      true,
    );
    const earthNormalTexture = prepareTexture(
      textureLoader.load("/textures/earth/normal.jpg"),
    );
    const earthSpecularTexture = prepareTexture(
      textureLoader.load("/textures/earth/specular.jpg"),
    );
    const earthCloudTexture = prepareTexture(
      textureLoader.load("/textures/earth/clouds.png"),
      true,
    );

    const earthGeometry = new THREE.SphereGeometry(2.05, 128, 96);
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
      new THREE.SphereGeometry(2.056, 128, 96),
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
      new THREE.SphereGeometry(2.075, 128, 96),
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
      new THREE.SphereGeometry(2.17, 96, 72),
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
    const bus = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.22, 0.3), busMaterial);
    satelliteGroup.add(bus);
    const domeShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      detectorShellMaterial,
    );
    domeShell.position.y = 0.155;
    satelliteGroup.add(domeShell);

    const pixelGroup = new THREE.Group();
    pixelGroup.position.y = 0.155;
    satelliteGroup.add(pixelGroup);
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
    satelliteGroup.add(base);
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

    const particleCount = 220;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    const particleLife = new Float32Array(particleCount);
    const particleSeed = new Float32Array(particleCount * 3);
    const cyan = new THREE.Color(0x62d9ff);
    const amber = new THREE.Color(0xffc857);
    const magenta = new THREE.Color(0xff4dbe);
    for (let index = 0; index < particleCount; index += 1) {
      particleLife[index] = Math.random();
      particleSeed[index * 3] = (Math.random() - 0.5) * 2;
      particleSeed[index * 3 + 1] = (Math.random() - 0.5) * 2;
      particleSeed[index * 3 + 2] = (Math.random() - 0.5) * 2;
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
    let distance = 8.6;
    const onPointerDown = (event: PointerEvent) => {
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
      distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.006, 5.2, 12);
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
      outwardLocal.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
      satelliteGroup.quaternion.setFromUnitVectors(upAxis, outwardLocal);
      satelliteGroup.getWorldPosition(satWorld);
      satelliteGroup.getWorldQuaternion(satelliteWorldQuaternion);
      burstWorldDirection
        .fromArray(PIXEL_NORMALS[settings.selectedPixel])
        .applyQuaternion(satelliteWorldQuaternion)
        .normalize();

      sunSceneDirection.fromArray(settings.sunDirection).normalize();
      moonSceneDirection.fromArray(settings.moonDirection).normalize();
      sunBody.position.copy(sunSceneDirection).multiplyScalar(12.5);
      sunLight.position.copy(sunSceneDirection).multiplyScalar(9);
      sunLight.intensity = 2.7 + Math.min(1.2, settings.sunNoise / 90);
      nightMaterial.uniforms.lightDirection.value.copy(sunSceneDirection);
      atmosphereMaterial.uniforms.lightDirection.value.copy(sunSceneDirection);
      moonBody.position.copy(moonSceneDirection).multiplyScalar(5.4);

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
        const isBurstCluster =
          settings.grbActive &&
          isPixelOnBurstFootprint(index, settings.selectedPixel);
        const albedoResponse = getEarthAlbedoResponse(
          index,
          settings.earthIllumination,
          settings.earthAlbedoAzimuth,
          settings.earthAlbedoDirectional,
        );
        const isEarthAlbedo =
          !isBurstCluster &&
          isPixelLitByEarthAlbedo(
            index,
            settings.earthIllumination,
            settings.earthAlbedoAzimuth,
            settings.earthAlbedoDirectional,
          );
        material.color.setHex(
          isBurstCluster
            ? 0xff4dbe
            : isEarthAlbedo
              ? 0x7fd8ff
            : isSelected
              ? 0xffc857
              : layout.ring % 2 === 0
                ? 0x4edfd4
                : 0x54bedf,
        );
        material.emissive.setHex(
          isBurstCluster
            ? 0x8d124f
            : isEarthAlbedo
              ? 0x155d83
              : isSelected
                ? 0x8a5f0b
                : 0x086f79,
        );
        material.emissiveIntensity = isBurstCluster
          ? 2.2
          : isEarthAlbedo
            ? 0.9 + albedoResponse * 2.1
            : isSelected
              ? 1.8
              : 0.65;
        crystal.scale.setScalar(
          isBurstCluster ? 1.13 : isEarthAlbedo ? 1.04 + albedoResponse * 0.05 : isSelected ? 1.08 : 1,
        );
      });

      for (let index = 0; index < particleCount; index += 1) {
        if (!settings.paused) {
          particleLife[index] -= delta * (0.22 + settings.speed * 0.015);
          if (particleLife[index] <= 0) particleLife[index] = 1;
        }
        const life = particleLife[index];
        const isGRB = settings.grbActive && index % 4 === 0;
        const isSource = index % 11 === 0 || isGRB;
        const spread = isGRB ? 0.35 : isSource ? 1.2 : 2.8;
        const travel = 0.12 + life * (isGRB ? 4.8 : isSource ? 3.4 : 2.6);
        if (isGRB) {
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
        } else {
          particlePositions[index * 3] =
            satWorld.x + travel + particleSeed[index * 3] * spread;
          particlePositions[index * 3 + 1] =
            satWorld.y + particleSeed[index * 3 + 1] * spread * life;
          particlePositions[index * 3 + 2] =
            satWorld.z + particleSeed[index * 3 + 2] * spread * life;
        }
        const color = isGRB ? magenta : isSource ? amber : cyan;
        particleColors[index * 3] = color.r;
        particleColors[index * 3 + 1] = color.g;
        particleColors[index * 3 + 2] = color.b;
      }
      particleGeometry.attributes.position.needsUpdate = true;
      particleGeometry.attributes.color.needsUpdate = true;

      if (!dragging) yaw += settings.paused ? 0 : delta * 0.018;
      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance,
        Math.cos(yaw) * Math.cos(pitch) * distance,
      );
      camera.lookAt(0, 0, 0);
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
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="globe-scene" ref={mountRef} aria-label="Simulazione tridimensionale dell’orbita">
      <div className="scene-hud scene-hud-top">
        <span className="hud-tag"><CircleDot size={12} /> ORBITA LEO</span>
        <span>{altitude} km</span>
        <span>{inclination}° inc.</span>
      </div>
      <div className="scene-hud scene-hud-bottom">
        <span><span className="legend-dot background-dot" /> background</span>
        <span><span className="legend-dot albedo-dot" /> albedo Terra</span>
        <span><span className="legend-dot source-dot" /> sorgente</span>
        <span><span className="legend-dot grb-dot" /> GRB</span>
      </div>
      <div className="celestial-scene-status">
        <span className={sunNoise > 0 ? "interfering" : ""}>
          <Sun size={12} /> Sole {sunNoise > 0 ? `+${sunNoise.toFixed(0)} c/s` : "fuori cono"}
        </span>
        <span className={moonNoise > 0 ? "interfering moon" : ""}>
          <Moon size={12} /> Luna {moonNoise > 0 ? `+${moonNoise.toFixed(0)} c/s` : "fuori cono"}
        </span>
        <span className={earthAlbedoNoise > 1 ? "interfering earth" : ""}>
          <CircleDot size={12} /> Albedo Terra {earthAlbedoNoise > 1 ? `+${earthAlbedoNoise.toFixed(0)} c/s` : "minimo"}
        </span>
      </div>
      <div className="drag-hint">trascina per ruotare · scorri per zoom</div>
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
      key: keyof Sample,
      color: string,
      lineWidth: number,
      fill?: string,
    ) => {
      context.beginPath();
      data.forEach((point, index) => {
        const x = (index / Math.max(1, data.length - 1)) * width;
        const y = height - (point[key] / max) * (height - 8) - 4;
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
          const y = height - (point[key] / max) * (height - 8) - 4;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
      }
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.stroke();
    };

    drawSeries("observed", "#62d9ff", 1.5, "rgba(52, 181, 223, 0.08)");
    drawSeries("background", "rgba(154, 178, 191, 0.78)", 1);
    drawSeries("source", "#ffc857", 1.5);
  }, [data]);

  return <canvas ref={canvasRef} className="signal-canvas" aria-label="Serie temporale dei conteggi" />;
}

type SensorViewMode = "sky" | "mask" | "events";

function SensorView({
  phase,
  inclination,
  sunDirection,
  moonDirection,
  sunInFov,
  moonInFov,
  moonPhase,
  detector,
  selectedPixel,
  grbActive,
  earthIllumination,
  earthAlbedoNoise,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
}: {
  phase: number;
  inclination: number;
  sunDirection: [number, number, number];
  moonDirection: [number, number, number];
  sunInFov: boolean;
  moonInFov: boolean;
  moonPhase: number;
  detector: number[];
  selectedPixel: number;
  grbActive: boolean;
  earthIllumination: number;
  earthAlbedoNoise: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
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
        (theta / THREE.MathUtils.degToRad(EFFECTIVE_HALF_ANGLE_DEG)) * radius;
      return {
        visible: theta <= THREE.MathUtils.degToRad(EFFECTIVE_HALF_ANGLE_DEG),
        x: cx + (dot(direction, right) / sinTheta) * projectedRadius,
        y: cy - (dot(direction, up) / sinTheta) * projectedRadius,
        angle: theta,
      };
    };
    const sun = project(sunDirection);
    const moon = project(moonDirection);
    const selected = PIXEL_LAYOUT[selectedPixel];

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
        context.fillText("BACKGROUND DIFFUSO", cx - radius + 11, cy - radius + 17);
      }
    }

    if (earthAlbedoNoise > 1) {
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
        context.fillText("ALBEDO TERRA", labelX, labelY);
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
        const x = cx + Math.cos(pixel.angle) * pixel.radius * radius * 0.88;
        const y = cy + Math.sin(pixel.angle) * pixel.radius * radius * 0.88;
        const cellRadius = Math.max(2.2, radius * (0.036 - pixel.ring * 0.0008));
        const isSelected = pixel.index === selectedPixel;
        const isOnBurstFootprint =
          grbActive && isPixelOnBurstFootprint(pixel.index, selectedPixel);
        const isOnEarthAlbedo =
          isPixelLitByEarthAlbedo(
            pixel.index,
            earthIllumination,
            earthAlbedoAzimuth,
            earthAlbedoDirectional,
          );
        context.beginPath();
        for (let side = 0; side < 6; side += 1) {
          const angle = (side / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(angle) * cellRadius;
          const py = y + Math.sin(angle) * cellRadius;
          if (side === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.fillStyle = isOnBurstFootprint
          ? `rgba(255, 77, 190, ${0.38 + value * 0.62})`
          : isOnEarthAlbedo
            ? `rgba(112, 215, 255, ${0.28 + value * 0.68})`
            : `rgba(71, 208, 232, ${0.12 + value * 0.78})`;
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
          context.fillText("SOLE", sun.x, sun.y - radius * 0.055);
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
          context.fillText("LUNA", moon.x, moon.y - radius * 0.05);
        }
      }
      if (grbActive) {
        const burstX = cx + Math.cos(selected.angle) * selected.radius * radius * 0.78;
        const burstY = cy + Math.sin(selected.angle) * selected.radius * radius * 0.78;
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
          context.fillText("GRB", burstX, burstY - 10);
        }
      }
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
    earthAlbedoAzimuth,
    earthAlbedoDirectional,
    earthAlbedoNoise,
    earthIllumination,
    grbActive,
    inclination,
    mode,
    moonDirection,
    moonPhase,
    moonInFov,
    phase,
    selectedPixel,
    sunDirection,
    sunInFov,
  ]);

  return (
    <section className="sensor-view" aria-label="Vista istantanea del campo del Crystal Eye">
      <div className="sensor-view-header">
        <div>
          <small>CRYSTAL EYE VIEW</small>
          <strong>FOV istantaneo · {EFFECTIVE_FOV_DEG}°</strong>
        </div>
        <span><i /> LIVE</span>
      </div>
      <div className="sensor-view-tabs" role="group" aria-label="Modalità della vista sensore">
        {([
          ["sky", "Cielo"],
          ["mask", "Maschera"],
          ["events", "Eventi"],
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
        <canvas ref={canvasRef} />
        <span className="sensor-north">+Y</span>
        <span className="sensor-earth-shield">TERRA DIETRO IL PAYLOAD</span>
      </div>
      <div className="sensor-view-footer">
        <span className={sunInFov ? "active sun" : ""}><i /> Sole</span>
        <span className={moonInFov ? "active moon" : ""}><i /> Luna</span>
        <span className={earthAlbedoNoise > 1 ? "active earth" : ""}><i /> Terra</span>
        <span className={grbActive ? "active grb" : ""}><i /> GRB</span>
        <em>{mode === "events" ? "risposta per pixel" : "ricostruzione · non RGB"}</em>
      </div>
    </section>
  );
}

function DetectorMap({
  values,
  grbActive,
  selectedPixel,
  earthIllumination,
  earthAlbedoNoise,
  earthAlbedoAzimuth,
  earthAlbedoDirectional,
  onSelect,
}: {
  values: number[];
  grbActive: boolean;
  selectedPixel: number;
  earthIllumination: number;
  earthAlbedoNoise: number;
  earthAlbedoAzimuth: number;
  earthAlbedoDirectional: number;
  onSelect: (index: number) => void;
}) {
  const activeCluster = (
    grbActive
      ? PIXEL_LAYOUT.filter((pixel) =>
          isPixelOnBurstFootprint(pixel.index, selectedPixel),
        )
      : earthAlbedoNoise > 1
        ? PIXEL_LAYOUT.filter((pixel) =>
            isPixelLitByEarthAlbedo(
              pixel.index,
              earthIllumination,
              earthAlbedoAzimuth,
              earthAlbedoDirectional,
            ),
          )
      : PIXEL_LAYOUT.filter((pixel) => values[pixel.index] > 0.42).slice(0, 8)
  ).sort((a, b) => values[b.index] - values[a.index]);
  const selectedValue = values[selectedPixel] ?? 0;
  const depositedEnergy = Math.round(8 + selectedValue * (grbActive ? 980 : 190));
  const upEnergy = Math.round(depositedEnergy * 0.61);
  const downEnergy = depositedEnergy - upEnergy;

  return (
    <div className="detector-module">
      <div
        className={`detector-map ${grbActive ? "is-grb" : ""}`}
        aria-label="Mappa emisferica a nido d’ape dei 126 pixel"
      >
        {PIXEL_LAYOUT.map((pixel) => {
          const value = values[pixel.index] ?? 0;
          const isActive = activeCluster.some((active) => active.index === pixel.index);
          const isEarthAlbedo =
            !grbActive &&
            isPixelLitByEarthAlbedo(
              pixel.index,
              earthIllumination,
              earthAlbedoAzimuth,
              earthAlbedoDirectional,
            );
          return (
            <button
              key={pixel.id}
              type="button"
              className={`detector-pixel ${isActive ? "is-active" : ""} ${
                isEarthAlbedo ? "is-albedo" : ""
              } ${
                selectedPixel === pixel.index ? "is-selected" : ""
              }`}
              style={{
                "--heat": Math.min(1, value).toFixed(4),
                "--pixel-x": `${50 + Math.cos(pixel.angle) * pixel.radius * 44}%`,
                "--pixel-y": `${50 + Math.sin(pixel.angle) * pixel.radius * 44}%`,
                "--delay": `${(pixel.index % 17) * 24}ms`,
              } as React.CSSProperties}
              title={`${pixel.id} · ${(value * 100).toFixed(0)}% · ${Math.round(8 + value * 190)} keV`}
              aria-label={`${pixel.id}, risposta ${(value * 100).toFixed(0)} per cento`}
              onClick={() => onSelect(pixel.index)}
            >
              {String(pixel.index + 1).padStart(3, "0")}
            </button>
          );
        })}
        <div className="detector-axis"><i /> Z</div>
      </div>

      <div className="cluster-readout">
        <div className="cluster-heading">
          <span>
            <small>
              {grbActive
                ? "PIXEL ILLUMINATI DAL GRB"
                : earthAlbedoNoise > 1
                  ? "PIXEL DA ALBEDO TERRESTRE"
                  : "PIXEL SOPRA SOGLIA"}
            </small>
            <strong>{activeCluster.length} / 126</strong>
          </span>
          <em>Edep &gt; 30 keV</em>
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
            <span>nessun pixel selezionato dal trigger</span>
          )}
        </div>
      </div>

      <div className="pixel-detail">
        <div className="pixel-id-block">
          <small>PIXEL SELEZIONATO</small>
          <strong>{PIXEL_LAYOUT[selectedPixel].id}</strong>
          <span>ring {PIXEL_LAYOUT[selectedPixel].ring} · slot {PIXEL_LAYOUT[selectedPixel].slot + 1}</span>
        </div>
        <div className="pixel-stack" aria-label="Struttura del pixel selezionato">
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

export default function Home() {
  const [altitude, setAltitude] = useState(550);
  const [inclination, setInclination] = useState(20);
  const [speed, setSpeed] = useState(50);
  const [paused, setPaused] = useState(false);
  const [selectedPixel, setSelectedPixel] = useState(43);
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [samples, setSamples] = useState<Sample[]>(() =>
    Array.from({ length: 80 }, (_, index) => ({
      background: 396 + Math.sin(index * 0.12) * 22 + Math.sin(index * 1.73) * 6,
      source: 6 + Math.sin(index * 0.81) * 2,
      observed: 404 + Math.sin(index * 0.12) * 22 + Math.sin(index * 1.31) * 8,
    })),
  );
  const [eventLog, setEventLog] = useState([
    { time: "T+00:00", text: "Acquisizione scientifica avviata", kind: "system" },
    { time: "T+00:00", text: "Modello background orbitale inizializzato", kind: "background" },
  ]);
  const phaseRef = useRef(INITIAL_TELEMETRY.phase);
  const elapsedRef = useRef(0);
  const grbTicksRef = useRef(0);
  const totalRef = useRef(0);
  const capturedRef = useRef(0);
  const selectedPixelRef = useRef(43);
  const settingsRef = useRef({ altitude, inclination, speed, paused });

  useEffect(() => {
    settingsRef.current = { altitude, inclination, speed, paused };
  }, [altitude, inclination, speed, paused]);

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
      const orbitalModulation = 34 * (0.5 + 0.5 * Math.sin(phase * 2.1 + 0.7));
      const latitudeBoost = Math.abs(latitude) * 1.35;
      const slowDrift = 18 * Math.sin(elapsedRef.current / 37);
      const celestial = getCelestialGeometry(
        elapsedRef.current,
        phase,
        settings.inclination,
        settings.altitude,
      );
      const backgroundMean =
        360 +
        orbitalModulation +
        latitudeBoost +
        slowDrift +
        celestial.sunNoise +
        celestial.moonNoise +
        celestial.earthAlbedoNoise;
      const isGRB = grbTicksRef.current > 0;
      if (isGRB) grbTicksRef.current -= 1;
      const sourceMean = isGRB
        ? 88 * Math.exp(-Math.max(0, 60 - grbTicksRef.current) / 21) + 7
        : 5.5 + Math.max(0, Math.sin(phase * 0.8 - 0.4)) * 4.5;
      const background = poissonLike(backgroundMean);
      const source = poissonLike(sourceMean);
      const observed = background + source;
      totalRef.current += observed;
      capturedRef.current += source;
      const detector = PIXEL_LAYOUT.map((pixel) => {
        const incidence = getBurstIncidence(pixel.index, selectedPixelRef.current);
        const directionalResponse = Math.pow(incidence, isGRB ? 2.4 : 5.5);
        const earthAlbedoResponse = getEarthAlbedoResponse(
          pixel.index,
          celestial.earthIllumination,
          celestial.earthAlbedoAzimuth,
          celestial.earthAlbedoDirectional,
        );
        const normalizedAlbedo = celestial.earthAlbedoNoise / 85;
        return Math.min(
          1,
          0.04 +
            Math.random() * 0.16 +
            directionalResponse * (isGRB ? 0.94 : 0.36) +
            earthAlbedoResponse * normalizedAlbedo * 0.62,
        );
      });
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
        detector,
        simulatedDate: celestial.date.toISOString(),
        sunDirection: celestial.sunDirection,
        moonDirection: celestial.moonDirection,
        sunSeparation: celestial.sunSeparation,
        moonSeparation: celestial.moonSeparation,
        sunNoise: celestial.sunNoise,
        moonNoise: celestial.moonNoise,
        sunInFov: celestial.sunInFov,
        moonInFov: celestial.moonInFov,
        moonDistanceKm: celestial.moonDistanceKm,
        moonPhase: celestial.moonPhase,
        earthIllumination: celestial.earthIllumination,
        earthAlbedoNoise: celestial.earthAlbedoNoise,
        earthAlbedoAzimuth: celestial.earthAlbedoAzimuth,
        earthAlbedoDirectional: celestial.earthAlbedoDirectional,
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  const selectPixel = useCallback((index: number) => {
    selectedPixelRef.current = index;
    setSelectedPixel(index);
  }, []);

  const injectGRB = useCallback(() => {
    const targetPixel =
      31 + Math.floor(((Math.sin(phaseRef.current * 1.7) + 1) / 2) * 64);
    const footprintCount = PIXEL_LAYOUT.filter((pixel) =>
      isPixelOnBurstFootprint(pixel.index, targetPixel),
    ).length;
    selectPixel(targetPixel);
    grbTicksRef.current = 60;
    setEventLog((current) => [
      ...current.slice(-4),
      {
        time: `T+${formatTime(elapsedRef.current).slice(3)}`,
        text: `GRB sintetico · direzione ${PIXEL_LAYOUT[targetPixel].id} · ${footprintCount} pixel illuminati`,
        kind: "grb",
      },
    ]);
  }, [selectPixel]);

  const resetSimulation = useCallback(() => {
    phaseRef.current = 0.72;
    elapsedRef.current = 0;
    totalRef.current = 0;
    capturedRef.current = 0;
    grbTicksRef.current = 0;
    selectPixel(43);
    setTelemetry(INITIAL_TELEMETRY);
    setEventLog([
      { time: "T+00:00", text: "Simulazione ripristinata", kind: "system" },
      { time: "T+00:00", text: "Acquisizione scientifica avviata", kind: "background" },
    ]);
  }, [selectPixel]);

  const orbitPeriod = useMemo(() => {
    const earthRadius = 6371;
    const gravitationalParameter = 398600.4418;
    return (2 * Math.PI * Math.sqrt(((earthRadius + altitude) ** 3) / gravitationalParameter)) / 60;
  }, [altitude]);

  const occulted = Math.cos(telemetry.phase) < -0.45;
  const captureRate = telemetry.total > 0 ? (telemetry.captured / telemetry.total) * 100 : 0;

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
          <span className="status-live"><i /> SCIENCE MODE</span>
          <div className="header-metric">
            <small>MISSION ELAPSED</small>
            <strong>{formatTime(telemetry.elapsed)}</strong>
          </div>
          <div className="header-metric celestial-time">
            <small>EPHEMERIS UTC</small>
            <strong>{new Date(telemetry.simulatedDate).toISOString().slice(0, 16).replace("T", " · ")}</strong>
          </div>
          <div className="header-metric">
            <small>LINK</small>
            <strong className="link-ok"><Radio size={13} /> NOMINAL</strong>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel left-panel">
          <div className="panel-heading">
            <span>MISSION CONTROL</span>
            <Orbit size={17} />
          </div>

          <div className="control-section">
            <div className="section-label">CONFIGURAZIONE ORBITALE</div>
            <RangeControl label="Altitudine" value={altitude} min={400} max={700} step={10} suffix=" km" onChange={setAltitude} />
            <RangeControl label="Inclinazione" value={inclination} min={0} max={60} step={1} suffix="°" onChange={setInclination} />
            <RangeControl label="Time warp fisico" value={speed} min={1} max={500} step={1} suffix="×" onChange={setSpeed} />
            <div className="warp-presets" aria-label="Preset time warp">
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
            <div className="mini-grid">
              <div><small>PERIODO</small><strong>{orbitPeriod.toFixed(1)} min</strong></div>
              <div><small>FOV GEOMETRICO</small><strong>&gt; 2π sr</strong></div>
              <div><small>CONO EFFICACE</small><strong>{EFFECTIVE_FOV_DEG}°</strong></div>
              <div><small>POINTING</small><strong>anti-Terra</strong></div>
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
                <span>Ø 30 cm · semisfera</span>
                <span>10 keV – 30 MeV</span>
                <span>126 pixel · SiPM array</span>
              </div>
            </div>
          </div>

          <div className="control-section grow">
            <div className="section-label">STATO OSSERVAZIONE</div>
            <div className={`observation-state ${occulted ? "occulted" : ""}`}>
              <div className="state-icon"><Satellite size={19} /></div>
              <div>
                <small>EARTH OCCULTATION</small>
                <strong>{occulted ? "Sorgente occultata" : "Campo visibile"}</strong>
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
              {paused ? "Riprendi" : "Pausa"}
            </button>
            <button className="icon-button" aria-label="Ripristina simulazione" onClick={resetSimulation}>
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
            selectedPixel={selectedPixel}
            sunDirection={telemetry.sunDirection}
            moonDirection={telemetry.moonDirection}
            sunNoise={telemetry.sunNoise}
            moonNoise={telemetry.moonNoise}
            earthIllumination={telemetry.earthIllumination}
            earthAlbedoNoise={telemetry.earthAlbedoNoise}
            earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
            earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
          />
          <div className="stage-title">
            <span className="eyebrow">ORBITAL PHOTON CAPTURE</span>
            <h2>Terra · LEO <em>{altitude} km</em></h2>
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
            sunInFov={telemetry.sunInFov}
            moonInFov={telemetry.moonInFov}
            moonPhase={telemetry.moonPhase}
            detector={telemetry.detector}
            selectedPixel={selectedPixel}
            grbActive={telemetry.grbActive}
            earthIllumination={telemetry.earthIllumination}
            earthAlbedoNoise={telemetry.earthAlbedoNoise}
            earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
            earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
          />
        </section>

        <aside className="control-panel right-panel">
          <div className="panel-heading">
            <span>PHOTON STREAM</span>
            <Activity size={17} />
          </div>

          <div className="photon-summary">
            <div className="primary-count">
              <small>CONTEGGI / 0.2 s</small>
              <strong>{telemetry.observed}</strong>
              <span className={telemetry.grbActive ? "hot" : ""}>
                {telemetry.grbActive ? "burst in corso" : "stream nominale"}
              </span>
            </div>
            <div className="stat-stack">
              <div><span className="legend-dot background-dot" /><small>BACKGROUND</small><strong>{telemetry.background}</strong></div>
              <div><span className="legend-dot source-dot" /><small>SORGENTE</small><strong>{telemetry.source}</strong></div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <div>
                <small>LIGHT CURVE</small>
                <strong>Observed = BG + source</strong>
              </div>
              <span>0.2 s bins</span>
            </div>
            <SignalChart data={samples} />
          </div>

          <div className="celestial-card">
            <div className="chart-header">
              <div>
                <small>CELESTIAL INTERFERENCE</small>
                <strong>Sole, Luna e albedo terrestre</strong>
              </div>
              <span>FOV {EFFECTIVE_FOV_DEG}°</span>
            </div>
            <div className="celestial-rows">
              <div className={telemetry.sunInFov ? "in-fov sun" : ""}>
                <Sun size={16} />
                <span><small>SOLE</small><strong>{telemetry.sunSeparation.toFixed(1)}° dal boresight</strong></span>
                <em>{telemetry.sunInFov ? `+${telemetry.sunNoise.toFixed(0)} c/s` : "OUT"}</em>
              </div>
              <div className={telemetry.moonInFov ? "in-fov moon" : ""}>
                <Moon size={16} />
                <span><small>LUNA · {(telemetry.moonPhase * 100).toFixed(0)}% illum.</small><strong>{telemetry.moonSeparation.toFixed(1)}° · {(telemetry.moonDistanceKm / 1000).toFixed(0)}k km</strong></span>
                <em>{telemetry.moonInFov ? `+${telemetry.moonNoise.toFixed(0)} c/s` : "OUT"}</em>
              </div>
              <div className={telemetry.earthAlbedoNoise > 1 ? "in-fov earth" : ""}>
                <CircleDot size={16} />
                <span>
                  <small>TERRA · {(telemetry.earthIllumination * 100).toFixed(0)}% illuminata</small>
                  <strong>albedo sui pixel periferici</strong>
                </span>
                <em>+{telemetry.earthAlbedoNoise.toFixed(0)} c/s</em>
              </div>
            </div>
            <p>Geometria astronomica reale; ampiezze di disturbo parametriche, da calibrare.</p>
          </div>

          <div className="detector-section">
            <div className="chart-header">
              <div>
                <small>DETECTOR RESPONSE</small>
                <strong>Distribuzione di carica</strong>
              </div>
              <span>{telemetry.grbActive ? "GRB" : "LIVE"}</span>
            </div>
            <DetectorMap
              values={telemetry.detector}
              grbActive={telemetry.grbActive}
              selectedPixel={selectedPixel}
              earthIllumination={telemetry.earthIllumination}
              earthAlbedoNoise={telemetry.earthAlbedoNoise}
              earthAlbedoAzimuth={telemetry.earthAlbedoAzimuth}
              earthAlbedoDirectional={telemetry.earthAlbedoDirectional}
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

          <button className="grb-button" onClick={injectGRB} disabled={telemetry.grbActive}>
            <Sparkles size={17} />
            <span>
              <strong>{telemetry.grbActive ? "GRB IN CORSO" : "INIETTA GAMMA RAY BURST"}</strong>
              <small>Simula un transiente nel flusso</small>
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
