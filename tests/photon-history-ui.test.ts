import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adaptiveSource = readFileSync(
  new URL("../app/components/adaptive-background-panel.tsx", import.meta.url),
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

test("adaptive event dots are driven only by recorded injected GRB starts", () => {
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
  assert.match(pageSource, /activeBurstCount: sample\.activeBurstCount/);
  assert.match(pageSource, /startedBurstIds: sample\.startedBurstIds/);
  assert.match(adaptiveSource, /points\.slice\(-ADAPTIVE_ANALYSIS_VISIBLE_BIN_COUNT\)/);
  assert.match(pageSource, /appendAdaptiveAnalysisSample/);
  assert.match(pageSource, /initialFilterState=\{adaptiveAnalysisWindow\.initialFilterState\}/);
  assert.doesNotMatch(pageSource, /current\.slice\(-119\)/);
});

test("the persisted history supports row selection and current-page reconstruction", () => {
  assert.match(historySource, /setSelectedRecordId/);
  assert.match(historySource, /result\.items[\s\S]*?sort\(\(left, right\) => left\.bin - right\.bin/);
  assert.match(historySource, /runAggregateBackgroundKalman/);
  assert.match(historySource, /activeBurstCount: record\.activeBursts/);
  assert.match(historySource, /deriveBurstStartsByRecord/);
  assert.match(historySource, /selectedFrameIndex=\{selectedRecord\.bin\}/);
  assert.match(historySource, /NEWER ROW/);
  assert.match(historySource, /OLDER ROW/);
  assert.match(historySource, /Each yellow dot marks one injected GRB start/);
  assert.match(historySource, /ANALYSIS RECONSTRUCTION UNAVAILABLE/);
  assert.match(historySource, /Persisted rows remain available below/);
  assert.match(historySource, /Number\.isFinite\(observedRate\)/);
  assert.match(adaptiveSource, /complete persisted photon and analysis history/);
});
