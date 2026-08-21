import assert from "node:assert/strict";
import test from "node:test";
import {
  MOON_DIRECTION_RADIUS_SCALE,
  SATELLITE_ORBIT_RADIUS_SCALE,
  SUN_DIRECTION_RADIUS_SCALE,
  getGeometryEllipticalRadius,
  projectEciDirectionToGeometryEllipse,
} from "../app/lib/system-geometry-projection.ts";

const center = { x: 285, y: 520 };
const orbitRadius = { x: 165, y: 340 };
const direction = [0.3, 0.8, -0.4] as const;

test("satellite stays on the orbit while Moon and Sun are outside it", () => {
  const satellite = projectEciDirectionToGeometryEllipse(
    direction,
    center,
    orbitRadius,
    SATELLITE_ORBIT_RADIUS_SCALE,
  );
  const moon = projectEciDirectionToGeometryEllipse(
    direction,
    center,
    orbitRadius,
    MOON_DIRECTION_RADIUS_SCALE,
  );
  const sun = projectEciDirectionToGeometryEllipse(
    direction,
    center,
    orbitRadius,
    SUN_DIRECTION_RADIUS_SCALE,
  );

  assert.ok(Math.abs(getGeometryEllipticalRadius(satellite, center, orbitRadius) - 1) < 1e-12);
  assert.ok(getGeometryEllipticalRadius(moon, center, orbitRadius) > 1);
  assert.ok(
    getGeometryEllipticalRadius(sun, center, orbitRadius) >
      getGeometryEllipticalRadius(moon, center, orbitRadius),
  );
});

test("an out-of-plane vector is placed on the upper directional boundary", () => {
  const projected = projectEciDirectionToGeometryEllipse(
    [0, 1, 0],
    center,
    orbitRadius,
    MOON_DIRECTION_RADIUS_SCALE,
  );
  assert.equal(projected.x, center.x);
  assert.equal(projected.y, center.y - orbitRadius.y * MOON_DIRECTION_RADIUS_SCALE);
  assert.equal(projected.outOfPlane, true);
});

test("invalid geometry fails closed", () => {
  assert.throws(
    () => projectEciDirectionToGeometryEllipse(direction, center, orbitRadius, 0),
    RangeError,
  );
});

test("portrait layout keeps directional markers inside the canvas", () => {
  const width = 320;
  const height = 680;
  const portraitCenter = { x: width * 0.5, y: height * 0.57 };
  const radius = Math.min(width, height) * 0.27;
  const portraitOrbit = { x: radius, y: radius };
  for (const radialScale of [
    SATELLITE_ORBIT_RADIUS_SCALE,
    MOON_DIRECTION_RADIUS_SCALE,
    SUN_DIRECTION_RADIUS_SCALE,
  ]) {
    for (const vector of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const point = projectEciDirectionToGeometryEllipse(
        vector,
        portraitCenter,
        portraitOrbit,
        radialScale,
      );
      assert.ok(point.x >= 0 && point.x <= width);
      assert.ok(point.y >= 0 && point.y <= height);
    }
  }
});
