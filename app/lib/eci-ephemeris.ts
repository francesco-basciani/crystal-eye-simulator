export const ECI_EPHEMERIS_RECORD_COUNT = 9_304;
export const ECI_EPHEMERIS_START_MS = Date.UTC(2033, 0, 1, 0, 0, 0);
export const ECI_EPHEMERIS_END_MS = Date.UTC(2033, 2, 1, 23, 50, 39);
export const ECI_EPHEMERIS_SHA256 =
  "95d42bdbf86e0452e50b2096a2d14c101a92a700b54af16475e1abd41b24e7e6";

export type EciVectorKm = readonly [number, number, number];

export type EciEphemerisRecord = Readonly<{
  timestampMs: number;
  satelliteKm: EciVectorKm;
  sunKm: EciVectorKm;
  moonKm: EciVectorKm;
}>;

export type EciEphemerisProfile = Readonly<{
  records: readonly EciEphemerisRecord[];
  startMs: number;
  endMs: number;
  sha256: string;
}>;

export type EciEphemerisSample = Readonly<{
  timestampMs: number;
  satelliteKm: EciVectorKm;
  sunKm: EciVectorKm;
  moonKm: EciVectorKm;
  lowerRecordIndex: number;
  upperRecordIndex: number;
  interpolationFraction: number;
}>;

export const ECI_EPHEMERIS_INITIAL_SAMPLE: EciEphemerisSample = Object.freeze({
  timestampMs: ECI_EPHEMERIS_START_MS,
  satelliteKm: Object.freeze([0, 6928.1, 0] as const),
  sunKm: Object.freeze([26579123, -132747145, -57541267] as const),
  moonKm: Object.freeze([30725.2, -350949.7, -119280.6] as const),
  lowerRecordIndex: 0,
  upperRecordIndex: 0,
  interpolationFraction: 0,
});

const HEADER =
  "utc\tsat_x_km\tsat_y_km\tsat_z_km\tsun_x_km\tsun_y_km\tsun_z_km\tmoon_x_km\tmoon_y_km\tmoon_z_km";
const UTC_2033 = /^2033-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const STRICT_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const JULIAN_DATE_AT_UNIX_EPOCH = 2_440_587.5;
const JULIAN_DATE_J2000 = 2_451_545;
const DAYS_PER_JULIAN_CENTURY = 36_525;

export class EciEphemerisRangeError extends RangeError {
  constructor(timestampMs: number, startMs: number, endMs: number) {
    super(
      `ECI ephemeris has no sample for ${new Date(timestampMs).toISOString()}; ` +
        `supported interval is ${new Date(startMs).toISOString()} through ` +
        `${new Date(endMs).toISOString()}.`,
    );
    this.name = "EciEphemerisRangeError";
  }
}

