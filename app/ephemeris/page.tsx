"use client";

import { useEffect, useMemo, useState } from "react";
import { AppNav } from "../components/app-nav";
import {
  ECI_EPHEMERIS_END_MS,
  ECI_EPHEMERIS_START_MS,
  loadEciEphemerisProfile,
  type EciEphemerisProfile,
  type EciVectorKm,
} from "../lib/eci-ephemeris";
import { queryEciEphemeris } from "../lib/ephemeris-query";

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const PAGE_SIZE = 100;

function inputUtc(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 19);
}

function parseInputUtc(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function VectorCells({ vector }: { vector: EciVectorKm }) {
  return vector.map((value, index) => <td key={index}>{value.toLocaleString("en-US")}</td>);
}

export default function EphemerisPage() {
  const [profile, setProfile] = useState<EciEphemerisProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(inputUtc(ECI_EPHEMERIS_START_MS));
  const [to, setTo] = useState(inputUtc(ECI_EPHEMERIS_END_MS));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadEciEphemerisProfile(`${PUBLIC_BASE_PATH}/data/eci-ephemeris-2033.tsv`)
      .then((loaded) => {
        if (!cancelled) setProfile(loaded);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unknown ephemeris error.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo(
    () =>
      queryEciEphemeris(profile?.records ?? [], {
        fromMs: parseInputUtc(from),
        toMs: parseInputUtc(to),
        search,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    [from, page, profile, search, to],
  );
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(0);
  };

  return (
    <main className="data-page">
      <header className="data-page-header">
        <div>
          <span className="eyebrow">CRYSTAL EYE · CANONICAL INPUT DATA</span>
          <h1>ECI EPHEMERIS</h1>
        </div>
        <AppNav current="/ephemeris/" />
      </header>

      <section className="data-toolbar" aria-label="Ephemeris filters">
        <label>
          FROM UTC
          <input
            type="datetime-local"
            step="1"
            min={inputUtc(ECI_EPHEMERIS_START_MS)}
            max={inputUtc(ECI_EPHEMERIS_END_MS)}
            value={from}
            onChange={(event) => updateFilter(setFrom, event.target.value)}
          />
        </label>
        <label>
          TO UTC
          <input
            type="datetime-local"
            step="1"
            min={inputUtc(ECI_EPHEMERIS_START_MS)}
            max={inputUtc(ECI_EPHEMERIS_END_MS)}
            value={to}
            onChange={(event) => updateFilter(setTo, event.target.value)}
          />
        </label>
        <label className="data-search">
          SEARCH UTC OR VALUE
          <input
            type="search"
            value={search}
            placeholder="2033-01-01 or 6928.1"
            onChange={(event) => updateFilter(setSearch, event.target.value)}
          />
        </label>
      </section>

      <div className={`data-status ${error ? "error" : ""}`} role={error ? "alert" : "status"}>
        {error
          ? `EPHEMERIS UNAVAILABLE · ${error}`
          : profile
            ? `${result.total.toLocaleString("en-US")} matching records · validated SHA-256 ${profile.sha256.slice(0, 12)}…`
            : "VALIDATING ECI EPHEMERIS…"}
      </div>

      <section className="data-table-panel" aria-busy={!profile && !error}>
        <table className="data-table ephemeris-table">
          <caption>Satellite, Sun, and Moon positions in ECI kilometres</caption>
          <thead>
            <tr>
              <th scope="col">UTC</th>
              <th scope="col">SAT X</th><th scope="col">SAT Y</th><th scope="col">SAT Z</th>
              <th scope="col">SUN X</th><th scope="col">SUN Y</th><th scope="col">SUN Z</th>
              <th scope="col">MOON X</th><th scope="col">MOON Y</th><th scope="col">MOON Z</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((record) => (
              <tr key={record.timestampMs}>
                <th scope="row">{new Date(record.timestampMs).toISOString().replace("T", " ")}</th>
                <VectorCells vector={record.satelliteKm} />
                <VectorCells vector={record.sunKm} />
                <VectorCells vector={record.moonKm} />
              </tr>
            ))}
          </tbody>
        </table>
        {profile && result.items.length === 0 && <p className="data-empty">No matching records.</p>}
      </section>

      <footer className="data-pager">
        <span>
          Rows {result.total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, result.total)} of {result.total.toLocaleString("en-US")}
        </span>
        <div>
          <button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>NEWER</button>
          <strong>{Math.min(page + 1, pageCount)} / {pageCount}</strong>
          <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>OLDER</button>
        </div>
      </footer>
    </main>
  );
}
