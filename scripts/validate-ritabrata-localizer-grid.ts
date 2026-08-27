import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { APPROVED_LOCALIZER_MANIFEST_SHA256 } from "../app/lib/ritabrata-localizer-assets.ts";

const directory = resolve(process.argv[2] ?? "public/data/ritabrata-localizer-2deg");
const manifestBytes = readFileSync(resolve(directory, "ritabrata-localizer.manifest.json"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const approved = APPROVED_LOCALIZER_MANIFEST_SHA256[
  manifest.assetVersion as keyof typeof APPROVED_LOCALIZER_MANIFEST_SHA256
];
assert.ok(approved);
assert.equal(digest(manifestBytes), approved);
assert.equal(manifest.pixelCount, 126);
assert.equal(manifest.energyBinCount, 100);
assert.equal(manifest.templates.length, manifest.templateCount);

const descriptors = manifest.templateResponse.shards ?? [manifest.templateResponse];
let uncompressedBytes = 0;
let templateCount = 0;
for (const descriptor of descriptors) {
  const compressed = readFileSync(resolve(directory, descriptor.file));
  assert.equal(digest(compressed), descriptor.sha256);
  const raw = gunzipSync(compressed);
  assert.equal(raw.byteLength, descriptor.uncompressedByteLength);
  const values = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  for (let index = 0; index < values.length; index += 1) {
    assert.ok(Number.isFinite(values[index]) && values[index] >= 0);
  }
  uncompressedBytes += raw.byteLength;
  templateCount += descriptor.templateCount ?? manifest.templateCount;
}
assert.equal(uncompressedBytes, manifest.templateResponse.uncompressedByteLength);
assert.equal(templateCount, manifest.templateCount);

if (manifest.templateProjectionFlow) {
  const descriptor = manifest.templateProjectionFlow;
  const compressed = readFileSync(resolve(directory, descriptor.file));
  assert.equal(digest(compressed), descriptor.sha256);
  const raw = gunzipSync(compressed);
  assert.equal(raw.byteLength, descriptor.uncompressedByteLength);
  const values = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  assert.equal(values.filter((value) => value !== 0).length, descriptor.nonzeroCellCount);
  for (let index = 0; index < values.length; index += 1) {
    assert.ok(Number.isFinite(values[index]) && values[index] >= 0);
  }
}

console.log(JSON.stringify({
  status: "PASS",
  assetVersion: manifest.assetVersion,
  manifestSha256: approved,
  templateCount: manifest.templateCount,
  responseUncompressedBytes: uncompressedBytes,
  projectionFlowNonzeroCellCount: manifest.templateProjectionFlow?.nonzeroCellCount ?? 0,
}, null, 2));
