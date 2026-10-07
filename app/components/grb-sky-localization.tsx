"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { celestialToVector, greatCircleArc, type SkyLocalizationEvent } from "../lib/sky-localization";
import styles from "./grb-sky-localization.module.css";

type DirectionKey = "truth" | "ks" | "centroid";
type Coordinate = { raDeg: number; decDeg: number };
type SceneHandle = { show: (event: SkyLocalizationEvent | undefined) => void; recenter: () => void; focus: (direction?: "ks" | "centroid") => void };
const EMPTY_OVERVIEW: readonly SkyLocalizationEvent[] = [];
const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const COLORS = { truth: "#ff6347", ks: "#73e58e", centroid: "#64b5f6" };

function vector(coordinate: Coordinate, radius = 1) {
  return new THREE.Vector3(...celestialToVector(coordinate)).multiplyScalar(radius);
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((object) => {
    const drawable = object as THREE.Mesh;
    drawable.geometry?.dispose();
    const materials = drawable.material ? (Array.isArray(drawable.material) ? drawable.material : [drawable.material]) : [];
    materials.forEach((material) => {
      const texture = (material as THREE.SpriteMaterial).map;
      texture?.dispose();
      material.dispose();
    });
  });
  group.clear();
}

function label(text: string, position: THREE.Vector3, color = "#c2d5e9") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = "500 28px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.position.copy(position);
  sprite.scale.set(0.38, 0.095, 1);
  return sprite;
}

function formatCoordinate(coordinate: Coordinate | null, detectorLocal = false) {
  if (!coordinate) return "—";
  return detectorLocal
    ? `${(90 - coordinate.decDeg).toFixed(3)}° / ${((360 - coordinate.raDeg) % 360).toFixed(3)}°`
    : `${coordinate.raDeg.toFixed(3)}° / ${coordinate.decDeg.toFixed(3)}°`;
}

