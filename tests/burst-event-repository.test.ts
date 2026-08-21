import assert from "node:assert/strict";
import test from "node:test";
import {
  BURST_EVENT_STORE_NAME,
  BurstEventRepository,
  buildBurstPixelReadouts,
  openBurstEventRepository,
  type BurstDetectionRecord,
  type BurstDetectionRecordInput,
} from "../app/lib/burst-event-repository.ts";

type FakeRange = {
  lower: [number, string];
  upper: [number, string];
  lowerOpen: boolean;
  upperOpen: boolean;
};

const fakeKeyRange = {
  bound(
    lower: [number, string],
    upper: [number, string],
    lowerOpen: boolean,
    upperOpen: boolean,
  ): FakeRange {
    return { lower, upper, lowerOpen, upperOpen };
  },
} as unknown as typeof IDBKeyRange;

function compareKey(
  left: [number, string],
  right: [number, string],
): number {
  return left[0] - right[0] || left[1].localeCompare(right[1]);
}

class FakeDatabase {
  records = new Map<string, BurstDetectionRecord>();
  closed = false;

  close() {
    this.closed = true;
  }

  transaction(storeName: string) {
    assert.equal(storeName, BURST_EVENT_STORE_NAME);
    const transaction: Record<string, unknown> = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    const store = {
      put: (input: BurstDetectionRecordInput) => {
        const request: Record<string, unknown> = {
          error: null,
          onsuccess: null,
          onerror: null,
        };
        queueMicrotask(() => {
          this.records.set(input.eventKey, { ...input });
          (request.onsuccess as (() => void) | null)?.();
          (transaction.oncomplete as (() => void) | null)?.();
        });
        return request;
      },
      count: () => {
        const request: Record<string, unknown> = {
          result: 0,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        queueMicrotask(() => {
          request.result = this.records.size;
          (request.onsuccess as (() => void) | null)?.();
        });
        return request;
      },
      index: (name: string) => {
        assert.equal(name, "bySimulatedAt");
        return {
          openCursor: (range: FakeRange, direction: string) => {
            assert.equal(direction, "prev");
            const matching = [...this.records.values()]
              .filter((record) => {
                const key: [number, string] = [
                  record.simulatedAtMs,
                  record.eventKey,
                ];
                const aboveLower = range.lowerOpen
                  ? compareKey(key, range.lower) > 0
                  : compareKey(key, range.lower) >= 0;
                const belowUpper = range.upperOpen
                  ? compareKey(key, range.upper) < 0
                  : compareKey(key, range.upper) <= 0;
                return aboveLower && belowUpper;
              })
              .sort((left, right) =>
                compareKey(
                  [right.simulatedAtMs, right.eventKey],
                  [left.simulatedAtMs, left.eventKey],
                ),
              );
            let index = 0;
            const request: Record<string, unknown> = {
              result: null,
              error: null,
              onsuccess: null,
              onerror: null,
            };
            const emit = () => {
              const value = matching[index];
              request.result = value
                ? {
                    value,
                    continue: () => {
                      index += 1;
                      queueMicrotask(emit);
                    },
                  }
                : null;
              (request.onsuccess as (() => void) | null)?.();
            };
            queueMicrotask(emit);
            return request;
          },
        };
      },
    };
    transaction.objectStore = () => store;
    return transaction;
  }
}

function input(
  eventKey: string,
  burstId: number,
  simulatedAtMs: number,
): BurstDetectionRecordInput {
  const aggregate = Array.from({ length: 126 }, (_, pixelId) => pixelId / 10);
  const background = Array.from({ length: 126 }, () => 1);
  const source = aggregate.map((value, pixelId) =>
    Math.max(0, value - background[pixelId]),
  );
  const impact = source.map((value) => Math.min(1, value / 10));
  return {
    schemaVersion: 1,
    eventKey,
    runId: "run-a",
    burstId,
    simulatedAtMs,
    simulatedDate: new Date(simulatedAtMs).toISOString(),
    capturedAtMs: simulatedAtMs + 1,
    missionElapsedSeconds: burstId,
    classification: "injected-source-reconstruction",
    reconstructionMethod: "positive-excess-weighted-centroid-v1",
    reconstructedRaDeg: 12,
    reconstructedDecDeg: -4,
    truthRaDeg: 11,
    truthDecDeg: -3,
    truthAngularErrorDeg: 1.4,
    targetPixelId: 43,
    configuredIntensityPercent: 80,
    transmissionFraction: 0.7,
    configuredDurationSeconds: 1.2,
    peakFrameIndex: 12,
    exposureSeconds: 0.2,
    positiveExcessCounts: source.reduce((sum, value) => sum + value, 0),
    activePixelCount: source.filter((value) => value > 0).length,
    footprintPixelIds: [43, 44, 45],
    aggregateExpectedCounts: aggregate.reduce((sum, value) => sum + value, 0),
    aggregateBackgroundExpectedCounts: background.reduce(
      (sum, value) => sum + value,
      0,
    ),
    aggregateSourceExpectedCounts: source.reduce(
      (sum, value) => sum + value,
      0,
    ),
    pixels: buildBurstPixelReadouts({
      aggregateExpectedCounts: aggregate,
      backgroundExpectedCounts: background,
      sourceExcessExpectedCounts: source,
      relativeImpact: impact,
    }),
  };
}

test("pixel event readouts preserve all 126 aggregate values and fail closed per layer", () => {
  const record = input("run-a:1", 1, 1_000);
  assert.equal(record.pixels.length, 126);
  assert.deepEqual(record.pixels.map((pixel) => pixel.pixelId), [
    ...Array(126).keys(),
  ]);
  for (const pixel of record.pixels) {
    assert.equal(pixel.layers.upperAcd.status, "unavailable");
    assert.equal(pixel.layers.upperGagg.expectedCounts, null);
    assert.equal(pixel.layers.lowerLyso.reason, "per-layer-response-model-unavailable");
  }
  assert.throws(
    () =>
      buildBurstPixelReadouts({
        aggregateExpectedCounts: [1],
        backgroundExpectedCounts: [1],
        sourceExcessExpectedCounts: [0],
        relativeImpact: [0],
      }),
    /exactly 126/,
  );
});

test("event repository upserts one run/burst record and keyset-pages newest first", async () => {
  const database = new FakeDatabase();
  const repository = new BurstEventRepository(
    database as unknown as IDBDatabase,
    fakeKeyRange,
  );
  await repository.save(input("run-a:1", 1, 1_000));
  const updated = { ...input("run-a:1", 1, 1_000), positiveExcessCounts: 99 };
  await repository.save(updated);
  await repository.save(input("run-a:2", 2, 2_000));
  await repository.save(input("run-a:3", 3, 3_000));
  assert.equal(await repository.count(), 3);

  const first = await repository.query({ limit: 2 });
  assert.deepEqual(first.items.map((record) => record.burstId), [3, 2]);
  assert.equal(first.hasMore, true);
  const second = await repository.query({ cursor: first.nextCursor!, limit: 2 });
  assert.deepEqual(second.items.map((record) => record.burstId), [1]);
  assert.equal(second.items[0].positiveExcessCounts, 99);
});

test("unavailable IndexedDB fails explicitly for the burst event archive", async () => {
  await assert.rejects(openBurstEventRepository(undefined), /unavailable/);
});
