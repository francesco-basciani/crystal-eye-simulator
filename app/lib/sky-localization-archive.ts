import { getBurstTruthEvaluation, openBurstEventRepository, type BurstDetectionRecord } from "./burst-event-repository.ts";
import type { SkyLocalizationEvent } from "./sky-localization.ts";

const DATABASE = "crystal-eye-sky-localizations";
const STORE = "localizations";
let writes: Promise<void> = Promise.resolve();

function openArchive(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("IndexedDB is unavailable in this browser.")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "eventKey" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open sky localization archive."));
    request.onblocked = () => reject(new Error("Sky localization archive is blocked by another tab."));
  });
}

/** Serialize pending/completion writes, retaining events across simulator resets. */
export function saveSkyLocalizationEvent(event: SkyLocalizationEvent): Promise<void> {
  const operation = writes.catch(() => undefined).then(async () => {
    const database = await openArchive();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(event);
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Sky localization write failed."));
      });
    } finally { database.close(); }
  });
  writes = operation;
  return operation;
}

/** Legacy archive fallback keeps its own reconstruction method, never invents KS. */
export function skyEventFromDetection(record: BurstDetectionRecord): SkyLocalizationEvent {
  const truth = getBurstTruthEvaluation(record);
  return Object.freeze({
    eventKey: record.eventKey, burstId: record.burstId,
    dataOrigin: "archived-detection", simulatedDate: record.simulatedDate,
    truth: truth.status === "available" ? { raDeg: truth.raDeg, decDeg: truth.decDeg } : null,
    ks: null, ksErrorDeg: null,
    centroid: { raDeg: record.reconstructedRaDeg, decDeg: record.reconstructedDecDeg },
    centroidErrorDeg: truth.status === "available" ? truth.angularErrorDeg : null,
    status: "available",
    reason: "KS pipeline output was not retained for this archived event.",
    gridLabel: "Archived positive-excess centroid · KS unavailable",
    coordinateFrame: "Simulator ECI-like equatorial · simulated UTC",
  });
}

export function mergeSkyLocalizationHistory(
  snapshots: readonly SkyLocalizationEvent[], detections: readonly BurstDetectionRecord[],
): readonly SkyLocalizationEvent[] {
  const merged = new Map(detections.map(record => [record.eventKey, skyEventFromDetection(record)]));
  // The two methods use different inputs. Preserve the complete pipeline snapshot
  // as a unit, even when unavailable; do not splice in a live-detection centroid.
  snapshots.forEach(event => merged.set(event.eventKey, event));
  return [...merged.values()].sort((a, b) => b.simulatedDate.localeCompare(a.simulatedDate) || b.eventKey.localeCompare(a.eventKey));
}

export async function loadSkyLocalizationHistory(): Promise<readonly SkyLocalizationEvent[]> {
  await writes.catch(() => undefined);
  const database = await openArchive();
  let snapshots: SkyLocalizationEvent[];
  try {
    snapshots = await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as SkyLocalizationEvent[]);
      request.onerror = () => reject(request.error ?? new Error("Sky localization read failed."));
    });
  } finally { database.close(); }
  const repository = await openBurstEventRepository();
  const detections: BurstDetectionRecord[] = [];
  try {
    let cursor;
    do {
      const page = await repository.query({ limit: 500, cursor });
      detections.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  } finally { repository.close(); }
  return mergeSkyLocalizationHistory(snapshots, detections);
}
