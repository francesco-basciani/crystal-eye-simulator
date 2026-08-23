import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  reconstructBurstDirection,
  rotateDetectorDirectionToScene,
  sceneDirectionToRaDec,
} from "../app/lib/burst-direction-reconstruction.ts";
import { scoreDirectionAgainstTruth } from "../app/lib/burst-direction-truth-score.ts";

const localizerSource = readFileSync(
  new URL("../app/lib/burst-direction-reconstruction.ts", import.meta.url),
  "utf8",
);

test("direction reconstruction public input contains no injected truth fields", () => {
  const contract = localizerSource.slice(
    localizerSource.indexOf("export type DirectionReconstructionInput"),
    localizerSource.indexOf("export type BurstDirectionReconstruction"),
  );
  assert.doesNotMatch(
    contract,
    /truth|burstId|targetPixel|pixelIds|sourceRa|sourceDec|activeBurst/i,
  );
});

test("positive-excess centroid reconstructs a canonical local direction", () => {
  const result = reconstructBurstDirection({
    pixelValues: [1, 9, 1],
    pixelBaseline: [1, 1, 1],
    detectorNormals: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    radialBoresight: [1, 0, 0],
    frameIndex: 4,
    acquisitionTimeSeconds: 0.8,
  });
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.ok(Math.abs(result.raDeg) < 1e-10);
    assert.ok(Math.abs(result.decDeg) < 1e-10);
    assert.equal(result.activePixelCount, 1);
    assert.equal(scoreDirectionAgainstTruth(result, { raDeg: 0, decDeg: 0 }), 0);
    const wrapped = { ...result, raDeg: 359, decDeg: 0 };
    assert.ok(
      Math.abs(scoreDirectionAgainstTruth(wrapped, { raDeg: 1, decDeg: 0 }) - 2) <
        1e-10,
    );
    const polar = { ...result, raDeg: 245, decDeg: 90 };
    assert.ok(
      scoreDirectionAgainstTruth(polar, { raDeg: 12, decDeg: 90 }) < 1e-6,
    );
    assert.throws(
      () => scoreDirectionAgainstTruth(result, { raDeg: 0, decDeg: 91 }),
      /within \[-90, \+90\]/,
    );
  }
});

test("normal magnitude cannot bias the weighted centroid", () => {
  const result = reconstructBurstDirection({
    pixelValues: [2, 2],
    pixelBaseline: [1, 1],
    detectorNormals: [[100, 0, 0], [0, 1, 0]],
    radialBoresight: [0, 1, 0],
    frameIndex: 1,
    acquisitionTimeSeconds: 0.2,
  });
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.ok(Math.abs(result.localDirection[0] - Math.SQRT1_2) < 1e-12);
    assert.ok(Math.abs(result.localDirection[1] - Math.SQRT1_2) < 1e-12);
  }
});

test("coordinate transforms cover canonical and antipodal radial attitudes", () => {
  assert.deepEqual(sceneDirectionToRaDec([0, 1, 0]), { raDeg: 0, decDeg: 90 });
  const antipodal = rotateDetectorDirectionToScene([0, 1, 0], [0, -1, 0]);
  assert.ok(antipodal);
  assert.ok(Math.abs(antipodal?.[0] ?? 1) < 1e-12);
  assert.equal(antipodal?.[1], -1);
  assert.ok(Math.abs(antipodal?.[2] ?? 1) < 1e-12);
  const nearAntipodal = rotateDetectorDirectionToScene(
    [1, 2, 3],
    [0, -0.999999999, 0.000001],
  );
  assert.ok(nearAntipodal);
  assert.ok((nearAntipodal?.[0] ?? 0) < 0);
  assert.ok((nearAntipodal?.[1] ?? 0) < 0);
  assert.ok((nearAntipodal?.[2] ?? 0) > 0);
});

test("localization is unavailable for missing dimensions or zero excess", () => {
  assert.deepEqual(reconstructBurstDirection({
    pixelValues: [],
    pixelBaseline: [],
    detectorNormals: [],
    radialBoresight: [0, 1, 0],
    frameIndex: 1,
    acquisitionTimeSeconds: 0.2,
  }), {
    status: "unavailable",
    reason: "dimension-mismatch",
    frameIndex: 1,
    acquisitionTimeSeconds: 0.2,
  });
  assert.equal(reconstructBurstDirection({
    pixelValues: [1],
    pixelBaseline: [1],
    detectorNormals: [[0, 1, 0]],
    radialBoresight: [0, 1, 0],
    frameIndex: 2,
    acquisitionTimeSeconds: 0.4,
  }).status, "unavailable");
  const invalid = reconstructBurstDirection({
    pixelValues: [-1],
    pixelBaseline: [0],
    detectorNormals: [[0, 1, 0]],
    radialBoresight: [0, 0, 0],
    frameIndex: 2,
    acquisitionTimeSeconds: 0.4,
  });
  assert.equal(invalid.status, "unavailable");
  if (invalid.status === "unavailable") {
    assert.equal(invalid.reason, "invalid-input");
  }
  const degenerate = reconstructBurstDirection({
    pixelValues: [2, 2],
    pixelBaseline: [1, 1],
    detectorNormals: [[1, 0, 0], [-1, 0, 0]],
    radialBoresight: [0, 1, 0],
    frameIndex: 3,
    acquisitionTimeSeconds: 0.6,
  });
  assert.equal(degenerate.status, "unavailable");
  if (degenerate.status === "unavailable") {
    assert.equal(degenerate.reason, "degenerate-centroid");
  }
});
