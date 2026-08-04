import type { EciEphemerisRecord } from "./eci-ephemeris";

export type EphemerisQuery = Readonly<{
  fromMs?: number;
  toMs?: number;
  search?: string;
  offset?: number;
  limit?: number;
}>;

export type EphemerisQueryResult = Readonly<{
  items: readonly EciEphemerisRecord[];
  total: number;
  offset: number;
}>;

function lowerBound(
  records: readonly EciEphemerisRecord[],
  timestampMs: number,
): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (records[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(
  records: readonly EciEphemerisRecord[],
  timestampMs: number,
): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (records[middle].timestampMs <= timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function recordSearchText(record: EciEphemerisRecord): string {
  return [
    new Date(record.timestampMs).toISOString(),
    ...record.satelliteKm,
    ...record.sunKm,
    ...record.moonKm,
  ]
    .join(" ")
    .toLowerCase();
}

export function queryEciEphemeris(
  records: readonly EciEphemerisRecord[],
  query: EphemerisQuery = {},
): EphemerisQueryResult {
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = Math.max(1, Math.trunc(query.limit ?? 100));
  const fromMs = query.fromMs ?? Number.NEGATIVE_INFINITY;
  const toMs = query.toMs ?? Number.POSITIVE_INFINITY;
  if (fromMs > toMs) return { items: [], total: 0, offset: 0 };

  const start = lowerBound(records, fromMs);
  const end = upperBound(records, toMs);
  const search = query.search?.trim().toLowerCase() ?? "";
  const items: EciEphemerisRecord[] = [];
  let total = 0;

  for (let index = start; index < end; index += 1) {
    const record = records[index];
    if (search && !recordSearchText(record).includes(search)) continue;
    if (total >= offset && items.length < limit) items.push(record);
    total += 1;
  }

  return { items, total, offset: Math.min(offset, total) };
}
