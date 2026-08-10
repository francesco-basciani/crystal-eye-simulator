"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNav } from "../components/app-nav";
import { AdaptiveAnalysisPlot } from "../components/adaptive-background-panel";
import { runAggregateBackgroundKalman } from "../lib/kalman-scenarios";
import {
  deriveBurstStartsByRecord,
  openPhotonRepository,
  type PhotonCursor,
  type PhotonQueryResult,
  type PhotonRecord,
  type PhotonRepository,
} from "../lib/photon-repository";

const PAGE_SIZE = 100;

function parseInputUtc(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function PhotonHistoryPage() {
  const repositoryRef = useRef<PhotonRepository | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursors, setCursors] = useState<(PhotonCursor | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PhotonQueryResult>({ items: [], nextCursor: null, hasMore: false });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);

  const loadPage = useCallback(async (repository: PhotonRepository, pageIndex: number, cursor?: PhotonCursor) => {
    setStatus("loading");
    try {
      const next = await repository.query({
        fromMs: parseInputUtc(from),
        toMs: parseInputUtc(to),
        cursor,
        limit: PAGE_SIZE,
      });
      setResult(next);
      setSelectedRecordId(next.items[0]?.id ?? null);
      setPage(pageIndex);
      setError(null);
      setStatus("ready");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unknown IndexedDB query error.");
      setStatus("error");
    }
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    let repository: PhotonRepository | null = null;
    openPhotonRepository()
      .then((opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        repository = opened;
        repositoryRef.current = opened;
        return loadPage(opened, page, cursors[page]);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "IndexedDB is unavailable.");
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
      repository?.close();
      repositoryRef.current = null;
    };
    // The repository is opened once; filter changes are handled explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    const repository = repositoryRef.current;
    if (!repository) return;
    setCursors([undefined]);
    void loadPage(repository, 0);
  };

  const older = () => {
    const repository = repositoryRef.current;
    if (!repository || !result.nextCursor) return;
    const nextPage = page + 1;
    setCursors((current) => [...current.slice(0, nextPage), result.nextCursor ?? undefined]);
    void loadPage(repository, nextPage, result.nextCursor);
  };

  const newer = () => {
    const repository = repositoryRef.current;
    if (!repository || page === 0) return;
    const nextPage = page - 1;
    void loadPage(repository, nextPage, cursors[nextPage]);
  };

  const selectedRecord = useMemo(
    () => result.items.find((record) => record.id === selectedRecordId) ?? null,
    [result.items, selectedRecordId],
  );
  const selectedPageIndex = selectedRecord
    ? result.items.findIndex((record) => record.id === selectedRecord.id)
    : -1;
  const normalizedLegacyCount = result.items.filter(
    (record) => (record.normalizationWarnings?.length ?? 0) > 0,
  ).length;
  const analysisRecords = useMemo(() => {
    if (!selectedRecord) return [];
    return result.items
      .filter((record) => record.runId === selectedRecord.runId)
      .sort((left, right) => left.bin - right.bin || left.id - right.id);
  }, [result.items, selectedRecord]);
  const analysisRun = useMemo(() => {
    if (analysisRecords.length === 0 || !selectedRecord) return null;
    const burstStartsByRecord = deriveBurstStartsByRecord(analysisRecords);
    return runAggregateBackgroundKalman(
      analysisRecords.map((record) => ({
        frameIndex: record.bin,
        simulationTimeSeconds: record.bin * 0.2,
        exposureSeconds: 0.2,
        expectedBackgroundRateCountsPerSecond: record.background / 0.2,
        expectedSourceRateCountsPerSecond: record.source / 0.2,
        observedCounts: record.observed,
        activeBurstCount: record.activeBursts,
        startedBurstIds: burstStartsByRecord.get(record.id) ?? [],
      })),
      {
        scenarioId: `persisted-run-${selectedRecord.runId}`,
        scenarioSchemaVersion: selectedRecord.schemaVersion,
        seed: selectedRecord.id,
      },
    );
  }, [analysisRecords, selectedRecord]);
  const selectPageRow = (record: PhotonRecord) => setSelectedRecordId(record.id);

  return (
    <main className="data-page">
      <header className="data-page-header">
        <div>
          <span className="eyebrow">CRYSTAL EYE · LOCAL ACQUISITION DATA</span>
          <h1>PHOTON HISTORY</h1>
        </div>
        <AppNav current="/photon-history/" />
      </header>

      <section className="data-toolbar" aria-label="Photon history filters">
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
          ? `HISTORY UNAVAILABLE · ${error}`
          : status === "loading"
            ? "READING LOCAL PHOTON RECORDS…"
            : `${result.items.length} records on this page · newest first · stored locally in this browser${normalizedLegacyCount > 0 ? ` · ${normalizedLegacyCount} legacy rows normalized for display` : ""}`}
      </div>

      <section className="data-table-panel" aria-busy={status === "loading"}>
        {selectedRecord && analysisRun && (
          <section className="history-analysis-inspector" aria-labelledby="history-analysis-title">
            <header>
              <div>
                <small>
                  PERSISTED PAGE RECONSTRUCTION · PROVISIONAL
                  {selectedRecord.normalizationWarnings?.length
                    ? " · LEGACY ROW NORMALIZED"
                    : ""}
                </small>
                <strong id="history-analysis-title">Selected photon bin {selectedRecord.bin}</strong>
              </div>
              <div>
                <button
                  type="button"
                  disabled={selectedPageIndex <= 0}
                  onClick={() => setSelectedRecordId(result.items[selectedPageIndex - 1].id)}
                >
                  NEWER ROW
                </button>
                <button
                  type="button"
                  disabled={selectedPageIndex < 0 || selectedPageIndex >= result.items.length - 1}
                  onClick={() => setSelectedRecordId(result.items[selectedPageIndex + 1].id)}
                >
                  OLDER ROW
                </button>
              </div>
            </header>
            <div className="history-analysis-details">
              <span><small>SIMULATED UTC</small><strong>{new Date(selectedRecord.simulatedAtMs).toISOString()}</strong></span>
              <span><small>RUN / BIN</small><strong>{selectedRecord.runId.slice(0, 12)} / {selectedRecord.bin}</strong></span>
              <span><small>BACKGROUND</small><strong>{selectedRecord.background.toFixed(2)}</strong></span>
              <span><small>INJECTED SOURCE</small><strong>{selectedRecord.source.toFixed(2)}</strong></span>
              <span><small>OBSERVED</small><strong>{selectedRecord.observed.toFixed(2)}</strong></span>
              <span><small>ACTIVE GRB</small><strong>{selectedRecord.activeBursts}</strong></span>
            </div>
            <div className="history-analysis-plot">
              <AdaptiveAnalysisPlot
                points={analysisRun.points}
                selectedFrameIndex={selectedRecord.bin}
              />
            </div>
            <p>
              Reconstructed from persisted rows for the selected run on this 100-row page. Each yellow dot marks one injected GRB start; environmental changes and Poisson samples never create event dots. Legacy pages infer starts only from an increase in the recorded active-event count, so an event already active at the page boundary is not marked.
            </p>
          </section>
        )}
        <table className="data-table photon-data-table">
          <caption>Persisted photon acquisition records</caption>
          <thead>
            <tr>
              <th scope="col">INSPECT</th><th scope="col">ID</th><th scope="col">RUN</th><th scope="col">BIN</th>
              <th scope="col">SIMULATED UTC</th><th scope="col">CAPTURED UTC</th>
              <th scope="col">BACKGROUND</th><th scope="col">SOURCE</th><th scope="col">OBSERVED</th>
              <th scope="col">SUN</th><th scope="col">MOON</th><th scope="col">EARTH ALBEDO</th>
              <th scope="col">GRB</th><th scope="col">HIT PIXELS</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((record) => (
              <tr
                key={record.id}
                className={`${record.id === selectedRecordId ? "selected" : ""}${record.normalizationWarnings?.length ? " legacy-normalized" : ""}`}
                title={record.normalizationWarnings?.length
                  ? `Legacy fields normalized: ${record.normalizationWarnings.join(", ")}`
                  : undefined}
              >
                <td>
                  <button
                    type="button"
                    className="history-inspect-button"
                    aria-pressed={record.id === selectedRecordId}
                    onClick={() => selectPageRow(record)}
                  >
                    VIEW
                  </button>
                </td>
                <th scope="row">{record.id}</th>
                <td title={record.runId}>{record.runId.slice(0, 12)}</td>
                <td>{record.bin}</td>
                <td>{new Date(record.simulatedAtMs).toISOString().replace("T", " ")}</td>
                <td>{new Date(record.capturedAtMs).toISOString().replace("T", " ")}</td>
                <td>{record.background.toFixed(2)}</td><td>{record.source.toFixed(2)}</td><td>{record.observed.toFixed(2)}</td>
                <td>{record.sun.toFixed(2)}</td><td>{record.moon.toFixed(2)}</td><td>{record.earthAlbedo.toFixed(2)}</td>
                <td>{record.activeBursts}</td><td>{record.hitPixels}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {status === "ready" && result.items.length === 0 && <p className="data-empty">No persisted records match this UTC interval.</p>}
      </section>

      <footer className="data-pager">
        <span>Keyset page {page + 1} · up to {PAGE_SIZE} rows</span>
        <div>
          <button type="button" disabled={page === 0 || status === "loading"} onClick={newer}>NEWER</button>
          <strong>{page + 1}</strong>
          <button type="button" disabled={!result.hasMore || status === "loading"} onClick={older}>OLDER</button>
        </div>
      </footer>
    </main>
  );
}
