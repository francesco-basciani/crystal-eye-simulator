import assert from "node:assert/strict";
import test from "node:test";
import { queryEciEphemeris } from "../app/lib/ephemeris-query.ts";
import type { EciEphemerisRecord } from "../app/lib/eci-ephemeris.ts";

const records: readonly EciEphemerisRecord[] = [0, 1, 2, 3, 4].map((index) => ({
  timestampMs: Date.UTC(2033, 0, 1, 0, index, 0),
  satelliteKm: [index, 10, 20],
  sunKm: [100 + index, 200, 300],
  moonKm: [400, 500 + index, 600],
}));

test("ephemeris UTC bounds are inclusive and pages have no gaps or duplicates", () => {
  const fromMs = records[1].timestampMs;
  const toMs = records[4].timestampMs;
  const first = queryEciEphemeris(records, { fromMs, toMs, offset: 0, limit: 2 });
  const second = queryEciEphemeris(records, { fromMs, toMs, offset: 2, limit: 2 });

  assert.equal(first.total, 4);
  assert.deepEqual(
    [...first.items, ...second.items].map((record) => record.timestampMs),
    records.slice(1).map((record) => record.timestampMs),
  );
});

test("ephemeris text search covers normalized UTC and every vector value", () => {
  assert.deepEqual(
    queryEciEphemeris(records, { search: "2033-01-01t00:03" }).items,
    [records[3]],
  );
  assert.deepEqual(queryEciEphemeris(records, { search: "104" }).items, [records[4]]);
  assert.equal(queryEciEphemeris(records, { fromMs: 2, toMs: 1 }).total, 0);
});
