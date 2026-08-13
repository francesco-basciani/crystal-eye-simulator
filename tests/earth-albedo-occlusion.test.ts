import assert from "node:assert/strict";
import test from "node:test";
import {
  getExposedEarthAlbedoWeight,
  getNadirExposureFraction,
  getSubSatelliteSolarIncidence,
  isPixelCenterExposedToNadir,
  type NadirPixelGeometry,
} from "../app/lib/earth-albedo-occlusion.ts";

const count = 35;
const outer: readonly NadirPixelGeometry[] = Array.from({ length: count }, (_, slot) => ({
  ring: 6,
  outermostRing: 6,
  angleRadians: slot / count * Math.PI * 2 + Math.PI / count,
}));
const inner: NadirPixelGeometry = { ring: 5, outermostRing: 6, angleRadians: 0 };

test("geocentric solar incidence is noon one and terminator/midnight zero", () => {
  assert.equal(getSubSatelliteSolarIncidence([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(getSubSatelliteSolarIncidence([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(getSubSatelliteSolarIncidence([1, 0, 0], [-1, 0, 0]), 0);
});

test("binary nadir visibility covers center edge corner and outer ring only", () => {
  const exposed = (x: number, z: number) => outer.filter((pixel) =>
    isPixelCenterExposedToNadir(pixel, x, z),
  );
  assert.equal(exposed(0, 0).length, 0);
  assert.equal(exposed(1, 0).length, 18);
  assert.equal(exposed(1, -1).length, 26);
  assert.equal(getNadirExposureFraction(outer, 1, 0), 18 / 35);
  assert.equal(isPixelCenterExposedToNadir(inner, 1, -1), false);
});

test("nightside and inner pixels have no Earth support", () => {
  for (const [x, z] of [[0, 0], [1, 0], [1, -1]] as const) {
    assert.ok(outer.every((pixel) =>
      getExposedEarthAlbedoWeight(pixel, 0, 0, 1, x, z) === 0,
    ));
  }
  assert.equal(getExposedEarthAlbedoWeight(inner, 1, 0, 1, 1, -1), 0);
});
