"use client";

import { useMemo } from "react";
import { Maximize2 } from "lucide-react";
import {
  KALMAN_DEMONSTRATOR_LABEL,
  runAggregateBackgroundKalman,
  type KalmanAnalysisPoint,
  type KalmanReferenceFrame,
} from "../lib/kalman-scenarios";

export type AdaptiveAnalysisSample = Readonly<{
  frameIndex: number;
  acquisitionTimeSeconds: number;
  simulationTimeSeconds: number;
  exposureSeconds: number;
  expectedBackgroundCounts: number;
  expectedSourceCounts: number;
  observedCounts: number;
  activeBurstCount: number;
}>;

const WIDTH = 680;
const HEIGHT = 342;
const LEFT = 82;
const RIGHT = 18;
const UPPER_TOP = 28;
const UPPER_BOTTOM = 214;
const LOWER_TOP = 258;
const LOWER_BOTTOM = 314;

function niceStep(rawStep: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Number.EPSILON, rawStep)));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function formatRateTick(value: number) {
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
    : value.toFixed(0);
}

function linePath(
  points: readonly KalmanAnalysisPoint[],
  x: (point: KalmanAnalysisPoint, index: number) => number,
  y: (point: KalmanAnalysisPoint) => number,
) {
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(point, index).toFixed(2)},${y(point).toFixed(2)}`,
    )
    .join(" ");
}

export function AdaptiveAnalysisPlot({
  points,
  selectedFrameIndex,
}: {
  points: readonly KalmanAnalysisPoint[];
  selectedFrameIndex?: number;
}) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const maximumRate = Math.max(
    1,
    ...points.map((point) =>
      Math.max(
        point.observedRateCountsPerSecond,
        point.upperBackgroundRateCountsPerSecond,
        point.expectedBackgroundRateCountsPerSecond +
          point.expectedSourceRateCountsPerSecond,
      ),
    ),
  );
  const minimumRate = Math.max(
    0,
    Math.min(
      ...points.map((point) =>
        Math.min(
          point.observedRateCountsPerSecond,
          point.lowerBackgroundRateCountsPerSecond,
        ),
      ),
    ),
  );
  const center = (maximumRate + minimumRate) / 2;
  // Display-only floor: keep count noise and environmental variation visually
  // subordinate to a transient without changing any observation or filter input.
  const minimumSpan = Math.max(10, center * 0.25);
  const dataSpan = Math.max(minimumSpan, maximumRate - minimumRate);
  const padding = dataSpan * 0.08;
  const provisionalMinimum = Math.max(0, center - dataSpan / 2 - padding);
  const provisionalMaximum = center + dataSpan / 2 + padding;
  const tickStep = niceStep((provisionalMaximum - provisionalMinimum) / 4);
  const yMinimum = Math.max(0, Math.floor(provisionalMinimum / tickStep) * tickStep);
  const yMaximum = Math.ceil(provisionalMaximum / tickStep) * tickStep;
  const rateSpan = Math.max(1, yMaximum - yMinimum);
  const x = (_point: KalmanAnalysisPoint, index: number) =>
    LEFT + (index / Math.max(1, points.length - 1)) * plotWidth;
  const yRate = (value: number) =>
    UPPER_BOTTOM - ((value - yMinimum) / rateSpan) * (UPPER_BOTTOM - UPPER_TOP);
  const yInnovation = (value: number) =>
    LOWER_BOTTOM -
    ((Math.max(-6, Math.min(6, value)) + 6) / 12) *
      (LOWER_BOTTOM - LOWER_TOP);
  const confidenceArea = [
    ...points.map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(point, index).toFixed(2)},${yRate(point.upperBackgroundRateCountsPerSecond).toFixed(2)}`,
    ),
    ...[...points].reverse().map((point, reverseIndex) => {
      const index = points.length - reverseIndex - 1;
      return `L${x(point, index).toFixed(2)},${yRate(point.lowerBackgroundRateCountsPerSecond).toFixed(2)}`;
    }),
    "Z",
  ].join(" ");
  const sourceArea = [
    ...points.map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(point, index).toFixed(2)},${yRate(point.expectedBackgroundRateCountsPerSecond + point.expectedSourceRateCountsPerSecond).toFixed(2)}`,
    ),
    ...[...points].reverse().map((point, reverseIndex) => {
      const index = points.length - reverseIndex - 1;
      return `L${x(point, index).toFixed(2)},${yRate(point.expectedBackgroundRateCountsPerSecond).toFixed(2)}`;
    }),
    "Z",
  ].join(" ");

  return (
    <svg
      className="kalman-plot adaptive-analysis-plot"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Continuous observed stream, configured background reference, adaptive estimate and uncertainty, injected GRB event dots, and normalized innovation"
    >
      <title>Adaptive background and transient analysis</title>
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = UPPER_TOP + fraction * (UPPER_BOTTOM - UPPER_TOP);
        return (
          <g key={fraction}>
            <line className="kalman-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
            <text className="kalman-axis-label" x={LEFT - 12} y={y + 5} textAnchor="end">
              {formatRateTick(yMaximum - fraction * rateSpan)}
            </text>
          </g>
        );
      })}
      <path className="kalman-confidence" d={confidenceArea} />
      <path className="kalman-source-area" d={sourceArea} />
      <path className="kalman-truth-line" d={linePath(points, x, (point) => yRate(point.expectedBackgroundRateCountsPerSecond))} />
      <path className="kalman-estimate-line" d={linePath(points, x, (point) => yRate(point.estimatedBackgroundRateCountsPerSecond))} />
      <path className="kalman-observed-line" d={linePath(points, x, (point) => yRate(point.observedRateCountsPerSecond))} />
      {points.map((point, index) =>
        (point.activeBurstCount ?? 0) > 0 ? (
          <circle
            className="kalman-source-event-marker"
            key={`source-event-${point.frameIndex}`}
            cx={x(point, index)}
            cy={yRate(
              point.expectedBackgroundRateCountsPerSecond +
                point.expectedSourceRateCountsPerSecond,
            )}
            r={4.2}
          >
            <title>{`Injected GRB active · frame ${point.frameIndex}`}</title>
          </circle>
        ) : null,
      )}
      {selectedFrameIndex !== undefined && points.map((point, index) =>
        point.frameIndex === selectedFrameIndex ? (
          <line
            className="kalman-selected-frame"
            key={`selected-${point.frameIndex}`}
            x1={x(point, index)}
            x2={x(point, index)}
            y1={UPPER_TOP}
            y2={LOWER_BOTTOM}
          />
        ) : null,
      )}
      {[-4, 0, 4].map((innovation) => (
        <g key={innovation}>
          <line className={innovation === 0 ? "kalman-zero" : "kalman-gate"} x1={LEFT} x2={WIDTH - RIGHT} y1={yInnovation(innovation)} y2={yInnovation(innovation)} />
          <text className="kalman-axis-label" x={LEFT - 12} y={yInnovation(innovation) + 5} textAnchor="end">{innovation > 0 ? `+${innovation}` : innovation}</text>
        </g>
      ))}
      <path className="kalman-innovation-line" d={linePath(points, x, (point) => yInnovation(point.normalizedInnovation))} />
      <text className="kalman-axis-title" x={8} y={18}>RATE · COUNTS/S</text>
      <text className="kalman-axis-title" x={8} y={248}>NORMALIZED INNOVATION · ±4 GATE</text>
      <text className="kalman-time-label" x={LEFT} y={338}>{(points[0]?.simulationTimeSeconds ?? 0).toFixed(1)} s</text>
      <text className="kalman-time-label" x={WIDTH - RIGHT} y={338} textAnchor="end">{(points.at(-1)?.simulationTimeSeconds ?? 0).toFixed(1)} s acquisition time</text>
    </svg>
  );
}

export function AdaptiveBackgroundPanel({
  samples,
  mode,
  seed,
  onSeedChange,
  onExpand,
  historyHref,
}: {
  samples: readonly AdaptiveAnalysisSample[];
  mode: "reference" | "simulation";
  seed: number;
  onSeedChange: (seed: number) => void;
  onExpand?: () => void;
  historyHref?: string;
}) {
  const run = useMemo(() => {
    const frames: KalmanReferenceFrame[] = samples.map((sample) => ({
      frameIndex: sample.frameIndex,
      // The estimator evolves on acquisition time, not accelerated orbit time.
      simulationTimeSeconds: sample.acquisitionTimeSeconds,
      exposureSeconds: sample.exposureSeconds,
      expectedBackgroundRateCountsPerSecond:
        sample.expectedBackgroundCounts / sample.exposureSeconds,
      expectedSourceRateCountsPerSecond:
        sample.expectedSourceCounts / sample.exposureSeconds,
      observedCounts: sample.observedCounts,
      activeBurstCount: sample.activeBurstCount,
    }));
    return runAggregateBackgroundKalman(frames, {
      scenarioId: mode === "simulation" ? "live-seeded-simulation-v1" : "live-reference-replay-v1",
      scenarioSchemaVersion: 1,
      seed,
    });
  }, [mode, samples, seed]);

  return (
    <section className={`adaptive-analysis-panel ${mode}`} aria-labelledby="adaptive-analysis-title">
      <header>
        <div>
          <small>TRANSIENT ANALYSIS · {run.status}</small>
          <strong id="adaptive-analysis-title">Adaptive Background Analysis</strong>
        </div>
        <div className="adaptive-analysis-actions">
          <label>
            <span>RUN SEED</span>
            <input
              type="number"
              min="1"
              max="4294967295"
              value={seed}
              disabled={mode === "simulation"}
              onChange={(event) => {
                const value = Math.max(1, Math.min(0xffff_ffff, Number(event.target.value)));
                if (Number.isFinite(value)) onSeedChange(Math.trunc(value));
              }}
            />
          </label>
          {onExpand && (
            <button type="button" onClick={onExpand} aria-label="Open analysis split focus" title="Open analysis alongside the 3D viewer">
              <Maximize2 size={13} />
            </button>
          )}
          {historyHref && (
            <a href={historyHref} aria-label="Open complete persisted photon and analysis history">
              HISTORY
            </a>
          )}
        </div>
      </header>
      <div className="adaptive-analysis-warning">{KALMAN_DEMONSTRATOR_LABEL}</div>
      <div className="adaptive-analysis-legend">
        <span>observed stream</span><span>{mode === "simulation" ? "environment reference" : "Rito + environment reference"}</span><span>estimate ±95%</span><span>GRB dots + injected source truth</span>
      </div>
      <AdaptiveAnalysisPlot points={run.points} />
      <footer>
        <span>GATED <b>{run.metrics.gatedBinCount}</b> / {run.metrics.totalBinCount}</span>
        <span>SOURCE-WINDOW SIGNED EXCESS <b>{run.metrics.sourceIntervalResidualCounts.toFixed(1)}</b> counts</span>
        <span>EXPOSURE <b>{(run.points[0]?.exposureSeconds ?? 0).toFixed(1)} s</b></span>
      </footer>
    </section>
  );
}
