export const PHOTON_DATABASE_NAME = "crystal-eye-simulator";
export const PHOTON_DATABASE_VERSION = 1;
export const PHOTON_STORE_NAME = "photonRecords";

export type PhotonRecordInput = Readonly<{
  schemaVersion: 1;
  runId: string;
  bin: number;
  elapsed: number;
  capturedAtMs: number;
  simulatedAtMs: number;
  simulatedDate: string;
  observed: number;
  background: number;
  source: number;
  sun: number;
  moon: number;
  earthAlbedo: number;
  activeBursts: number;
  activeBurstIds?: readonly number[];
  startedBurstIds?: readonly number[];
  hitPixels: number;
}>;

export type PhotonRecord = PhotonRecordInput & Readonly<{
  id: number;
  normalizationWarnings?: readonly string[];
}>;

export type PhotonCursor = Readonly<{
  simulatedAtMs: number;
  id: number;
}>;

export type PhotonQuery = Readonly<{
  fromMs?: number;
  toMs?: number;
  cursor?: PhotonCursor;
  limit?: number;
}>;

export type PhotonQueryResult = Readonly<{
  items: readonly PhotonRecord[];
  nextCursor: PhotonCursor | null;
  hasMore: boolean;
}>;

function requestFailure(request: IDBRequest, fallback: string): Error {
  return request.error ?? new Error(fallback);
}

function transactionFailure(transaction: IDBTransaction): Error {
  return transaction.error ?? new Error("IndexedDB transaction failed.");
}

export function normalizeStoredPhotonRecord(
  value: unknown,
  fallbackId = 0,
): PhotonRecord {
  const raw = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const warnings: string[] = [];
  const finite = (field: string, fallback: number) => {
    const candidate = raw[field];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    warnings.push(field);
    return fallback;
  };
  const nonNegative = (field: string, fallback: number) => {
    const candidate = finite(field, fallback);
    if (candidate >= 0) return candidate;
    warnings.push(`${field}:negative`);
    return fallback;
  };
  const optionalNonNegativeIntegerArray = (field: string) => {
    const candidate = raw[field];
    if (candidate === undefined) return undefined;
    if (!Array.isArray(candidate)) {
      warnings.push(field);
      return undefined;
    }
    const normalized = candidate.filter(
      (item): item is number =>
        typeof item === "number" &&
        Number.isFinite(item) &&
        item >= 0 &&
        Number.isInteger(item),
    );
    if (normalized.length !== candidate.length) warnings.push(`${field}:normalized`);
    return Object.freeze([...new Set(normalized)]);
  };
  const id = Math.max(0, Math.trunc(nonNegative("id", fallbackId)));
  const bin = Math.max(0, Math.trunc(nonNegative("bin", id)));
  const background = nonNegative("background", 0);
  const source = nonNegative("source", 0);
  const observed = nonNegative("observed", background + source);
  const capturedCandidate = finite("capturedAtMs", Number.NaN);
  const simulatedCandidate = finite("simulatedAtMs", Number.NaN);
  const validTimestamp = (candidate: number) =>
    Number.isFinite(candidate) && Number.isFinite(new Date(candidate).getTime());
  const parsedSimulatedDate =
    typeof raw.simulatedDate === "string"
      ? Date.parse(raw.simulatedDate)
      : Number.NaN;
  const simulatedAtMs = validTimestamp(simulatedCandidate)
    ? simulatedCandidate
    : validTimestamp(parsedSimulatedDate)
      ? parsedSimulatedDate
      : validTimestamp(capturedCandidate)
        ? capturedCandidate
        : 0;
  const capturedAtMs = validTimestamp(capturedCandidate)
    ? capturedCandidate
    : simulatedAtMs;
  if (!validTimestamp(simulatedCandidate)) warnings.push("simulatedAtMs:derived");
  if (!validTimestamp(capturedCandidate)) warnings.push("capturedAtMs:derived");
  const runId = typeof raw.runId === "string" && raw.runId.trim()
    ? raw.runId
    : `legacy-${id}`;
  if (runId.startsWith("legacy-") && raw.runId !== runId) warnings.push("runId");
  if (raw.schemaVersion !== 1) warnings.push("schemaVersion");
  const activeBurstIds = optionalNonNegativeIntegerArray("activeBurstIds");
  const startedBurstIds = optionalNonNegativeIntegerArray("startedBurstIds");

  return Object.freeze({
    schemaVersion: 1,
    runId,
    bin,
    elapsed: nonNegative("elapsed", bin * 0.2),
    capturedAtMs,
    simulatedAtMs,
    simulatedDate: new Date(simulatedAtMs).toISOString(),
    observed,
    background,
    source,
    sun: nonNegative("sun", 0),
    moon: nonNegative("moon", 0),
    earthAlbedo: nonNegative("earthAlbedo", 0),
    activeBursts: Math.max(0, Math.trunc(nonNegative("activeBursts", 0))),
    ...(activeBurstIds !== undefined ? { activeBurstIds } : {}),
    ...(startedBurstIds !== undefined ? { startedBurstIds } : {}),
    hitPixels: Math.max(0, Math.trunc(nonNegative("hitPixels", 0))),
    id,
    ...(warnings.length > 0
      ? { normalizationWarnings: Object.freeze([...new Set(warnings)]) }
      : {}),
  });
}

