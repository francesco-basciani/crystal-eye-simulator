export const BURST_EVENT_DATABASE_NAME = "crystal-eye-burst-events";
export const BURST_EVENT_DATABASE_VERSION = 1;
export const BURST_EVENT_STORE_NAME = "burstEvents";
export const BURST_EVENT_PIXEL_COUNT = 126;

export type UnavailableLayerReadout = Readonly<{
  status: "unavailable";
  expectedCounts: null;
  reason: "per-layer-response-model-unavailable";
}>;

export type BurstPixelReadout = Readonly<{
  pixelId: number;
  aggregateExpectedCounts: number;
  backgroundExpectedCounts: number;
  sourceExcessExpectedCounts: number;
  relativeImpact: number;
  layers: Readonly<{
    upperAcd: UnavailableLayerReadout;
    upperGagg: UnavailableLayerReadout;
    lowerLyso: UnavailableLayerReadout;
  }>;
}>;

export type BurstDetectionRecordInput = Readonly<{
  schemaVersion: 1;
  eventKey: string;
  runId: string;
  burstId: number;
  simulatedAtMs: number;
  simulatedDate: string;
  capturedAtMs: number;
  missionElapsedSeconds: number;
  classification: "injected-source-reconstruction";
  reconstructionMethod: "positive-excess-weighted-centroid-v1";
  reconstructedRaDeg: number;
  reconstructedDecDeg: number;
  truthRaDeg: number;
  truthDecDeg: number;
  truthAngularErrorDeg: number;
  targetPixelId: number;
  configuredIntensityPercent: number;
  transmissionFraction: number;
  configuredDurationSeconds: number;
  peakFrameIndex: number;
  exposureSeconds: 0.2;
  positiveExcessCounts: number;
  activePixelCount: number;
  footprintPixelIds: readonly number[];
  aggregateExpectedCounts: number;
  aggregateBackgroundExpectedCounts: number;
  aggregateSourceExpectedCounts: number;
  pixels: readonly BurstPixelReadout[];
}>;

export type BurstDetectionRecord = BurstDetectionRecordInput;

export type BurstEventCursor = Readonly<{
  simulatedAtMs: number;
  eventKey: string;
}>;

export type BurstEventQuery = Readonly<{
  fromMs?: number;
  toMs?: number;
  cursor?: BurstEventCursor;
  limit?: number;
}>;

export type BurstEventQueryResult = Readonly<{
  items: readonly BurstDetectionRecord[];
  nextCursor: BurstEventCursor | null;
  hasMore: boolean;
}>;

const unavailableLayerReadout: UnavailableLayerReadout = Object.freeze({
  status: "unavailable",
  expectedCounts: null,
  reason: "per-layer-response-model-unavailable",
});

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function buildBurstPixelReadouts({
  aggregateExpectedCounts,
  backgroundExpectedCounts,
  sourceExcessExpectedCounts,
  relativeImpact,
}: {
  aggregateExpectedCounts: readonly number[];
  backgroundExpectedCounts: readonly number[];
  sourceExcessExpectedCounts: readonly number[];
  relativeImpact: readonly number[];
}): readonly BurstPixelReadout[] {
  const arrays = [
    aggregateExpectedCounts,
    backgroundExpectedCounts,
    sourceExcessExpectedCounts,
    relativeImpact,
  ];
  if (arrays.some((values) => values.length !== BURST_EVENT_PIXEL_COUNT)) {
    throw new RangeError("Burst event readout requires exactly 126 values per field.");
  }
  if (
    aggregateExpectedCounts.some((value) => !finiteNonNegative(value)) ||
    backgroundExpectedCounts.some((value) => !finiteNonNegative(value)) ||
    sourceExcessExpectedCounts.some((value) => !finiteNonNegative(value)) ||
    relativeImpact.some(
      (value) => !finiteNonNegative(value) || value > 1,
    )
  ) {
    throw new RangeError("Burst event readout contains an invalid pixel value.");
  }
  return Object.freeze(
    aggregateExpectedCounts.map((expected, pixelId) =>
      Object.freeze({
        pixelId,
        aggregateExpectedCounts: expected,
        backgroundExpectedCounts: backgroundExpectedCounts[pixelId],
        sourceExcessExpectedCounts: sourceExcessExpectedCounts[pixelId],
        relativeImpact: relativeImpact[pixelId],
        layers: Object.freeze({
          upperAcd: unavailableLayerReadout,
          upperGagg: unavailableLayerReadout,
          lowerLyso: unavailableLayerReadout,
        }),
      }),
    ),
  );
}

