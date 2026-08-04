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
  hitPixels: number;
}>;

export type PhotonRecord = PhotonRecordInput & Readonly<{ id: number }>;

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
        items.push(Object.freeze(cursor.value as PhotonRecord));
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
