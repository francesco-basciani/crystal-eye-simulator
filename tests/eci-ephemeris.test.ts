import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ECI_EPHEMERIS_END_MS,
  ECI_EPHEMERIS_RECORD_COUNT,
  ECI_EPHEMERIS_SHA256,
  ECI_EPHEMERIS_START_MS,
  EciEphemerisRangeError,
  greenwichMeanSiderealTimeRadians,
  interpolateSatelliteVector,
  loadEciEphemerisProfile,
  parseEciEphemerisTsv,
  sampleEciEphemeris,
  slerpUnitDirection,
  type EciEphemerisProfile,
} from "../app/lib/eci-ephemeris.ts";

const datasetUrl = new URL("../public/data/eci-ephemeris-2033.tsv", import.meta.url);

async function loadBundledProfile(): Promise<EciEphemerisProfile> {
  const text = await readFile(datasetUrl, "ascii");
  return loadEciEphemerisProfile(
    "https://example.invalid/eci-ephemeris-2033.tsv",
    async () => new Response(text, { status: 200 }),
  );
}

test("the derived ECI asset has the approved hash, extent, and clean decimals", async () => {
  const bytes = await readFile(datasetUrl);
  const text = bytes.toString("ascii");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), ECI_EPHEMERIS_SHA256);
  assert.doesNotMatch(text, /\.\d{3,}/);

  const records = parseEciEphemerisTsv(text);
  assert.equal(records.length, ECI_EPHEMERIS_RECORD_COUNT);
  assert.equal(records[0].timestampMs, ECI_EPHEMERIS_START_MS);
  assert.equal(records.at(-1)?.timestampMs, ECI_EPHEMERIS_END_MS);
  assert.deepEqual(records[0].satelliteKm, [0, 6928.1, 0]);
  assert.deepEqual(records[0].sunKm, [26579123, -132747145, -57541267]);
  assert.deepEqual(records[0].moonKm, [30725.2, -350949.7, -119280.6]);
  assert.deepEqual(records.at(-1)?.satelliteKm, [1491.98, 6740.75, 578.65]);
});

test("sampling is exact at records and bounded to the approved 2033 interval", async () => {
  const profile = await loadBundledProfile();
  assert.equal("status" in profile, false);
  assert.deepEqual(sampleEciEphemeris(profile, profile.startMs).satelliteKm, [0, 6928.1, 0]);
  assert.deepEqual(
    sampleEciEphemeris(profile, profile.endMs).satelliteKm,
    [1491.98, 6740.75, 578.65],
  );
  assert.throws(
    () => sampleEciEphemeris(profile, profile.startMs - 1),
    EciEphemerisRangeError,
  );
  assert.throws(
    () => sampleEciEphemeris(profile, profile.endMs + 1),
    EciEphemerisRangeError,
  );
});

test("GMST is deterministic from replay UTC and has the expected sidereal advance", () => {
  const j2000Ms = Date.UTC(2000, 0, 1, 12, 0, 0);
  const j2000Gmst = greenwichMeanSiderealTimeRadians(j2000Ms);
  assert.ok(
    Math.abs((j2000Gmst * 180) / Math.PI - 280.46061837) < 1e-9,
  );

  const nextUtcDayGmst = greenwichMeanSiderealTimeRadians(
    j2000Ms + 86_400_000,
  );
  const advance = ((nextUtcDayGmst - j2000Gmst) + Math.PI * 2) % (Math.PI * 2);
  assert.ok(
    Math.abs((advance * 180) / Math.PI - 0.98564736629) < 1e-9,
  );
  assert.throws(() => greenwichMeanSiderealTimeRadians(Number.NaN), /finite/);
});

test("display direction interpolation is spherical, normalized, and bounded", () => {
  const midpoint = slerpUnitDirection([1, 0, 0], [0, 1, 0], 0.5);
  assert.ok(Math.abs(Math.hypot(...midpoint) - 1) < 1e-12);
  assert.ok(Math.abs(midpoint[0] - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(midpoint[1] - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(slerpUnitDirection([2, 0, 0], [0, 3, 0], 0), [1, 0, 0]);
  assert.deepEqual(slerpUnitDirection([2, 0, 0], [0, 3, 0], 1), [0, 1, 0]);
  assert.throws(() => slerpUnitDirection([1, 0, 0], [-1, 0, 0], 0.5), /Antipodal/);
  assert.throws(() => slerpUnitDirection([1, 0, 0], [0, 1, 0], 1.01), /\[0, 1\]/);
});

test("satellite interpolation preserves the linearly interpolated radius", async () => {
  const profile = await loadBundledProfile();
  const first = profile.records[0];
  const second = profile.records[1];
  const timestampMs = (first.timestampMs + second.timestampMs) / 2;
  const sample = sampleEciEphemeris(profile, timestampMs);
  const expectedRadius =
    (Math.hypot(...first.satelliteKm) + Math.hypot(...second.satelliteKm)) / 2;
  const chordMidpointRadius = Math.hypot(
    ...first.satelliteKm.map(
      (value, index) => (value + second.satelliteKm[index]) / 2,
    ),
  );
  assert.ok(Math.abs(Math.hypot(...sample.satelliteKm) - expectedRadius) < 1e-9);
  assert.ok(expectedRadius - chordMidpointRadius > 200);
  assert.equal(sample.interpolationFraction, 0.5);

  const direct = interpolateSatelliteVector(first.satelliteKm, second.satelliteKm, 0.5);
  assert.deepEqual(sample.satelliteKm, direct);
});

test("Sun and Moon positions are interpolated from the same canonical ECI rows", async () => {
  const profile = await loadBundledProfile();
  const first = profile.records[0];
  const second = profile.records[1];
  const sample = sampleEciEphemeris(
    profile,
    first.timestampMs + (second.timestampMs - first.timestampMs) * 0.25,
  );
  assert.deepEqual(
    sample.sunKm,
    first.sunKm.map((value, index) => value + (second.sunKm[index] - value) * 0.25),
  );
  assert.deepEqual(
    sample.moonKm,
    first.moonKm.map((value, index) => value + (second.moonKm[index] - value) * 0.25),
  );
});

test("the parser and loader fail closed on schema, order, range, and hash changes", async () => {
  const text = await readFile(datasetUrl, "ascii");
  assert.throws(() => parseEciEphemerisTsv(text.slice(0, -1)), /LF/);
  assert.throws(() => parseEciEphemerisTsv(text.replace(/^utc/, "time")), /header/);
  assert.throws(
    () => parseEciEphemerisTsv(text.replace("2033-01-01 00:09:17", "2033-01-01 00:00:00")),
    /strictly increasing/,
  );
  assert.throws(
    () => parseEciEphemerisTsv(text.replace("2033-01-01 00:00:00", "2032-12-31 23:59:59")),
    /out-of-scenario/,
  );
  await assert.rejects(
    loadEciEphemerisProfile(
      "https://example.invalid/eci-ephemeris-2033.tsv",
      async () => new Response(text.replace("6928.1", "6928.2"), { status: 200 }),
    ),
    /SHA-256 mismatch/,
  );
});