function requestFailure(request: IDBRequest, fallback: string): Error {
  return request.error ?? new Error(fallback);
}

function transactionFailure(transaction: IDBTransaction): Error {
  return transaction.error ?? new Error("Burst event transaction failed.");
}

export class BurstEventRepository {
  private readonly database: IDBDatabase;
  private readonly keyRange: typeof IDBKeyRange;

  constructor(
    database: IDBDatabase,
    keyRange: typeof IDBKeyRange = IDBKeyRange,
  ) {
    this.database = database;
    this.keyRange = keyRange;
  }

  close(): void {
    this.database.close();
  }

  save(input: BurstDetectionRecordInput): Promise<BurstDetectionRecord> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(
        BURST_EVENT_STORE_NAME,
        "readwrite",
      );
      const request = transaction.objectStore(BURST_EVENT_STORE_NAME).put(input);
      request.onerror = () =>
        reject(requestFailure(request, "Burst event write failed."));
      transaction.oncomplete = () => resolve(Object.freeze({ ...input }));
      transaction.onerror = () => reject(transactionFailure(transaction));
      transaction.onabort = () => reject(transactionFailure(transaction));
    });
  }

  count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(
        BURST_EVENT_STORE_NAME,
        "readonly",
      );
      const request = transaction.objectStore(BURST_EVENT_STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(requestFailure(request, "Burst event count failed."));
      transaction.onerror = () => reject(transactionFailure(transaction));
      transaction.onabort = () => reject(transactionFailure(transaction));
    });
  }

  query(query: BurstEventQuery = {}): Promise<BurstEventQueryResult> {
    const limit = Math.max(1, Math.trunc(query.limit ?? 100));
    const fromMs = query.fromMs ?? Number.MIN_SAFE_INTEGER;
    const toMs = query.toMs ?? Number.MAX_SAFE_INTEGER;
    if (fromMs > toMs) {
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    }
    const lower: [number, string] = [fromMs, ""];
    let upper: [number, string] = [toMs, "\uffff"];
    let upperOpen = false;
    if (query.cursor) {
      upper = [query.cursor.simulatedAtMs, query.cursor.eventKey];
      upperOpen = true;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(
        BURST_EVENT_STORE_NAME,
        "readonly",
      );
      const index = transaction
        .objectStore(BURST_EVENT_STORE_NAME)
        .index("bySimulatedAt");
      const range = this.keyRange.bound(lower, upper, false, upperOpen);
      const request = index.openCursor(range, "prev");
      const items: BurstDetectionRecord[] = [];
      let settled = false;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          if (!settled) {
            settled = true;
            resolve({ items, nextCursor: null, hasMore: false });
          }
          return;
        }
        if (items.length === limit) {
          const last = items.at(-1)!;
          settled = true;
          resolve({
            items,
            nextCursor: {
              simulatedAtMs: last.simulatedAtMs,
              eventKey: last.eventKey,
            },
            hasMore: true,
          });
          return;
        }
        items.push(Object.freeze(cursor.value as BurstDetectionRecord));
        cursor.continue();
      };
      request.onerror = () => {
        if (!settled) {
          reject(requestFailure(request, "Burst event query failed."));
        }
      };
      transaction.onerror = () => {
        if (!settled) reject(transactionFailure(transaction));
      };
      transaction.onabort = () => {
        if (!settled) reject(transactionFailure(transaction));
      };
    });
  }
}

export function openBurstEventRepository(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<BurstEventRepository> {
  if (!factory) {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = factory.open(
      BURST_EVENT_DATABASE_NAME,
      BURST_EVENT_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(BURST_EVENT_STORE_NAME, {
        keyPath: "eventKey",
      });
      store.createIndex("bySimulatedAt", ["simulatedAtMs", "eventKey"]);
    };
    request.onsuccess = () => resolve(new BurstEventRepository(request.result));
    request.onerror = () =>
      reject(requestFailure(request, "Burst event archive could not be opened."));
    request.onblocked = () =>
      reject(new Error("Burst event archive upgrade is blocked by another tab."));
  });
}
