"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  KALMAN_DEMONSTRATOR_LABEL,
  KALMAN_SCENARIOS,
  createLiveReferenceFrames,
  generateScenarioFrames,
  runAggregateBackgroundKalman,
  type KalmanAnalysisPoint,
  type KalmanScenarioId,
} from "../lib/kalman-scenarios";

export type KalmanLiveSample = Readonly<{
  frameIndex: number;
  simulationTimeSeconds: number;
  exposureSeconds: number;
  expectedBackgroundCounts: number;
  expectedSourceCounts: number;
}>;

type AnalysisMode = KalmanScenarioId | "live-simulator-v1";

const WIDTH = 920;
const LEFT = 54;
const RIGHT = 14;
const UPPER_TOP = 18;
const UPPER_BOTTOM = 230;
const LOWER_TOP = 268;
const LOWER_BOTTOM = 350;

function linePath(
  points: readonly KalmanAnalysisPoint[],
  x: (point: KalmanAnalysisPoint, index: number) => number,
  y: (point: KalmanAnalysisPoint) => number,
): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point, index).toFixed(2)},${y(point).toFixed(2)}`)
    .join(" ");
}

function KalmanPlots({ points }: { points: readonly KalmanAnalysisPoint[] }) {
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
          point.expectedBackgroundRateCountsPerSecond,
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
  const yRateValue = (value: number) =>
    UPPER_BOTTOM -
    ((value - yMinimum) / rateSpan) * (UPPER_BOTTOM - UPPER_TOP);
  const yInnovationValue = (value: number) => {
    const bounded = Math.max(-6, Math.min(6, value));
    return (
      LOWER_BOTTOM -
      ((bounded + 6) / 12) * (LOWER_BOTTOM - LOWER_TOP)
    );
  };
  const confidenceArea = [
    ...points.map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(point, index).toFixed(2)},${yRateValue(point.upperBackgroundRateCountsPerSecond).toFixed(2)}`,
    ),
    ...[...points]
      .reverse()
      .map((point, reverseIndex) => {
        const index = points.length - reverseIndex - 1;
        return `L${x(point, index).toFixed(2)},${yRateValue(point.lowerBackgroundRateCountsPerSecond).toFixed(2)}`;
      }),
    "Z",
  ].join(" ");
  const sourceArea = [
    ...points.map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(point, index).toFixed(2)},${yRateValue(point.expectedBackgroundRateCountsPerSecond + point.expectedSourceRateCountsPerSecond).toFixed(2)}`,
    ),
    ...[...points]
      .reverse()
      .map((point, reverseIndex) => {
        const index = points.length - reverseIndex - 1;
        return `L${x(point, index).toFixed(2)},${yRateValue(point.expectedBackgroundRateCountsPerSecond).toFixed(2)}`;
      }),
    "Z",
  ].join(" ");
  const elapsedStart = points[0]?.simulationTimeSeconds ?? 0;
  const elapsedEnd = points.at(-1)?.simulationTimeSeconds ?? elapsedStart;

  return (
    <svg
      className="kalman-plot"
      viewBox={`0 0 ${WIDTH} 372`}
      role="img"
      aria-label="Observed Poisson counts, provisional reference truth, Kalman background estimate and uncertainty, source residual, and normalized innovation"
    >
      <title>Aggregate background Kalman analysis</title>
      <desc>
        Upper plot: observation samples, synthetic reference background, estimate,
        confidence band and source residual. Lower plot: normalized innovation.
      </desc>
      {[0, 0.5, 1].map((fraction) => {
        const y = UPPER_TOP + fraction * (UPPER_BOTTOM - UPPER_TOP);
        const label = yMaximum - fraction * rateSpan;
        return (
          <g key={fraction}>
            <line className="kalman-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
            <text className="kalman-axis-label" x={LEFT - 8} y={y + 3} textAnchor="end">
              {label.toFixed(0)}
            </text>
          </g>
        );
      })}
      <text className="kalman-axis-title" x={8} y={13}>RATE · COUNTS/S</text>
      <path className="kalman-confidence" d={confidenceArea} />
      <path className="kalman-source-area" d={sourceArea} />
      <path
        className="kalman-truth-line"
        d={linePath(points, x, (point) =>
          yRateValue(point.expectedBackgroundRateCountsPerSecond),
        )}
      />
      <path
        className="kalman-estimate-line"
        d={linePath(points, x, (point) =>
          yRateValue(point.estimatedBackgroundRateCountsPerSecond),
        )}
      />
      <path
        className="kalman-residual-line"
        d={linePath(points, x, (point) =>
          yRateValue(
            point.predictedBackgroundRateCountsPerSecond +
              point.sourceResidualRateCountsPerSecond,
          ),
        )}
      />
      {points.map((point, index) => (
        <circle
          className={point.gated ? "kalman-observation gated" : "kalman-observation"}
          key={point.frameIndex}
          cx={x(point, index)}
          cy={yRateValue(point.observedRateCountsPerSecond)}
          r={point.gated ? 2.6 : 1.15}
        />
      ))}

      {[-4, 0, 4].map((innovation) => (
        <g key={innovation}>
          <line
            className={innovation === 0 ? "kalman-zero" : "kalman-gate"}
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={yInnovationValue(innovation)}
            y2={yInnovationValue(innovation)}
          />
          <text
            className="kalman-axis-label"
            x={LEFT - 8}
            y={yInnovationValue(innovation) + 3}
            textAnchor="end"
          >
            {innovation > 0 ? `+${innovation}` : innovation}
          </text>
        </g>
      ))}
      <text className="kalman-axis-title" x={8} y={LOWER_TOP - 7}>NORMALIZED INNOVATION</text>
      <path
        className="kalman-innovation-line"
        d={linePath(points, x, (point) =>
          yInnovationValue(point.normalizedInnovation),
        )}
      />
      {points.map((point, index) =>
        point.gated ? (
          <circle
            className="kalman-gated-point"
            key={`gate-${point.frameIndex}`}
            cx={x(point, index)}
            cy={yInnovationValue(point.normalizedInnovation)}
            r={3}
          />
        ) : null,
      )}
      <text className="kalman-time-label" x={LEFT} y={368}>{elapsedStart.toFixed(1)} s</text>
      <text className="kalman-time-label" x={WIDTH - RIGHT} y={368} textAnchor="end">{elapsedEnd.toFixed(1)} s simulation time</text>
    </svg>
  );
}

export function KalmanScenarioDialog({
  liveSamples,
  onClose,
}: {
  liveSamples: readonly KalmanLiveSample[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AnalysisMode>(
    "bright-grb-presentation-v1",
  );
  const selectedScenario = KALMAN_SCENARIOS.find(({ id }) => id === mode);
  const defaultSeed = selectedScenario?.seed ?? 0x4345_1000;
  const [seed, setSeed] = useState(defaultSeed);

  const run = useMemo(() => {
    const frames = selectedScenario
      ? generateScenarioFrames(selectedScenario, seed)
      : createLiveReferenceFrames(liveSamples, seed);
    return runAggregateBackgroundKalman(frames, {
      scenarioId: selectedScenario?.id ?? "live-simulator-v1",
      scenarioSchemaVersion: selectedScenario?.schemaVersion ?? 1,
      seed,
    });
  }, [liveSamples, seed, selectedScenario]);

  const sourceLabel = selectedScenario
    ? selectedScenario.description
    : "Seeded Poisson observations generated from the current simulator reference background and configured GRB source stream.";
  const exposureSeconds = run.points[0]?.exposureSeconds ?? 0;
  const firstStep =
    run.points.length > 1
      ? run.points[1].simulationTimeSeconds - run.points[0].simulationTimeSeconds
      : 0;

  return (
    <div className="kalman-dialog-backdrop" role="presentation">
      <section
        className="kalman-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kalman-dialog-title"
      >
        <header>
          <div>
            <small>REPRODUCIBLE SCENARIO ANALYSIS · {run.analysisVersion}</small>
            <h2 id="kalman-dialog-title">Aggregate background Kalman demonstrator</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Kalman scenario analysis">
            <X size={18} />
          </button>
        </header>

        <div className="kalman-warning" role="status">{KALMAN_DEMONSTRATOR_LABEL}</div>

        <div className="kalman-controls">
          <div className="kalman-mode-buttons" aria-label="Analysis source">
            {KALMAN_SCENARIOS.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                className={mode === scenario.id ? "active" : ""}
                aria-pressed={mode === scenario.id}
                onClick={() => {
                  setMode(scenario.id);
                  setSeed(scenario.seed);
                }}
              >
                {scenario.id === "bright-grb-presentation-v1"
                  ? "ASI · BRIGHT GRB"
                  : scenario.id === "weak-grb-v1"
                    ? "WEAK GRB · LIMITATIONS"
                    : scenario.title}
              </button>
            ))}
            <button
              type="button"
              className={mode === "live-simulator-v1" ? "active" : ""}
              aria-pressed={mode === "live-simulator-v1"}
              onClick={() => {
                setMode("live-simulator-v1");
                setSeed(0x4345_1000);
              }}
            >
              CURRENT SIMULATOR + GRB
            </button>
          </div>
          <label>
            <span>SEED</span>
            <input
              type="number"
              min="1"
              max="4294967295"
              step="1"
              value={seed}
              onChange={(event) => {
                const value = Math.max(1, Math.min(0xffff_ffff, Number(event.target.value)));
                if (Number.isFinite(value)) setSeed(Math.trunc(value));
              }}
            />
          </label>
        </div>

        <div className="kalman-scenario-summary">
          <div>
            <small>ACTIVE RUN · {run.scenarioId} · {run.status}</small>
            <strong>{selectedScenario?.title ?? "Current simulator stream"}</strong>
            <p>{sourceLabel}</p>
          </div>
          <dl>
            <div><dt>EXPOSURE</dt><dd>{exposureSeconds.toFixed(1)} s</dd></div>
            <div><dt>SIM STEP</dt><dd>{firstStep.toFixed(1)} s</dd></div>
            <div><dt>GATE</dt><dd>±{run.filter.gateSigma.toFixed(0)}σ</dd></div>
            <div><dt>SEED</dt><dd>{run.seed}</dd></div>
          </dl>
        </div>

        <div className="kalman-legend" aria-label="Plot legend">
          <span className="observed">Poisson observation</span>
          <span className="truth">synthetic/reference background</span>
          <span className="estimate">KF estimate ±95%</span>
          <span className="source">source / GRB interval and positive residual</span>
          <span className="gated">gated innovation</span>
        </div>

        <KalmanPlots points={run.points} />

        <div className="kalman-metrics" aria-label="Provisional analysis metrics">
          <div><small>BACKGROUND RMSE</small><strong>{run.metrics.backgroundRmseCountsPerSecond.toFixed(2)} c/s</strong></div>
          <div><small>BACKGROUND BIAS</small><strong>{run.metrics.backgroundBiasCountsPerSecond.toFixed(2)} c/s</strong></div>
          <div><small>95% COVERAGE</small><strong>{(run.metrics.confidenceCoverage * 100).toFixed(1)}%</strong></div>
          <div><small>GATED BINS</small><strong>{run.metrics.gatedBinCount} / {run.metrics.totalBinCount}</strong></div>
          <div><small>SOURCE-INTERVAL RESIDUAL / REF.</small><strong>{run.metrics.sourceIntervalResidualCounts.toFixed(1)} / {run.metrics.sourceReferenceCounts.toFixed(1)} counts</strong></div>
        </div>

        <footer>
          <span>
            Metrics, truth, 4σ gating, noise and scenario parameters are provisional engineering outputs, not validated detection performance.
          </span>
          <button type="button" onClick={onClose}>DONE</button>
        </footer>
      </section>
    </div>
  );
}
