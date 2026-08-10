export const PAYLOAD_PLACEMENT_STORAGE_KEY_V1 =
  "crystal-eye.payload-placement.v1";

export type PayloadPlacement = Readonly<{
  mountX: number;
  mountZ: number;
}>;

export function parseStoredPayloadPlacement(
  serialized: string | null,
): PayloadPlacement | null {
  if (!serialized) return null;
  try {
    const candidate = JSON.parse(serialized) as Record<string, unknown>;
    if (
      candidate.schemaVersion !== 1 ||
      typeof candidate.mountX !== "number" ||
      !Number.isFinite(candidate.mountX) ||
      candidate.mountX < -1 ||
      candidate.mountX > 1 ||
      typeof candidate.mountZ !== "number" ||
      !Number.isFinite(candidate.mountZ) ||
      candidate.mountZ < -1 ||
      candidate.mountZ > 1
    ) {
      return null;
    }
    return Object.freeze({ mountX: candidate.mountX, mountZ: candidate.mountZ });
  } catch {
    return null;
  }
}

export function serializePayloadPlacement({
  mountX,
  mountZ,
}: PayloadPlacement): string {
  if (
    !Number.isFinite(mountX) ||
    mountX < -1 ||
    mountX > 1 ||
    !Number.isFinite(mountZ) ||
    mountZ < -1 ||
    mountZ > 1
  ) {
    throw new RangeError("Payload placement coordinates must be within [-1, 1].");
  }
  return JSON.stringify({ schemaVersion: 1, mountX, mountZ });
}
