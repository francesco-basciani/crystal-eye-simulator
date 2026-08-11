import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adaptiveSource = readFileSync(
  new URL("../app/components/adaptive-background-panel.tsx", import.meta.url),
  "utf8",
);
const skyEnergySource = readFileSync(
  new URL("../app/components/sky-energy-analysis-panel.tsx", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../app/photon-history/page.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("legacy adaptive plot remains isolated while live Sky/Energy uses existing GRB truth", () => {
  const markerStart = adaptiveSource.indexOf('className="kalman-source-event-marker"');
  assert.ok(markerStart > 0);
  const markerConditionStart = adaptiveSource.lastIndexOf(
    "(point.startedBurstIds ?? []).map",
    markerStart,
  );
  const markerCondition = adaptiveSource.slice(markerConditionStart, markerStart + 500);
  assert.match(markerCondition, /\(point\.startedBurstIds \?\? \[\]\)\.map/);
  assert.doesNotMatch(markerCondition, /gated|normalizedInnovation/);
  assert.match(adaptiveSource, /Injected GRB \$\{burstId\} started · frame/);
  assert.match(adaptiveSource, /className="kalman-observed-line"/);
  assert.equal((adaptiveSource.match(/<circle/g) ?? []).length, 1);
  assert.doesNotMatch(adaptiveSource, /kalman-observation|kalman-gated-point/);
  assert.doesNotMatch(adaptiveSource, /sourceArea|kalman-source-area/);
  assert.doesNotMatch(styles, /\.kalman-source-area/);
  assert.match(adaptiveSource, /const HEIGHT = 500/);
  assert.match(styles, /\.history-analysis-plot\s*\{[\s\S]*?min-height:\s*clamp\(440px, 58dvh, 560px\)/);
  assert.match(styles, /\.workspace\.focus-analysis \.adaptive-analysis-plot\s*\{[\s\S]*?min-height:\s*min\(500px, calc\(100dvh - 190px\)\)/);
  assert.match(pageSource, /activeBurstCount: activeBursts\.length/);
  assert.match(pageSource, /startedBurstIds = activeBursts[\s\S]*?burst\.ageTicks === 0/);
  assert.match(pageSource, /startedBurstIds,/);
  assert.match(pageSource, /sourceExpectedByPixel: detectorResponse\.componentExpectedCounts\.source/);
  assert.match(pageSource, /detectorNormals: getConfiguredPixelNormals\(currentPixelConfiguration\)/);
  assert.match(adaptiveSource, /points\.slice\(-ADAPTIVE_ANALYSIS_VISIBLE_BIN_COUNT\)/);
  assert.match(pageSource, /appendSkyEnergyAnalysisSample/);
  assert.match(pageSource, /samples=\{skyEnergyAnalysisSamples\}/);
  assert.doesNotMatch(pageSource, /current\.slice\(-119\)/);
});

test("the persisted history supports row selection and current-page reconstruction", () => {
  assert.match(historySource, /setSelectedRecordId/);
  assert.match(historySource, /result\.items[\s\S]*?sort\(\(left, right\) => left\.bin - right\.bin/);
  assert.match(historySource, /AggregateEnergyHistoryPlot/);
  assert.doesNotMatch(historySource, /runAggregateBackgroundKalman|AdaptiveAnalysisPlot/);
  assert.match(historySource, /selectedFrameIndex=\{selectedRecord\.bin\}/);
  assert.match(historySource, /NEWER ROW/);
  assert.match(historySource, /OLDER ROW/);
  assert.match(historySource, /Schema-v1 history has no per-pixel or energy-resolved observations/);
  assert.match(historySource, /no CountCube, sky localization, or calibrated energy claim/);
  assert.match(historySource, /ANALYSIS RECONSTRUCTION UNAVAILABLE/);
  assert.match(historySource, /Persisted rows remain available below/);
  assert.match(historySource, /Number\.isFinite\(observedRate\)/);
  assert.match(skyEnergySource, /Open persisted photon and analysis history/);
  assert.match(skyEnergySource, /Legacy aggregate integrated-count history/);
});
