"use client";

import { ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "../components/app-nav";
import {
  openBurstEventRepository,
  type BurstDetectionRecord,
  type BurstEventCursor,
  type BurstEventQueryResult,
  type BurstEventRepository,
} from "../lib/burst-event-repository";

const PAGE_SIZE = 100;

function parseInputUtc(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function LayerStatus() {
  return <span className="layer-unavailable">UNAVAILABLE</span>;
}

function EventDetail({
  record,
  onClose,
}: {
  record: BurstDetectionRecord;
  onClose: () => void;
}) {
  return (
    <div
      className="event-detail-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="event-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
      >
        <header>
          <div>
            <small>PROVISIONAL · INJECTED-SOURCE RECONSTRUCTION</small>
            <strong id="event-detail-title">GRB EVENT #{record.burstId}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close event detail">
            <X size={17} />
          </button>
        </header>

        <div className="event-detail-summary">
          <span><small>SIMULATED UTC</small><strong>{record.simulatedDate}</strong></span>
          <span><small>RECONSTRUCTED POSITION</small><strong>RA {record.reconstructedRaDeg.toFixed(3)}° · Dec {record.reconstructedDecDeg.toFixed(3)}°</strong></span>
          <span><small>INPUT TRUTH · EVALUATION ONLY</small><strong>RA {record.truthRaDeg.toFixed(3)}° · Dec {record.truthDecDeg.toFixed(3)}° · error {record.truthAngularErrorDeg.toFixed(3)}°</strong></span>
          <span><small>SIGNAL</small><strong>{record.positiveExcessCounts.toFixed(3)} expected excess counts / {record.exposureSeconds.toFixed(1)} s</strong></span>
          <span><small>INPUT INTENSITY</small><strong>{record.configuredIntensityPercent.toFixed(1)}% · physical power unavailable</strong></span>
          <span><small>MODULES</small><strong>{record.activePixelCount} positive-excess · {record.footprintPixelIds.length} configured footprint</strong></span>
        </div>

        <p className="event-layer-notice">
          Aggregate expected module response is available. Per-layer measured counts and energy for Upper ACD, Upper GAGG and Lower LYSO remain unavailable until a validated layer-resolved response model is integrated.
        </p>

        <div className="event-pixel-table-wrap">
          <table className="data-table event-pixel-table">
            <caption>All 126 physical modules at the peak reconstruction frame</caption>
            <thead>
              <tr>
                <th>PIXEL ID</th>
                <th>AGGREGATE EXPECTED</th>
                <th>BACKGROUND EXPECTED</th>
                <th>SOURCE EXCESS EXPECTED</th>
                <th>RELATIVE IMPACT</th>
                <th>UPPER ACD</th>
                <th>UPPER GAGG</th>
                <th>LOWER LYSO</th>
              </tr>
            </thead>
            <tbody>
              {record.pixels.map((pixel) => (
                <tr key={pixel.pixelId} className={pixel.sourceExcessExpectedCounts > 0 ? "source-pixel" : ""}>
                  <th scope="row">{pixel.pixelId}</th>
                  <td>{pixel.aggregateExpectedCounts.toFixed(4)}</td>
                  <td>{pixel.backgroundExpectedCounts.toFixed(4)}</td>
                  <td>{pixel.sourceExcessExpectedCounts.toFixed(4)}</td>
                  <td>{(pixel.relativeImpact * 100).toFixed(1)}%</td>
                  <td><LayerStatus /></td>
                  <td><LayerStatus /></td>
                  <td><LayerStatus /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function EventHistoryPage() {
  const repositoryRef = useRef<BurstEventRepository | null>(null);
  const requestedEventKeyRef = useRef<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursors, setCursors] = useState<(BurstEventCursor | undefined)[]>([
    undefined,
  ]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<BurstEventQueryResult>({
    items: [],
    nextCursor: null,
    hasMore: false,
  });
  const [selected, setSelected] = useState<BurstDetectionRecord | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (
      repository: BurstEventRepository,
      pageIndex: number,
      cursor?: BurstEventCursor,
    ) => {
      setStatus("loading");
      try {
        const next = await repository.query({
          fromMs: parseInputUtc(from),
          toMs: parseInputUtc(to),
          cursor,
          limit: PAGE_SIZE,
        });
        setResult(next);
        setPage(pageIndex);
        setError(null);
        setStatus("ready");
        const requested = requestedEventKeyRef.current;
        if (requested) {
          const match = next.items.find((item) => item.eventKey === requested);
          if (match) setSelected(match);
          requestedEventKeyRef.current = null;
        }
      } catch (reason: unknown) {
        setError(
          reason instanceof Error ? reason.message : "Unknown IndexedDB query error.",
        );
        setStatus("error");
      }
    },
    [from, to],
  );

  useEffect(() => {
    requestedEventKeyRef.current = new URLSearchParams(window.location.search).get(
      "event",
    );
    let cancelled = false;
    let repository: BurstEventRepository | null = null;
    openBurstEventRepository()
      .then((opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        repository = opened;
        repositoryRef.current = opened;
        return loadPage(opened, 0);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : "IndexedDB is unavailable.",
          );
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
      repository?.close();
      repositoryRef.current = null;
    };
    // Repository lifetime is intentionally independent from filter edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    const repository = repositoryRef.current;
    if (!repository) return;
    setCursors([undefined]);
    setSelected(null);
    void loadPage(repository, 0);
  };

  const older = () => {
    const repository = repositoryRef.current;
    if (!repository || !result.nextCursor) return;
    const nextPage = page + 1;
    setCursors((current) => [
      ...current.slice(0, nextPage),
      result.nextCursor ?? undefined,
    ]);
    void loadPage(repository, nextPage, result.nextCursor);
  };

  const newer = () => {
    const repository = repositoryRef.current;
    if (!repository || page === 0) return;
    const nextPage = page - 1;
    void loadPage(repository, nextPage, cursors[nextPage]);
  };

  return (
    <main className="data-page">
      <header className="data-page-header">
        <div>
          <span className="eyebrow">CRYSTAL EYE · LOCAL EVENT ARCHIVE</span>
          <h1>GRB EVENTS</h1>
        </div>
        <AppNav current="/event-history/" />
      </header>

      <section className="data-toolbar" aria-label="GRB event history filters">
        <label>
          FROM SIMULATED UTC
          <input type="datetime-local" step="1" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          TO SIMULATED UTC
          <input type="datetime-local" step="1" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button type="button" onClick={applyFilters} disabled={status !== "ready"}>APPLY UTC FILTER</button>
      </section>

      <div className={`data-status ${status === "error" ? "error" : ""}`} role={status === "error" ? "alert" : "status"}>
        {status === "error"
          ? `EVENT ARCHIVE UNAVAILABLE · ${error}`
          : status === "loading"
            ? "READING LOCAL GRB EVENT RECORDS…"
            : `${result.items.length} reconstructed events on this page · newest first · stored locally in this browser`}
      </div>

      <section className="data-table-panel" aria-busy={status === "loading"}>
        <table className="data-table grb-event-table">
          <caption>Persisted provisional GRB reconstruction records</caption>
          <thead>
            <tr>
              <th>EVENT</th><th>SIMULATED UTC</th><th>CLASSIFICATION</th>
              <th>RECONSTRUCTED RA</th><th>RECONSTRUCTED DEC</th>
              <th>INPUT INTENSITY</th><th>PHYSICAL POWER</th>
              <th>EXCESS / 0.2 S</th><th>MODULES</th><th>DETAIL</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((record) => (
              <tr key={record.eventKey}>
                <th scope="row">#{record.burstId}</th>
                <td>{record.simulatedDate.replace("T", " ")}</td>
                <td>PROVISIONAL RECONSTRUCTION</td>
                <td>{record.reconstructedRaDeg.toFixed(3)}°</td>
                <td>{record.reconstructedDecDeg.toFixed(3)}°</td>
                <td>{record.configuredIntensityPercent.toFixed(1)}%</td>
                <td><LayerStatus /></td>
                <td>{record.positiveExcessCounts.toFixed(3)}</td>
                <td>{record.activePixelCount}</td>
                <td>
                  <button className="event-detail-button" type="button" onClick={() => setSelected(record)}>
                    126 PIXELS <ChevronRight size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {status === "ready" && result.items.length === 0 && (
          <p className="data-empty">No reconstructed GRB event matches this UTC interval.</p>
        )}
      </section>

      <footer className="data-pager">
        <span>Keyset page {page + 1} · up to {PAGE_SIZE} events</span>
        <div>
          <button type="button" disabled={page === 0 || status === "loading"} onClick={newer}>NEWER</button>
          <strong>{page + 1}</strong>
          <button type="button" disabled={!result.hasMore || status === "loading"} onClick={older}>OLDER</button>
        </div>
      </footer>

      {selected && <EventDetail record={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
