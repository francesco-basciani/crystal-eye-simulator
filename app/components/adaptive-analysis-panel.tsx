"use client";

import type { AnalysisPoint } from "../lib/source-conditioned-kalman";
import type { BurstDirectionReconstruction } from "../lib/burst-direction-reconstruction";
import { deriveAnalysisScale } from "../lib/adaptive-analysis-scale";

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
  truthAngularErrorDeg: number;
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
}: {
  points: readonly AnalysisPoint[];
  mode: "reference" | "simulation";
  seed: number;
  onModeChange: (mode: "reference" | "simulation") => void;
  reconstruction: ReconstructionDisplay;
}) {
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
    <section className="adaptive-analysis-panel" aria-labelledby="adaptive-analysis-title">
      <header>
        <div>
          <small>0.2 S ACQUISITION · PROVISIONAL</small>
          <strong id="adaptive-analysis-title">Adaptive Background Analysis</strong>
        </div>
        <div className="analysis-mode-controls" role="group" aria-label="Observation mode">
          <button type="button" className={mode === "reference" ? "active" : ""} onClick={() => onModeChange("reference")}>REFERENCE</button>
          <button type="button" className={mode === "simulation" ? "active" : ""} onClick={() => onModeChange("simulation")}>SIMULATION</button>
        </div>
      </header>
      <div className="analysis-provenance">
        {mode === "simulation"
          ? `SEEDED POISSON OBSERVATIONS · SEPARATE RNG · SEED ${seed}`
          : "DETERMINISTIC CONFIGURED REFERENCE REPLAY"}
        {" · "}KNOWN INJECTED SOURCE BINS SKIP FILTER UPDATE
      </div>
      <div className="analysis-oracle-warning">SOURCE-CONDITIONED ORACLE · NOT A BLIND DETECTOR · NOT FLIGHT TELEMETRY</div>
      <div className="analysis-legend">
        <span className="observed">{mode === "simulation" ? "seeded Poisson stream" : "deterministic stream"}</span>
        <span className="configured">configured background</span>
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

      <section className="burst-reconstruction-panel" aria-labelledby="burst-reconstruction-title">
        <header><small>DERIVED DETECTOR RESPONSE · NOT INDEPENDENT TELEMETRY</small><strong id="burst-reconstruction-title">Burst Direction Reconstruction</strong></header>
        {reconstruction.status === "available" ? (
          <div className="reconstruction-grid">
            <span><small>METHOD</small><strong>POSITIVE-EXCESS WEIGHTED CENTROID</strong></span>
            <span><small>BURST</small><strong>#{reconstruction.burstId}</strong></span>
            <span><small>PEAK FRAME / TIME</small><strong>{reconstruction.reconstruction.frameIndex} / {reconstruction.reconstruction.acquisitionTimeSeconds.toFixed(1)} s</strong></span>
            <span><small>RA / DEC</small><strong>{reconstruction.reconstruction.raDeg.toFixed(2)}° / {reconstruction.reconstruction.decDeg.toFixed(2)}°</strong></span>
            <span><small>POSITIVE EXCESS</small><strong>{reconstruction.reconstruction.positiveExcessCounts.toFixed(2)} counts</strong></span>
            <span><small>ACTIVE PIXELS</small><strong>{reconstruction.reconstruction.activePixelCount}</strong></span>
            <span><small>SYNTHETIC EVALUATION · WITHHELD FROM ESTIMATOR</small><strong>TRUTH ERROR {reconstruction.truthAngularErrorDeg.toFixed(2)}°</strong></span>
          </div>
        ) : (
          <div className="reconstruction-unavailable">UNAVAILABLE · {reconstruction.reason.replaceAll("-", " ").toUpperCase()}</div>
        )}
        <p>Engineering reconstruction under current radial-attitude/minimum-rotation convention. Sun and Moon are not allocated in the derived per-pixel display. No confidence ellipse. Simultaneous bursts are unresolved.</p>
      </section>
    </section>
  );
}