function parseUtc2033(value: string, lineNumber: number): number {
  const match = UTC_2033.exec(value);
  if (!match) {
    throw new Error(`Invalid or out-of-scenario UTC at ECI line ${lineNumber}.`);
  }
  const [, month, day, hour, minute, second] = match;
  const timestampMs = Date.UTC(
    2033,
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (
    new Date(timestampMs).toISOString().slice(0, 19).replace("T", " ") !== value
  ) {
    throw new Error(`Invalid calendar date at ECI line ${lineNumber}.`);
  }
  return timestampMs;
}

function parseVector(
  fields: readonly string[],
  offset: number,
  lineNumber: number,
): EciVectorKm {
  const text = fields.slice(offset, offset + 3);
  if (text.length !== 3 || text.some((value) => !STRICT_DECIMAL.test(value))) {
    throw new Error(`Invalid numeric field at ECI line ${lineNumber}.`);
  }
  const vector = text.map(Number) as [number, number, number];
  if (vector.some((value) => !Number.isFinite(value)) || Math.hypot(...vector) === 0) {
    throw new Error(`Invalid ECI vector at line ${lineNumber}.`);
  }
  return Object.freeze(vector);
}

export function parseEciEphemerisTsv(
  text: string,
): readonly EciEphemerisRecord[] {
  if (!text.endsWith("\n") || text.includes("\r")) {
    throw new Error("ECI ephemeris TSV must use LF endings and end with LF.");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines[0] !== HEADER) {
    throw new Error("ECI ephemeris TSV header does not match the approved schema.");
  }
  if (lines.length !== ECI_EPHEMERIS_RECORD_COUNT + 1) {
    throw new Error(
      `ECI ephemeris TSV must contain ${ECI_EPHEMERIS_RECORD_COUNT} records.`,
    );
  }

  let previousTimestampMs = -Infinity;
  const records = lines.slice(1).map((line, index) => {
    const lineNumber = index + 2;
    const fields = line.split("\t");
    if (fields.length !== 10) {
      throw new Error(`Invalid field count at ECI line ${lineNumber}.`);
    }
    const timestampMs = parseUtc2033(fields[0], lineNumber);
    if (timestampMs <= previousTimestampMs) {
      throw new Error(`ECI timestamps are not strictly increasing at line ${lineNumber}.`);
    }
    previousTimestampMs = timestampMs;
    return Object.freeze({
      timestampMs,
      satelliteKm: parseVector(fields, 1, lineNumber),
      sunKm: parseVector(fields, 4, lineNumber),
      moonKm: parseVector(fields, 7, lineNumber),
    });
  });
  if (
    records[0].timestampMs !== ECI_EPHEMERIS_START_MS ||
    records.at(-1)?.timestampMs !== ECI_EPHEMERIS_END_MS
  ) {
    throw new Error("ECI ephemeris TSV does not span the approved interval.");
  }
  return Object.freeze(records);
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 support is required for ECI validation.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadEciEphemerisProfile(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<EciEphemerisProfile> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`ECI ephemeris request failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  const sha256 = await sha256Hex(text);
  if (sha256 !== ECI_EPHEMERIS_SHA256) {
    throw new Error("ECI ephemeris SHA-256 mismatch.");
  }
  const records = parseEciEphemerisTsv(text);
  return Object.freeze({
    records,
    startMs: records[0].timestampMs,
    endMs: records[records.length - 1].timestampMs,
    sha256,
  });
}

/**
 * Greenwich mean sidereal angle using Vallado et al. (2006), Eq. 3-47.
 * The replay has UTC but no DUT1, so UTC is used as the documented UT1 proxy.
 * Source: https://celestrak.org/publications/AIAA/2006-6753/
 */
export function greenwichMeanSiderealTimeRadians(timestampMs: number): number {
  if (!Number.isFinite(timestampMs)) {
    throw new TypeError("GMST timestamp must be finite.");
  }
  const julianDate =
    timestampMs / MILLISECONDS_PER_DAY + JULIAN_DATE_AT_UNIX_EPOCH;
  const daysSinceJ2000 = julianDate - JULIAN_DATE_J2000;
  const centuriesSinceJ2000 = daysSinceJ2000 / DAYS_PER_JULIAN_CENTURY;
  const gmstDegrees =
    280.46061837 +
    360.98564736629 * daysSinceJ2000 +
    0.000387933 * centuriesSinceJ2000 ** 2 -
    centuriesSinceJ2000 ** 3 / 38_710_000;
  const normalizedDegrees = ((gmstDegrees % 360) + 360) % 360;
  return (normalizedDegrees * Math.PI) / 180;
}

export function slerpUnitDirection(
  start: EciVectorKm,
  end: EciVectorKm,
  fraction: number,
): EciVectorKm {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new RangeError("Direction interpolation fraction must be in [0, 1].");
  }
  const startLength = Math.hypot(...start);
  const endLength = Math.hypot(...end);
  if (startLength === 0 || endLength === 0) {
    throw new Error("Direction interpolation requires non-zero vectors.");
  }
  const startUnit = start.map((value) => value / startLength) as [number, number, number];
  const endUnit = end.map((value) => value / endLength) as [number, number, number];
  if (fraction === 0) return Object.freeze(startUnit);
  if (fraction === 1) return Object.freeze(endUnit);
  const dot = Math.max(
    -1,
    Math.min(1, startUnit.reduce((sum, value, index) => sum + value * endUnit[index], 0)),
  );
  if (dot < -1 + 1e-12) {
    throw new Error("Antipodal directions cannot be interpolated unambiguously.");
  }
  if (dot > 1 - 1e-12) return Object.freeze(startUnit);
  const angle = Math.acos(dot);
  const sine = Math.sin(angle);
  return Object.freeze(
    startUnit.map(
      (value, index) =>
        (Math.sin((1 - fraction) * angle) / sine) * value +
        (Math.sin(fraction * angle) / sine) * endUnit[index],
    ) as [number, number, number],
  );
}

function linearVector(
  start: EciVectorKm,
  end: EciVectorKm,
  fraction: number,
): EciVectorKm {
  return Object.freeze([
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
    start[2] + (end[2] - start[2]) * fraction,
  ]);
}

export function interpolateSatelliteVector(
  start: EciVectorKm,
  end: EciVectorKm,
  fraction: number,
): EciVectorKm {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new RangeError("Satellite interpolation fraction must be in [0, 1].");
  }
  if (fraction === 0) return start;
  if (fraction === 1) return end;
  const startRadius = Math.hypot(...start);
  const endRadius = Math.hypot(...end);
  const startUnit = start.map((value) => value / startRadius) as [number, number, number];
  const endUnit = end.map((value) => value / endRadius) as [number, number, number];
  const dot = Math.max(
    -1,
    Math.min(1, startUnit.reduce((sum, value, index) => sum + value * endUnit[index], 0)),
  );
  const angle = Math.acos(dot);
  const sine = Math.sin(angle);
  if (Math.abs(sine) < 1e-12 && dot < 0) {
    throw new Error("Antipodal satellite samples cannot be interpolated unambiguously.");
  }
  const direction =
    angle < 1e-8
      ? linearVector(startUnit, endUnit, fraction)
      : (startUnit.map(
          (value, index) =>
            (Math.sin((1 - fraction) * angle) / sine) * value +
            (Math.sin(fraction * angle) / sine) * endUnit[index],
        ) as [number, number, number]);
  const directionLength = Math.hypot(...direction);
  const radius = startRadius + (endRadius - startRadius) * fraction;
  return Object.freeze(
    direction.map((value) => (value / directionLength) * radius) as [
      number,
      number,
      number,
    ],
  );
}

export function sampleEciEphemeris(
  profile: EciEphemerisProfile,
  timestampMs: number,
): EciEphemerisSample {
  if (!Number.isFinite(timestampMs) || timestampMs < profile.startMs || timestampMs > profile.endMs) {
    throw new EciEphemerisRangeError(timestampMs, profile.startMs, profile.endMs);
  }

  let low = 0;
  let high = profile.records.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const middleTime = profile.records[middle].timestampMs;
    if (middleTime === timestampMs) {
      const record = profile.records[middle];
      return Object.freeze({
        ...record,
        lowerRecordIndex: middle,
        upperRecordIndex: middle,
        interpolationFraction: 0,
      });
    }
    if (middleTime < timestampMs) low = middle + 1;
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
    satelliteKm: interpolateSatelliteVector(
      lower.satelliteKm,
      upper.satelliteKm,
      interpolationFraction,
    ),
    sunKm: linearVector(lower.sunKm, upper.sunKm, interpolationFraction),
    moonKm: linearVector(lower.moonKm, upper.moonKm, interpolationFraction),
    lowerRecordIndex,
    upperRecordIndex,
    interpolationFraction,
  });
}
