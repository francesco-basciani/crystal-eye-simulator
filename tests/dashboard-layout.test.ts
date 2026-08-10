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

test("the cockpit exposes four owned areas and keeps analysis inline", () => {
  assert.match(pageSource, /simulation-stage cockpit-globe/);
  assert.match(pageSource, /cockpit-panel cockpit-detector/);
  assert.match(pageSource, /cockpit-panel cockpit-context/);
  assert.match(pageSource, /cockpit-panel cockpit-analysis/);
  const analysisStart = pageSource.indexOf('className="cockpit-panel cockpit-analysis"');
  const analysisEnd = pageSource.indexOf("</aside>", analysisStart);
  assert.match(pageSource.slice(analysisStart, analysisEnd), /PHOTON STREAM[\s\S]*<AdaptiveBackgroundPanel/);
  const contextStart = pageSource.indexOf('className="cockpit-panel cockpit-context"');
  const contextEnd = pageSource.indexOf("</aside>", contextStart);
  const contextPanel = pageSource.slice(contextStart, contextEnd);
  assert.match(contextPanel, /<SensorView/);
  assert.match(contextPanel, /CELESTIAL INTERFERENCE/);
  assert.match(contextPanel, /TEST BURST CONFIGURATION/);
  const detectorStart = pageSource.indexOf('className="cockpit-panel cockpit-detector"');
  const detectorEnd = pageSource.indexOf("</aside>", detectorStart);
  assert.match(pageSource.slice(detectorStart, detectorEnd), /RITO BACKGROUND REFERENCE[\s\S]*<DetectorMap/);
  assert.match(styles, /grid-template-columns:\s*minmax\(440px, 42fr\) minmax\(600px, 58fr\)/);
  assert.match(styles, /"globe detector"\s*"context analysis"/);
  assert.match(styles, /@media \(max-width: 1099px\)[\s\S]*?"globe"\s*"analysis"\s*"detector"\s*"context"/);
});

test("the cockpit detector map preserves the configurator aspect and geometry", () => {
  assert.match(
    styles,
    /\.pixel-editor-canvas\s*\{[\s\S]*?aspect-ratio:\s*1\.18;/,
  );
  assert.match(
    styles,
    /\.cockpit-detector \.detector-map\.projection-unfolded\s*\{[\s\S]*?aspect-ratio:\s*1\.18;/,
  );
  assert.match(
    styles,
    /\.cockpit-detector \.detector-map\.projection-unfolded \.detector-pixel\s*\{[\s\S]*?width:\s*5\.2%;/,
  );
  assert.match(styles, /\.cockpit-analysis \.adaptive-analysis-plot\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?height:\s*100%;/);
  assert.match(pageSource, /"--pixel-x": `\$\{configuredPixel\.x\}%`/);
  assert.match(pageSource, /"--pixel-y": `\$\{configuredPixel\.y\}%`/);
  assert.match(
    pageSource,
    /"--pixel-rotation": `\$\{configuredPixel\.rotationDeg\}deg`/,
  );
});

test("desktop cockpit owns overflow without page-level scrolling", () => {
  assert.match(styles, /body\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.app-shell\s*\{[\s\S]*?height:\s*100dvh;/);
  assert.match(styles, /\.workspace\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.cockpit-panel\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.cockpit-context > \.celestial-card\s*\{[\s\S]*?overflow:\s*auto;/);
  assert.match(styles, /\.cockpit-context > \.burst-inline-panel\s*\{[\s\S]*?overflow:\s*auto;/);
  assert.match(styles, /@media \(max-width: 1099px\)\s*\{[\s\S]*?body\s*\{\s*overflow:\s*auto;/);
});

test("the vinext development overlay does not mask opaque script errors", () => {
  assert.match(viteConfig, /hmr:\s*\{\s*overlay:\s*false\s*\}/);
  assert.match(
    viteConfig,
    /ignored:\s*\["\*\*\/\.next\/\*\*",\s*"\*\*\/out\/\*\*"\]/,
  );
});

test("Reference and Simulation modes keep analysis inline and simulation explicit", () => {
  assert.match(pageSource, /<AdaptiveBackgroundPanel/);
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
