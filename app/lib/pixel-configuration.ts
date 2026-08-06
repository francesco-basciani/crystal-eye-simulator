import manualPixelConfiguration from "../data/crystal-eye-pixel-configuration.v1.json" with {
  type: "json",
};

export const PIXEL_COUNT = 126;
export const PIXEL_CONFIGURATION_STORAGE_KEY_V1 =
  "crystal-eye.pixel-configuration.v1";
export const PIXEL_CONFIGURATION_STORAGE_KEY_V2 =
  "crystal-eye.pixel-configuration.v2";

export type PixelConfigurationEntry = {
  /** Canonical physical identity and pixbkg pixel_id. */
  pixelId: number;
  /** Non-identity annotation retained for backward compatibility. */
  legacyAnnotation: string;
  x: number;
  y: number;
  isSeam: boolean;
  isPentagon: boolean;
  rotationDeg: number;
};

export type PixelConfiguration = {
  version: 2;
  pixels: PixelConfigurationEntry[];
};

type LegacyPixel = {
  index?: unknown;
  id?: unknown;
  secondaryId?: unknown;
  x?: unknown;
  y?: unknown;
  isSeam?: unknown;
  isPentagon?: unknown;
  rotationDeg?: unknown;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function normalizeRotation(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? ((value % 360) + 360) % 360
    : 0;
}

function parseLegacyPixelId(id: unknown): number | null {
  if (typeof id !== "string") return null;
  const match = id.trim().match(/^PX[-_\s]*(\d+)$/i);
  if (!match) return null;
  const pixelId = Number(match[1]) - 1;
  return Number.isInteger(pixelId) && pixelId >= 0 && pixelId < PIXEL_COUNT
    ? pixelId
    : null;
}

export function hasCanonicalPixelIdBijection(
  pixels: readonly Pick<PixelConfigurationEntry, "pixelId">[],
): boolean {
  if (pixels.length !== PIXEL_COUNT) return false;
  const ids = pixels.map(({ pixelId }) => pixelId);
  return (
    ids.every(
      (pixelId) =>
        Number.isInteger(pixelId) && pixelId >= 0 && pixelId < PIXEL_COUNT,
    ) &&
    new Set(ids).size === PIXEL_COUNT
  );
}

function normalizeEntries(
  candidate: { version?: unknown; pixels?: unknown },
  seamBaseline?: readonly boolean[],
): PixelConfiguration | null {
  if (
    (candidate.version !== 1 && candidate.version !== 2) ||
    !Array.isArray(candidate.pixels) ||
    candidate.pixels.length !== PIXEL_COUNT
  ) {
    return null;
  }

  const legacyIds = candidate.pixels.map((entry) =>
    entry && typeof entry === "object"
      ? parseLegacyPixelId((entry as LegacyPixel).id)
      : null,
  );
  const hasLegacyIdBijection =
    candidate.version === 1 &&
    legacyIds.every((pixelId): pixelId is number => pixelId !== null) &&
    new Set(legacyIds).size === PIXEL_COUNT;

  const pixels = candidate.pixels.map((entry, geometrySlot) => {
    if (!entry || typeof entry !== "object") return null;
    const pixel = entry as LegacyPixel & { pixelId?: unknown };
    const legacyIndex =
      typeof pixel.index === "number" && Number.isInteger(pixel.index)
        ? pixel.index
        : geometrySlot;
    if (candidate.version === 1 && legacyIndex !== geometrySlot) return null;
    if (
      typeof pixel.x !== "number" ||
      !Number.isFinite(pixel.x) ||
      typeof pixel.y !== "number" ||
      !Number.isFinite(pixel.y)
    ) {
      return null;
    }

    const pixelId =
      candidate.version === 2
        ? pixel.pixelId
        : hasLegacyIdBijection
          ? legacyIds[geometrySlot]
          : geometrySlot;
    if (
      typeof pixelId !== "number" ||
      !Number.isInteger(pixelId) ||
      pixelId < 0 ||
      pixelId >= PIXEL_COUNT
    ) {
      return null;
    }

    const isSeam = seamBaseline?.[geometrySlot] ?? pixel.isSeam === true;
    if (
      seamBaseline &&
      typeof pixel.isSeam === "boolean" &&
      pixel.isSeam !== isSeam
    ) {
      return null;
    }

    return {
      pixelId,
      legacyAnnotation:
        typeof (pixel as LegacyPixel & { legacyAnnotation?: unknown }).legacyAnnotation === "string"
          ? String((pixel as LegacyPixel & { legacyAnnotation?: unknown }).legacyAnnotation)
              .trim()
              .slice(0, 12)
          : typeof pixel.secondaryId === "string"
            ? pixel.secondaryId.trim().slice(0, 12)
          : "",
      x: clamp(pixel.x, 0.8, 99.2),
      y: clamp(pixel.y, 0.8, 99.2),
      isSeam,
      isPentagon: pixel.isPentagon === true,
      rotationDeg: normalizeRotation(pixel.rotationDeg),
    } satisfies PixelConfigurationEntry;
  });

  if (
    pixels.some((pixel) => pixel === null) ||
    !hasCanonicalPixelIdBijection(
      pixels.filter((pixel): pixel is PixelConfigurationEntry => pixel !== null),
    )
  ) {
    return null;
  }

  const normalizedPixels = pixels as PixelConfigurationEntry[];
  for (let cluster = 0; cluster < 6; cluster += 1) {
    const members = normalizedPixels.slice(cluster * 16, (cluster + 1) * 16);
    if (members.filter((pixel) => pixel.isPentagon).length !== 1) return null;
  }
  if (normalizedPixels.slice(96).some((pixel) => pixel.isPentagon)) return null;

  return { version: 2, pixels: normalizedPixels };
}

const baseline = normalizeEntries(
  manualPixelConfiguration as { version?: unknown; pixels?: unknown },
);
if (!baseline) {
  throw new Error("Bundled manual pixel configuration is invalid.");
}

export const DEFAULT_PIXEL_CONFIGURATION: PixelConfiguration = baseline;

export function normalizePixelConfiguration(
  value: unknown,
): PixelConfiguration | null {
  if (!value || typeof value !== "object") return null;
  return normalizeEntries(value as { version?: unknown; pixels?: unknown },
    DEFAULT_PIXEL_CONFIGURATION.pixels.map((pixel) => pixel.isSeam));
}

export function getPixelByPhysicalId(
  configuration: PixelConfiguration,
  pixelId: number,
): PixelConfigurationEntry | undefined {
  return configuration.pixels.find((pixel) => pixel.pixelId === pixelId);
}

export function getGeometrySlotByPhysicalId(
  configuration: PixelConfiguration,
  pixelId: number,
): number {
  return configuration.pixels.findIndex((pixel) => pixel.pixelId === pixelId);
}

export function swapPhysicalPixelIds(
  configuration: PixelConfiguration,
  geometrySlot: number,
  requestedPixelId: number,
): PixelConfiguration {
  if (
    !Number.isInteger(geometrySlot) ||
    geometrySlot < 0 ||
    geometrySlot >= PIXEL_COUNT ||
    !Number.isInteger(requestedPixelId) ||
    requestedPixelId < 0 ||
    requestedPixelId >= PIXEL_COUNT
  ) {
    return configuration;
  }
  const currentPixelId = configuration.pixels[geometrySlot].pixelId;
  if (currentPixelId === requestedPixelId) return configuration;
  return {
    version: 2,
    pixels: configuration.pixels.map((pixel, slot) => {
      if (slot === geometrySlot) return { ...pixel, pixelId: requestedPixelId };
      if (pixel.pixelId === requestedPixelId) {
        return { ...pixel, pixelId: currentPixelId };
      }
      return pixel;
    }),
  };
}
