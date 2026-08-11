"use client";

import { useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";
import {
  INTEGRATED_BAND_ID,
  SKY_ENERGY_ANALYSIS_VERSION,
  createIntegratedEnergyBands,
  createSyntheticEnergyBands,
  repartitionCountCubeFrame,
  runSequentialResidualBaseline,
  type CountCubeFrameV1,
  type EnergyBand,
} from "../lib/sky-energy-analysis";

export type SkyEnergyAnalysisSample = CountCubeFrameV1;
export const SKY_ENERGY_VISIBLE_FRAME_COUNT = 120;

function residualColor(value: number, maximum: number) {
  const normalized = maximum <= 0 ? 0 : Math.min(1, Math.abs(value) / maximum);
  return value >= 0
    ? `rgba(255, 99, 71, ${0.2 + normalized * 0.8})`
    : `rgba(55, 190, 255, ${0.2 + normalized * 0.8})`;
}

export function AggregateEnergyHistoryPlot({
  points,
  selectedFrameIndex,
}: {
  points: readonly Readonly<{
    frameIndex: number;
    simulationTimeSeconds: number;
    observedRateCountsPerSecond: number;
    expectedBackgroundRateCountsPerSecond: number;
  }>[];
  selectedFrameIndex?: number;
}) {
  const visible = points.slice(-SKY_ENERGY_VISIBLE_FRAME_COUNT);
  const maximum = Math.max(1, ...visible.flatMap((point) => [
    point.observedRateCountsPerSecond,
    point.expectedBackgroundRateCountsPerSecond,
  ]));
  const x = (index: number) => 54 + index / Math.max(1, visible.length - 1) * 606;
  const y = (value: number) => 270 - value / maximum * 235;
  const path = (select: (point: typeof visible[number]) => number) =>
    visible.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(select(point)).toFixed(2)}`).join(" ");
  return (
    <svg className="kalman-plot adaptive-analysis-plot" viewBox="0 0 680 300" role="img" aria-label="Legacy aggregate integrated-count history">
      <title>Sky and Energy Analysis — legacy aggregate integrated-count history</title>
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
        <line key={fraction} className="kalman-grid" x1="54" x2="660" y1={35 + fraction * 235} y2={35 + fraction * 235} />
      ))}
      <path className="kalman-truth-line" d={path((point) => point.expectedBackgroundRateCountsPerSecond)} />
      <path className="kalman-observed-line" d={path((point) => point.observedRateCountsPerSecond)} />
      {visible.map((point, index) => point.frameIndex === selectedFrameIndex ? (
        <line key={point.frameIndex} className="kalman-selected-frame" x1={x(index)} x2={x(index)} y1="35" y2="270" />
      ) : null)}
      <text className="kalman-axis-title" x="8" y="18">INTEGRATED COUNTS/S</text>
    </svg>
  );
}

export function SkyEnergyAnalysisPanel({
  samples,
  mode,
  seed,
  onSeedChange,
  onExpand,
  historyHref,
}: {
  samples: readonly SkyEnergyAnalysisSample[];
  mode: "reference" | "simulation";
  seed: number;
  onSeedChange: (seed: number) => void;
  onExpand?: () => void;
  historyHref?: string;
}) {
  const [energyMode, setEnergyMode] = useState<"integrated" | "synthetic-six">("integrated");
  const [selectedBandIndex, setSelectedBandIndex] = useState(0);
  const bands: readonly EnergyBand[] = useMemo(
    () => energyMode === "integrated" ? createIntegratedEnergyBands() : createSyntheticEnergyBands(),
    [energyMode],
  );
  const frames = useMemo(() => samples.map((sample) => {
    if (energyMode === "integrated") return sample;
    return repartitionCountCubeFrame(sample, bands);
  }), [bands, energyMode, samples]);
  const residuals = useMemo(() => runSequentialResidualBaseline(frames), [frames]);
  const latest = frames.at(-1);
  const byPixel = residuals.filter((point) => point.bandId === bands[selectedBandIndex]?.id);
  const maximumResidual = Math.max(0, ...byPixel.map((point) => Math.abs(point.residualCounts)));
  const aggregateObserved = latest?.pixels.reduce((sum, pixel) => sum + pixel[selectedBandIndex].observedCounts, 0) ?? 0;
  const aggregateBackground = latest?.pixels.reduce((sum, pixel) => sum + pixel[selectedBandIndex].expectedBackgroundCounts, 0) ?? 0;
  const aggregateSource = latest?.pixels.reduce((sum, pixel) => sum + pixel[selectedBandIndex].sourceExpectedCounts, 0) ?? 0;
  const faultInspectionPixelId = (Math.trunc(seed) >>> 0) % 126;

  return (
    <section className={`adaptive-analysis-panel sky-energy-analysis-panel ${mode}`} aria-labelledby="sky-energy-analysis-title">
      <header>
        <div>
          <small>COUNT CUBE V1 · PROVISIONAL</small>
          <strong id="sky-energy-analysis-title">Sky &amp; Energy Analysis</strong>
        </div>
        <div className="adaptive-analysis-actions">
          <label><span>RUN SEED</span><input type="number" min="1" max="4294967295" value={seed} disabled={mode === "simulation"} onChange={(event) => {
            const value = Math.max(1, Math.min(0xffff_ffff, Number(event.target.value)));
            if (Number.isFinite(value)) onSeedChange(Math.trunc(value));
          }} /></label>
          {onExpand && <button type="button" onClick={onExpand} aria-label="Open Sky and Energy split focus" title="Open Sky and Energy Analysis alongside the 3D viewer"><Maximize2 size={13} /></button>}
          {historyHref && <a href={historyHref} aria-label="Open persisted photon and analysis history">HISTORY</a>}
        </div>
      </header>
      <div className="adaptive-analysis-warning">Engineering demonstrator · no detection or localization claim · {SKY_ENERGY_ANALYSIS_VERSION}</div>
      <div className="sky-energy-controls">
        <button type="button" className={energyMode === "integrated" ? "active" : ""} onClick={() => { setEnergyMode("integrated"); setSelectedBandIndex(0); }}>INTEGRATED EXISTING COUNTS</button>
        <button type="button" className={energyMode === "synthetic-six" ? "active" : ""} onClick={() => { setEnergyMode("synthetic-six"); setSelectedBandIndex(0); }}>6-BAND SYNTHETIC</button>
      </div>
      {energyMode === "synthetic-six" && <div className="adaptive-analysis-warning synthetic">SYNTHETIC · NON-CALIBRATED · equal configurable visualization partition</div>}
      {energyMode === "synthetic-six" && <div className="sky-energy-band-selector" aria-label="Synthetic energy band selector">
        {bands.map((band, index) => <button key={band.id} type="button" className={selectedBandIndex === index ? "active" : ""} aria-pressed={selectedBandIndex === index} onClick={() => setSelectedBandIndex(index)}>B{index + 1}</button>)}
      </div>}
      <div className="adaptive-analysis-warning allocation">
        {latest?.observationProvenance === "simulation-seeded-conditional-multinomial-derived-allocation"
          ? "SYNTHETIC · SEEDED MULTINOMIAL DERIVED FROM AGGREGATE · NOT TELEMETRY"
          : latest
            ? "DETERMINISTIC PROPORTIONAL DERIVATION · NOT TELEMETRY"
            : "AWAITING DERIVED PER-PIXEL ALLOCATION · NOT TELEMETRY"}
      </div>
      <div className="sky-energy-scenarios" aria-label="Analysis scenario truth">
        <span><b>BACKGROUND</b><small>{mode === "reference" ? "Rito reference + existing environment expected" : "existing physical environment expected · Rito excluded"} · {aggregateBackground.toFixed(2)} counts</small></span>
        <span className={aggregateSource > 0 ? "active" : ""}><b>GRB</b><small>existing RA/Dec footprint · {aggregateSource > 0 ? "active" : "inactive"}</small></span>
        <span><b>SENSOR FAULT</b><small>seeded PX-{String(faultInspectionPixelId + 1).padStart(3, "0")} inspection target · not injected</small></span>
      </div>
      <div className="sky-energy-map" role="img" aria-label="Per-pixel ICRS sky directions colored by sequential residual">
        {latest?.pixelDirectionsIcrs.map((direction) => {
          const residual = byPixel.find((point) => point.pixelId === direction.pixelId)?.residualCounts ?? 0;
          return <span key={direction.pixelId} style={{ left: `${direction.raDeg / 3.6}%`, top: `${(90 - direction.decDeg) / 1.8}%`, background: residualColor(residual, maximumResidual) }} title={`PX-${String(direction.pixelId + 1).padStart(3, "0")} · RA ${direction.raDeg.toFixed(2)}° · Dec ${direction.decDeg.toFixed(2)}° · residual ${residual.toFixed(3)} counts`} />;
        })}
        {!latest && <p>Awaiting first 126-pixel acquisition frame…</p>}
      </div>
      <div className="adaptive-analysis-legend"><span>ICRS RA 0–360° →</span><span>Dec +90° top / −90° bottom</span><span>red positive residual</span><span>cyan negative residual</span></div>
      <footer>
        <span>BAND <b>{bands[selectedBandIndex]?.id ?? INTEGRATED_BAND_ID}</b></span>
        <span>OBSERVED <b>{aggregateObserved.toFixed(1)}</b> counts</span>
        <span>BACKGROUND EXPECTED <b>{aggregateBackground.toFixed(1)}</b> counts</span>
        <span>PIXELS <b>{latest?.pixels.length ?? 0} / 126</b></span>
      </footer>
      <p className="sky-energy-conventions">Current radial attitude: detector +Y → geocentric radial boresight by shortest rotation; minimum-rotation roll. Scene [x,z,y] → ICRS-like ECI [X,Y,Z]. No measured attitude, calibrated energy response, threshold, or operative localization algorithm.</p>
    </section>
  );
}
