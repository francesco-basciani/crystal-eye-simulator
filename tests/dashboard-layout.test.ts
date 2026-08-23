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
const eventHistorySource = readFileSync(
  new URL("../app/event-history/page.tsx", import.meta.url),
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
    /TEST BURST CONFIGURATION[\s\S]*DETECTOR RESPONSE[\s\S]*<AdaptiveAnalysisPanel[\s\S]*DATA &amp; ARCHIVE STATUS/,
  );
  assert.match(analysisPanelSource, /PHOTON STREAM · 0\.2 S ACQUISITION/);
  assert.doesNotMatch(pageSource, /<SignalChart|TRANSIENT DETECTED|GRB candidate/);
  assert.match(pageSource, /SYNTHETIC SOURCE ACTIVE/);
  assert.match(pageSource, /"Crystal Eye Simulator"/);
  assert.match(pageSource, /"Orbital Observation Replay"/);
  assert.match(pageSource, /"CANONICAL ECI ORBIT · SYNTHETIC PHOTON SIMULATION"/);
  assert.match(pageSource, /"CANONICAL ECI ORBIT · REFERENCE MODE"/);
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
    /@media \(max-height: 900px\) and \(min-width: 1101px\)[\s\S]*?\.right-panel \.burst-inline-panel\s*\{[\s\S]*?padding:\s*0;/,
  );
  assert.match(pageSource, /"--pixel-x": `\$\{configuredPixel\.x\}%`/);
  assert.match(pageSource, /"--pixel-y": `\$\{configuredPixel\.y\}%`/);
  assert.match(
    pageSource,
    /"--pixel-rotation": `\$\{configuredPixel\.rotationDeg\}deg`/,
  );
});

