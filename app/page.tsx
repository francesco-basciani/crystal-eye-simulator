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
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

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
};

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
}: {
  altitude: number;
  inclination: number;
  speed: number;
  paused: boolean;
  phase: number;
  grbActive: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef({ altitude, inclination, speed, paused, phase, grbActive });

  useEffect(() => {
    settingsRef.current = { altitude, inclination, speed, paused, phase, grbActive };
  }, [altitude, inclination, speed, paused, phase, grbActive]);

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
    const sun = new THREE.DirectionalLight(0xfff3d1, 3.2);
    sun.position.set(-5, 3, 5);
    scene.add(ambient, sun);

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
    const detectorMaterial = new THREE.MeshStandardMaterial({
      color: 0x55e7e2,
      emissive: 0x0a8791,
      emissiveIntensity: 1.2,
      metalness: 0.3,
      roughness: 0.25,
      transparent: true,
      opacity: 0.93,
    });
    const bus = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.22, 0.3), busMaterial);
    satelliteGroup.add(bus);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      detectorMaterial,
    );
    dome.rotation.x = Math.PI;
    dome.position.y = 0.18;
    satelliteGroup.add(dome);
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
      satelliteGroup.rotation.y = -angle + Math.PI / 2;
      satelliteGroup.rotation.z = Math.PI / 2;
      satelliteGroup.getWorldPosition(satWorld);

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

function DetectorMap({ values, grbActive }: { values: number[]; grbActive: boolean }) {
  return (
    <div className={`detector-map ${grbActive ? "is-grb" : ""}`} aria-label="Mappa dei 126 pixel del detector">
      {values.map((value, index) => (
        <span
          key={index}
          className="detector-pixel"
          style={{
            "--heat": Math.min(1, value).toFixed(4),
            "--delay": `${(index % 17) * 24}ms`,
          } as React.CSSProperties}
          title={`Pixel ${index + 1}: ${(value * 100).toFixed(0)}%`}
        />
      ))}
      <div className="detector-core">
        <Aperture size={22} />
        <b>126</b>
        <span>PIXEL</span>
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
  const [speed, setSpeed] = useState(5);
  const [paused, setPaused] = useState(false);
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
      const backgroundMean = 360 + orbitalModulation + latitudeBoost + slowDrift;
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
      const detector = Array.from({ length: 126 }, (_, index) => {
        const row = Math.floor(index / 11);
        const col = index % 11;
        const dx = col - (isGRB ? 7.2 : 5.1 + Math.sin(phase) * 1.4);
        const dy = row - (isGRB ? 4.4 : 6.1 + Math.cos(phase) * 0.9);
        const spot = Math.exp(-(dx * dx + dy * dy) / (isGRB ? 7 : 18));
        return Math.min(1, 0.06 + Math.random() * 0.18 + spot * (isGRB ? 0.88 : 0.34));
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
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  const injectGRB = useCallback(() => {
    grbTicksRef.current = 60;
    setEventLog((current) => [
      ...current.slice(-4),
      {
        time: `T+${formatTime(elapsedRef.current).slice(3)}`,
        text: "GRB sintetico iniettato · profilo Comptonized",
        kind: "grb",
      },
    ]);
  }, []);

  const resetSimulation = useCallback(() => {
    phaseRef.current = 0.72;
    elapsedRef.current = 0;
    totalRef.current = 0;
    capturedRef.current = 0;
    grbTicksRef.current = 0;
    setTelemetry(INITIAL_TELEMETRY);
    setEventLog([
      { time: "T+00:00", text: "Simulazione ripristinata", kind: "system" },
      { time: "T+00:00", text: "Acquisizione scientifica avviata", kind: "background" },
    ]);
  }, []);

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
            <RangeControl label="Velocità simulazione" value={speed} min={1} max={20} step={1} suffix="×" onChange={setSpeed} />
            <div className="mini-grid">
              <div><small>PERIODO</small><strong>{orbitPeriod.toFixed(1)} min</strong></div>
              <div><small>FOV</small><strong>&gt; 2π sr</strong></div>
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

          <div className="detector-section">
            <div className="chart-header">
              <div>
                <small>DETECTOR RESPONSE</small>
                <strong>Distribuzione di carica</strong>
              </div>
              <span>{telemetry.grbActive ? "GRB" : "LIVE"}</span>
            </div>
            <DetectorMap values={telemetry.detector} grbActive={telemetry.grbActive} />
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
