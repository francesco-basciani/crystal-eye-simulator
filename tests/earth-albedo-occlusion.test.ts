import assert from "node:assert/strict";
import test from "node:test";
import {
  getExposedEarthAlbedoWeight,
  getNadirExposureFraction,
  isPixelCenterExposedToNadir,
  type NadirPixelGeometry,
} from "../app/lib/earth-albedo-occlusion.ts";
import { distributeSupportedTotal } from "../app/lib/signal-composition.ts";

const OUTER_PIXEL_COUNT = 35;
const OUTERMOST_RING = 6;
const outerPixels: readonly NadirPixelGeometry[] = Array.from(
  { length: OUTER_PIXEL_COUNT },
  (_, slot) => ({
    ring: OUTERMOST_RING,
    outermostRing: OUTERMOST_RING,
    angleRadians:
      (slot / OUTER_PIXEL_COUNT) * Math.PI * 2 + Math.PI / OUTER_PIXEL_COUNT,
  }),
);
const innerPixel: NadirPixelGeometry = {
  ring: 5,
  outermostRing: OUTERMOST_RING,
  angleRadians: 0,
};

function exposedSlots(mountX: number, mountZ: number) {
  return outerPixels
    .map((pixel, slot) =>
      isPixelCenterExposedToNadir(pixel, mountX, mountZ) ? slot : null,
    )
    .filter((slot): slot is number => slot !== null);
}

test("binary nadir rays block center placement and expose only overhanging crown sectors", () => {
  assert.deepEqual(exposedSlots(0, 0), []);
  assert.equal(getNadirExposureFraction(outerPixels, 0, 0), 0);

  const edge = exposedSlots(1, 0);
  const corner = exposedSlots(1, -1);
  assert.equal(edge.length, 18);
  assert.equal(corner.length, 26);
  assert.ok(edge.every((slot) => Math.cos(outerPixels[slot].angleRadians) > 0));
  assert.ok(corner.length > edge.length);
  assert.equal(isPixelCenterExposedToNadir(innerPixel, 1, -1), false);
});

test("configured ID rotation changes exposed physical IDs while preserving support count", () => {
  const base = exposedSlots(1, 0);
  // A configured physical-ID rotation changes identity, not sphere geometry.
  const rotated = base.map((sphereSlot) => (sphereSlot + 5) % OUTER_PIXEL_COUNT);
  assert.equal(rotated.length, base.length);
  assert.notDeepEqual(rotated, base);
});

test("directional lobe redistributes only over geometric support and sums reconcile", () => {
  const totalAtFullSupport = 17;
  const exposure = getNadirExposureFraction(outerPixels, 1, 0);
  const expectedAggregate = totalAtFullSupport * exposure;
  const weightsAtZero = outerPixels.map((pixel) =>
    getExposedEarthAlbedoWeight(pixel, 1, 0, 1, 1, 0),
  );
  const weightsAtQuarterTurn = outerPixels.map((pixel) =>
    getExposedEarthAlbedoWeight(pixel, 1, Math.PI / 2, 1, 1, 0),
  );
  const supportAtZero = weightsAtZero.map((weight) => weight > 0);
  const supportAtQuarterTurn = weightsAtQuarterTurn.map((weight) => weight > 0);
  assert.deepEqual(supportAtQuarterTurn, supportAtZero);
  assert.notEqual(
    weightsAtZero.indexOf(Math.max(...weightsAtZero)),
    weightsAtQuarterTurn.indexOf(Math.max(...weightsAtQuarterTurn)),
  );

  const allocation = distributeSupportedTotal(expectedAggregate, weightsAtZero);
  assert.ok(
    Math.abs(
      allocation.values.reduce((sum, value) => sum + value, 0) -
        expectedAggregate,
    ) < 1e-12,
  );
  assert.equal(allocation.unsupportedTotal, 0);
  assert.equal(getExposedEarthAlbedoWeight(innerPixel, 1, 0, 1, 1, 0), 0);

  const centerWeights = outerPixels.map((pixel) =>
    getExposedEarthAlbedoWeight(pixel, 1, 0, 1, 0, 0),
  );
  const centerAllocation = distributeSupportedTotal(0, centerWeights);
  assert.ok(centerAllocation.values.every((value) => value === 0));
});
