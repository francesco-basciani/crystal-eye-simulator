export const PAYLOAD_PLACEMENT_STORAGE_KEY_V1 =
  "crystal-eye.payload-placement.v1";

export type PayloadPlacement = Readonly<{
  mountX: number;
  mountZ: number;
}>;

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
}

export function parseStoredPayloadPlacement(serialized: string | null): PayloadPlacement | null {
  if (!serialized) return null;
  try {
    const candidate = JSON.parse(serialized) as Record<string, unknown>;
    if (
      candidate.schemaVersion !== 1 ||
      !isCoordinate(candidate.mountX) ||
      !isCoordinate(candidate.mountZ)
    ) return null;
    return Object.freeze({ mountX: candidate.mountX, mountZ: candidate.mountZ });
  } catch {
    return null;
  }
}

export function serializePayloadPlacement({ mountX, mountZ }: PayloadPlacement): string {
  if (!isCoordinate(mountX) || !isCoordinate(mountZ)) {
    throw new RangeError("Payload placement coordinates must be within [-1, 1].");
  }
  return JSON.stringify({ schemaVersion: 1, mountX, mountZ });
}
