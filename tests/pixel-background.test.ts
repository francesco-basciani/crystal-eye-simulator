import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PIXEL_BACKGROUND_BIN_SECONDS,
  PIXEL_BACKGROUND_SHA256,
  composeBackgroundRate,
  loadPixelBackgroundProfile,
  parsePixelBackgroundTsv,
  rateToExpectedCountsPerBin,
} from "../app/lib/pixel-background.ts";
import { RITABRATA_DETECTOR_FRAME } from "../app/lib/detector-local-frame-adapter.ts";

const datasetUrl = new URL("../public/data/pixbkg.txt", import.meta.url);

test("the bundled profile is byte-identical and preserves all fields", async () => {
  const bytes = await readFile(datasetUrl);
  const text = bytes.toString("ascii");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PIXEL_BACKGROUND_SHA256);

  const records = parsePixelBackgroundTsv(text);
  assert.equal(records.length, 126);
  assert.deepEqual(records[0], {
    pixelId: 0,
    thetaDeg: 40.629,
    phiDeg: -19.2146,
    backgroundRateCountsPerSecond: 41.1497,
  });
  assert.deepEqual(records[125], {
    pixelId: 125,
    thetaDeg: 0.641923,
    phiDeg: 90,
    backgroundRateCountsPerSecond: 32.803,
  });
});

test("the provisional mapping and deterministic 0.2 s bin are exact", async () => {
  const text = await readFile(datasetUrl, "ascii");
  const profile = await loadPixelBackgroundProfile(
    "https://example.invalid/pixbkg.txt",
    async () => new Response(text, { status: 200 }),
  );

  assert.deepEqual(profile.records.map((record) => record.pixelId),
    Array.from({ length: 126 }, (_, index) => index));
  assert.equal(profile.status, "PROVISIONAL");
  assert.equal(profile.angularCoordinateFrame, RITABRATA_DETECTOR_FRAME);
  assert.equal(profile.binSeconds, PIXEL_BACKGROUND_BIN_SECONDS);
  assert.ok(Math.abs(profile.totalRateCountsPerSecond - 5711.5784) < 1e-9);
  assert.ok(Math.abs(profile.totalExpectedCountsPerBin - 1142.31568) < 1e-9);
  assert.ok(Math.abs(profile.expectedCountsPerBin[0] - 8.22994) < 1e-12);
  assert.equal(profile.records[0].thetaDeg, 40.629);
  assert.equal(profile.records[0].phiDeg, -19.2146);
});

test("celestial terms are separate deterministic additions", async () => {
  const text = await readFile(datasetUrl, "ascii");
  const profile = await loadPixelBackgroundProfile(
    "https://example.invalid/pixbkg.txt",
    async () => new Response(text, { status: 200 }),
  );
  assert.ok(
    Math.abs(composeBackgroundRate(profile, 10, 2, 3) - 5726.5784) < 1e-9,
  );
  assert.ok(
    Math.abs(rateToExpectedCountsPerBin(5726.5784) - 1145.31568) < 1e-9,
  );
});

test("the parser fails closed on malformed or reordered data", async () => {
  const text = await readFile(datasetUrl, "ascii");
  assert.throws(() => parsePixelBackgroundTsv(text.replace(/^0\t/, "1\t")), /record/);
  assert.throws(() => parsePixelBackgroundTsv(text.replace(/\t41\.1497\n/, "\t-1\n")), /record/);
  assert.throws(() => parsePixelBackgroundTsv(text.slice(0, -1)), /LF/);
  assert.throws(() => parsePixelBackgroundTsv(`header\n${text}`), /126 records/);
});
