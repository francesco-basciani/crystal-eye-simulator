import assert from "node:assert/strict";
import test from "node:test";
import {
  PAYLOAD_PLACEMENT_STORAGE_KEY_V1,
  parseStoredPayloadPlacement,
  serializePayloadPlacement,
} from "../app/lib/payload-placement.ts";

test("payload placement is versioned, persistent, and round-trips", () => {
  assert.equal(PAYLOAD_PLACEMENT_STORAGE_KEY_V1, "crystal-eye.payload-placement.v1");
  assert.deepEqual(
    parseStoredPayloadPlacement(serializePayloadPlacement({ mountX: 0.5, mountZ: -0.25 })),
    { mountX: 0.5, mountZ: -0.25 },
  );
});

test("payload placement fails closed on malformed values", () => {
  assert.equal(parseStoredPayloadPlacement(null), null);
  assert.equal(parseStoredPayloadPlacement("not-json"), null);
  assert.equal(parseStoredPayloadPlacement(JSON.stringify({ schemaVersion: 2, mountX: 0, mountZ: 0 })), null);
  assert.equal(parseStoredPayloadPlacement(JSON.stringify({ schemaVersion: 1, mountX: 1.1, mountZ: 0 })), null);
  assert.throws(() => serializePayloadPlacement({ mountX: 0, mountZ: Number.NaN }), /within/);
});
