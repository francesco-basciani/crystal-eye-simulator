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

test("adaptive event dots are driven only by recorded active injected GRBs", () => {
  const markerStart = adaptiveSource.indexOf('className="kalman-source-event-marker"');
  assert.ok(markerStart > 0);
  const markerConditionStart = adaptiveSource.lastIndexOf(
    "(point.activeBurstCount ?? 0) > 0",
    markerStart,
  );
  const markerCondition = adaptiveSource.slice(markerConditionStart, markerStart + 500);
  assert.match(markerCondition, /\(point\.activeBurstCount \?\? 0\) > 0/);
  assert.doesNotMatch(markerCondition, /gated|normalizedInnovation|observedRate/);
  assert.match(adaptiveSource, /Injected GRB active · frame/);
  assert.match(adaptiveSource, /className="kalman-observed-line"/);
  assert.equal((adaptiveSource.match(/<circle/g) ?? []).length, 1);
  assert.doesNotMatch(adaptiveSource, /kalman-observation|kalman-gated-point/);
  assert.match(pageSource, /activeBurstCount: activeBursts\.length/);
  assert.match(pageSource, /activeBurstCount: sample\.activeBurstCount/);
});

test("the persisted history supports row selection and current-page reconstruction", () => {
  assert.match(historySource, /setSelectedRecordId/);
  assert.match(historySource, /result\.items[\s\S]*?sort\(\(left, right\) => left\.bin - right\.bin/);
  assert.match(historySource, /runAggregateBackgroundKalman/);
  assert.match(historySource, /activeBurstCount: record\.activeBursts/);
  assert.match(historySource, /selectedFrameIndex=\{selectedRecord\.bin\}/);
  assert.match(historySource, /NEWER ROW/);
  assert.match(historySource, /OLDER ROW/);
  assert.match(historySource, /Yellow dots mark only bins with a recorded active injected GRB/);
  assert.match(adaptiveSource, /complete persisted photon and analysis history/);
});
