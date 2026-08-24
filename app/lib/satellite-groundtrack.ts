import {
  interpolateSatelliteVector,
  type EciVectorKm,
} from "./eci-ephemeris.ts";

export const MELISSA_GROUNDTRACK_RECORD_COUNT = 718;
export const MELISSA_GROUNDTRACK_START_MS = Date.UTC(2031, 0, 1, 0, 0, 0);
export const MELISSA_GROUNDTRACK_LAST_SAMPLE_MS = Date.UTC(
  2031,
  0,
  1,
  1,
  35,
  36,
);
export const MELISSA_GROUNDTRACK_SAMPLE_INTERVAL_SECONDS = 8;
export const MELISSA_GROUNDTRACK_DECLARED_PERIOD_SECONDS = 95.65 * 60;
export const MELISSA_GROUNDTRACK_SHA256 =
  "a35d9d4e62f7715a211fb904ceb65d94b552fd27de11bdc3ee1e0f4eb6ff027e";

export type SatelliteGroundTrackRecord = Readonly<{
  timestampMs: number;
  eciKm: EciVectorKm;
  ecefKm: EciVectorKm;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}>;

export type SatelliteGroundTrackProfile = Readonly<{
  records: readonly SatelliteGroundTrackRecord[];
  startMs: number;
  lastSampleMs: number;
  declaredPeriodSeconds: number;
  sampleIntervalSeconds: number;
  sha256: string;
}>;

export type SatelliteGroundTrackSample = SatelliteGroundTrackRecord &
  Readonly<{
    lowerRecordIndex: number;
    upperRecordIndex: number;
    interpolationFraction: number;
  }>;

export type SatelliteGroundTrackContinuity = Readonly<{
  sampledDurationSeconds: number;
  declaredPeriodSeconds: number;
  unsampledTailSeconds: number;
  closureAngleDeg: number;
}>;

const DATA_HEADER =
  "UTC_datetime              X_ECI_km      Y_ECI_km      Z_ECI_km     X_ECEF_km     Y_ECEF_km     Z_ECEF_km     lat_deg     lon_deg      alt_km";
const UTC_2031 = /^2031-01-01T(\d{2}):(\d{2}):(\d{2})$/;
const STRICT_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function parseTimestamp(value: string, lineNumber: number): number {
  const match = UTC_2031.exec(value);
  if (!match) {
    throw new Error(`Invalid or out-of-scenario UTC at ground-track line ${lineNumber}.`);
  }
  const [, hour, minute, second] = match;
  const timestampMs = Date.UTC(2031, 0, 1, Number(hour), Number(minute), Number(second));
  if (new Date(timestampMs).toISOString().slice(0, 19) !== value) {
    throw new Error(`Invalid calendar date at ground-track line ${lineNumber}.`);
  }
  return timestampMs;
}

function parseFiniteNumber(value: string, lineNumber: number): number {
  if (!STRICT_DECIMAL.test(value)) {
    throw new Error(`Invalid numeric field at ground-track line ${lineNumber}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Non-finite numeric field at ground-track line ${lineNumber}.`);
  }
  return parsed;
}

function frozenVector(values: readonly number[], offset: number): EciVectorKm {
  const vector = values.slice(offset, offset + 3) as [number, number, number];
  if (Math.hypot(...vector) === 0) {
    throw new Error("Ground-track position vectors must be non-zero.");
  }
  return Object.freeze(vector);
}

