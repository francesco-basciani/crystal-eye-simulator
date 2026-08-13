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
const analysisPanelSource = readFileSync(
  new URL("../app/components/adaptive-analysis-panel.tsx", import.meta.url),
  "utf8",
);

test("adaptive analysis and reconstruction belong beside the visible 3D stage", () => {
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
    /<AdaptiveAnalysisPanel/,
  );
  assert.match(
    pageSource.slice(rightPanelStart, rightPanelEnd),
    /PHOTON STREAM[\s\S]*<AdaptiveAnalysisPanel/,
  );
  assert.doesNotMatch(pageSource, /<SignalChart|TRANSIENT DETECTED|GRB candidate/);
  assert.match(pageSource, /SYNTHETIC SOURCE ACTIVE/);
  assert.match(pageSource, /simulatorMode === "simulation" \? "Simulation Mode" : "Reference Replay"/);
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
  assert.match(styles, /\.adaptive-analysis-panel\s*\{/);
  assert.match(styles, /\.burst-reconstruction-panel\s*\{/);
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

test("analysis wiring preserves exposure, separates time warp, and avoids detection claims", () => {
  assert.match(pageSource, /exposureSeconds: PIXEL_BACKGROUND_BIN_SECONDS/);
  assert.match(pageSource, /acquisitionTimeSeconds: frameIndex \* PIXEL_BACKGROUND_BIN_SECONDS/);
  assert.match(pageSource, /const dt = 0\.2 \* settings\.speed/);
  assert.match(pageSource, /knownInjectedSource: activeBursts\.length > 0/);
  assert.match(pageSource, /startedBurstIds: startedBursts\.map\(\(burst\) => burst\.id\)/);
  assert.match(pageSource, /samplePoisson\(expectedCounts, observationRandomRef\.current\)/);
  assert.match(pageSource, /pixelBaseline: detectorLocalizationBaseline/);
  assert.doesNotMatch(pageSource, /confidence ellipse|TRANSIENT DETECTED|GRB candidate/);
});

test("mode-B composition, excitation glow, and persisted placement are wired consistently", () => {
  assert.match(pageSource, /createDetectorExpectedResponse/);
  assert.match(pageSource, /aggregateBackgroundExpectedCounts/);
  assert.match(pageSource, /configuredBackgroundCounts: background/);
  assert.match(pageSource, /detectorExcitationExpectedCounts/);
  assert.match(pageSource, /const isFired = detectorExcitationFrame\[pixelId\] > 0/);
  assert.match(pageSource, /const isActive = excitationCount > 0/);
  assert.match(pageSource, /PAYLOAD_PLACEMENT_STORAGE_KEY_V1/);
  assert.match(pageSource, /parseStoredPayloadPlacement/);
  assert.match(pageSource, /serializePayloadPlacement/);
  assert.match(pageSource, /saved locally/i);
  assert.match(pageSource, /EXPOSED OUTER PIXELS/);
  assert.match(analysisPanelSource, /VISIBLE SUN\/MOON\/EARTH ONLY · RITO EXCLUDED/);
  assert.match(analysisPanelSource, /RITO \+ VISIBLE SUN\/MOON\/EARTH/);
});

test("the vinext development overlay does not mask opaque script errors", () => {
  assert.match(viteConfig, /hmr:\s*\{\s*overlay:\s*false\s*\}/);
  assert.match(
    viteConfig,
    /ignored:\s*\["\*\*\/\.next\/\*\*",\s*"\*\*\/out\/\*\*"\]/,
  );
});
