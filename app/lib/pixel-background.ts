export const PIXEL_BACKGROUND_PIXEL_COUNT = 126;
export const PIXEL_BACKGROUND_BIN_SECONDS = 0.2;
export const PIXEL_BACKGROUND_SHA256 =
  "88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d";

export type PixelBackgroundRecord = Readonly<{
  pixelId: number;
  thetaDeg: number;
  phiDeg: number;
  backgroundRateCountsPerSecond: number;
}>;

export type PixelBackgroundProfile = Readonly<{
  records: readonly PixelBackgroundRecord[];
  ratesCountsPerSecond: readonly number[];
  expectedCountsPerBin: readonly number[];
  totalRateCountsPerSecond: number;
  totalExpectedCountsPerBin: number;
  minimumRateCountsPerSecond: number;
  maximumRateCountsPerSecond: number;
  binSeconds: number;
  sha256: string;
  status: "PROVISIONAL";
}>;

export function rateToExpectedCountsPerBin(rateCountsPerSecond: number): number {
  return rateCountsPerSecond * PIXEL_BACKGROUND_BIN_SECONDS;
}

const STRICT_INTEGER = /^(?:0|[1-9]\d*)$/;
const STRICT_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function parsePixelBackgroundTsv(text: string): readonly PixelBackgroundRecord[] {
  if (!text.endsWith("\n") || text.includes("\r")) {
    throw new Error("Pixel background TSV must use LF endings and end with LF.");
  }

  const lines = text.slice(0, -1).split("\n");
  if (lines.length !== PIXEL_BACKGROUND_PIXEL_COUNT) {
    throw new Error(
      `Pixel background TSV must contain ${PIXEL_BACKGROUND_PIXEL_COUNT} records.`,
    );
  }

  return Object.freeze(
    lines.map((line, expectedPixelId) => {
      const fields = line.split("\t");
      if (fields.length !== 4) {
        throw new Error(`Invalid field count at pixel background line ${expectedPixelId + 1}.`);
      }
      const [pixelIdText, thetaText, phiText, rateText] = fields;
      if (
        !STRICT_INTEGER.test(pixelIdText) ||
        !STRICT_DECIMAL.test(thetaText) ||
        !STRICT_DECIMAL.test(phiText) ||
        !STRICT_DECIMAL.test(rateText)
      ) {
        throw new Error(`Invalid numeric field at pixel background line ${expectedPixelId + 1}.`);
      }

      const pixelId = Number(pixelIdText);
      const thetaDeg = Number(thetaText);
      const phiDeg = Number(phiText);
      const backgroundRateCountsPerSecond = Number(rateText);
      if (
        pixelId !== expectedPixelId ||
        !Number.isFinite(thetaDeg) ||
        thetaDeg < 0 ||
        thetaDeg > 180 ||
        !Number.isFinite(phiDeg) ||
        phiDeg < -180 ||
        phiDeg > 180 ||
        !Number.isFinite(backgroundRateCountsPerSecond) ||
        backgroundRateCountsPerSecond < 0
      ) {
        throw new Error(`Invalid pixel background record at line ${expectedPixelId + 1}.`);
      }

      return Object.freeze({
        pixelId,
        thetaDeg,
        phiDeg,
        backgroundRateCountsPerSecond,
      });
    }),
  );
}

export async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 support is required for pixel background validation.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadPixelBackgroundProfile(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<PixelBackgroundProfile> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Pixel background request failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  const sha256 = await sha256Hex(text);
  if (sha256 !== PIXEL_BACKGROUND_SHA256) {
    throw new Error("Pixel background SHA-256 mismatch.");
  }

  const records = parsePixelBackgroundTsv(text);
  const ratesCountsPerSecond = Object.freeze(
    records.map((record) => record.backgroundRateCountsPerSecond),
  );
  const expectedCountsPerBin = Object.freeze(
    ratesCountsPerSecond.map(rateToExpectedCountsPerBin),
  );
  const totalRateCountsPerSecond = ratesCountsPerSecond.reduce(
    (sum, rate) => sum + rate,
    0,
  );

  return Object.freeze({
    records,
    ratesCountsPerSecond,
    expectedCountsPerBin,
    totalRateCountsPerSecond,
    totalExpectedCountsPerBin:
      rateToExpectedCountsPerBin(totalRateCountsPerSecond),
    minimumRateCountsPerSecond: Math.min(...ratesCountsPerSecond),
    maximumRateCountsPerSecond: Math.max(...ratesCountsPerSecond),
    binSeconds: PIXEL_BACKGROUND_BIN_SECONDS,
    sha256,
    status: "PROVISIONAL",
  });
}

export function composeBackgroundRate(
  profile: PixelBackgroundProfile,
  sunRateCountsPerSecond: number,
  moonRateCountsPerSecond: number,
  earthRateCountsPerSecond: number,
): number {
  return (
    profile.totalRateCountsPerSecond +
    sunRateCountsPerSecond +
    moonRateCountsPerSecond +
    earthRateCountsPerSecond
  );
}
