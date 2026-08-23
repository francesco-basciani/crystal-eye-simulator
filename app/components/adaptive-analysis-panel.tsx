"use client";

import { useState } from "react";
import type { AnalysisPoint } from "../lib/source-conditioned-kalman";
import type { BurstDirectionReconstruction } from "../lib/burst-direction-reconstruction";
import { deriveAnalysisScale } from "../lib/adaptive-analysis-scale";
import {
  BURST_COORDINATE_EPOCH,
  BURST_COORDINATE_FRAME,
  BURST_DEC_CONVENTION,
  BURST_RA_CONVENTION,
  type BurstTruthEvaluation,
} from "../lib/burst-event-repository";

const WIDTH = 680;
const HEIGHT = 400;
const LEFT = 62;
const RIGHT = 18;
const TOP = 24;
const SIGNAL_BOTTOM = 265;
const INNOVATION_TOP = 315;
const INNOVATION_BOTTOM = 375;

function path(
  points: readonly AnalysisPoint[],
  x: (index: number) => number,
  y: (point: AnalysisPoint) => number,
) {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point).toFixed(2)}`,
  ).join(" ");
}

export type ReconstructionDisplay = Readonly<{
  status: "available";
  burstId: number;
  reconstruction: BurstDirectionReconstruction;
  truth: BurstTruthEvaluation;
}> | Readonly<{
  status: "unavailable";
  reason:
    | "awaiting-source"
    | "invalid-input"
    | "zero-positive-excess"
    | "degenerate-centroid"
    | "simultaneous-unresolved";
}>;

export function AdaptiveAnalysisPanel({
  points,
  mode,
  seed,
  onModeChange,
  reconstruction,
  historyHref,
  historyRowCount,
}: {
  points: readonly AnalysisPoint[];
  mode: "reference" | "simulation";
  seed: number;
  onModeChange: (mode: "reference" | "simulation") => void;
  reconstruction: ReconstructionDisplay;
  historyHref: string;
  historyRowCount: number;
}) {
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);
  const [reconstructionCollapsed, setReconstructionCollapsed] = useState(false);
  const visible = points.slice(-120);
  const { minimum, maximum, ticks } = deriveAnalysisScale(visible);
  const maximumInnovation = Math.max(
    1,
    ...visible.map((point) => Math.abs(point.signedInnovationCounts)),
  );
  const x = (index: number) =>
    LEFT + index / Math.max(1, visible.length - 1) * (WIDTH - LEFT - RIGHT);
  const ySignal = (value: number) =>
    SIGNAL_BOTTOM - (value - minimum) / Math.max(1, maximum - minimum) * (SIGNAL_BOTTOM - TOP);
  const yInnovation = (value: number) =>
    (INNOVATION_TOP + INNOVATION_BOTTOM) / 2 -
    value / maximumInnovation * (INNOVATION_BOTTOM - INNOVATION_TOP) / 2;
  const confidenceArea = visible.length === 0 ? "" : [
    ...visible.map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${ySignal(point.upperBackgroundCounts).toFixed(2)}`,
    ),
    ...[...visible].reverse().map((point, reverseIndex) => {
      const index = visible.length - reverseIndex - 1;
      return `L${x(index).toFixed(2)},${ySignal(point.lowerBackgroundCounts).toFixed(2)}`;
    }),
    "Z",
  ].join(" ");

  return (
    <section className={`adaptive-analysis-panel collapsible-panel ${analysisCollapsed ? "is-collapsed" : ""}`} aria-labelledby="adaptive-analysis-title">
      <header className="unified-panel-header">
        <div>
          <small>PHOTON STREAM · 0.2 S ACQUISITION · PROVISIONAL</small>
          <strong id="adaptive-analysis-title">Adaptive Background Analysis</strong>
        </div>
        <div className="analysis-header-actions">
          <a className="analysis-history-link" href={historyHref} aria-label="Open photon stream history table">
            {historyRowCount.toLocaleString("en-US")} ROWS&nbsp;›
          </a>
          <button
            type="button"
            className="panel-collapse-button"
            aria-expanded={!analysisCollapsed}
            aria-label={`${analysisCollapsed ? "Expand" : "Collapse"} adaptive background analysis`}
            onClick={() => setAnalysisCollapsed((current) => !current)}
          >
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
      </header>
      <div className="collapsible-panel-body analysis-panel-body">
        <div className="analysis-mode-toolbar">
          <span>OBSERVATION MODE</span>
          <div className="analysis-mode-controls" role="group" aria-label="Observation mode">
            <button type="button" className={mode === "reference" ? "active" : ""} onClick={() => onModeChange("reference")}>REFERENCE</button>
            <button type="button" className={mode === "simulation" ? "active" : ""} onClick={() => onModeChange("simulation")}>SIMULATION</button>
          </div>
        </div>
        <div className="analysis-provenance">
          {mode === "simulation"
            ? `SEEDED POISSON · VISIBLE SUN/MOON/EARTH ONLY · RITO EXCLUDED · SEPARATE RNG · SEED ${seed}`
            : "DETERMINISTIC REFERENCE · RITO + VISIBLE SUN/MOON/EARTH"}
          {" · "}KNOWN INJECTED SOURCE BINS SKIP FILTER UPDATE
        </div>
        <div className="analysis-oracle-warning">SOURCE-CONDITIONED ORACLE · NOT A BLIND DETECTOR · NOT FLIGHT TELEMETRY</div>
        <div className="analysis-legend">
          <span className="observed">{mode === "simulation" ? "seeded Poisson stream" : "deterministic stream"}</span>
          <span className="configured">{mode === "simulation" ? "visible environment background" : "Rito + visible environment"}</span>
          <span className="estimate">cyan estimate ±1σ</span>
          <span className="onset">one marker per burst onset</span>
        </div>
        <svg className="adaptive-analysis-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Observed counts, configured background, adaptive estimate with uncertainty, signed innovation, and injected burst onset markers">
          <title>Adaptive background analysis in counts per 0.2 second bin</title>
          {ticks.map((tick, index) => {
            const fraction = index / Math.max(1, ticks.length - 1);
            return <g key={fraction}><line className="analysis-grid-line" x1={LEFT} x2={WIDTH - RIGHT} y1={TOP + fraction * (SIGNAL_BOTTOM - TOP)} y2={TOP + fraction * (SIGNAL_BOTTOM - TOP)} /><text className="analysis-axis-label" x={LEFT - 8} y={TOP + fraction * (SIGNAL_BOTTOM - TOP) + 3} textAnchor="end">{tick.toFixed(0)}</text></g>;
          })}
          <line className="analysis-grid-line" x1={LEFT} x2={WIDTH - RIGHT} y1={(INNOVATION_TOP + INNOVATION_BOTTOM) / 2} y2={(INNOVATION_TOP + INNOVATION_BOTTOM) / 2} />
          <path className="analysis-confidence" d={confidenceArea} />
          <path className="analysis-configured-line" d={path(visible, x, (point) => ySignal(point.configuredBackgroundCounts))} />
          <path className="analysis-estimate-line" d={path(visible, x, (point) => ySignal(point.estimatedBackgroundCounts))} />
          <path className="analysis-observed-line" d={path(visible, x, (point) => ySignal(point.observedCounts))} />
          <path className="analysis-innovation-line" d={path(visible, x, (point) => yInnovation(point.signedInnovationCounts))} />
          {visible.flatMap((point, index) => point.startedBurstIds.map((burstId) => (
            <circle key={`${point.frameIndex}-${burstId}`} className="analysis-onset-marker" cx={x(index)} cy={ySignal(point.observedCounts)} r="4"><title>{`Injected burst #${burstId} onset`}</title></circle>
          )))}
          <text className="analysis-axis-title" x="8" y="16">COUNTS / BIN</text>
          <text className="analysis-axis-title" x="8" y={INNOVATION_TOP - 8}>SIGNED INNOVATION</text>
          <text className="analysis-axis-label" x={LEFT - 8} y={INNOVATION_TOP + 3} textAnchor="end">+{maximumInnovation.toFixed(0)}</text>
          <text className="analysis-axis-label" x={LEFT - 8} y={(INNOVATION_TOP + INNOVATION_BOTTOM) / 2 + 3} textAnchor="end">0</text>
          <text className="analysis-axis-label" x={LEFT - 8} y={INNOVATION_BOTTOM + 3} textAnchor="end">−{maximumInnovation.toFixed(0)}</text>
        </svg>
      </div>

      <section className={`burst-reconstruction-panel collapsible-panel ${reconstructionCollapsed ? "is-collapsed" : ""}`} aria-labelledby="burst-reconstruction-title">
        <header className="unified-panel-header">
          <div><small>DERIVED DETECTOR RESPONSE · NOT INDEPENDENT TELEMETRY</small><strong id="burst-reconstruction-title">Burst Direction Reconstruction</strong></div>
          <button
            type="button"
            className="panel-collapse-button"
            aria-expanded={!reconstructionCollapsed}
            aria-label={`${reconstructionCollapsed ? "Expand" : "Collapse"} burst direction reconstruction`}
            onClick={() => setReconstructionCollapsed((current) => !current)}
          >
            <span aria-hidden="true">⌄</span>
          </button>
        </header>
        <div className="collapsible-panel-body reconstruction-panel-body">
          {reconstruction.status === "available" ? (
            <div className="reconstruction-grid">
            <span><small>METHOD</small><strong>POSITIVE-EXCESS WEIGHTED CENTROID</strong></span>
            <span><small>BURST</small><strong>#{reconstruction.burstId}</strong></span>
            <span><small>PEAK FRAME / TIME</small><strong>{reconstruction.reconstruction.frameIndex} / {reconstruction.reconstruction.acquisitionTimeSeconds.toFixed(1)} s</strong></span>
            <span><small>INJECTED TRUTH · WITHHELD FROM ESTIMATOR</small><strong>{reconstruction.truth.status === "available" ? `RA ${reconstruction.truth.raDeg.toFixed(2)}° · Dec ${reconstruction.truth.decDeg.toFixed(2)}°` : "N/A · NO INJECTED TRUTH"}</strong></span>
            <span><small>RECONSTRUCTED DIRECTION</small><strong>RA {reconstruction.reconstruction.raDeg.toFixed(2)}° · Dec {reconstruction.reconstruction.decDeg.toFixed(2)}°</strong></span>
            <span><small>ANGULAR SEPARATION · GREAT-CIRCLE</small><strong>{reconstruction.truth.status === "available" ? `${reconstruction.truth.angularErrorDeg.toFixed(2)}°` : "N/A"}</strong></span>
            <span><small>POSITIVE EXCESS</small><strong>{reconstruction.reconstruction.positiveExcessCounts.toFixed(2)} counts</strong></span>
            <span><small>ACTIVE PIXELS</small><strong>{reconstruction.reconstruction.activePixelCount}</strong></span>
            </div>
          ) : (
            <div className="reconstruction-unavailable">UNAVAILABLE · {reconstruction.reason.replaceAll("-", " ").toUpperCase()}</div>
          )}
          <p>{BURST_COORDINATE_FRAME} · epoch: {BURST_COORDINATE_EPOCH} · RA {BURST_RA_CONVENTION} · Dec {BURST_DEC_CONVENTION}. Engineering reconstruction under the current radial-attitude/minimum-rotation convention. Truth is evaluation-only and never estimator input. No confidence ellipse. Simultaneous bursts are unresolved.</p>
        </div>
      </section>
    </section>
  );
}
