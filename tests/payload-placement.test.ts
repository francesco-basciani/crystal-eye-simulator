import assert from "node:assert/strict";
import test from "node:test";
import {
  PAYLOAD_PLACEMENT_STORAGE_KEY_V1,
  parseStoredPayloadPlacement,
  serializePayloadPlacement,
} from "../app/lib/payload-placement.ts";

test("payload placement storage is versioned and round-trips valid coordinates", () => {
  assert.equal(
    PAYLOAD_PLACEMENT_STORAGE_KEY_V1,
    "crystal-eye.payload-placement.v1",
  );
  const serialized = serializePayloadPlacement({ mountX: 0.5, mountZ: -0.25 });
  assert.deepEqual(parseStoredPayloadPlacement(serialized), {
    mountX: 0.5,
    mountZ: -0.25,
  });
});

test("payload placement persistence fails closed on malformed or unsupported values", () => {
  assert.equal(parseStoredPayloadPlacement(null), null);
  assert.equal(parseStoredPayloadPlacement("not-json"), null);
  assert.equal(
    parseStoredPayloadPlacement(
      JSON.stringify({ schemaVersion: 2, mountX: 0, mountZ: 0 }),
    ),
    null,
  );
  assert.equal(
    parseStoredPayloadPlacement(
      JSON.stringify({ schemaVersion: 1, mountX: 1.1, mountZ: 0 }),
    ),
    null,
  );
  assert.throws(
    () => serializePayloadPlacement({ mountX: 0, mountZ: Number.NaN }),
    /within \[-1, 1\]/,
  );
});
