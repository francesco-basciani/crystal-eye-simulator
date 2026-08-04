import assert from "node:assert/strict";
import test from "node:test";
import {
  PHOTON_STORE_NAME,
  PhotonRepository,
  openPhotonRepository,
  type PhotonRecord,
  type PhotonRecordInput,
} from "../app/lib/photon-repository.ts";

type FakeRange = {
  lower: [number, number];
  upper: [number, number];
  lowerOpen: boolean;
  upperOpen: boolean;
};

const fakeKeyRange = {
  bound(
    lower: [number, number],
    upper: [number, number],
    lowerOpen: boolean,
    upperOpen: boolean,
  ): FakeRange {
    return { lower, upper, lowerOpen, upperOpen };
  },
} as unknown as typeof IDBKeyRange;

function compareKey(left: [number, number], right: [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

class FakeDatabase {
  records: PhotonRecord[] = [];
  nextId = 1;
  closed = false;

  close() {
    this.closed = true;
  }

  transaction(storeName: string) {
    assert.equal(storeName, PHOTON_STORE_NAME);
    const transaction: Record<string, unknown> = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    const store = {
      add: (input: PhotonRecordInput) => {
        const request: Record<string, unknown> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        queueMicrotask(() => {
          const duplicate = this.records.some(
            (record) => record.runId === input.runId && record.bin === input.bin,
          );
          if (duplicate) {
            request.error = new Error("unique byRunBin constraint");
            transaction.error = request.error;
            (request.onerror as (() => void) | null)?.();
            (transaction.onabort as (() => void) | null)?.();
            return;
          }
          const id = this.nextId++;
          request.result = id;
          this.records.push({ ...input, id });
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
          request.result = this.records.length;
          (request.onsuccess as (() => void) | null)?.();
        });
        return request;
      },
      index: (name: string) => {
        assert.equal(name, "bySimulatedAt");
        return {
          openCursor: (range: FakeRange, direction: string) => {
            assert.equal(direction, "prev");
            const matching = this.records
              .filter((record) => {
                const key: [number, number] = [record.simulatedAtMs, record.id];
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
                  [right.simulatedAtMs, right.id],
                  [left.simulatedAtMs, left.id],
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
                ? { value, continue: () => { index += 1; queueMicrotask(emit); } }
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

function input(runId: string, bin: number, simulatedAtMs: number): PhotonRecordInput {
  return {
    schemaVersion: 1,
    runId,
    bin,
    elapsed: bin * 0.2,
    capturedAtMs: 2_000 + bin,
    simulatedAtMs,
    simulatedDate: new Date(simulatedAtMs).toISOString(),
    observed: 10,
    background: 8,
    source: 2,
    sun: 1,
    moon: 0.5,
    earthAlbedo: 0.25,
    activeBursts: 0,
    hitPixels: 4,
  };
}

test("repository appends transactionally and enforces unique run/bin records", async () => {
  const database = new FakeDatabase();
  const repository = new PhotonRepository(database as unknown as IDBDatabase, fakeKeyRange);
  const stored = await repository.append(input("run-a", 1, 1_000));
  assert.equal(stored.id, 1);
  assert.equal(await repository.count(), 1);
  await assert.rejects(repository.append(input("run-a", 1, 2_000)), /unique byRunBin/);
});

test("reverse compound keyset paging is inclusive and has no gaps or duplicates", async () => {
  const database = new FakeDatabase();
  const repository = new PhotonRepository(database as unknown as IDBDatabase, fakeKeyRange);
  for (const [bin, time] of [[1, 1_000], [2, 2_000], [3, 2_000], [4, 3_000]] as const) {
    await repository.append(input("run-a", bin, time));
  }

  const first = await repository.query({ fromMs: 1_000, toMs: 3_000, limit: 2 });
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  const second = await repository.query({
    fromMs: 1_000,
    toMs: 3_000,
    cursor: first.nextCursor!,
    limit: 2,
  });
  assert.equal(second.hasMore, false);
  assert.deepEqual(
    [...first.items, ...second.items].map((record) => record.id),
    [4, 3, 2, 1],
  );
});

test("unavailable IndexedDB fails explicitly", async () => {
  await assert.rejects(openPhotonRepository(undefined), /unavailable/);
});