export function parseSatelliteGroundTrack(
  text: string,
): readonly SatelliteGroundTrackRecord[] {
  if (!text.endsWith("\n") || text.includes("\r")) {
    throw new Error("Ground-track source must use LF endings and end with LF.");
  }
  const lines = text.slice(0, -1).split("\n");
  const headerIndex = lines.indexOf(DATA_HEADER);
  if (headerIndex < 0) {
    throw new Error("Ground-track header does not match the supplied schema.");
  }
  const dataLines = lines.slice(headerIndex + 1);
  if (dataLines.length !== MELISSA_GROUNDTRACK_RECORD_COUNT) {
    throw new Error(
      `Ground-track source must contain ${MELISSA_GROUNDTRACK_RECORD_COUNT} records.`,
    );
  }

  let previousTimestampMs = -Infinity;
  const records = dataLines.map((line, index) => {
    const lineNumber = headerIndex + index + 2;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 10) {
      throw new Error(`Invalid field count at ground-track line ${lineNumber}.`);
    }
    const timestampMs = parseTimestamp(fields[0], lineNumber);
    if (
      previousTimestampMs !== -Infinity &&
      timestampMs - previousTimestampMs !==
        MELISSA_GROUNDTRACK_SAMPLE_INTERVAL_SECONDS * 1000
    ) {
      throw new Error(`Ground-track cadence is not exactly 8 s at line ${lineNumber}.`);
    }
    previousTimestampMs = timestampMs;
    const values = fields.slice(1).map((field) => parseFiniteNumber(field, lineNumber));
    const latitudeDeg = values[6];
    const longitudeDeg = values[7];
    const altitudeKm = values[8];
    if (latitudeDeg < -90 || latitudeDeg > 90) {
      throw new Error(`Ground-track latitude is outside [-90, 90] at line ${lineNumber}.`);
    }
    if (longitudeDeg < -180 || longitudeDeg > 180) {
      throw new Error(`Ground-track longitude is outside [-180, 180] at line ${lineNumber}.`);
    }
    return Object.freeze({
      timestampMs,
      eciKm: frozenVector(values, 0),
      ecefKm: frozenVector(values, 3),
      latitudeDeg,
      longitudeDeg,
      altitudeKm,
    });
  });

  if (
    records[0].timestampMs !== MELISSA_GROUNDTRACK_START_MS ||
    records.at(-1)?.timestampMs !== MELISSA_GROUNDTRACK_LAST_SAMPLE_MS
  ) {
    throw new Error("Ground-track source does not span the supplied sample interval.");
  }
  return Object.freeze(records);
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 support is required for ground-track validation.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadSatelliteGroundTrackProfile(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<SatelliteGroundTrackProfile> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Ground-track request failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  const sha256 = await sha256Hex(text);
  if (sha256 !== MELISSA_GROUNDTRACK_SHA256) {
    throw new Error("Ground-track SHA-256 mismatch.");
  }
  const records = parseSatelliteGroundTrack(text);
  return Object.freeze({
    records,
    startMs: records[0].timestampMs,
    lastSampleMs: records[records.length - 1].timestampMs,
    declaredPeriodSeconds: MELISSA_GROUNDTRACK_DECLARED_PERIOD_SECONDS,
    sampleIntervalSeconds: MELISSA_GROUNDTRACK_SAMPLE_INTERVAL_SECONDS,
    sha256,
  });
}

function shortestLongitudeInterpolation(
  startDeg: number,
  endDeg: number,
  fraction: number,
): number {
  const delta = ((endDeg - startDeg + 540) % 360) - 180;
  const interpolated = startDeg + delta * fraction;
  return ((interpolated + 540) % 360) - 180;
}

export function sampleSatelliteGroundTrack(
  profile: SatelliteGroundTrackProfile,
  timestampMs: number,
): SatelliteGroundTrackSample {
  if (
    !Number.isFinite(timestampMs) ||
    timestampMs < profile.startMs ||
    timestampMs > profile.lastSampleMs
  ) {
    const requestedUtc = Number.isFinite(timestampMs)
      ? new Date(timestampMs).toISOString()
      : String(timestampMs);
    throw new RangeError(
      `Ground-track source has no measured sample for ${requestedUtc}.`,
    );
  }

  let low = 0;
  let high = profile.records.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const record = profile.records[middle];
    if (record.timestampMs === timestampMs) {
      return Object.freeze({
        ...record,
        lowerRecordIndex: middle,
        upperRecordIndex: middle,
        interpolationFraction: 0,
      });
    }
    if (record.timestampMs < timestampMs) low = middle + 1;
    else high = middle - 1;
  }

  const lowerRecordIndex = high;
  const upperRecordIndex = low;
  const lower = profile.records[lowerRecordIndex];
  const upper = profile.records[upperRecordIndex];
  const interpolationFraction =
    (timestampMs - lower.timestampMs) / (upper.timestampMs - lower.timestampMs);
  return Object.freeze({
    timestampMs,
    eciKm: interpolateSatelliteVector(lower.eciKm, upper.eciKm, interpolationFraction),
    ecefKm: interpolateSatelliteVector(lower.ecefKm, upper.ecefKm, interpolationFraction),
    latitudeDeg:
      lower.latitudeDeg + (upper.latitudeDeg - lower.latitudeDeg) * interpolationFraction,
    longitudeDeg: shortestLongitudeInterpolation(
      lower.longitudeDeg,
      upper.longitudeDeg,
      interpolationFraction,
    ),
    altitudeKm:
      lower.altitudeKm + (upper.altitudeKm - lower.altitudeKm) * interpolationFraction,
    lowerRecordIndex,
    upperRecordIndex,
    interpolationFraction,
  });
}

function centralAngleRadians(start: EciVectorKm, end: EciVectorKm): number {
  const denominator = Math.hypot(...start) * Math.hypot(...end);
  const cosine = start.reduce(
    (sum, value, index) => sum + value * end[index],
    0,
  ) / denominator;
  return Math.acos(Math.max(-1, Math.min(1, cosine)));
}

export function summarizeSatelliteGroundTrackContinuity(
  profile: SatelliteGroundTrackProfile,
): SatelliteGroundTrackContinuity {
  const sampledDurationSeconds =
    (profile.lastSampleMs - profile.startMs) / 1000;
  const closureAngleRadians = centralAngleRadians(
    profile.records.at(-1)!.eciKm,
    profile.records[0].eciKm,
  );
  return Object.freeze({
    sampledDurationSeconds,
    declaredPeriodSeconds: profile.declaredPeriodSeconds,
    unsampledTailSeconds: profile.declaredPeriodSeconds - sampledDurationSeconds,
    closureAngleDeg: (closureAngleRadians * 180) / Math.PI,
  });
}
