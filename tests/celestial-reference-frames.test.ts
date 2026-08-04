import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  angularSeparationDeg,
  deriveCelestialReferenceFrameDirections,
} from "../app/lib/celestial-reference-frames.ts";
import {
  parseEciEphemerisTsv,
  type EciEphemerisSample,
  type EciVectorKm,
} from "../app/lib/eci-ephemeris.ts";

const datasetUrl = new URL(
  "../public/data/eci-ephemeris-2033.tsv",
  import.meta.url,
);

const REFERENCE_POINTS = [
  {
    index: 0,
    utc: "2033-01-01T00:00:00.000Z",
    satelliteKm: [0, 6_928.1, 0],
    sunKm: [26_579_123, -132_747_145, -57_541_267],
    moonKm: [30_725.2, -350_949.7, -119_280.6],
    sunGeocentric: [
      0.180683929818968,
      -0.902410355332205,
      -0.391163480011079,
    ],
    moonGeocentric: [
      0.082608476654653,
      -0.943571403909737,
      -0.320700553957435,
    ],
    sunTopocentric: [
      0.180676250896673,
      -0.902419098589929,
      -0.391146855876488,
    ],
    moonTopocentric: [
      0.081180140667445,
      -0.945561628427338,
      -0.315155503850169,
    ],
    sunMoonSeparationDeg: 7.315075758127812,
    sunBoresightSeparationDeg: 154.4778916430402,
    moonBoresightSeparationDeg: 161.00757819576052,
  },
  {
    index: 4_652,
    utc: "2033-01-30T23:59:58.000Z",
    satelliteKm: [-1_334.95, 6_780.62, -489.58],
    sunKm: [96_599_254, -102_128_814, -44_269_798],
    moonKm: [241_647.9, -257_214.4, -78_701],
    sunGeocentric: [
      0.655433463798635,
      -0.692951959170062,
      -0.300374028197007,
    ],
    moonGeocentric: [
      0.668293884427898,
      -0.711344110612139,
      -0.217653027393824,
    ],
    sunTopocentric: [
      0.65541838900463,
      -0.692972450929041,
      -0.300359647103223,
    ],
    moonTopocentric: [
      0.661680652157452,
      -0.7189001075587,
      -0.212982041291228,
    ],
    sunMoonSeparationDeg: 4.91239977929551,
    sunBoresightSeparationDeg: 141.56241505553265,
    moonBoresightSeparationDeg: 144.69060388992665,
  },
  {
    index: 9_303,
    utc: "2033-03-01T23:50:39.000Z",
    satelliteKm: [1_491.98, 6_740.75, 578.65],
    sunKm: [140_383_041, -43_733_306, -18_957_846],
    moonKm: [351_877.4, -61_101, -8_391.9],
    sunGeocentric: [
      0.946905693344397,
      -0.294988028077926,
      -0.127873653278007,
    ],
    moonGeocentric: [
      0.984984777235485,
      -0.171035579079149,
      -0.023490834455644,
    ],
    sunTopocentric: [
      0.946891479279896,
      -0.295032202308714,
      -0.127876995851481,
    ],
    moonTopocentric: [
      0.981456685312803,
      -0.190029993487799,
      -0.025127204974547,
    ],
    sunMoonSeparationDeg: 9.548685644542791,
    sunBoresightSeparationDeg: 95.3833823492841,
    moonBoresightSeparationDeg: 88.60363437120476,
  },
] as const;

function assertVectorClose(
  actual: EciVectorKm,
  expected: readonly [number, number, number],
  tolerance = 1e-14,
) {
  actual.forEach((component, index) => {
    assert.ok(
      Math.abs(component - expected[index]) <= tolerance,
      `component ${index}: expected ${expected[index]}, got ${component}`,
    );
  });
}

test("ECI reference-frame directions match selected workbook source points", async () => {
  const records = parseEciEphemerisTsv(await readFile(datasetUrl, "ascii"));

  for (const reference of REFERENCE_POINTS) {
    const record = records[reference.index];
    assert.equal(new Date(record.timestampMs).toISOString(), reference.utc);
    assert.deepEqual(record.satelliteKm, reference.satelliteKm);
    assert.deepEqual(record.sunKm, reference.sunKm);
    assert.deepEqual(record.moonKm, reference.moonKm);

    const directions = deriveCelestialReferenceFrameDirections({
      ...record,
      lowerRecordIndex: reference.index,
      upperRecordIndex: reference.index,
      interpolationFraction: 0,
    });
    assertVectorClose(directions.sunGeocentric, reference.sunGeocentric);
    assertVectorClose(directions.moonGeocentric, reference.moonGeocentric);
    assertVectorClose(directions.sunTopocentric, reference.sunTopocentric);
    assertVectorClose(directions.moonTopocentric, reference.moonTopocentric);
    assert.ok(
      Math.abs(
        directions.sunMoonGeocentricSeparationDeg -
          reference.sunMoonSeparationDeg,
      ) < 1e-12,
    );
    assert.ok(
      Math.abs(
        directions.sunBoresightSeparationDeg -
          reference.sunBoresightSeparationDeg,
      ) < 1e-12,
    );
    assert.ok(
      Math.abs(
        directions.moonBoresightSeparationDeg -
          reference.moonBoresightSeparationDeg,
      ) < 1e-12,
    );
  }
});

test("geocentric Sun and Moon trajectories are independent of satellite scenarios", () => {
  const reference = REFERENCE_POINTS[1];
  const sample: EciEphemerisSample = {
    timestampMs: Date.parse(reference.utc),
    satelliteKm: reference.satelliteKm,
    sunKm: reference.sunKm,
    moonKm: reference.moonKm,
    lowerRecordIndex: reference.index,
    upperRecordIndex: reference.index,
    interpolationFraction: 0,
  };
  const canonical = deriveCelestialReferenceFrameDirections(sample);
  const parametric = deriveCelestialReferenceFrameDirections(sample, [7_000, 0, 0]);

  assert.deepEqual(parametric.sunGeocentric, canonical.sunGeocentric);
  assert.deepEqual(parametric.moonGeocentric, canonical.moonGeocentric);
  assert.notDeepEqual(parametric.sunTopocentric, canonical.sunTopocentric);
  assert.notDeepEqual(parametric.moonTopocentric, canonical.moonTopocentric);
  assert.notDeepEqual(parametric.satelliteGeocentric, canonical.satelliteGeocentric);
});

test("bundled ECI rows have independent non-zero Sun and Moon path lengths", async () => {
  const records = parseEciEphemerisTsv(await readFile(datasetUrl, "ascii"));
  let sunPathDeg = 0;
  let moonPathDeg = 0;
  for (let index = 1; index < records.length; index += 1) {
    sunPathDeg += angularSeparationDeg(
      records[index - 1].sunKm,
      records[index].sunKm,
    );
    moonPathDeg += angularSeparationDeg(
      records[index - 1].moonKm,
      records[index].moonKm,
    );
  }

  assert.ok(Math.abs(sunPathDeg - 60.83604557) < 1e-6);
  assert.ok(Math.abs(moonPathDeg - 795.50611845) < 1e-6);
});
