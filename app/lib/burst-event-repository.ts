import { angularSeparationDeg } from "./burst-direction-truth-score.ts";

export const BURST_EVENT_DATABASE_NAME = "crystal-eye-burst-events";
export const BURST_EVENT_DATABASE_VERSION = 1;
export const BURST_EVENT_STORE_NAME = "burstEvents";
export const BURST_EVENT_PIXEL_COUNT = 126;

export const BURST_COORDINATE_FRAME = "SIMULATOR ECI-LIKE EQUATORIAL";
export const BURST_COORDINATE_EPOCH = "SIMULATED UTC";
export const BURST_RA_CONVENTION = "DEGREES [0, 360)";
export const BURST_DEC_CONVENTION = "DEGREES [-90, +90]";

export type BurstTruthEvaluation = Readonly<{
  status: "available";
  raDeg: number;
  decDeg: number;
  angularErrorDeg: number;
}> | Readonly<{
  status: "unavailable";
  reason:
    | "not-injected-source"
    | "truth-not-retained"
    | "invalid-direction-data";
}>;

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
  schemaVersion: 1 | 2;
  eventKey: string;
  runId: string;
  burstId: number;
  simulatedAtMs: number;
  simulatedDate: string;
  capturedAtMs: number;
  missionElapsedSeconds: number;
  classification:
    | "injected-source-reconstruction"
    | "telemetry-reconstruction";
  reconstructionMethod: "positive-excess-weighted-centroid-v1";
  reconstructedRaDeg: number;
  reconstructedDecDeg: number;
  coordinateFrame?: "simulation-eci-like-equatorial";
  coordinateEpoch?: "simulated-utc";
  rightAscensionConvention?: "degrees-[0,360)";
  declinationConvention?: "degrees-[-90,+90]";
  truthStatus?: "available" | "unavailable";
  truthRaDeg: number | null;
  truthDecDeg: number | null;
  truthAngularErrorDeg: number | null;
  truthUnavailableReason?: "not-injected-source" | "truth-not-retained" | null;
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

export function getBurstTruthEvaluation(
  record: Pick<
    BurstDetectionRecord,
    | "classification"
    | "truthStatus"
    | "truthRaDeg"
    | "truthDecDeg"
    | "truthAngularErrorDeg"
    | "truthUnavailableReason"
    | "reconstructedRaDeg"
    | "reconstructedDecDeg"
  >,
): BurstTruthEvaluation {
  if (record.classification !== "injected-source-reconstruction") {
    return Object.freeze({
      status: "unavailable",
      reason: "not-injected-source",
    });
  }
  if (
    record.truthStatus !== "unavailable" &&
    Number.isFinite(record.truthRaDeg) &&
    Number.isFinite(record.truthDecDeg) &&
    isCanonicalEquatorial(record.truthRaDeg as number, record.truthDecDeg as number) &&
    isCanonicalEquatorial(record.reconstructedRaDeg, record.reconstructedDecDeg)
  ) {
    try {
      return Object.freeze({
        status: "available",
        raDeg: record.truthRaDeg as number,
        decDeg: record.truthDecDeg as number,
        angularErrorDeg: angularSeparationDeg(
          {
            raDeg: record.reconstructedRaDeg,
            decDeg: record.reconstructedDecDeg,
          },
          {
            raDeg: record.truthRaDeg as number,
            decDeg: record.truthDecDeg as number,
          },
        ),
      });
    } catch {
      return Object.freeze({
        status: "unavailable",
        reason: "invalid-direction-data",
      });
    }
  }
  return Object.freeze({
    status: "unavailable",
    reason: record.truthUnavailableReason ?? "truth-not-retained",
  });
}

function isCanonicalEquatorial(raDeg: number, decDeg: number): boolean {
  return Number.isFinite(raDeg) &&
    raDeg >= 0 &&
    raDeg < 360 &&
    Number.isFinite(decDeg) &&
    decDeg >= -90 &&
    decDeg <= 90;
}

function validateBurstDetectionRecord(input: BurstDetectionRecordInput): void {
  if (!isCanonicalEquatorial(input.reconstructedRaDeg, input.reconstructedDecDeg)) {
    throw new RangeError("Burst reconstruction coordinates are outside the declared convention.");
  }
  if (input.schemaVersion === 2 && (
    input.coordinateFrame !== "simulation-eci-like-equatorial" ||
    input.coordinateEpoch !== "simulated-utc" ||
    input.rightAscensionConvention !== "degrees-[0,360)" ||
    input.declinationConvention !== "degrees-[-90,+90]"
  )) {
    throw new RangeError("Burst schema v2 requires explicit coordinate metadata.");
  }
  if (input.classification === "telemetry-reconstruction") {
    if (
      input.truthStatus !== "unavailable" ||
      input.truthRaDeg !== null ||
      input.truthDecDeg !== null ||
      input.truthAngularErrorDeg !== null
    ) {
      throw new RangeError("Telemetry reconstruction cannot contain injected truth.");
    }
    return;
  }
  if (
    input.truthStatus === "unavailable" ||
    input.truthRaDeg === null ||
    input.truthDecDeg === null ||
    input.truthAngularErrorDeg === null ||
    !isCanonicalEquatorial(input.truthRaDeg, input.truthDecDeg) ||
    !Number.isFinite(input.truthAngularErrorDeg) ||
    input.truthAngularErrorDeg < 0 ||
    input.truthAngularErrorDeg > 180
  ) {
    throw new RangeError("Injected-source reconstruction requires valid truth coordinates.");
  }
  const recomputed = angularSeparationDeg(
    { raDeg: input.reconstructedRaDeg, decDeg: input.reconstructedDecDeg },
    { raDeg: input.truthRaDeg, decDeg: input.truthDecDeg },
  );
  if (Math.abs(recomputed - input.truthAngularErrorDeg) > 1e-9) {
    throw new RangeError("Stored truth angular error is inconsistent with the coordinate pair.");
  }
}

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
      validateBurstDetectionRecord(input);
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