test("rails separate observation context from injection and science response", () => {
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
  const leftRail = pageSource.slice(leftPanelStart, simulationStageStart);
  const rightRail = pageSource.slice(rightPanelStart, rightPanelEnd);

  assert.match(leftRail, /OBSERVATION CONTEXT[\s\S]*<div className="left-sensor-slot">[\s\S]*CELESTIAL INTERFERENCE/);
  assert.doesNotMatch(leftRail, /TEST BURST CONFIGURATION|DETECTOR RESPONSE|<AdaptiveAnalysisPanel/);
  assert.match(rightRail, /INJECTION &amp; SCIENCE RESPONSE[\s\S]*TEST BURST CONFIGURATION[\s\S]*DETECTOR RESPONSE[\s\S]*<AdaptiveAnalysisPanel/);
  assert.match(pageSource, /useState<SensorViewMode>\("geometry"\)/);
  assert.match(
    pageSource,
    /\["geometry", "Geometry"\],[\s\S]*\["sky", "Sky"\],[\s\S]*\["mask", "Mask"\],[\s\S]*\["events", "Events"\]/,
  );
  assert.match(
    styles,
    /\.collapsible-panel\.is-collapsed > \.collapsible-panel-body\s*\{[\s\S]*?display:\s*none;/,
  );
});

test("rail window headings share one visible type hierarchy", () => {
  assert.match(pageSource, /burst-inline-header unified-panel-header/);
  assert.match(pageSource, /chart-header unified-panel-header/);
  assert.match(pageSource, /detector-section-header unified-panel-header/);
  assert.match(analysisPanelSource, /<header className="unified-panel-header">/);
  assert.match(styles, /\.unified-panel-header,[\s\S]*?\.sensor-view-header\s*\{[\s\S]*?min-height:\s*48px;/);
  assert.match(styles, /\.unified-panel-header strong,[\s\S]*?\.sensor-view-header strong\s*\{[\s\S]*?font-size:\s*11px;/);
  assert.match(pageSource, /diagnostics:\s*true/);
  assert.match(pageSource, /burst:\s*false[\s\S]*?celestial:\s*false[\s\S]*?detector:\s*false/);
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
  assert.match(pageSource, /detectorEarthExpectedCounts: \[\.\.\.earthAllocation\.values\]/);
  assert.match(pageSource, /const isEarthPath = earthExpectedCount > 0/);
  assert.match(pageSource, /const isEarthAlbedo = earthExpectedFrame\[physicalPixelId\] > 0/);
  assert.match(pageSource, /getDetectorVisualResponse/);
  assert.match(pageSource, /visualResponse\.earthOnly/);
  assert.match(pageSource, /is-albedo-only/);
  assert.match(pageSource, /has-albedo-overlap/);
  assert.match(pageSource, /<small>EARTH ALBEDO<\/small>/);
  assert.match(styles, /\.detector-map \.detector-pixel\.is-albedo-only/);
  assert.match(styles, /\.detector-map \.detector-pixel\.has-albedo-overlap/);
  assert.match(pageSource, /const isFired = detectorExcitationFrame\[pixelId\] > 0/);
  assert.match(pageSource, /const isActive = excitationCount > 0/);
  assert.match(pageSource, /PAYLOAD_PLACEMENT_STORAGE_KEY_V1/);
  assert.match(pageSource, /parseStoredPayloadPlacement/);
  assert.match(pageSource, /serializePayloadPlacement/);
  assert.match(pageSource, /getEarthAlbedoResponse\([\s\S]*?mountX,[\s\S]*?mountZ/);
  assert.match(pageSource, /earthIllumination,[\s\S]*?earthAlbedoAzimuth,[\s\S]*?earthAlbedoDirectional,[\s\S]*?mountX,[\s\S]*?mountZ/);
  assert.match(pageSource, /saved locally/i);
  assert.match(pageSource, /EXPOSED OUTER PIXELS/);
  assert.match(analysisPanelSource, /VISIBLE SUN\/MOON\/EARTH ONLY · RITO EXCLUDED/);
  assert.match(analysisPanelSource, /RITO \+ VISIBLE SUN\/MOON\/EARTH/);
});

test("Simulation schedules one Sun-overlap burst before sparse deterministic random bursts", () => {
  assert.match(pageSource, /shouldInjectAutomaticBurst/);
  assert.match(pageSource, /directSunRateCountsPerSecond: telemetry\.sunNoise/);
  assert.match(pageSource, /AUTO SOLAR-OVERLAP SCENARIO/);
  assert.match(pageSource, /AUTO RANDOM SCENARIO/);
  assert.match(pageSource, /nextAutomaticBurstRandomState/);
  assert.match(pageSource, /simulatorMode !== "simulation" \|\| paused/);
});

test("Simulation starts 30 minutes forward while Reference keeps the ECI origin", () => {
  assert.match(pageSource, /getModeReplayStartMs/);
  assert.match(pageSource, /settingsRef\.current\.simulatorMode/);
  assert.match(pageSource, /Simulation started 30 minutes after the ECI replay origin/);
  assert.match(pageSource, /Reference replay reset to the ECI origin/);
});

test("V2R8 candidate directions drive burst physics while the flat map stays visual", () => {
  assert.match(pageSource, /createV2R8CandidateDetectorGeometry/);
  assert.match(pageSource, /rankV2R8PixelsForDirection/);
  assert.match(pageSource, /getV2R8CosineIncidence/);
  assert.match(pageSource, /localDirection: DetectorVector3/);
  assert.doesNotMatch(pageSource, /getConfiguredPixelDistance|getConfiguredBurstIncidence/);
  assert.match(pageSource, /UPPER ACD/);
  assert.match(pageSource, /UP · GAGG/);
  assert.match(pageSource, /DOWN · LYSO/);
  assert.doesNotMatch(pageSource, /CH 0–1|CH 2–4|CH 5–7/);
});

test("provisional GRB reconstruction notification links to a fail-closed event archive", () => {
  assert.match(pageSource, /PROVISIONAL GRB RECONSTRUCTION/);
  assert.match(pageSource, /TRUTH ·/);
  assert.match(pageSource, /RECONSTRUCTED · RA/);
  assert.match(pageSource, /ANGULAR SEPARATION ·/);
  assert.match(pageSource, /OPEN EVENT RECORD/);
  assert.match(pageSource, /physical power unavailable/);
  assert.match(pageSource, /buildBurstPixelReadouts/);
  assert.match(eventHistorySource, /All 126 physical modules/);
  assert.match(eventHistorySource, /UPPER ACD/);
  assert.match(eventHistorySource, /UPPER GAGG/);
  assert.match(eventHistorySource, /LOWER LYSO/);
  assert.match(eventHistorySource, /UNAVAILABLE/);
  assert.match(eventHistorySource, /TRUTH RA/);
  assert.match(eventHistorySource, /TRUTH DEC/);
  assert.match(eventHistorySource, /ANGULAR SEPARATION/);
  assert.match(eventHistorySource, /"N\/A"/);
  assert.doesNotMatch(eventHistorySource, />0<\/td>/);
});

test("topbar simulation control is prominent and shares the panel mode transition", () => {
  assert.match(pageSource, /className={`acquisition-mode-button \$\{simulatorMode\}`}/);
  assert.match(pageSource, /"STOP SIMULATION"[\s\S]*"START SIMULATION"/);
  assert.match(pageSource, /const changeSimulatorMode = useCallback/);
  assert.match(pageSource, /settingsRef\.current\.simulatorMode = mode;[\s\S]*setSimulatorMode\(mode\);[\s\S]*resetSimulation\(\);/);
  assert.match(pageSource, /onModeChange={changeSimulatorMode}/);
  assert.doesNotMatch(
    pageSource.slice(
      pageSource.indexOf("const changeSimulatorMode"),
      pageSource.indexOf("const selectedConfiguredPixel"),
    ),
    /setPaused/,
  );
  assert.match(styles, /\.acquisition-mode-button\s*\{[\s\S]*background:\s*#ffc857;/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.acquisition-mode-button/);
});

test("the vinext development overlay does not mask opaque script errors", () => {
  assert.match(viteConfig, /hmr:\s*\{\s*overlay:\s*false\s*\}/);
  assert.match(
    viteConfig,
    /ignored:\s*\["\*\*\/\.next\/\*\*",\s*"\*\*\/out\/\*\*"\]/,
  );
});

test("directional geometry keeps celestial bodies outside the satellite orbit", () => {
  assert.match(pageSource, /SATELLITE_ORBIT_RADIUS_SCALE/);
  assert.match(pageSource, /MOON_DIRECTION_RADIUS_SCALE/);
  assert.match(pageSource, /SUN_DIRECTION_RADIUS_SCALE/);
  assert.match(pageSource, /SUN · DIRECTION TO 1 AU/);
  assert.match(pageSource, /MOON · DIRECTION TO ~384,000 KM/);
  assert.match(pageSource, /ECI X–Z DIRECTION SCHEMATIC · RADIAL DISTANCES NOT TO SCALE/);
  assert.match(pageSource, /sunDirection=\{geocentricSunDirection\}/);
  assert.match(pageSource, /moonDirection=\{geocentricMoonDirection\}/);
});

test("3D detector materials update only when detector state changes", () => {
  assert.match(pageSource, /appliedDetectorIntensity !== settings\.detectorIntensity/);
  assert.match(pageSource, /appliedDetectorEarth !== settings\.detectorEarthExpectedCounts/);
  assert.match(pageSource, /appliedSelectedPixel !== settings\.selectedPixel/);
  assert.match(pageSource, /appliedDetectorIntensity = settings\.detectorIntensity/);
  assert.match(pageSource, /appliedDetectorEarth = settings\.detectorEarthExpectedCounts/);
});

test("responsive layouts keep every dashboard region reachable", () => {
  assert.match(
    styles,
    /\.left-panel\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.app-shell\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*100dvh;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.workspace\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"stage stage"[\s\S]*?"left right";[\s\S]*?overflow:\s*visible;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*?\.workspace\s*\{[\s\S]*?display:\s*grid;[\s\S]*?"stage"[\s\S]*?"right"[\s\S]*?"left";/,
  );
  assert.match(
    pageSource,
    /if \(!window\.matchMedia\("\(min-width: 1101px\)"\)\.matches\) return;[\s\S]*?event\.preventDefault\(\);/,
  );
});

test("compact configuration surfaces preserve scrollable content and actions", () => {
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.configuration-hub\s*\{[\s\S]*?max-height:\s*calc\(100dvh - 40px\);[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.configuration-hub > div\s*\{[\s\S]*?overflow-y:\s*auto;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.pixel-editor-body\s*\{[\s\S]*?overflow-y:\s*auto;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.pixel-editor-workspace\s*\{[\s\S]*?container-type:\s*inline-size;/,
  );
});
