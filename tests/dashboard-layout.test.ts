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
    'className="control-panel left-panel"',
  );
  const simulationStageStart = pageSource.indexOf(
    '<section className="simulation-stage">',
    leftPanelStart,
  );
  const rightPanelStart = pageSource.indexOf(
    'className="control-panel right-panel"',
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

test("geometry separates orbit context, payload detail, and unscaled celestial directions", () => {
  assert.match(pageSource, /EARTH–ORBIT CONTEXT/);
  assert.match(pageSource, /SUN \/ MOON: DIRECTION ONLY · DISTANCE NOT SHOWN/);
  assert.match(pageSource, /ENLARGED PAYLOAD SECTION/);
  assert.match(pageSource, /SATELLITE 60 × 60 CM/);
  assert.match(pageSource, /OUTWARD \/ SPACE/);
  assert.match(pageSource, /EARTH \/ NADIR/);
  assert.match(pageSource, /Orbit context · enlarged payload detail/);
  assert.match(pageSource, /PAYLOAD_PLACEMENT_STORAGE_KEY_V1/);
  assert.match(pageSource, /parseStoredPayloadPlacement/);
  assert.match(pageSource, /serializePayloadPlacement/);
  assert.match(pageSource, /saved locally in this browser/i);
});

test("Earth albedo UI uses one binary nadir-support identity in 3D and planar views", () => {
  assert.match(pageSource, /function getMountNadirExposure/);
  assert.match(pageSource, /getNadirExposureFraction/);
  assert.match(pageSource, /getExposedEarthAlbedoWeight/);
  assert.match(pageSource, /isPixelLitByEarthAlbedo/);
  assert.match(pageSource, /crystalPixels\.forEach[\s\S]*?isPixelLitByEarthAlbedo/);
  assert.match(pageSource, /function DetectorMap[\s\S]*?isPixelLitByEarthAlbedo/);
  assert.doesNotMatch(pageSource, /return response >= 0\.12 \? response : 0/);
  assert.match(pageSource, /EXPOSED OUTER PIXELS/);
  assert.match(pageSource, /PROVISIONAL binary nadir-ray model/);
  assert.match(pageSource, /getSubSatelliteSolarIncidence\([\s\S]*?satelliteDirection,[\s\S]*?geocentricSunDirection/);
  assert.doesNotMatch(pageSource, /\(1 \+ sunBoresightDot\) \/ 2/);
  assert.match(pageSource, /detectorExcitationExpectedCounts/);
  assert.match(pageSource, /const isFired = excitationCount > 0/);
  assert.match(pageSource, /const isActive = excitationCount > 0/);
  assert.match(pageSource, /nightside · zero local solar incidence/);
  assert.match(pageSource, /detectorExcitationExpectedCounts: createZeroDetectorFrame\(\)/);
  assert.match(pageSource, /const detectorExcitationFrame = resolveDetectorFrameVector/);
  assert.doesNotMatch(
    pageSource,
    /settings\.detectorExcitationExpectedCounts\[pixelId\]/,
  );
});

test("the vinext development overlay does not mask opaque script errors", () => {
  assert.match(viteConfig, /hmr:\s*\{\s*overlay:\s*false\s*\}/);
  assert.match(
    viteConfig,
    /ignored:\s*\["\*\*\/\.next\/\*\*",\s*"\*\*\/out\/\*\*"\]/,
  );
});

test("side columns toggle independently and focus views keep the 3D stage", () => {
  assert.match(pageSource, /\[leftColumnVisible, setLeftColumnVisible\] = useState\(true\)/);
  assert.match(pageSource, /\[rightColumnVisible, setRightColumnVisible\] = useState\(true\)/);
  assert.match(pageSource, /type WorkspaceFocus = "analysis" \| "detector" \| null/);
  assert.match(pageSource, /Hide left dashboard column/);
  assert.match(pageSource, /Show left dashboard column/);
  assert.match(pageSource, /Hide right dashboard column/);
  assert.match(pageSource, /Show right dashboard column/);
  assert.match(pageSource, /RESTORE DASHBOARD/);
  assert.match(pageSource, /left-edge-toggle/);
  assert.match(pageSource, /right-edge-toggle/);
  assert.match(styles, /--left-panel-width:\s*286px/);
  assert.match(styles, /--right-panel-width:\s*330px/);
  assert.match(styles, /\.left-edge-toggle\s*\{[\s\S]*?left:\s*var\(--left-panel-width\)/);
  assert.match(styles, /\.right-edge-toggle\s*\{[\s\S]*?right:\s*var\(--right-panel-width\)/);
  assert.doesNotMatch(pageSource, /workspace-view-controls/);
  assert.match(pageSource, /setWorkspaceFocus\("analysis"\)/);
  assert.match(pageSource, /setWorkspaceFocus\("detector"\)/);
  assert.match(styles, /\.workspace\.split-focus\s*\{[\s\S]*?45fr[\s\S]*?55fr/);
  assert.match(styles, /\.workspace\.split-focus > \.simulation-stage\s*\{[\s\S]*?grid-column:\s*1;/);
  assert.match(styles, /\.workspace\.split-focus > \.right-panel\s*\{[\s\S]*?grid-column:\s*2;/);
  assert.match(styles, /\.workspace\.focus-analysis \.right-panel\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.workspace\.focus-detector \.right-panel \.detector-map\.projection-unfolded\s*\{[\s\S]*?aspect-ratio:\s*1\.18;/);
  assert.doesNotMatch(pageSource, /detector-expanded-backdrop|aria-modal="true"[\s\S]*?Enlarged configured detector map/);
  assert.doesNotMatch(styles, /\.detector-expanded-backdrop|\.detector-expanded-dialog/);
});

test("Reference and Simulation modes keep analysis inline and simulation explicit", () => {
  const rightPanelStart = pageSource.indexOf(
    'className="control-panel right-panel"',
  );
  const rightPanelEnd = pageSource.indexOf("</aside>", rightPanelStart);
  const rightPanel = pageSource.slice(rightPanelStart, rightPanelEnd);
  assert.match(rightPanel, /<AdaptiveBackgroundPanel/);
  assert.match(pageSource, /START SIMULATION/);
  assert.match(pageSource, /STOP SIMULATION/);
  assert.match(pageSource, /REFERENCE REPLAY/);
  assert.match(pageSource, /SIMULATION MODE/);
  assert.match(pageSource, /\? "Simulation Mode" : "Reference Replay"/);
  assert.match(pageSource, /SIMULATION MODE · ENVIRONMENT-ONLY SEEDED SYNTHETIC OBSERVATIONS/);
  assert.match(pageSource, /settings\.simulatorMode === "simulation"[\s\S]*?samplePoisson/);
  assert.match(pageSource, /nextAutomaticBurstBinRef/);
  assert.match(pageSource, /origin: "automatic"/);
  assert.match(pageSource, /disabled=\{simulatorMode !== "simulation"\}/);
  assert.match(adaptiveAnalysisSource, /Adaptive Background Analysis/);
  assert.match(adaptiveAnalysisSource, /normalizedInnovation/);
  assert.doesNotMatch(adaptiveAnalysisSource, /sourceResidualRateCountsPerSecond/);
  assert.match(adaptiveAnalysisSource, /sample\.acquisitionTimeSeconds/);
  assert.match(adaptiveAnalysisSource, /acquisition time/);
  assert.match(adaptiveAnalysisSource, /injected GRB start dots/);
  assert.match(adaptiveAnalysisSource, /KALMAN_DEMONSTRATOR_LABEL/);
  assert.doesNotMatch(pageSource, /KALMAN SCENARIOS|ASI/);
  assert.doesNotMatch(adaptiveAnalysisSource, /KALMAN SCENARIOS|ASI/);
  assert.match(styles, /\.adaptive-analysis-panel\s*\{/);
  assert.match(adaptiveAnalysisSource, /center \* 0\.25/);
  assert.match(pageSource, /AUTOMATIC_GRB_INITIAL_DELAY_BINS = 50/);
  assert.match(pageSource, /AUTOMATIC_GRB_MINIMUM_GAP_BINS = 90/);
  assert.match(pageSource, /AUTOMATIC_GRB_GAP_RANGE_BINS = 61/);
  assert.match(pageSource, /AUTOMATIC_GRB_MINIMUM_DURATION_SECONDS = 0\.8/);
  assert.match(pageSource, /AUTOMATIC_GRB_DURATION_RANGE_SECONDS = 1\.6/);
  assert.match(pageSource, /burst\.origin === "automatic" && burst\.ticksRemaining > 0/);
  assert.match(pageSource, /setEphemerisEndReached\(true\)/);
  assert.match(pageSource, /EPHEMERIS END · ACQUISITION PAUSED/);
  assert.match(pageSource, /RESTART FROM DATASET START/);
  assert.match(pageSource, /restartFromEphemerisStart/);
  assert.match(pageSource, /restartFromEphemerisStart[\s\S]*?createSeededRandom\(simulationSeed\)[\s\S]*?AUTOMATIC_GRB_INITIAL_DELAY_BINS/);
  assert.match(pageSource, /disabled=\{ephemerisEndReached\}/);
  assert.match(styles, /\.ephemeris-end-notice\s*\{/);
  assert.match(pageSource, /composeModeBackgroundRate\(/);
  assert.match(pageSource, /composePixelSignalFrame\(/);
  assert.match(pageSource, /ENVIRONMENT-ONLY SEEDED SYNTHETIC OBSERVATIONS/);
  assert.match(pageSource, /Rito reference excluded\. All amplitudes are PROVISIONAL/);
  assert.match(pageSource, /acquisitionTimeSeconds:[\s\S]*?PIXEL_BACKGROUND_BIN_SECONDS/);
  assert.doesNotMatch(pageSource, /TRANSIENT DETECTED|GRB candidate/);
});
