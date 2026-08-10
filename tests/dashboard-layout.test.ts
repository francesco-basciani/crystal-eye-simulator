import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const viteConfig = readFileSync(
  new URL("../vite.config.ts", import.meta.url),
  "utf8",
);
const adaptiveAnalysisSource = readFileSync(
  new URL("../app/components/adaptive-background-panel.tsx", import.meta.url),
  "utf8",
);

test("adaptive analysis belongs to the right-hand Photon Stream panel", () => {
  const leftPanelStart = pageSource.indexOf(
    '<aside className="control-panel left-panel">',
  );
  const simulationStageStart = pageSource.indexOf(
    '<section className="simulation-stage">',
    leftPanelStart,
  );
  const rightPanelStart = pageSource.indexOf(
    '<aside className="control-panel right-panel">',
  );
  const rightPanelEnd = pageSource.indexOf("</aside>", rightPanelStart);

  assert.ok(leftPanelStart >= 0 && simulationStageStart > leftPanelStart);
  assert.ok(rightPanelStart >= 0 && rightPanelEnd > rightPanelStart);
  assert.doesNotMatch(
    pageSource.slice(leftPanelStart, simulationStageStart),
    /<SignalChart data=\{samples\}/,
  );
  assert.match(pageSource.slice(rightPanelStart, rightPanelEnd), /PHOTON STREAM[\s\S]*<AdaptiveBackgroundPanel/);
});

test("the right-hand planar map preserves the configurator aspect and geometry", () => {
  assert.match(
    styles,
    /\.pixel-editor-canvas\s*\{[\s\S]*?aspect-ratio:\s*1\.18;/,
  );
  assert.match(
    styles,
    /\.right-panel \.detector-map\.projection-unfolded\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*auto;[\s\S]*?aspect-ratio:\s*1\.18;/,
  );
  assert.match(
    styles,
    /\.right-panel \.detector-map\.projection-unfolded \.detector-pixel\s*\{[\s\S]*?width:\s*5\.2%;/,
  );
  assert.match(
    styles,
    /@media \(max-height: 900px\) and \(min-width: 901px\)[\s\S]*?\.right-panel > \.photon-stream-chart \.signal-canvas\s*\{\s*height:\s*38px;/,
  );
  assert.match(
    styles,
    /@media \(max-height: 900px\) and \(min-width: 901px\)[\s\S]*?\.right-panel \.burst-inline-panel\s*\{[\s\S]*?gap:\s*2px;[\s\S]*?padding:\s*3px 7px;/,
  );
  assert.match(pageSource, /"--pixel-x": `\$\{configuredPixel\.x\}%`/);
  assert.match(pageSource, /"--pixel-y": `\$\{configuredPixel\.y\}%`/);
  assert.match(
    pageSource,
    /"--pixel-rotation": `\$\{configuredPixel\.rotationDeg\}deg`/,
  );
});

test("the vinext development overlay does not mask opaque script errors", () => {
  assert.match(viteConfig, /hmr:\s*\{\s*overlay:\s*false\s*\}/);
  assert.match(
    viteConfig,
    /ignored:\s*\["\*\*\/\.next\/\*\*",\s*"\*\*\/out\/\*\*"\]/,
  );
});

test("Reference and Simulation modes keep analysis inline and simulation explicit", () => {
  const rightPanelStart = pageSource.indexOf(
    '<aside className="control-panel right-panel">',
  );
  const rightPanelEnd = pageSource.indexOf("</aside>", rightPanelStart);
  const rightPanel = pageSource.slice(rightPanelStart, rightPanelEnd);
  assert.match(rightPanel, /<AdaptiveBackgroundPanel/);
  assert.match(pageSource, /START SIMULATION/);
  assert.match(pageSource, /STOP SIMULATION/);
  assert.match(pageSource, /REFERENCE REPLAY/);
  assert.match(pageSource, /SIMULATION MODE/);
  assert.match(pageSource, /\? "Simulation Mode" : "Reference Replay"/);
  assert.match(pageSource, /SIMULATION MODE · SEEDED SYNTHETIC OBSERVATIONS/);
  assert.match(pageSource, /settings\.simulatorMode === "simulation"[\s\S]*?samplePoisson/);
  assert.match(pageSource, /nextAutomaticBurstBinRef/);
  assert.match(pageSource, /origin: "automatic"/);
  assert.match(pageSource, /disabled=\{simulatorMode !== "simulation"\}/);
  assert.match(adaptiveAnalysisSource, /Adaptive Background Analysis/);
  assert.match(adaptiveAnalysisSource, /normalizedInnovation/);
  assert.match(adaptiveAnalysisSource, /sourceResidualRateCountsPerSecond/);
  assert.match(adaptiveAnalysisSource, /KALMAN_DEMONSTRATOR_LABEL/);
  assert.doesNotMatch(pageSource, /KALMAN SCENARIOS|ASI/);
  assert.doesNotMatch(adaptiveAnalysisSource, /KALMAN SCENARIOS|ASI/);
  assert.match(styles, /\.adaptive-analysis-panel\s*\{/);
});
