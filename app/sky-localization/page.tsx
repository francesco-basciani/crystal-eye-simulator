"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "../components/app-header";
import { GrbSkyLocalization } from "../components/grb-sky-localization";
import { loadSkyLocalizationHistory } from "../lib/sky-localization-archive";
import { SKY_BENCHMARK_EXAMPLES } from "../lib/sky-benchmark-examples";
import type { SkyLocalizationEvent } from "../lib/sky-localization";
import styles from "./page.module.css";

function origin(event: SkyLocalizationEvent) {
  if (event.dataOrigin === "benchmark") return "Computed · KS + centroid";
  if (event.referenceOverlay) return "Sky-map comparison";
  return event.dataOrigin === "archived-detection" ? "Centroid" : "KS + centroid (source-only)";
}
function errorText(value: number | null) { return value == null ? "—" : `${value.toFixed(3)}°`; }

export default function SkyLocalizationPage() {
  const [events, setEvents] = useState<readonly SkyLocalizationEvent[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef({ value: 0 });
  const selected = [...events, ...SKY_BENCHMARK_EXAMPLES].find(event => event.eventKey === selectedKey);
  const refresh = useCallback(async () => {
    const guard = requestRef.current;
    const request = ++guard.value;
    setStatus("loading");
    setError(null);
    try {
      const history = (await loadSkyLocalizationHistory()).filter(event => event.dataOrigin !== "demo" && event.dataOrigin !== "reference" && !event.eventKey.startsWith("demo:"));
      if (request !== guard.value) return;
      // A row can be selected while the archive read is in flight.
      const requestedKey = new URL(window.location.href).searchParams.get("event");
      const requested = requestedKey;
      setRequestedKey(requested);
      setEvents(history);
      setSelectedKey(current => {
        if (requested) return [...history, ...SKY_BENCHMARK_EXAMPLES].some(event => event.eventKey === requested) ? requested : null;
        return [...history, ...SKY_BENCHMARK_EXAMPLES].some(event => event.eventKey === current) ? current : null;
      });
      setStatus("ready");
    } catch (cause) {
      if (request !== guard.value) return;
      const requestedKey = new URL(window.location.href).searchParams.get("event");
      const requested = requestedKey;
      setRequestedKey(requested);
      if (requested) setSelectedKey(requested);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  }, []);
  useEffect(() => {
    const guard = requestRef.current;
    const initialFrame = requestAnimationFrame(() => { void refresh(); });
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onHistory = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("popstate", onHistory);
    return () => {
      cancelAnimationFrame(initialFrame);
      guard.value++;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("popstate", onHistory);
    };
  }, [refresh]);
  const selectEvent = (event: SkyLocalizationEvent) => {
    setSelectedKey(event.eventKey);
    setRequestedKey(event.eventKey);
    const url = new URL(window.location.href);
    url.searchParams.set("event", event.eventKey);
    url.searchParams.set("view", event.dataOrigin === "benchmark" ? "examples" : "archive");
    window.history.replaceState(null, "", url);
  };
  const visibleEvents = [...SKY_BENCHMARK_EXAMPLES, ...events];
  return <main className={styles.page}>
    <AppHeader current="/sky-localization/" />
    <header className="data-page-header">
      <div><small>CRYSTAL EYE · SKY LOCALIZATION</small><h1>GRB sky localization</h1></div>

    </header>
    <div className={styles.content}>
      <GrbSkyLocalization events={selected ? [selected] : []} showEventControls={false} />
      {status === "error" && <p className={styles.notice} role="alert">Archive unavailable: {error}</p>}
      {status === "ready" && requestedKey && !selected && <p className={styles.notice} role="status">Event not found in this browser’s archive.</p>}
      <section className={styles.archive} aria-labelledby="sky-event-archive" aria-busy={status === "loading"}>
        <header><h2 id="sky-event-archive">Bursts and computed examples <span>({visibleEvents.length})</span></h2><button type="button" onClick={() => void refresh()} disabled={status === "loading"}>{status === "loading" ? "Loading…" : "Refresh"}</button></header>
        <div className={styles.tableScroll}><table>
          <caption>Archived bursts and angular separation from injected direction</caption>
          <thead><tr><th scope="col">Burst</th><th scope="col">Time / coordinates</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col">KS Δ°</th><th scope="col">Centroid Δ°</th><th scope="col">View</th></tr></thead>
          <tbody>{visibleEvents.map(event => <tr key={event.eventKey} data-selected={event.eventKey === selectedKey}>
            <th scope="row" title={event.eventKey}><strong>{event.dataOrigin === "benchmark" ? "Example · case" : "GRB"} #{event.burstId}</strong>{event.dataOrigin !== "benchmark" && <code title={event.eventKey}>Run {event.eventKey.slice(0, event.eventKey.lastIndexOf(":" )).slice(0, 8)}</code>}</th><td>{event.dataOrigin === "benchmark" && event.truth ? `${(90-event.truth.decDeg).toFixed(2)}° / ${((-event.truth.raDeg+360)%360).toFixed(2)}°` : event.simulatedDate.replace("T", " ").replace(".000Z", "")}</td><td>{origin(event)}</td><td>{event.status}</td><td>{errorText(event.ksErrorDeg)}</td><td>{errorText(event.centroidErrorDeg)}</td><td><button type="button" aria-pressed={event.eventKey === selectedKey} aria-label={`Select ${event.dataOrigin === "benchmark" ? "case" : "GRB"} ${event.burstId} at ${event.simulatedDate}, ${event.eventKey}`} onClick={() => selectEvent(event)}>{event.eventKey === selectedKey ? "Selected" : "Select"}</button></td>
          </tr>)}</tbody>
        </table></div>
        {status === "ready" && !visibleEvents.length && <p className={styles.empty}>No bursts yet.</p>}
      </section>
    </div>
  </main>;
}
