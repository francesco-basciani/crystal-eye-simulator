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

    const ambient = new THREE.AmbientLight(0x78bde9, 0.9);
    const sunLight = new THREE.DirectionalLight(0xfff3d1, 3.2);
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

    const earthGeometry = new THREE.SphereGeometry(2.05, 96, 64);
    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        lightDirection: { value: new THREE.Vector3(-1, 0.5, 1).normalize() },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 lightDirection;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          vec2 p = vec2(vUv.x * 12.0 + time * 0.008, vUv.y * 7.0);
          float continents = noise(p) * 0.62 + noise(p * 2.4) * 0.28 + noise(p * 5.2) * 0.10;
          float latitudeMask = smoothstep(0.07, 0.22, abs(vUv.y - 0.5));
          float land = smoothstep(0.50 + 0.08 * latitudeMask, 0.63, continents);
          float ice = smoothstep(0.40, 0.48, abs(vUv.y - 0.5));
          vec3 ocean = mix(vec3(0.008, 0.10, 0.20), vec3(0.015, 0.30, 0.48), max(0.0, vNormal.z));
          vec3 landColor = mix(vec3(0.05, 0.25, 0.18), vec3(0.18, 0.42, 0.25), continents);
          vec3 color = mix(ocean, landColor, land);
          color = mix(color, vec3(0.72, 0.86, 0.88), ice * 0.55);
          float diffuse = max(dot(normalize(vNormal), normalize(lightDirection)), 0.0);
          float night = smoothstep(-0.15, 0.18, diffuse);
          color *= mix(0.075, 0.50 + diffuse * 0.72, night);
          float city = step(0.79, hash(floor(p * 5.0))) * land * (1.0 - night);
          color += vec3(1.0, 0.52, 0.12) * city * 0.95;
          float rim = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
          color += vec3(0.02, 0.22, 0.42) * rim;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    earth.rotation.z = THREE.MathUtils.degToRad(23.4);
    scene.add(earth);

    const grid = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(2.058, 24, 16)),
      new THREE.LineBasicMaterial({
        color: 0x61bde8,
        transparent: true,
        opacity: 0.055,
      }),
    );
    grid.rotation.z = earth.rotation.z;
    scene.add(grid);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.18, 64, 48),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          void main() {
            float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.3);
            gl_FragColor = vec4(0.08, 0.55, 1.0, intensity * 0.7);
          }
        `,
      }),
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
      const polar = THREE.MathUtils.lerp(0.04, Math.PI / 2 - 0.045, pixel.radius);
      const normal = new THREE.Vector3(
        Math.sin(polar) * Math.cos(pixel.angle),
        Math.cos(polar),
        Math.sin(polar) * Math.sin(pixel.angle),
      );
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
    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      const settings = settingsRef.current;
      const orbitRadius = 3.1 + (settings.altitude - 550) / 1500;
      const angle = settings.phase;
      orbitGroup.rotation.z = THREE.MathUtils.degToRad(settings.inclination);
      orbitLine.scale.setScalar(orbitRadius / 3.1);
      satelliteGroup.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius);
      outwardLocal.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
      satelliteGroup.quaternion.setFromUnitVectors(upAxis, outwardLocal);
      satelliteGroup.getWorldPosition(satWorld);

      sunSceneDirection.fromArray(settings.sunDirection).normalize();
      moonSceneDirection.fromArray(settings.moonDirection).normalize();
      sunBody.position.copy(sunSceneDirection).multiplyScalar(12.5);
      sunLight.position.copy(sunSceneDirection).multiplyScalar(9);
      sunLight.intensity = 2.7 + Math.min(1.2, settings.sunNoise / 90);
      moonBody.position.copy(moonSceneDirection).multiplyScalar(5.4);

      earthMaterial.uniforms.time.value += settings.paused ? 0 : delta;
      if (!settings.paused) {
        earth.rotation.y += delta * 0.025;
        grid.rotation.y = earth.rotation.y;
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
        const selectedLayout = PIXEL_LAYOUT[settings.selectedPixel];
        const angularDistance = Math.abs(
          Math.atan2(
            Math.sin(layout.angle - selectedLayout.angle),
            Math.cos(layout.angle - selectedLayout.angle),
          ),
        );
        const radialDistance = Math.abs(layout.radius - selectedLayout.radius);
        const isBurstCluster =
          settings.grbActive &&
          (isSelected || (radialDistance < 0.19 && angularDistance < 0.32));
        material.color.setHex(
          isBurstCluster
            ? 0xff4dbe
            : isSelected
              ? 0xffc857
              : layout.ring % 2 === 0
                ? 0x4edfd4
                : 0x54bedf,
        );
        material.emissive.setHex(
          isBurstCluster ? 0x8d124f : isSelected ? 0x8a5f0b : 0x086f79,
        );
        material.emissiveIntensity = isBurstCluster ? 2.2 : isSelected ? 1.8 : 0.65;
        crystal.scale.setScalar(isBurstCluster ? 1.13 : isSelected ? 1.08 : 1);
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
        particlePositions[index * 3] =
          satWorld.x + travel + particleSeed[index * 3] * spread;
        particlePositions[index * 3 + 1] =
          satWorld.y + particleSeed[index * 3 + 1] * spread * life;
        particlePositions[index * 3 + 2] =
          satWorld.z + particleSeed[index * 3 + 2] * spread * life;
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

function DetectorMap({
  values,
  grbActive,
  selectedPixel,
  onSelect,
}: {
  values: number[];
  grbActive: boolean;
  selectedPixel: number;
  onSelect: (index: number) => void;
}) {
  const activeCluster = PIXEL_LAYOUT
    .filter((pixel) => values[pixel.index] > (grbActive ? 0.58 : 0.42))
    .sort((a, b) => values[b.index] - values[a.index])
    .slice(0, grbActive ? 15 : 8);
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
          return (
            <button
              key={pixel.id}
              type="button"
              className={`detector-pixel ${isActive ? "is-active" : ""} ${
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
            <small>{grbActive ? "BURST CLUSTER" : "PIXEL SOPRA SOGLIA"}</small>
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
        celestial.moonNoise;
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
      const sourcePixel = PIXEL_LAYOUT[selectedPixelRef.current];
      const detector = PIXEL_LAYOUT.map((pixel) => {
        const angularDistance = Math.abs(
          Math.atan2(
            Math.sin(pixel.angle - sourcePixel.angle),
            Math.cos(pixel.angle - sourcePixel.angle),
          ),
        );
        const radialDistance = Math.abs(pixel.radius - sourcePixel.radius);
        const projectedAngularDistance =
          angularDistance * Math.max(0.2, (pixel.radius + sourcePixel.radius) / 2);
        const spread = isGRB ? 0.12 : 0.24;
        const spot = Math.exp(
          -(
            (radialDistance * radialDistance) / (spread * spread) +
            (projectedAngularDistance * projectedAngularDistance) / (spread * spread)
          ),
        );
        return Math.min(
          1,
          0.04 + Math.random() * 0.16 + spot * (isGRB ? 0.94 : 0.36),
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
    selectPixel(targetPixel);
    grbTicksRef.current = 60;
    setEventLog((current) => [
      ...current.slice(-4),
      {
        time: `T+${formatTime(elapsedRef.current).slice(3)}`,
        text: `GRB sintetico · cluster centrato su ${PIXEL_LAYOUT[targetPixel].id}`,
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
                <strong>Sole e Luna · ephemeris UTC</strong>
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
            </div>
            <p>Direzioni astronomiche reali; flusso di disturbo parametrico, da calibrare.</p>
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