export function GrbSkyLocalization({ events, showEventControls = true, overviewEvents = EMPTY_OVERVIEW, onSelectEvent }: {
  events: readonly SkyLocalizationEvent[];
  showEventControls?: boolean;
  overviewEvents?: readonly SkyLocalizationEvent[];
  onSelectEvent?: (event: SkyLocalizationEvent) => void;
}) {
  const titleId = useId();
  const helpId = useId();
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState<{ eventKey: string; direction: DirectionKey } | null>(null);
  const [focused, setFocused] = useState(false);
  const [focusDirection, setFocusDirection] = useState<"ks" | "centroid" | null>(null);
  const [referenceState, setReferenceState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "unavailable">("loading");
  const panelRef = useRef<HTMLDialogElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const latest = events[events.length - 1];
  const candidate = (followLatest ? latest : events.find((event) => event.eventKey === selectedEventKey)) ?? latest;
  const selected = candidate?.dataOrigin === "demo" ? undefined : candidate;
  const selectedRef = useRef(selected);
  const overviewRef = useRef(overviewEvents);
  const selectEventRef = useRef(onSelectEvent);
  const pickedDirection = picked?.eventKey === selected?.eventKey ? picked?.direction : undefined;
  const isReference = selected?.referenceOverlay === "rito-gbm-bayestar";
  const overviewActive = overviewEvents.length > 0 && !isReference && (!selected || selected.coordinateSystem === overviewEvents[0].coordinateSystem);
  const isDetectorLocal = (selected ?? (overviewActive ? overviewEvents[0] : undefined))?.coordinateSystem === "detector-local";
  const isBenchmark = selected?.dataOrigin === "benchmark";

  useEffect(() => {
    selectedRef.current = selected;
    overviewRef.current = overviewEvents;
    sceneRef.current?.show(selected);
  }, [selected, overviewEvents]);

  useEffect(() => { selectEventRef.current = onSelectEvent; }, [onSelectEvent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      const frame = requestAnimationFrame(() => setSceneState("unavailable"));
      return () => cancelAnimationFrame(frame);
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#081321");
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30);
    camera.position.set(2.4, 1.5, 2.8);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.setAttribute("aria-label", "Interactive celestial sphere. Drag to rotate, scroll to zoom; arrow keys rotate, plus and minus zoom.");
    renderer.domElement.setAttribute("aria-describedby", helpId);
    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.65;
    controls.maxDistance = 6;
    const grid = new THREE.Group();
    scene.add(grid);
    grid.add(new THREE.Mesh(new THREE.SphereGeometry(0.996, 48, 32), new THREE.MeshBasicMaterial({ color: "#122238" })));
    function addLine(points: THREE.Vector3[], color: string, opacity: number) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      grid.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
    }
    for (let dec = -60; dec <= 60; dec += 30) {
      addLine(Array.from({ length: 181 }, (_, i) => vector({ raDeg: i * 2, decDeg: dec })), dec === 0 ? "#8aa3bd" : "#55738e", dec === 0 ? 0.85 : 0.55);
    }
    for (let ra = 0; ra < 360; ra += 30) {
      addLine(Array.from({ length: 91 }, (_, i) => vector({ raDeg: ra, decDeg: i * 2 - 90 })), "#55738e", 0.7);
    }
    for (let ra = 0; ra < 360; ra += 90) {
      const sprite = label(isDetectorLocal ? `Phi ${(360 - ra) % 360}°` : `RA ${ra / 15}h`, vector({ raDeg: ra, decDeg: 0 }, 1.12));
      if (sprite) grid.add(sprite);
    }
    for (const dec of [-90, 90]) {
      const sprite = label(isDetectorLocal ? `Theta ${90 - dec}°` : `Dec ${dec > 0 ? "+" : ""}${dec}°`, vector({ raDeg: 0, decDeg: dec }, 1.12));
      if (sprite) grid.add(sprite);
    }
    const markers = new THREE.Group();
    scene.add(markers);
    const referenceLayer = new THREE.Group();
    scene.add(referenceLayer);
    let disposed = false;
    let referenceRequested = false;
    let referenceGeneration = 0;
    let referenceTexture: THREE.Texture | null = null;
    const setReferenceLayer = (enabled: boolean) => {
      if (enabled === referenceRequested) return;
      referenceRequested = enabled;
      const generation = ++referenceGeneration;
      disposeGroup(referenceLayer);
      referenceTexture?.dispose();
      referenceTexture = null;
      queueMicrotask(() => {
        if (!disposed && generation === referenceGeneration) setReferenceState(enabled ? "loading" : "idle");
      });
      if (!enabled) return;
      referenceTexture = new THREE.TextureLoader().load(
        `${PUBLIC_BASE_PATH}/data/sky-localization/rito-reference.png`,
        (texture) => {
          if (disposed || generation !== referenceGeneration) { texture.dispose(); return; }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = true;
          // The supplied PNG runs left-to-right RA 0..360 and top-to-bottom
          // Dec +90..-90. After flipY, v=0 is the south pole. Build the
          // geometry explicitly in the same basis as the coordinate helper.
          const geometry = new THREE.SphereGeometry(1.006, 256, 128);
          const positions = geometry.getAttribute("position");
          const uv = geometry.getAttribute("uv");
          for (let i = 0; i < positions.count; i++) {
            const point = vector({ raDeg: uv.getX(i) * 360, decDeg: uv.getY(i) * 180 - 90 }, 1.006);
            positions.setXYZ(i, point.x, point.y, point.z);
          }
          positions.needsUpdate = true;
          geometry.computeVertexNormals();
          geometry.computeBoundingSphere();
          const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 1;
          referenceLayer.add(mesh);
          setReferenceState("ready");
        },
        undefined,
        () => {
          if (!disposed && generation === referenceGeneration) setReferenceState("error");
        },
      );
    };
    let previousKey: string | undefined;
    let initializedView = false;
    let focusMode = false;
    let comparison: "ks" | "centroid" | undefined;
    const markerMeshes: THREE.Mesh[] = [];
    const overviewLabels: THREE.Sprite[] = [];
    const applyCamera = () => {
      const target = overviewActive && !focusMode ? { raDeg: 0, decDeg: 30 } : selectedRef.current?.truth ?? selectedRef.current?.ks ?? selectedRef.current?.centroid;
      camera.position.copy(target ? vector(target, 3.6) : new THREE.Vector3(2.4, 1.5, 2.8));
      // Avoid a camera exactly on the polar axis, where the up vector degenerates.
      if (Math.abs(camera.position.clone().normalize().y) > 0.999999) { camera.position.x += 1e-6; camera.position.setLength(3.6); }
      const coordinates = (comparison ? [selectedRef.current?.truth, selectedRef.current?.[comparison]] : [selectedRef.current?.truth, selectedRef.current?.ks, selectedRef.current?.centroid]).filter((point): point is Coordinate => Boolean(point));
      let maximumSeparation = 0;
      for (const a of coordinates) for (const b of coordinates) maximumSeparation = Math.max(maximumSeparation, vector(a).angleTo(vector(b)));
      // Optical focus: unchanged directions and camera distance. Convert the
      // actual spread (minimum 0.1° total sky extent) to the external camera FOV.
      const halfExtent = Math.min(80 * Math.PI / 180, Math.max(0.05 * Math.PI / 180, maximumSeparation * 1.2));
      const focusFov = 2 * Math.atan2(1.012 * Math.sin(halfExtent), 3.6 - 1.012 * Math.cos(halfExtent)) * 180 / Math.PI;
      camera.fov = focusMode ? Math.min(42, focusFov) : 42;
      camera.updateProjectionMatrix();
      for (const mesh of markerMeshes) mesh.scale.setScalar(focusMode ? camera.fov / 42 : 1);
      for (const sprite of overviewLabels) sprite.scale.set(0.65, 0.1625, 1).multiplyScalar(focusMode ? camera.fov / 42 : 1);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    const recenter = () => { comparison = undefined; setFocusDirection(null); focusMode = false; setFocused(false); applyCamera(); };
    const focus = (direction?: "ks" | "centroid") => { comparison = direction; setFocusDirection(direction ?? null); focusMode = true; setFocused(true); applyCamera(); };
    const show = (event: SkyLocalizationEvent | undefined) => {
      disposeGroup(markers);
      markerMeshes.length = 0;
      overviewLabels.length = 0;
      const showReference = event?.referenceOverlay === "rito-gbm-bayestar";
      setReferenceLayer(showReference);
      const overview = overviewActive ? overviewRef.current : EMPTY_OVERVIEW;
      for (const item of overview) {
        if (!item.truth || item.dataOrigin === "demo") continue;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), new THREE.MeshBasicMaterial({ color: COLORS.truth }));
        mesh.position.copy(vector(item.truth, 1.012));
        mesh.userData.direction = "truth";
        mesh.userData.event = item;
        mesh.scale.setScalar(focusMode ? camera.fov / 42 : 1);
        markers.add(mesh);
        markerMeshes.push(mesh);
        const sprite = label(`Case ${item.burstId}`, vector(item.truth, 1.012), item.eventKey === event?.eventKey ? "#ffffff" : "#f4c2b9");
        if (sprite) {
          sprite.center.set(0.5, -0.2);
          sprite.material.depthTest = false;
          sprite.renderOrder = 3;
          sprite.scale.set(0.65, 0.1625, 1).multiplyScalar(focusMode ? camera.fov / 42 : 1);
          markers.add(sprite);
          overviewLabels.push(sprite);
        }
      }
      const points = showReference ? [] : [
        { coordinate: event?.truth, color: COLORS.truth, name: "Injected", radius: 1.012, size: 0.018 },
        { coordinate: event?.ks, color: COLORS.ks, name: "KS", radius: 1.012, size: 0.018 },
        { coordinate: event?.centroid, color: COLORS.centroid, name: "Centroid", radius: 1.012, size: 0.018 },
      ];
      points.forEach(({ coordinate, color, name, radius, size }) => {
        if (!coordinate || (name === "Injected" && overview.some(item => item.eventKey === event?.eventKey))) return;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 10), new THREE.MeshBasicMaterial({ color }));
        mesh.position.copy(vector(coordinate, radius));
        mesh.userData.direction = name === "Injected" ? "truth" : name === "KS" ? "ks" : "centroid";
        mesh.userData.event = event;
        markers.add(mesh);
        markerMeshes.push(mesh);
        mesh.scale.setScalar(focusMode ? camera.fov / 42 : 1);
        if (name !== "Injected" && event?.truth) {
          const arc = greatCircleArc(event.truth, coordinate).map((point) => new THREE.Vector3(...point).multiplyScalar(1.009));
          markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), new THREE.LineBasicMaterial({ color })));
        }
      });
      if (!initializedView || (overviewActive && !event && previousKey !== undefined) || (!overviewActive && event?.eventKey !== previousKey)) {
        comparison = undefined;
        focusMode = !overviewActive && event?.dataOrigin === "benchmark";
        queueMicrotask(() => { if (!disposed) { setFocused(focusMode); setFocusDirection(null); } });
        applyCamera();
      } else if (!overviewActive && focusMode) applyCamera();
      initializedView = true;
      previousKey = event?.eventKey;
    };
    sceneRef.current = { show, recenter, focus };
    show(selectedRef.current);
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const onKeyDown = (event: KeyboardEvent) => {
      const spherical = new THREE.Spherical().setFromVector3(camera.position);
      if (event.key === "ArrowLeft") spherical.theta -= 0.1;
      else if (event.key === "ArrowRight") spherical.theta += 0.1;
      else if (event.key === "ArrowUp") spherical.phi -= 0.1;
      else if (event.key === "ArrowDown") spherical.phi += 0.1;
      else if (event.key === "+" || event.key === "=") spherical.radius *= 0.9;
      else if (event.key === "-") spherical.radius *= 1.1;
      else return;
      event.preventDefault();
      spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
      spherical.makeSafe();
      camera.position.setFromSpherical(spherical);
      controls.update();
    };
    // Screen-space tolerance keeps small markers usable in both overview and focus.
    // Reject back-side points and distinguish a click from an orbit drag.
    const raycaster = new THREE.Raycaster();
    const sphere = new THREE.Sphere(new THREE.Vector3(), 0.996);
    const pickAt = (event: PointerEvent): { direction: DirectionKey; event: SkyLocalizationEvent } | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      let best: {direction: DirectionKey; event: SkyLocalizationEvent; distance: number} | null = null;
      for (const mesh of markerMeshes) {
        const projected = mesh.position.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) continue;
        raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const surface = raycaster.ray.intersectSphere(sphere, new THREE.Vector3());
        if (surface && camera.position.distanceTo(surface) + 0.002 < camera.position.distanceTo(mesh.position)) continue;
        const distance = Math.hypot(event.clientX - rect.left - (projected.x + 1) * rect.width / 2,
          event.clientY - rect.top - (1 - projected.y) * rect.height / 2);
        if (distance <= 12 && (!best || distance < best.distance)) best = {direction: mesh.userData.direction as DirectionKey, event: mesh.userData.event as SkyLocalizationEvent, distance};
      }
      return best;
    };
    let pointerStart: {x: number; y: number; id: number} | null = null;
    let dragged = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerStart = {x: event.clientX, y: event.clientY, id: event.pointerId};
      dragged = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerStart && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5) dragged = true;
      renderer.domElement.style.cursor = pickAt(event) ? "pointer" : "grab";
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointerStart?.id === event.pointerId && !dragged && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)<=5) {
        const hit = pickAt(event);
        if (hit) {
          selectEventRef.current?.(hit.event);
          setPicked({ eventKey: hit.event.eventKey, direction: hit.direction });
        } else setPicked(null);
      }
      pointerStart = null;
    };
    const onPointerCancel = () => { pointerStart = null; };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    let contextLost = false;
    const onLost = (event: Event) => { event.preventDefault(); contextLost = true; setSceneState("unavailable"); };
    const onRestored = () => { contextLost = false; setSceneState("ready"); resize(); };
    renderer.domElement.addEventListener("keydown", onKeyDown);
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    renderer.domElement.addEventListener("webglcontextrestored", onRestored);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (contextLost) return;
      controls.update();
      for (const sprite of overviewLabels) sprite.visible = sprite.position.dot(camera.position) > 0.996 * sprite.position.length();
      renderer.render(scene, camera);
    };
    const readyFrame = requestAnimationFrame(() => setSceneState("ready"));
    animate();
    return () => {
      disposed = true;
      referenceGeneration++;
      referenceTexture?.dispose();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(readyFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      controls.dispose();
      disposeGroup(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [helpId, isDetectorLocal, overviewActive]);

  useEffect(() => {
    if (!expanded) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : expandRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The top layer escapes the sidebar backdrop-filter and clipping without
    // reparenting the canvas or creating a second WebGL scene.
    panel.showModal();
    closeRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setExpanded(false); return; }
      if (event.key !== "Tab") return;
      const targets = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trapFocus, true);
    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      document.body.style.overflow = previousOverflow;
      panel.close();
      if (panel.isConnected) panel.show();
      previousFocus?.focus();
    };
  }, [expanded]);

  return <dialog ref={panelRef} open={!expanded} onCancel={(event) => { event.preventDefault(); setExpanded(false); }} className={`${styles.panel} ${expanded ? styles.expanded : ""}`} role={expanded ? "dialog" : "region"} aria-modal={expanded || undefined} aria-labelledby={titleId} data-standalone={!showEventControls}>
    <header className={styles.header}>
      <h2 id={titleId}>{overviewActive ? (selected ? `Computed bursts · case ${selected.burstId} selected` : "Computed burst overview") : selected?.dataOrigin === "benchmark" ? `Computed case ${selected.burstId}` : selected ? `GRB #${selected.burstId}` : "3D sky"}</h2>
      {expanded ? <button type="button" ref={closeRef} onClick={() => setExpanded(false)} aria-label="Close expanded sky localization">Close ×</button> : <button type="button" ref={expandRef} onClick={() => setExpanded(true)} aria-label="Expand sky localization">Expand ↗</button>}
    </header>
    {showEventControls && <div className={styles.selection}>
      <label>Event<select value={selected?.eventKey ?? ""} disabled={!events.length} onChange={(event) => { setSelectedEventKey(event.target.value); setFollowLatest(false); }}>
        {!events.length && <option value="">No event selected</option>}
        {[...events].reverse().map((event) => <option key={event.eventKey} value={event.eventKey}>GRB #{event.burstId} · {event.simulatedDate} · {event.status}</option>)}
      </select></label>
      <label className={styles.follow}><input type="checkbox" checked={followLatest} onChange={(event) => { setFollowLatest(event.target.checked); if (!event.target.checked) setSelectedEventKey(selected?.eventKey ?? null); }} />Follow latest event</label>
    </div>}
    <div className={styles.viewport}>
      <div ref={containerRef} className={styles.scene} />
      {sceneState !== "ready" && <div className={styles.fallback} role="status">{sceneState === "loading" ? "Loading celestial sphere…" : "3D view unavailable. Coordinates and angular errors remain available below."}</div>}
      {!selected && !overviewActive && sceneState === "ready" && <div className={styles.emptySelection}><span>Select a burst below</span></div>}
      {isReference && referenceState !== "ready" && <div className={styles.layerStatus} role="status">{referenceState === "error" ? "Reference sky layers could not be loaded. The coordinate grid remains available." : "Loading reference sky layers…"}</div>}
      <div className={styles.viewControls}>
        <button type="button" aria-pressed={focused && !focusDirection} disabled={sceneState !== "ready" || !selected || isReference} onClick={() => sceneRef.current?.focus()}>Focus burst</button>
        <button type="button" aria-pressed={focusDirection === "ks"} disabled={sceneState !== "ready" || !selected?.ks || !selected?.truth} onClick={() => sceneRef.current?.focus("ks")}>Focus KS</button>
        <button type="button" aria-pressed={focusDirection === "centroid"} disabled={sceneState !== "ready" || !selected?.centroid || !selected?.truth} onClick={() => sceneRef.current?.focus("centroid")}>Focus centroid</button>
        <button type="button" aria-pressed={!focused} disabled={sceneState !== "ready"} onClick={() => sceneRef.current?.recenter()}>{isDetectorLocal ? "Full sphere" : "All sky"}</button>
      </div>
    </div>
    <div className={styles.details}>
      {overviewActive && <section className={styles.overviewList} aria-label="Computed burst positions">
        <p>Injected burst positions · fixed sphere</p>
        {overviewEvents.map(event => <button key={event.eventKey} type="button" aria-pressed={selected?.eventKey === event.eventKey} onClick={() => { onSelectEvent?.(event); setPicked({ eventKey: event.eventKey, direction: "truth" }); }}>
          <strong>Case {event.burstId}</strong><span>{formatCoordinate(event.truth, isDetectorLocal)}</span>
        </button>)}
        <small>{isDetectorLocal ? "Theta / Phi (°)" : "RA / Dec (°)"}. Selecting a case keeps the viewpoint fixed.</small>
      </section>}
      {isReference && <div className={styles.referenceLegend} aria-label="Reference sky layers">
        <span><i style={{ background: "#87cefa" }} />Fermi/GBM map</span>
        <span><i style={{ background: "#98fb98" }} />BAYESTAR H1/L1 map</span>
        <span><i style={{ background: "#ff6347" }} />CE illustrative 68% radius: 1.45°</span>
        <span><i style={{ background: "#ffb6c1" }} />CE illustrative 95% radius: 2.75°</span>
      </div>}
      <p id={helpId} className={styles.hint}>{overviewActive ? "Click a labelled burst to select it" : "Click a point for details"} · drag to rotate · scroll to zoom{focusDirection && <><br />Focused comparison: injected / {focusDirection === "ks" ? "KS" : "centroid"}. Other directions may be outside the view.</>}</p>
      {selected && selected.status !== "available" && <div className={styles.status} role="status">{selected.status === "pending" ? "Localization pending" : `Localization unavailable${selected.reason ? `: ${selected.reason}` : ""}`}</div>}
      {selected && pickedDirection && <section className={styles.pointInfo} aria-label="Burst point details" aria-live="polite">
        <header><strong>{isBenchmark ? `Computed case ${selected.burstId}` : `GRB #${selected.burstId}`}</strong><button type="button" aria-label="Close point details" onClick={() => setPicked(null)}>×</button></header>
        <dl>
          <dt>Direction</dt><dd>{pickedDirection === "truth" ? "Injected" : pickedDirection === "ks" ? (isBenchmark ? "KS (5°)" : "KS") : "Centroid"}</dd>
          <dt>{isDetectorLocal ? "Theta / Phi" : "RA / Dec"}</dt><dd>{formatCoordinate(selected[pickedDirection], isDetectorLocal)}</dd>
          <dt>Separation</dt><dd>{pickedDirection === "truth" ? "Reference direction" : `${(pickedDirection === "ks" ? selected.ksErrorDeg : selected.centroidErrorDeg)?.toFixed(3) ?? "—"}°`}</dd>
          <dt>{isBenchmark ? "Calculated" : "UTC"}</dt><dd>{selected.simulatedDate}</dd>
          <dt>Data</dt><dd>{isBenchmark ? "Source-only benchmark" : selected.dataOrigin === "archived-detection" ? "Archived centroid" : "Source-only pipeline"}</dd>
        </dl>
        <p>{selected.coordinateFrame}</p>
      </section>}
      {selected && <table className={styles.coordinates}>
        <caption>{isReference ? "Supplied CE reference center" : "Selected event directions and separation from injected truth"}</caption>
        <thead><tr><th scope="col">Direction</th><th scope="col">{isDetectorLocal ? "Theta / Phi" : "RA / Dec"}</th>{!isReference && <th scope="col">Separation</th>}</tr></thead>
        <tbody>
          <tr><th scope="row"><button type="button" disabled={!selected?.truth} aria-pressed={pickedDirection === "truth"} onClick={() => selected && setPicked({eventKey:selected.eventKey,direction:"truth"})}><span style={{ color: COLORS.truth }}>●</span> {isReference ? "CE reference center" : "Injected"}</button></th><td>{formatCoordinate(selected?.truth ?? null, isDetectorLocal)}</td>{!isReference && <td>—</td>}</tr>
          {!isReference && <tr><th scope="row"><button type="button" disabled={!selected?.ks} aria-pressed={pickedDirection === "ks"} onClick={() => selected && setPicked({eventKey:selected.eventKey,direction:"ks"})}><span style={{ color: COLORS.ks }}>●</span> {isBenchmark ? "KS (5°)" : "KS"}</button></th><td>{formatCoordinate(selected?.ks ?? null, isDetectorLocal)}</td><td>{selected?.ksErrorDeg != null ? `${selected.ksErrorDeg.toFixed(3)}°` : "—"}</td></tr>}
          {!isReference && <tr><th scope="row"><button type="button" disabled={!selected?.centroid} aria-pressed={pickedDirection === "centroid"} onClick={() => selected && setPicked({eventKey:selected.eventKey,direction:"centroid"})}><span style={{ color: COLORS.centroid }}>●</span> Centroid</button></th><td>{formatCoordinate(selected?.centroid ?? null, isDetectorLocal)}</td><td>{selected?.centroidErrorDeg != null ? `${selected.centroidErrorDeg.toFixed(3)}°` : "—"}</td></tr>}
        </tbody>
      </table>}
      {selected && <p className={styles.metadata}>{isBenchmark ? "Calculation time: " : ""}{selected.simulatedDate}<br />{selected.coordinateFrame}</p>}
      {selected?.dataOrigin === "benchmark" && <p className={styles.note}>Source-only · no background or Poisson noise</p>}
      <p className={styles.note}>Separation from injected direction · uncertainty unavailable</p>
    </div>
  </dialog>;
}

export const GrbSkyLocalizationPanel = GrbSkyLocalization;
export default GrbSkyLocalization;
