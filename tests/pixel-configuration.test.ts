import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_PIXEL_CONFIGURATION,
  PIXEL_CONFIGURATION_STORAGE_KEY_V3,
  PIXEL_CONFIGURATION_STORAGE_KEY_V4,
  hasCanonicalPixelIdBijection,
  migrateStoredPixelConfigurationToAuthoritativeIds,
  migrateStoredPixelConfigurationToPhotoGeometry,
  normalizePixelConfiguration,
  swapPhysicalPixelIds,
} from "../app/lib/pixel-configuration.ts";
import { parsePixelBackgroundTsv } from "../app/lib/pixel-background.ts";

const legacyConfigurationUrl = new URL(
  "../app/data/crystal-eye-pixel-configuration.v1.json",
  import.meta.url,
);
const bundledConfigurationUrl = new URL(
  "../app/data/crystal-eye-pixel-configuration.v2.json",
  import.meta.url,
);
const authoritativeSourceUrl = new URL(
  "../docs/provenance/inputs/CE-SIM-20260806-authoritative-pixel-ids.source.json",
  import.meta.url,
);

test("the bundled default combines the current geometry with the authoritative physical IDs", async () => {
  const supplied = JSON.parse(await readFile(bundledConfigurationUrl, "utf8"));
  const legacyGeometry = JSON.parse(await readFile(legacyConfigurationUrl, "utf8"));
  const authoritativeSource = JSON.parse(await readFile(authoritativeSourceUrl, "utf8"));
  const configuration = normalizePixelConfiguration(supplied);
  assert.deepEqual(configuration, DEFAULT_PIXEL_CONFIGURATION);
  assert.equal(configuration?.version, 2);
  assert.equal(configuration?.pixels.length, 126);
  assert.equal(hasCanonicalPixelIdBijection(configuration!.pixels), true);
  assert.deepEqual(
    configuration?.pixels.map((pixel) => pixel.pixelId).sort((a, b) => a - b),
    Array.from({ length: 126 }, (_, pixelId) => pixelId),
  );
  assert.deepEqual(
    configuration?.pixels.map((pixel) => pixel.pixelId),
    authoritativeSource.pixels.map((pixel: { pixelId: number }) => pixel.pixelId),
  );
  assert.deepEqual(
    supplied.pixels.map(
      ({ x, y, isSeam, isPentagon, rotationDeg, legacyAnnotation }: {
        x: number;
        y: number;
        isSeam: boolean;
        isPentagon: boolean;
        rotationDeg: number;
        legacyAnnotation: string;
      }) => ({
        x,
        y,
        isSeam,
        isPentagon,
        rotationDeg,
        legacyAnnotation,
      }),
    ),
    legacyGeometry.pixels.map(
      ({ x, y, isSeam, isPentagon, rotationDeg, secondaryId }: {
        x: number;
        y: number;
        isSeam: boolean;
        isPentagon: boolean;
        rotationDeg: number;
        secondaryId: string;
      }) => ({
        x,
        y,
        isSeam,
        isPentagon,
        rotationDeg,
        legacyAnnotation: secondaryId,
      }),
    ),
  );
  assert.deepEqual(
    configuration?.pixels
      .map((pixel, geometrySlot) => ({ pixel, geometrySlot }))
      .filter(({ pixel }) => pixel.isPentagon)
      .map(({ geometrySlot }) => geometrySlot),
    [6, 23, 39, 54, 70, 86],
  );
  assert.deepEqual(
    configuration?.pixels
      .map((pixel, geometrySlot) => ({ pixel, geometrySlot }))
      .filter(({ pixel }) => pixel.isSeam)
      .map(({ geometrySlot }) => geometrySlot),
    Array.from({ length: 30 }, (_, index) => index + 96),
  );
  assert.deepEqual(
    configuration?.pixels[0] && {
      ...configuration.pixels[0],
      rotationDeg: Number(configuration.pixels[0].rotationDeg.toFixed(1)),
    },
    {
    pixelId: 117,
    legacyAnnotation: "",
    x: 47.034,
    y: 39.6831,
    isSeam: false,
    isPentagon: false,
    rotationDeg: 30.1,
    },
  );
});

test("legacy v1 user geometry migrates while PX identity becomes physical pixelId", async () => {
  const legacy = JSON.parse(await readFile(legacyConfigurationUrl, "utf8"));
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
  const legacy = JSON.parse(await readFile(legacyConfigurationUrl, "utf8"));
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
  assert.equal(swapped.pixels[6].pixelId, 117);
  assert.equal(hasCanonicalPixelIdBijection(swapped.pixels), true);
  assert.equal(swapped.pixels[0].x, DEFAULT_PIXEL_CONFIGURATION.pixels[0].x);
  assert.equal(swapped.pixels[6].x, DEFAULT_PIXEL_CONFIGURATION.pixels[6].x);
});

