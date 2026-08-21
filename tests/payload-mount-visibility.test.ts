import assert from "node:assert/strict";
import test from "node:test";
import {
  getMountSkyVisibility,
  type NadirModuleGeometry,
} from "../app/lib/earth-albedo-occlusion.ts";

function moduleAt(pixelId: number, thetaDeg: number, phiDeg: number): NadirModuleGeometry {
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

test("physical inner modules 112 117 and 122 are not mapped to the synthetic rim", () => {
  const modules = [
    moduleAt(112, 24.1021, -90),
    moduleAt(117, 20.5521, 90),
    moduleAt(122, 12.0384, -90),
  ];
  for (const detectorModule of modules) {
    assert.ok(getMountSkyVisibility(detectorModule, 0, 0) > 0.9);
  }
});

test("mount visibility varies continuously with physical polar angle", () => {
  const samples = [12, 20, 24, 40, 60, 72, 82].map((theta, index) =>
    getMountSkyVisibility(moduleAt(index, theta, 0), 0, 0)
  );
  assert.ok(samples.every((value) => value >= 0 && value <= 1));
  assert.ok(samples.every((value, index) => index === 0 || value <= samples[index - 1]));
});
