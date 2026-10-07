import assert from "node:assert/strict";
import test from "node:test";
import { celestialToVector, greatCircleArc } from "../app/lib/sky-localization.ts";
import { projectSkyVector, oppositeSkyDirection, orthographicPath } from "../app/lib/sky-orthographic.ts";
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("orthographic view centres truth and places increasing RA left and north up", () => {
  const centre = { raDeg: 0, decDeg: 0 };
  const at = (raDeg: number, decDeg: number) => projectSkyVector(celestialToVector({ raDeg, decDeg }), centre);
  near(at(0, 0).x, 0); near(at(0, 0).y, 0); near(at(0, 0).depth, 1);
  near(at(90, 0).x, -1); near(at(0, 90).y, -1);
  assert.equal(at(180, 0).visible, false);
});

test("two hemispheres cover each direction; RA seam and polar centres remain finite", () => {
  for (const centre of [{ raDeg: 359, decDeg: 30 }, { raDeg: 0, decDeg: 90 }]) {
    const back = oppositeSkyDirection(centre);
    for (let raDeg = 0; raDeg < 360; raDeg += 15) for (let decDeg = -90; decDeg <= 90; decDeg += 15) {
      const vector = celestialToVector({ raDeg, decDeg });
      const front = projectSkyVector(vector, centre), rear = projectSkyVector(vector, back);
      assert.ok(front.visible || rear.visible);
      near(front.depth, -rear.depth);
      assert.ok(front.x ** 2 + front.y ** 2 <= 1 + 1e-9);
    }
    const projected = projectSkyVector(celestialToVector(centre), centre);
    near(projected.x, 0); near(projected.y, 0);
  }
});

test("path splits at hidden hemisphere instead of connecting across it", () => {
  const centre = { raDeg: 0, decDeg: 0 };
  const points = [0, 120, 0].map(raDeg => celestialToVector({ raDeg, decDeg: 0 }));
  const path = orthographicPath(points, centre, 100, 100, 100);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal(path.includes("L"), false);
  const seam = orthographicPath(greatCircleArc({ raDeg: 359, decDeg: 0 }, { raDeg: 1, decDeg: 0 }), centre, 100, 100, 100);
  assert.equal((seam.match(/M/g) ?? []).length, 1);
  assert.equal(/NaN|Infinity/.test(seam), false);
});
