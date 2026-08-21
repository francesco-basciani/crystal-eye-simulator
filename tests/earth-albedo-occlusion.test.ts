import assert from "node:assert/strict";
import test from "node:test";
import {
  getExposedEarthAlbedoWeight,
  getNadirExposureFraction,
  getSubSatelliteSolarIncidence,
  isModuleCenterExposedToNadir,
  isOuterCrownModule,
  type NadirModuleGeometry,
} from "../app/lib/earth-albedo-occlusion.ts";

function moduleAt(
  pixelId: number,
  thetaDeg: number,
  phiDeg: number,
): NadirModuleGeometry {
  const theta = thetaDeg * Math.PI / 180;
  const phi = phiDeg * Math.PI / 180;
  return {
    pixelId,
    normal: [
      Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      -Math.sin(theta) * Math.sin(phi),
    ],
  };
}

const outer = Array.from({ length: 25 }, (_, index) =>
  moduleAt(index, 82.3, index / 25 * 360)
);
const inner = moduleAt(117, 20.5521, 90);

test("geocentric solar incidence is noon one and terminator/midnight zero", () => {
  assert.equal(getSubSatelliteSolarIncidence([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(getSubSatelliteSolarIncidence([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(getSubSatelliteSolarIncidence([1, 0, 0], [-1, 0, 0]), 0);
});

test("physical theta identifies only the pixbkg outer crown", () => {
  assert.ok(outer.every(isOuterCrownModule));
  assert.equal(isOuterCrownModule(inner), false);
  assert.equal(isModuleCenterExposedToNadir(inner, 1, -1), false);
});

test("point-center nadir visibility follows mount placement", () => {
  const exposed = (x: number, z: number) => outer.filter((module) =>
    isModuleCenterExposedToNadir(module, x, z)
  );
  assert.equal(exposed(0, 0).length, 0);
  assert.ok(exposed(1, 0).length > 0 && exposed(1, 0).length < outer.length);
  assert.ok(exposed(1, -1).length > exposed(1, 0).length);
  assert.equal(
    getNadirExposureFraction(outer, 1, 0),
    exposed(1, 0).length / outer.length,
  );
});

test("nightside and inner modules have no Earth support", () => {
  assert.ok(outer.every((module) =>
    getExposedEarthAlbedoWeight(module, 0, 0, 1, 1, -1) === 0
  ));
  assert.equal(getExposedEarthAlbedoWeight(inner, 1, 0, 1, 1, -1), 0);
  const exposedOuter = outer.find((module) =>
    isModuleCenterExposedToNadir(module, 1, 0)
  );
  assert.ok(exposedOuter);
  assert.ok(getExposedEarthAlbedoWeight(exposedOuter, 1e-6, 0, 1, 1, 0) > 0);
});

test("sunlit Earth reaches a mount-dependent subset of the outer crown only", () => {
  const supported = (mountX: number, mountZ: number) => outer.filter((module) =>
    getExposedEarthAlbedoWeight(
      module,
      0.8,
      Math.PI / 5,
      0.9,
      mountX,
      mountZ,
    ) > 0
  );
  assert.deepEqual(supported(0, 0), []);
  assert.ok(supported(1, 0).length > 0);
  assert.ok(supported(1, -1).length > supported(1, 0).length);
  assert.equal(getExposedEarthAlbedoWeight(inner, 0.8, 0, 0.9, 1, -1), 0);
});
