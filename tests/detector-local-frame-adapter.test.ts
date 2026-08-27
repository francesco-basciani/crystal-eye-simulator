import assert from "node:assert/strict";
import test from "node:test";
import {
  createRitabrataDetectorVector,
  createThreeDetectorLocalVector,
  ritabrataAnglesFromDirection,
  ritabrataDirectionFromAngles,
  ritabrataToThreeDetectorLocal,
  threeDetectorLocalToRitabrata,
} from "../app/lib/detector-local-frame-adapter.ts";

test("the ROOT-to-Three adapter maps the detector basis by Rx(-90 degrees)", () => {
  assert.deepEqual(ritabrataToThreeDetectorLocal(createRitabrataDetectorVector(1, 0, 0)), [1, 0, -0]);
  assert.deepEqual(ritabrataToThreeDetectorLocal(createRitabrataDetectorVector(0, 1, 0)), [0, 0, -1]);
  assert.deepEqual(ritabrataToThreeDetectorLocal(createRitabrataDetectorVector(0, 0, 1)), [0, 1, -0]);
});

test("the rigid adapter round-trips vectors and preserves detector angles", () => {
  const root = ritabrataDirectionFromAngles(41.9898, 117.146);
  const three = ritabrataToThreeDetectorLocal(root);
  const roundTrip = threeDetectorLocalToRitabrata(three);
  for (let component = 0; component < 3; component += 1) {
    assert.ok(Math.abs(roundTrip[component] - root[component]) < 1e-15);
  }
  const angles = ritabrataAnglesFromDirection(roundTrip);
  assert.ok(Math.abs(angles.thetaDeg - 41.9898) < 1e-12);
  assert.ok(Math.abs(angles.phiDeg - 117.146) < 1e-12);
  const directThreeAngles = {
    thetaDeg: Math.acos(three[1]) * 180 / Math.PI,
    phiDeg: ((Math.atan2(-three[2], three[0]) * 180 / Math.PI) % 360 + 360) % 360,
  };
  assert.ok(Math.abs(directThreeAngles.thetaDeg - angles.thetaDeg) < 1e-12);
  assert.ok(Math.abs(directThreeAngles.phiDeg - angles.phiDeg) < 1e-12);
});

test("frame-tagged constructors reject non-finite vectors", () => {
  assert.throws(() => createRitabrataDetectorVector(Number.NaN, 0, 1), /finite/);
  assert.throws(() => createThreeDetectorLocalVector(0, Number.POSITIVE_INFINITY, 1), /finite/);
});
