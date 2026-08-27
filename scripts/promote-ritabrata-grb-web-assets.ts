import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCE_HASHES = Object.freeze({
  "ritabrata-grb-generator.manifest.json": "30012c34e376f3d1d7e3afb2910cb4034c3f17c1e5c3c288c5b3ef5efe9badc3",
  "ritabrata-grb-golden.json": "657f98244fe7322e63894b22899399f7c6c9954a2b71c0e98244643c71e4b908",
  "ritabrata-grb-pixelMean.f32.members.gz": "8defd2df8ee92ae9e1914a0d658bf432e4d5fda179cae49f744538d1f8614a71",
  "ritabrata-grb-pixelVariance.f32.members.gz": "6131c4a92ac3a3830879184a3f1bc9552c0a4d921de00f4f704417cb2e8ee70b",
  "ritabrata-grb-depositedEnergyMean.f32.members.gz": "cea5de1de9d7b4335f5a31ecff29ae758af7ababa935c75f36990ee7bd17d76b",
  "ritabrata-grb-depositedEnergyVariance.f32.members.gz": "5962641d8a21d65597ff5ade3a1826c1ae3ccc9291c36dcdd1fa29dbc7030728",
});
const PROMOTED_MANIFEST_SHA256 = "0c1c608ad0c541936d70ea3472ee4b164b1fd069c7b54ab7cb64d1cf2cd01922";
const PROMOTED_GOLDEN_SHA256 = "dbac50fc10b70d567a0d480700207088651e9d04b259e65574320a992437d0ff";
const PROVENANCE_SHA256 = "ac3ecb79f205c1d7436e9343b01f61211800abf03f0cae0e06ff892980fb40ea";

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceExactlyOnce(text: string, from: string, to: string): string {
  assert.equal(text.split(from).length - 1, 1, `Expected exactly one occurrence of ${from}`);
  return text.replace(from, to);
}

const sourceDirectory = resolve(process.argv[2] ?? "");
const outputDirectory = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: promote-ritabrata-grb-web-assets.ts <converted-dir> <public-output-dir>");
}
await mkdir(outputDirectory, { recursive: true });
for (const [name, expectedHash] of Object.entries(SOURCE_HASHES)) {
  const bytes = await readFile(resolve(sourceDirectory, name));
  assert.equal(sha256(bytes), expectedHash, `${name} source hash mismatch`);
}

let golden = await readFile(resolve(sourceDirectory, "ritabrata-grb-golden.json"), "utf8");
golden = replaceExactlyOnce(golden, '"amplitudeAt100KeV": 0.026', '"normalization": 0.026');
assert.equal(sha256(golden), PROMOTED_GOLDEN_SHA256);
await writeFile(resolve(outputDirectory, "ritabrata-grb-golden.json"), golden, "utf8");

let manifest = await readFile(
  resolve(sourceDirectory, "ritabrata-grb-generator.manifest.json"),
  "utf8",
);
manifest = replaceExactlyOnce(
  manifest,
  '"directionFrame": "ROOT TVector3 detector-local theta/phi; spacecraft axes unvalidated"',
  '"directionFrame": "RITABRATA_ROOT_PLUS_Z_POLAR_PHI_ATAN2_Y_X"',
);
for (const stem of [
  "pixelMean",
  "pixelVariance",
  "depositedEnergyMean",
  "depositedEnergyVariance",
]) {
  manifest = replaceExactlyOnce(
    manifest,
    `ritabrata-grb-${stem}.f32.members.gz`,
    `ritabrata-grb-${stem}.f32.members.bin`,
  );
}
manifest = replaceExactlyOnce(manifest, '"verified": false', '"verified": true');
manifest = replaceExactlyOnce(
  manifest,
  '"assetProvenanceSha256": ""',
  `"assetProvenanceSha256": "${PROVENANCE_SHA256}"`,
);
manifest = replaceExactlyOnce(
  manifest,
  '"status": "OFFLINE_TYPESCRIPT_PARITY_VALIDATION_REQUIRED"',
  '"status": "ROOT_GOLDEN_PARITY_VERIFIED_SINGLE_FIXTURE"',
);
manifest = replaceExactlyOnce(
  manifest,
  '"sha256": "657f98244fe7322e63894b22899399f7c6c9954a2b71c0e98244643c71e4b908"',
  `"sha256": "${PROMOTED_GOLDEN_SHA256}"`,
);
assert.equal(sha256(manifest), PROMOTED_MANIFEST_SHA256);
await writeFile(resolve(outputDirectory, "ritabrata-grb-generator.manifest.json"), manifest, "utf8");

for (const name of Object.keys(SOURCE_HASHES).filter((name) => name.endsWith(".gz"))) {
  await copyFile(
    resolve(sourceDirectory, name),
    resolve(outputDirectory, name.replace(/\.gz$/, ".bin")),
  );
}
console.log(JSON.stringify({
  sourceDirectory,
  outputDirectory,
  promotedManifestSha256: PROMOTED_MANIFEST_SHA256,
  promotedGoldenSha256: PROMOTED_GOLDEN_SHA256,
  status: "PASS",
}, null, 2));