test("stored v2 identity and annotations migrate onto the photo-aligned v3 geometry", () => {
  const storedV2 = swapPhysicalPixelIds(
    {
      version: 2,
      pixels: DEFAULT_PIXEL_CONFIGURATION.pixels.map((pixel) => ({
        ...pixel,
        x: 12.5,
        y: 87.5,
        rotationDeg: 47.5,
      })),
    },
    0,
    125,
  );
  storedV2.pixels[0].legacyAnnotation = "saved-note";
  storedV2.pixels[6].isPentagon = false;
  storedV2.pixels[7].isPentagon = true;

  const migrated = migrateStoredPixelConfigurationToPhotoGeometry(storedV2);
  assert.ok(migrated);
  assert.equal(PIXEL_CONFIGURATION_STORAGE_KEY_V3, "crystal-eye.pixel-configuration.v3");
  assert.equal(migrated.pixels[0].pixelId, 125);
  assert.equal(migrated.pixels[6].pixelId, 117);
  assert.equal(migrated.pixels[0].legacyAnnotation, "saved-note");
  assert.deepEqual(
    migrated.pixels.map(({ x, y, rotationDeg, isSeam, isPentagon }) => ({
      x,
      y,
      rotationDeg,
      isSeam,
      isPentagon,
    })),
    DEFAULT_PIXEL_CONFIGURATION.pixels.map(
      ({ x, y, rotationDeg, isSeam, isPentagon }) => ({
        x,
        y,
        rotationDeg,
        isSeam,
        isPentagon,
      }),
    ),
  );
});

test("stored v3 geometry and annotations migrate to authoritative IDs under storage v4", () => {
  const storedV3 = swapPhysicalPixelIds(
    {
      version: 2,
      pixels: DEFAULT_PIXEL_CONFIGURATION.pixels.map((pixel) => ({ ...pixel })),
    },
    0,
    125,
  );
  storedV3.pixels[0].x = 12.5;
  storedV3.pixels[0].y = 87.5;
  storedV3.pixels[0].rotationDeg = 47.5;
  storedV3.pixels[0].legacyAnnotation = "saved-note";

  const migrated = migrateStoredPixelConfigurationToAuthoritativeIds(storedV3);
  assert.ok(migrated);
  assert.equal(PIXEL_CONFIGURATION_STORAGE_KEY_V4, "crystal-eye.pixel-configuration.v4");
  assert.equal(migrated.pixels[0].pixelId, 117);
  assert.equal(migrated.pixels[6].pixelId, 125);
  assert.equal(migrated.pixels[0].x, 12.5);
  assert.equal(migrated.pixels[0].y, 87.5);
  assert.equal(migrated.pixels[0].rotationDeg, 47.5);
  assert.equal(migrated.pixels[0].legacyAnnotation, "saved-note");
  assert.deepEqual(
    migrated.pixels.map((pixel) => pixel.pixelId),
    DEFAULT_PIXEL_CONFIGURATION.pixels.map((pixel) => pixel.pixelId),
  );
});

test("the authoritative ID domain is exactly consistent with pixbkg", async () => {
  const authoritativeSource = JSON.parse(
    await readFile(authoritativeSourceUrl, "utf8"),
  );
  const normalizedSource = normalizePixelConfiguration(authoritativeSource);
  const records = parsePixelBackgroundTsv(
    await readFile(new URL("../public/data/pixbkg.txt", import.meta.url), "ascii"),
  );

  assert.deepEqual(Object.keys(authoritativeSource).sort(), ["pixels", "version"]);
  assert.equal(authoritativeSource.version, 2);
  assert.equal(
    authoritativeSource.pixels.every((pixel: Record<string, unknown>) =>
      JSON.stringify(Object.keys(pixel).sort()) ===
        JSON.stringify([
          "isPentagon",
          "isSeam",
          "legacyAnnotation",
          "pixelId",
          "rotationDeg",
          "x",
          "y",
        ]),
    ),
    true,
  );
  assert.ok(normalizedSource);
  assert.equal(normalizedSource.pixels.length, 126);
  assert.equal(hasCanonicalPixelIdBijection(normalizedSource.pixels), true);
  assert.deepEqual(
    normalizedSource.pixels.map((pixel) => pixel.pixelId).sort((a, b) => a - b),
    records.map((record) => record.pixelId),
  );
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
