import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SKY_BENCHMARK_DATA } from "../app/lib/sky-benchmark-data.ts";
import { SKY_BENCHMARK_EXAMPLES } from "../app/lib/sky-benchmark-examples.ts";
import { celestialToVector } from "../app/lib/sky-localization.ts";
import { angularSeparationDeg } from "../app/lib/burst-direction-truth-score.ts";
import { ritabrataDirectionFromAngles, ritabrataToThreeDetectorLocal } from "../app/lib/detector-local-frame-adapter.ts";

test("examples retain exact source records and a verifiable benchmark digest", () => {
  const raw = readFileSync(new URL(`../${SKY_BENCHMARK_DATA.source}`, import.meta.url));
  assert.equal(createHash("sha256").update(raw).digest("hex"), SKY_BENCHMARK_DATA.sourceSha256);
  const source = JSON.parse(raw.toString());
  for (const record of SKY_BENCHMARK_DATA.cases) assert.deepEqual(record, source.cases.find((c: {caseIndex:number}) => c.caseIndex === record.caseIndex));
});
test("benchmark sphere coordinates use the existing detector rotation and preserve measured separations", () => {
  for (const [index, event] of SKY_BENCHMARK_EXAMPLES.entries()) {
    assert.equal(event.coordinateSystem, "detector-local");
    assert.equal(event.dataOrigin, "benchmark");
    const record = SKY_BENCHMARK_DATA.cases[index];
    for (const [shown, original] of [[event.truth!,record.requestedDirection],[event.ks!,record.methods["ks-5deg-v2"]],[event.centroid!,record.methods["positive-excess-centroid"]]] as const) {
      const actual = celestialToVector(shown);
      const expected = ritabrataToThreeDetectorLocal(ritabrataDirectionFromAngles(original.thetaDeg,original.phiDeg));
      for(let i=0;i<3;i++) assert.ok(Math.abs(actual[i]-expected[i])<1e-12);
    }
    assert.ok(Math.abs(angularSeparationDeg(event.truth!,event.ks!)-event.ksErrorDeg!)<1e-9);
    assert.ok(Math.abs(angularSeparationDeg(event.truth!,event.centroid!)-event.centroidErrorDeg!)<1e-9);
    assert.equal(event.referenceOverlay, undefined);
  }
});

test("individual examples use varied actual input directions", () => {
  for (let i=0;i<SKY_BENCHMARK_EXAMPLES.length;i++) {
    for (let j=i+1;j<SKY_BENCHMARK_EXAMPLES.length;j++) {
      assert.ok(angularSeparationDeg(SKY_BENCHMARK_EXAMPLES[i].truth!,SKY_BENCHMARK_EXAMPLES[j].truth!)>45);
    }
  }
});
