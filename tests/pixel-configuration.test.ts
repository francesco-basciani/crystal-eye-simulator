import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_PIXEL_CONFIGURATION,
  hasCanonicalPixelIdBijection,
  normalizePixelConfiguration,
  swapPhysicalPixelIds,
} from "../app/lib/pixel-configuration.ts";
import { parsePixelBackgroundTsv } from "../app/lib/pixel-background.ts";

const manualConfigurationUrl = new URL(
  "../app/data/crystal-eye-pixel-configuration.v1.json",
  import.meta.url,
);

test("the supplied manual geometry is the bundled default with pixel IDs 0..125", async () => {
  const supplied = JSON.parse(await readFile(manualConfigurationUrl, "utf8"));
  const configuration = normalizePixelConfiguration(supplied);
  assert.deepEqual(configuration, DEFAULT_PIXEL_CONFIGURATION);
  assert.equal(configuration?.version, 2);
  assert.equal(configuration?.pixels.length, 126);
  assert.equal(hasCanonicalPixelIdBijection(configuration!.pixels), true);
  assert.deepEqual(
    configuration?.pixels.map((pixel) => pixel.pixelId).sort((a, b) => a - b),
    Array.from({ length: 126 }, (_, pixelId) => pixelId),
  );
  assert.equal(configuration?.pixels.filter((pixel) => pixel.isPentagon).length, 6);
  assert.equal(configuration?.pixels.filter((pixel) => pixel.isSeam).length, 30);
  assert.deepEqual(configuration?.pixels[0], {
    pixelId: 0,
    legacyAnnotation: "",
    x: 50.00459784836065,
    y: 41.05484594980616,
    isSeam: false,
    isPentagon: false,
    rotationDeg: 30,
  });
});

test("legacy v1 user geometry migrates while PX identity becomes physical pixelId", async () => {
  const legacy = JSON.parse(await readFile(manualConfigurationUrl, "utf8"));
  legacy.pixels[0].x = 12.5;
  legacy.pixels[0].y = 33.25;
  legacy.pixels[0].rotationDeg = 47.5;
  legacy.pixels[0].secondaryId = "note-7";
  [legacy.pixels[0].id, legacy.pixels[125].id] = [
    legacy.pixels[125].id,
    legacy.pixels[0].id,
  ];

  const migrated = normalizePixelConfiguration(legacy);
  assert.ok(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.pixels[0].pixelId, 125);
  assert.equal(migrated.pixels[125].pixelId, 0);
  assert.equal(migrated.pixels[0].x, 12.5);
  assert.equal(migrated.pixels[0].y, 33.25);
  assert.equal(migrated.pixels[0].rotationDeg, 47.5);
  assert.equal(migrated.pixels[0].legacyAnnotation, "note-7");
  assert.equal(hasCanonicalPixelIdBijection(migrated.pixels), true);
});

test("legacy noncanonical display IDs do not erase saved geometry", async () => {
  const legacy = JSON.parse(await readFile(manualConfigurationUrl, "utf8"));
  legacy.pixels[7].id = "custom-display-name";
  legacy.pixels[7].x = 61.25;
  const migrated = normalizePixelConfiguration(legacy);
  assert.ok(migrated);
  assert.equal(migrated.pixels[7].pixelId, 7);
  assert.equal(migrated.pixels[7].x, 61.25);
  assert.equal(hasCanonicalPixelIdBijection(migrated.pixels), true);
});

test("editing an occupied pixelId swaps identities atomically", () => {
  const swapped = swapPhysicalPixelIds(DEFAULT_PIXEL_CONFIGURATION, 0, 125);
  assert.equal(swapped.pixels[0].pixelId, 125);
  assert.equal(swapped.pixels[125].pixelId, 0);
  assert.equal(hasCanonicalPixelIdBijection(swapped.pixels), true);
  assert.equal(swapped.pixels[0].x, DEFAULT_PIXEL_CONFIGURATION.pixels[0].x);
  assert.equal(swapped.pixels[125].x, DEFAULT_PIXEL_CONFIGURATION.pixels[125].x);
});

test("a geometry slot resolves background, selection, and export identity by physical pixelId", async () => {
  const backgroundText = await readFile(
    new URL("../public/data/pixbkg.txt", import.meta.url),
    "ascii",
  );
  const records = parsePixelBackgroundTsv(backgroundText);
  const swapped = swapPhysicalPixelIds(DEFAULT_PIXEL_CONFIGURATION, 0, 125);

  const firstGeometryPixel = swapped.pixels[0];
  assert.equal(firstGeometryPixel.pixelId, 125);
  assert.equal(records[firstGeometryPixel.pixelId].pixelId, 125);
  assert.equal(
    records[firstGeometryPixel.pixelId].backgroundRateCountsPerSecond,
    32.803,
  );
  assert.equal(
    swapped.pixels.find((pixel) => pixel.pixelId === 125),
    firstGeometryPixel,
  );
  assert.equal(JSON.stringify(swapped).includes('"pixelId":125'), true);
  assert.equal(JSON.stringify(swapped).includes('"id"'), false);
  assert.equal(JSON.stringify(swapped).includes('"index"'), false);
  assert.equal(JSON.stringify(swapped).includes('"secondaryId"'), false);
});

test("v2 import fails closed without the exact physical ID bijection or shape contract", () => {
  const cloneDefault = () => ({
    version: 2 as const,
    pixels: DEFAULT_PIXEL_CONFIGURATION.pixels.map((pixel) => ({ ...pixel })),
  });
  const duplicate = cloneDefault();
  duplicate.pixels[1].pixelId = duplicate.pixels[0].pixelId;
  assert.equal(normalizePixelConfiguration(duplicate), null);

  for (const invalidPixelId of [undefined, -1, 126, 1.5]) {
    const invalid = cloneDefault() as {
      version: 2;
      pixels: Array<Record<string, unknown>>;
    };
    invalid.pixels[0].pixelId = invalidPixelId;
    assert.equal(normalizePixelConfiguration(invalid), null);
  }

  const changedSeam = cloneDefault();
  changedSeam.pixels[0].isSeam = !changedSeam.pixels[0].isSeam;
  assert.equal(normalizePixelConfiguration(changedSeam), null);

  const missingPentagon = cloneDefault();
  missingPentagon.pixels
    .slice(0, 16)
    .forEach((pixel) => { pixel.isPentagon = false; });
  assert.equal(normalizePixelConfiguration(missingPentagon), null);
});
