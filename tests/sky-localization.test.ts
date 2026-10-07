import assert from "node:assert/strict";
import test from "node:test";
import { celestialToVector, greatCircleArc, createSkyLocalizationEvent, completeSkyLocalizationEvent } from "../app/lib/sky-localization.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);
test("sky basis preserves equatorial cardinal directions and RA seam", () => {
  const cases = [[0,0,[1,0,0]],[90,0,[0,0,1]],[0,90,[0,1,0]],[360,0,[1,0,0]]] as const;
  for (const [raDeg,decDeg,expected] of cases) celestialToVector({raDeg,decDeg}).forEach((v,i)=>near(v,expected[i]));
  assert.throws(()=>celestialToVector({raDeg:NaN,decDeg:0}),RangeError);
  assert.throws(()=>celestialToVector({raDeg:0,decDeg:91}),RangeError);
});

test("great circle takes the short route across RA zero and preserves endpoints", () => {
  const a = {raDeg:359,decDeg:0}, b = {raDeg:1,decDeg:0};
  const points = greatCircleArc(a,b,10);
  assert.deepEqual(points[0],celestialToVector(a));
  assert.deepEqual(points.at(-1),celestialToVector(b));
  near(points[5][0],1);
  near(points[5][2],0);
  for (const p of points) near(Math.hypot(...p),1);
});

test("coincident and antipodal endpoints do not produce nonfinite arcs", () => {
  for (const raDeg of [0,180]) {
    const points = greatCircleArc({raDeg:0,decDeg:0},{raDeg,decDeg:0});
    for (const p of points) near(Math.hypot(...p),1);
    assert.deepEqual(points.at(-1),celestialToVector({raDeg,decDeg:0}));
  }
  assert.throws(()=>greatCircleArc({raDeg:0,decDeg:0},{raDeg:1,decDeg:0},0));
});

function event(key:string,burstId=1) {
  return createSkyLocalizationEvent({eventKey:key,burstId,simulatedDate:"2033-01-01T00:00:00Z",raDeg:359,decDeg:0,gridLabel:"Updated · KS 2°"});
}
const result = {status:"available" as const,ritabrata:{raDeg:1,decDeg:0},centroid:{reconstruction:{raDeg:89,decDeg:0}}};
test("out-of-order completions update only their own launch snapshot", () => {
  const first = event("run-a:1"), second = event("run-a:2",2);
  const completed = completeSkyLocalizationEvent([first,second],second.eventKey,result);
  const both = completeSkyLocalizationEvent(completed,first.eventKey,result);
  assert.equal(both[0].eventKey,first.eventKey);
  assert.equal(both[1],completed[1]);
  assert.equal(first.status,"pending");
  near(both[0].ksErrorDeg!,2);
  near(both[0].centroidErrorDeg!,90);
  assert.equal(both[0].simulatedDate, first.simulatedDate);
  assert.equal(both[0].gridLabel, first.gridLabel);
  assert.equal(both[0].truth, first.truth);
});

test("reset and reused numeric burst IDs cannot attach a stale run's result", () => {
  assert.deepEqual(completeSkyLocalizationEvent([],"run-a:1",result),[]);
  const fresh = event("run-b:1");
  const [after] = completeSkyLocalizationEvent([fresh],"run-a:1",result);
  assert.equal(after,fresh);
});

test("missing assets and invalid reconstruction never invent a sky position", () => {
  const input = event("run-a:1");
  const [missing] = completeSkyLocalizationEvent([input],input.eventKey,{status:"unavailable",reason:"assets-missing"});
  assert.equal(missing.status,"unavailable");
  assert.equal(missing.ks,null);
  assert.equal(missing.truth,input.truth);
  const [invalid] = completeSkyLocalizationEvent([input],input.eventKey,{...result,ritabrata:{raDeg:Infinity,decDeg:0}});
  assert.equal(invalid.status,"unavailable");
  assert.equal(invalid.ks,null);
});
