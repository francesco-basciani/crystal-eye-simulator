import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  V2R8_CANDIDATE_GEOMETRY_VERSION,
  createV2R8CandidateDetectorGeometry,
  getV2R8CosineIncidence,
  rankV2R8PixelsForDirection,
} from "../app/lib/detector-geometry-v2r8.ts";
import { parsePixelBackgroundTsv } from "../app/lib/pixel-background.ts";

const datasetUrl = new URL("../public/data/pixbkg.txt", import.meta.url);

async function loadGeometry() {
  const records = parsePixelBackgroundTsv(await readFile(datasetUrl, "ascii"));
  return createV2R8CandidateDetectorGeometry(records);
}

test("the candidate geometry exposes 126 canonical layered modules", async () => {
  const geometry = await loadGeometry();
  assert.equal(geometry.geometryVersion, V2R8_CANDIDATE_GEOMETRY_VERSION);
  assert.equal(geometry.status, "PROVISIONAL");
  assert.equal(geometry.modules.length, 126);
  assert.deepEqual(geometry.modules.map((detectorModule) => detectorModule.pixelId),
    Array.from({ length: 126 }, (_, pixelId) => pixelId));
  for (const detectorModule of geometry.modules) {
    assert.equal(detectorModule.upperCrystalId, detectorModule.pixelId);
    assert.equal(detectorModule.lowerCrystalId, null);
    assert.equal(detectorModule.upperAcdId, null);
    assert.deepEqual(detectorModule.layers.map((layer) => layer.kind),
      ["acd", "upper-gagg", "lower-lyso"]);
    assert.ok(Math.abs(Math.hypot(...detectorModule.normal) - 1) < 1e-12);
    assert.ok(detectorModule.layers.every((layer) => layer.responseStatus === "UNAVAILABLE"));
  }
  assert.equal(geometry.bottomAcd.scope, "GLOBAL");
});

test("the detector frame follows +Y polar and phi=atan2(-Z,X)", async () => {
  const geometry = await loadGeometry();
  const first = geometry.modules[0].normal;
  const thetaDeg = Math.acos(first[1]) * 180 / Math.PI;
  const phiDeg = Math.atan2(-first[2], first[0]) * 180 / Math.PI;
  assert.ok(Math.abs(thetaDeg - 40.629) < 1e-10);
  assert.ok(Math.abs(phiDeg - (-19.2146)) < 1e-10);
  assert.equal(geometry.coordinateFrame, "+Y_POLAR_PHI_ATAN2_NEG_Z_X");
});

test("directional ranking is physical, deterministic, and fail-closed", async () => {
  const geometry = await loadGeometry();
  const direction = geometry.modules[43].normal;
  assert.equal(rankV2R8PixelsForDirection(geometry, direction, 1)[0], 43);
  assert.ok(Math.abs(getV2R8CosineIncidence(geometry, 43, direction) - 1) < 1e-12);
  assert.deepEqual(
    rankV2R8PixelsForDirection(geometry, direction, 12),
    rankV2R8PixelsForDirection(geometry, direction, 12),
  );
  assert.throws(
    () => rankV2R8PixelsForDirection(geometry, [0, 0, 0], 5),
    /non-zero source direction/,
  );
  assert.throws(
    () => getV2R8CosineIncidence(geometry, 126, direction),
    /Unknown V2R8/,
  );
});