export function deriveBurstStartsByRecord(
  chronologicalRecords: readonly PhotonRecord[],
): ReadonlyMap<number, readonly string[]> {
  const startsByRecord = new Map<number, readonly string[]>();
  const previousActiveCountByRun = new Map<string, number>();

  for (const record of chronologicalRecords) {
    if (record.startedBurstIds !== undefined) {
      startsByRecord.set(
        record.id,
        Object.freeze(record.startedBurstIds.map((id) => `burst-${id}`)),
      );
    } else {
      const previousCount = previousActiveCountByRun.get(record.runId);
      const inferredCount = previousCount === undefined
        ? 0
        : Math.max(0, record.activeBursts - previousCount);
      startsByRecord.set(
        record.id,
        Object.freeze(
          Array.from(
            { length: inferredCount },
            (_, index) => `legacy-${record.runId}-${record.id}-${index + 1}`,
          ),
        ),
      );
    }
    previousActiveCountByRun.set(record.runId, record.activeBursts);
  }

  return startsByRecord;
}

export class PhotonRepository {
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

  append(input: PhotonRecordInput): Promise<PhotonRecord> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(PHOTON_STORE_NAME, "readwrite");
      const request = transaction.objectStore(PHOTON_STORE_NAME).add(input);
      let id: number | undefined;
      request.onsuccess = () => {
        id = Number(request.result);
      };
      request.onerror = () => reject(requestFailure(request, "Photon record write failed."));
      transaction.oncomplete = () => {
        if (id === undefined) reject(new Error("Photon record write returned no id."));
        else resolve(Object.freeze({ ...input, id }));
      };
      transaction.onerror = () => reject(transactionFailure(transaction));
      transaction.onabort = () => reject(transactionFailure(transaction));
    });
  }

  count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(PHOTON_STORE_NAME, "readonly");
      const request = transaction.objectStore(PHOTON_STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(requestFailure(request, "Photon record count failed."));
      transaction.onerror = () => reject(transactionFailure(transaction));
      transaction.onabort = () => reject(transactionFailure(transaction));
    });
  }

  query(query: PhotonQuery = {}): Promise<PhotonQueryResult> {
    const limit = Math.max(1, Math.trunc(query.limit ?? 100));
    const fromMs = query.fromMs ?? Number.MIN_SAFE_INTEGER;
    const toMs = query.toMs ?? Number.MAX_SAFE_INTEGER;
    if (fromMs > toMs) {
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    }

    const lower: [number, number] = [fromMs, Number.MIN_SAFE_INTEGER];
    let upper: [number, number] = [toMs, Number.MAX_SAFE_INTEGER];
    let upperOpen = false;
    if (query.cursor) {
      const cursorKey: [number, number] = [
        query.cursor.simulatedAtMs,
        query.cursor.id,
      ];
      if (
        cursorKey[0] < upper[0] ||
        (cursorKey[0] === upper[0] && cursorKey[1] < upper[1])
      ) {
        upper = cursorKey;
        upperOpen = true;
      }
    }
    if (
      upper[0] < lower[0] ||
      (upper[0] === lower[0] && upper[1] <= lower[1] && upperOpen)
    ) {
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    }

    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(PHOTON_STORE_NAME, "readonly");
      const index = transaction.objectStore(PHOTON_STORE_NAME).index("bySimulatedAt");
      const range = this.keyRange.bound(lower, upper, false, upperOpen);
      const request = index.openCursor(range, "prev");
      const items: PhotonRecord[] = [];
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
            nextCursor: { simulatedAtMs: last.simulatedAtMs, id: last.id },
            hasMore: true,
          });
          return;
        }
        items.push(
          normalizeStoredPhotonRecord(
            cursor.value,
            Number(cursor.primaryKey),
          ),
        );
        cursor.continue();
      };
      request.onerror = () => {
        if (!settled) reject(requestFailure(request, "Photon history query failed."));
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

export function openPhotonRepository(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<PhotonRepository> {
  if (!factory) {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = factory.open(PHOTON_DATABASE_NAME, PHOTON_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(PHOTON_STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
      store.createIndex("bySimulatedAt", ["simulatedAtMs", "id"]);
      store.createIndex("byRunBin", ["runId", "bin"], { unique: true });
    };
    request.onsuccess = () => resolve(new PhotonRepository(request.result));
    request.onerror = () => reject(requestFailure(request, "IndexedDB could not be opened."));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab."));
  });
}

export function createPhotonRunId(nowMs = Date.now()): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `run-${nowMs}-${Math.random().toString(36).slice(2)}`;
}
