"use client";

import { useEffect, useId, useRef, useState } from "react";
import { celestialToVector, greatCircleArc, type SkyLocalizationEvent } from "../lib/sky-localization";
import { orthographicPath, projectSkyVector } from "../lib/sky-orthographic";
import styles from "../sky-localization/page.module.css";

const COLORS = { truth: "#ff6347", ks: "#228b22", centroid: "#3b82d0" };

export function GrbSkyOrthographic({ event }: { event: SkyLocalizationEvent | undefined }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : expandRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setExpanded(false); }
      // The close button is the only interactive control in this read-only plot.
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      dialog.close();
      if (dialog.isConnected) dialog.show();
      previousFocus?.focus();
    };
  }, [expanded]);
  const centre = event?.truth ?? event?.ks ?? event?.centroid ?? { raDeg: 0, decDeg: 0 };
  const isDemo = event?.dataOrigin === "demo";
  const cx = 350, cy = 298, radius = 246;
  const path = (points: ReturnType<typeof greatCircleArc>) => orthographicPath(points, centre, radius, cx, cy);
  const clipId = `${id}-clip`;
  const markers = [
    { name: "Injected", point: event?.truth, color: COLORS.truth, radius: 7 },
    { name: isDemo ? "KS (example)" : "KS", point: event?.ks, color: COLORS.ks, radius: 5 },
    { name: isDemo ? "Centroid (example)" : "Centroid", point: event?.centroid, color: COLORS.centroid, radius: 3 },
  ];
  const hidden = markers.filter(marker => marker.point && !projectSkyVector(celestialToVector(marker.point), centre).visible);
  return <dialog ref={dialogRef} open={!expanded} onCancel={(event) => { event.preventDefault(); setExpanded(false); }} className={`${styles.projection} ${expanded ? styles.projectionExpanded : ""}`} role={expanded ? "dialog" : "region"} aria-modal={expanded || undefined} aria-labelledby={`${id}-title`}>
    <header><div><p className={styles.eyebrow}>{isDemo ? "Demo · illustrative positions" : "Orthographic projection · provisional"}</p><h2 id={`${id}-title`}>2D celestial globe</h2></div>
      {expanded ? <button type="button" ref={closeRef} onClick={() => setExpanded(false)} aria-label="Close expanded 2D sky projection">Close ×</button> : <button type="button" ref={expandRef} onClick={() => setExpanded(true)} aria-label="Expand 2D sky projection">Expand ↗</button>}
    </header>
    <svg className={styles.skySvg} viewBox="0 0 700 625" role="img" aria-labelledby={`${id}-svg-title ${id}-svg-desc`}>
      <title id={`${id}-svg-title`}>{event ? `GRB #${event.burstId}: ${isDemo ? "illustrative demo" : "retained directions"} on a celestial globe` : "Celestial grid: no event selected"}</title>
      <desc id={`${id}-svg-desc`}>Tomato injected direction, green KS, blue centroid. A white orthographic globe centred on the selected event, with grey celestial grid and right ascension labels in hours. Curves show separation from injected truth. Opposite-hemisphere directions are omitted and listed below. Demo markers are illustrative positions, not algorithm outputs. No confidence regions are inferred.</desc>
      <defs><clipPath id={clipId}><circle cx={cx} cy={cy} r={radius} /></clipPath></defs>
      <text x={cx} y={27} textAnchor="middle" fill="#202020" fontSize="19">GRB localization · {isDemo ? "illustrative example" : "selected event"}</text>
      <circle cx={cx} cy={cy} r={radius} fill="#ffffff" stroke="#242424" strokeWidth="1.5" />
      <g clipPath={`url(#${clipId})`}>
        {Array.from({ length: 7 }, (_, i) => i * 30 - 90).map(decDeg => <path key={`dec-${decDeg}`} d={path(Array.from({ length: 361 }, (_, raDeg) => celestialToVector({ raDeg, decDeg })))} fill="none" stroke="#a3a3a3" strokeWidth={decDeg === 0 ? 1.3 : 1} />)}
        {Array.from({ length: 12 }, (_, i) => i * 30).map(raDeg => <path key={`ra-${raDeg}`} d={path(Array.from({ length: 181 }, (_, i) => celestialToVector({ raDeg, decDeg: i - 90 })))} fill="none" stroke="#a3a3a3" strokeWidth="1" />)}
        <text x={cx - 35} y={cy + 10} textAnchor="middle" fill="#b8b8b8" opacity="0.65" fontSize="37" transform={`rotate(-42 ${cx - 35} ${cy + 10})`}>PRELIMINARY</text>
        {markers.filter(marker => marker.name !== "Injected" && marker.point && event?.truth).map(marker => <path key={`arc-${marker.name}`} d={path(greatCircleArc(event!.truth!, marker.point!, 180))} fill="none" stroke={marker.color} strokeWidth="2" />)}
        {markers.map(marker => {
          if (!marker.point) return null;
          const projected = projectSkyVector(celestialToVector(marker.point), centre);
          return projected.visible ? <circle key={marker.name} cx={(cx + projected.x * radius).toFixed(3)} cy={(cy + projected.y * radius).toFixed(3)} r={marker.radius} fill={marker.color} stroke="#ffffff" strokeWidth="0.8"><title>{`${marker.name}: RA ${marker.point.raDeg.toFixed(3)}°, Dec ${marker.point.decDeg.toFixed(3)}°`}</title></circle> : null;
        })}
      </g>
      {Array.from({ length: 6 }, (_, i) => i * 60).map(raDeg => {
        const position = projectSkyVector(celestialToVector({ raDeg, decDeg: 0 }), centre);
        return position.visible ? <text key={`hour-${raDeg}`} x={(cx + position.x * radius).toFixed(3)} y={(cy + position.y * radius + 20).toFixed(3)} textAnchor="middle" fill="#222222" stroke="#ffffff" strokeWidth="4" paintOrder="stroke" fontSize="16">{raDeg / 15}<tspan baselineShift="super" fontSize="11">h</tspan></text> : null;
      })}
      <text x={cx} y={579} textAnchor="middle" fill="#333333" fontSize="14">Centre RA {centre.raDeg.toFixed(2)}° · Dec {centre.decDeg.toFixed(2)}°</text>
      <text x={cx} y={602} textAnchor="middle" fill="#606060" fontSize="12">RA increases ← · local north ↑ · grid 30° · 1 h = 15°</text>
    </svg>
    <div className={styles.legend}><span style={{ color: COLORS.truth }}>● Injected</span><span style={{ color: COLORS.ks }}>● KS{isDemo ? " (example)" : ""}</span><span style={{ color: COLORS.centroid }}>● {event?.dataOrigin === "archived-detection" ? "Archived centroid" : isDemo ? "Centroid (example)" : "Centroid"}</span></div>
    <div className={styles.projectionNotes}>
      <p>{event ? `${event.coordinateFrame} · ${event.gridLabel}` : "Select an event from the archive to display its directions."}</p>
      <p>{hidden.length ? `Outside the visible hemisphere: ${hidden.map(marker => marker.name).join(", ")}. Rotate the 3D globe to inspect those directions.` : "All supplied directions are on the visible hemisphere."} Arcs show angular separation; no per-event uncertainty areas are available.</p>
      <p>{isDemo ? "Demo: authored illustrative positions, not algorithm outputs or validated scientific results. No probability maps or confidence regions are represented." : event?.dataOrigin === "archived-detection" ? "Archived positive-excess centroid. A KS direction is displayed only if that event actually retained a KS reconstruction." : "Injected truth, KS and centroid use the same retained source-only pipeline snapshot."}</p>
    </div>
  </dialog>;
}
