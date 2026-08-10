"use client";

import { useMemo } from "react";
import {
  KALMAN_DEMONSTRATOR_LABEL,
  runAggregateBackgroundKalman,
  type KalmanAnalysisPoint,
  type KalmanReferenceFrame,
} from "../lib/kalman-scenarios";

export type AdaptiveAnalysisSample = Readonly<{
  frameIndex: number;
  simulationTimeSeconds: number;
  exposureSeconds: number;
  expectedBackgroundCounts: number;
  expectedSourceCounts: number;
  observedCounts: number;
}>;

const WIDTH = 920;
const LEFT = 48;
const RIGHT = 12;
const UPPER_TOP = 12;
const UPPER_BOTTOM = 132;
const LOWER_TOP = 163;
const LOWER_BOTTOM = 210;

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

function AnalysisPlot({ points }: { points: readonly KalmanAnalysisPoint[] }) {
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
  const padding = Math.max(1, (maximumRate - minimumRate) * 0.08);
  const yMinimum = Math.max(0, minimumRate - padding);
  const yMaximum = maximumRate + padding;
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
      viewBox={`0 0 ${WIDTH} 226`}
      role="img"
      aria-label="Observed samples, reference background, adaptive estimate and uncertainty, transient interval, residual, and normalized innovation"
    >
      <title>Adaptive background and transient analysis</title>
      {[0, 0.5, 1].map((fraction) => {
        const y = UPPER_TOP + fraction * (UPPER_BOTTOM - UPPER_TOP);
        return (
          <g key={fraction}>
            <line className="kalman-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
            <text className="kalman-axis-label" x={LEFT - 7} y={y + 3} textAnchor="end">
              {(yMaximum - fraction * rateSpan).toFixed(0)}
            </text>
          </g>
        );
      })}
      <path className="kalman-confidence" d={confidenceArea} />
      <path className="kalman-source-area" d={sourceArea} />
      <path className="kalman-truth-line" d={linePath(points, x, (point) => yRate(point.expectedBackgroundRateCountsPerSecond))} />
      <path className="kalman-estimate-line" d={linePath(points, x, (point) => yRate(point.estimatedBackgroundRateCountsPerSecond))} />
      <path className="kalman-residual-line" d={linePath(points, x, (point) => yRate(point.predictedBackgroundRateCountsPerSecond + point.sourceResidualRateCountsPerSecond))} />
      {points.map((point, index) => (
        <circle
          className={point.gated ? "kalman-observation gated" : "kalman-observation"}
          key={point.frameIndex}
          cx={x(point, index)}
          cy={yRate(point.observedRateCountsPerSecond)}
          r={point.gated ? 2.8 : 1.2}
        />
      ))}
      {[-4, 0, 4].map((innovation) => (
        <line
          key={innovation}
          className={innovation === 0 ? "kalman-zero" : "kalman-gate"}
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={yInnovation(innovation)}
          y2={yInnovation(innovation)}
        />
      ))}
      <path className="kalman-innovation-line" d={linePath(points, x, (point) => yInnovation(point.normalizedInnovation))} />
      {points.map((point, index) =>
        point.gated ? <circle className="kalman-gated-point" key={`gate-${point.frameIndex}`} cx={x(point, index)} cy={yInnovation(point.normalizedInnovation)} r={3} /> : null,
      )}
      <text className="kalman-axis-title" x={5} y={158}>NORMALIZED INNOVATION · ±4 GATE</text>
      <text className="kalman-time-label" x={LEFT} y={224}>{(points[0]?.simulationTimeSeconds ?? 0).toFixed(1)} s</text>
      <text className="kalman-time-label" x={WIDTH - RIGHT} y={224} textAnchor="end">{(points.at(-1)?.simulationTimeSeconds ?? 0).toFixed(1)} s simulation time</text>
    </svg>
  );
}

export function AdaptiveBackgroundPanel({
  samples,
  mode,
  seed,
  onSeedChange,
}: {
  samples: readonly AdaptiveAnalysisSample[];
  mode: "reference" | "simulation";
  seed: number;
  onSeedChange: (seed: number) => void;
}) {
  const run = useMemo(() => {
    const frames: KalmanReferenceFrame[] = samples.map((sample) => ({
      frameIndex: sample.frameIndex,
      simulationTimeSeconds: sample.simulationTimeSeconds,
      exposureSeconds: sample.exposureSeconds,
      expectedBackgroundRateCountsPerSecond:
        sample.expectedBackgroundCounts / sample.exposureSeconds,
      expectedSourceRateCountsPerSecond:
        sample.expectedSourceCounts / sample.exposureSeconds,
      observedCounts: sample.observedCounts,
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
      </header>
      <div className="adaptive-analysis-warning">{KALMAN_DEMONSTRATOR_LABEL}</div>
      <div className="adaptive-analysis-legend">
        <span>samples</span><span>reference</span><span>estimate ±95%</span><span>transient / residual</span>
      </div>
      <AnalysisPlot points={run.points} />
      <footer>
        <span>GATED <b>{run.metrics.gatedBinCount}</b> / {run.metrics.totalBinCount}</span>
        <span>RESIDUAL <b>{run.metrics.sourceIntervalResidualCounts.toFixed(1)}</b> counts</span>
        <span>EXPOSURE <b>{(run.points[0]?.exposureSeconds ?? 0).toFixed(1)} s</b></span>
      </footer>
    </section>
  );
}
