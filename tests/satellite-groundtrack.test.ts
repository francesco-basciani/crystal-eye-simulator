import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MELISSA_GROUNDTRACK_DECLARED_PERIOD_SECONDS,
  MELISSA_GROUNDTRACK_LAST_SAMPLE_MS,
  MELISSA_GROUNDTRACK_RECORD_COUNT,
  MELISSA_GROUNDTRACK_SAMPLE_INTERVAL_SECONDS,
  MELISSA_GROUNDTRACK_SHA256,
  MELISSA_GROUNDTRACK_START_MS,
  loadSatelliteGroundTrackProfile,
  parseSatelliteGroundTrack,
  sampleSatelliteGroundTrack,
  summarizeSatelliteGroundTrackContinuity,
  type SatelliteGroundTrackProfile,
} from "../app/lib/satellite-groundtrack.ts";

const datasetUrl = new URL(
  "../public/data/groundtrack-orbit1-melissa.txt",
  import.meta.url,
);

async function loadBundledProfile(): Promise<SatelliteGroundTrackProfile> {
  const text = await readFile(datasetUrl, "utf8");
  return loadSatelliteGroundTrackProfile(
    "https://example.invalid/groundtrack-orbit1-melissa.txt",
    async () => new Response(text, { status: 200 }),
  );
}

test("Melissa's immutable source asset has the approved hash and schema", async () => {
  const bytes = await readFile(datasetUrl);
  const text = bytes.toString("utf8");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    MELISSA_GROUNDTRACK_SHA256,
  );
  const records = parseSatelliteGroundTrack(text);
  assert.equal(records.length, MELISSA_GROUNDTRACK_RECORD_COUNT);
  assert.equal(records[0].timestampMs, MELISSA_GROUNDTRACK_START_MS);
  assert.equal(records.at(-1)?.timestampMs, MELISSA_GROUNDTRACK_LAST_SAMPLE_MS);
  assert.deepEqual(records[0].eciKm, [0, 6928.1, 0]);
  assert.deepEqual(records[0].ecefKm, [0, 6928.1, 0]);
  assert.equal(records[0].latitudeDeg, 0);
  assert.equal(records[0].longitudeDeg, 90);
  assert.equal(records[0].altitudeKm, 550);
});

test("the supplied samples preserve their 8 s cadence, 550 km altitude, and 5 degree inclination", async () => {
  const profile = await loadBundledProfile();
  assert.equal(
    profile.sampleIntervalSeconds,
    MELISSA_GROUNDTRACK_SAMPLE_INTERVAL_SECONDS,
  );
  assert.equal(
    profile.declaredPeriodSeconds,
    MELISSA_GROUNDTRACK_DECLARED_PERIOD_SECONDS,
  );
  for (let index = 1; index < profile.records.length; index += 1) {
    assert.equal(
      profile.records[index].timestampMs - profile.records[index - 1].timestampMs,
      8_000,
    );
  }
  assert.ok(
    profile.records.every((record) => Math.abs(record.altitudeKm - 550) < 1e-12),
  );
  const maximumGeocentricLatitudeDeg = Math.max(
    ...profile.records.map((record) => record.latitudeDeg),
  );
  const minimumGeocentricLatitudeDeg = Math.min(
    ...profile.records.map((record) => record.latitudeDeg),
  );
  assert.equal(maximumGeocentricLatitudeDeg, 5);
  assert.equal(minimumGeocentricLatitudeDeg, -5);
});

test("sampling is exact at source rows and continuous only inside the supplied interval", async () => {
  const profile = await loadBundledProfile();
  const first = sampleSatelliteGroundTrack(profile, profile.startMs);
  assert.deepEqual(first.eciKm, [0, 6928.1, 0]);
  assert.equal(first.lowerRecordIndex, 0);
  assert.equal(first.upperRecordIndex, 0);

  const midpoint = sampleSatelliteGroundTrack(profile, profile.startMs + 4_000);
  assert.equal(midpoint.lowerRecordIndex, 0);
  assert.equal(midpoint.upperRecordIndex, 1);
  assert.equal(midpoint.interpolationFraction, 0.5);
  assert.ok(Math.abs(Math.hypot(...midpoint.eciKm) - 6928.1) < 1e-3);
  assert.ok(Math.abs(midpoint.longitudeDeg - 90.2329) < 1e-10);
  assert.throws(
    () => sampleSatelliteGroundTrack(profile, profile.startMs - 1),
    /no measured sample/,
  );
  assert.throws(
    () => sampleSatelliteGroundTrack(profile, profile.lastSampleMs + 1),
    /no measured sample/,
  );
  assert.throws(() => sampleSatelliteGroundTrack(profile, Number.NaN), /NaN/);
});

test("continuity diagnostics expose the unsampled tail without choosing a continuation policy", async () => {
  const profile = await loadBundledProfile();
  const continuity = summarizeSatelliteGroundTrackContinuity(profile);
  assert.equal(continuity.sampledDurationSeconds, 5736);
  assert.equal(continuity.declaredPeriodSeconds, 5739);
  assert.equal(continuity.unsampledTailSeconds, 3);
  assert.ok(Math.abs(continuity.closureAngleDeg - 0.67770364) < 1e-6);
});

test("the loader fails closed when the supplied asset changes", async () => {
  const text = await readFile(datasetUrl, "utf8");
  await assert.rejects(
    loadSatelliteGroundTrackProfile(
      "https://example.invalid/groundtrack-orbit1-melissa.txt",
      async () => new Response(text.replace("6928.1000", "6928.2000"), { status: 200 }),
    ),
    /SHA-256 mismatch/,
  );
  assert.throws(
    () => parseSatelliteGroundTrack(text.replace("2031-01-01T00:00:08", "2031-01-01T00:00:09")),
    /cadence/,
  );
});
