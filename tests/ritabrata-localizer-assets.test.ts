import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  createRitabrataAssetBundle,
  loadRitabrataLocalizerAssets,
} from "../app/lib/ritabrata-localizer-assets.ts";
import {
  CELOC_UPCAL_RAW_COMPONENT_FRAME,
  RITABRATA_DETECTOR_FRAME,
} from "../app/lib/detector-local-frame-adapter.ts";

const assetDirectory = new URL("../public/data/ritabrata-localizer/", import.meta.url);
const manifestBytes = readFileSync(new URL("ritabrata-localizer.manifest.json", assetDirectory));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const samples = JSON.parse(readFileSync(
  new URL("ritabrata-localizer-samples.json", assetDirectory),
  "utf8",
));

const expectedSourceHashes = {
  "CELoc.cc": "99b0ba5321070aa10c3de218174221fb9320b66ba896628e0eae2214114fce04",
  "CMakeLists.txt": "396b1f271234de694bb000feebc32b1c8245f840568e7a1025fbcbd8e06e729d",
  "allEffArea.root": "d2cbbeee10dd545a968ab926c4007af964013056b6a2a26767c99cf170d6ec85",
  "sample-src-41-117.root": "d279556abaa851bd9f98d1b3324102d9a9fb34c2773e543a572aca8c47e7e854",
  "sample-src-74-349.root": "a084a3b567c58e21c57facd7333f1bc08aa17c040e62794f988dfd0c589b2783",
  "srcpos-5deg.txt": "e1a544f017ab5a91572b410f2e1fa2ec20c21c80d438acc10c71956b51cb7450",
  "temEdepPix5deg.root": "95a0f9cb13e114a5e24fdcc4af8c5395df47c12f8a55d45c063efe7f91ce9104",
  "upCal.txt": "5164b59df7df244855d1f7a30385385eab460f30d2af2e0bb5ba3acbe4f942c6",
};

test("Ritabrata source provenance and converted dimensions are frozen", () => {
  assert.deepEqual(manifest.sourceFilesSha256, expectedSourceHashes);
  assert.equal(manifest.pixelCount, 126);
  assert.equal(manifest.directionFrame, RITABRATA_DETECTOR_FRAME);
  assert.equal(manifest.pixelPositionFrame, CELOC_UPCAL_RAW_COMPONENT_FRAME);
  assert.equal(manifest.energyBinCount, 100);
  assert.equal(manifest.templateCount, 742);
  assert.equal(manifest.effectiveAreaThetaCount, 91);
  assert.equal(manifest.pixelIdsInSourceFileOrder.length, 126);
  assert.deepEqual(manifest.pixelIdsInSourceFileOrder.slice(0, 6), [0, 1, 10, 100, 101, 102]);
  assert.equal(new Set(manifest.pixelIdsInSourceFileOrder).size, 126);
  assert.equal(manifest.templates.length, 742);
  assert.equal(manifest.effectiveArea.length, 91);
  assert.equal(manifest.energyBinEdgesKeV.length, 101);
  assert.equal(manifest.templateResponse.uncompressedByteLength, 742 * 126 * 100 * 4);
  assert.equal(manifest.sourceFilesGoogleDriveIds["CELoc.cc"], "1rfJUfU8dX6tfX2tSRrQpJfH62oVpaTD6");
});

test("the compressed browser asset matches its declared SHA-256", () => {
  const response = readFileSync(new URL(manifest.templateResponse.file, assetDirectory));
  assert.equal(
    createHash("sha256").update(response).digest("hex"),
    manifest.templateResponse.sha256,
  );
  const uncompressed = gunzipSync(response);
  assert.equal(uncompressed.byteLength, manifest.templateResponse.uncompressedByteLength);
  const values = new Float32Array(
    uncompressed.buffer,
    uncompressed.byteOffset,
    uncompressed.byteLength / 4,
  );
  assert.ok(Number.isFinite(values[0]));
  assert.ok(Number.isFinite(values.at(-1)));
});

test("official ROOT parity remains explicitly unverified", () => {
  assert.deepEqual(manifest.rootParity, {
    verified: false,
    rootVersion: "",
    goldenFixtureId: "",
    goldenOutputSha256: "",
    assetProvenanceSha256: "",
    status: "PENDING_OFFICIAL_ROOT_OUTPUTS",
  });
  assert.equal(samples.fixtures.length, 2);
  for (const fixture of samples.fixtures) {
    assert.equal(fixture.rootExpectedReconstruction, null);
    assert.equal(fixture.rootExpectedReconstructionStatus, "REQUESTED_FROM_DOMAIN_AUTHOR");
    assert.deepEqual(fixture.pixelIds, Array.from({ length: 126 }, (_, pixelId) => pixelId));
  }
});

test("the browser loader fetches, hashes and decompresses the frozen asset", async () => {
  const responseBytes = readFileSync(new URL(manifest.templateResponse.file, assetDirectory));
  const server = createServer((request, response) => {
    if (request.url === "/ritabrata-localizer.manifest.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(manifestBytes);
      return;
    }
    if (request.url === `/${manifest.templateResponse.file}`) {
      response.writeHead(200, { "content-type": "application/gzip" });
      response.end(responseBytes);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const assets = await loadRitabrataLocalizerAssets(
      `http://127.0.0.1:${address.port}/ritabrata-localizer.manifest.json`,
    );
    assert.equal(assets.templatePixelEnergyResponse.length, 742 * 126 * 100);
    assert.equal(assets.provenanceSha256, manifest.provenanceSha256);
    assert.equal(assets.rootParity.verified, false);
    assert.equal(assets.directionFrame, RITABRATA_DETECTOR_FRAME);
    assert.equal(assets.pixelPositionFrame, CELOC_UPCAL_RAW_COMPONENT_FRAME);
    assert.deepEqual(assets.pixelIds, Array.from({ length: 126 }, (_, pixelId) => pixelId));
    assert.deepEqual(assets.pixelPositionRowIds, manifest.pixelIdsInSourceFileOrder);
    assert.deepEqual(
      assets.pixelPositionVectors[0],
      manifest.pixelPositionVectorsInSourceFileOrder[0],
      "upCal raw components must be preserved literally",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});

test("the asset constructor rejects a mismatched decompressed length", () => {
  assert.throws(
    () => createRitabrataAssetBundle(manifest, new ArrayBuffer(4)),
    /unexpected uncompressed byte length/,
  );
});

test("the asset constructor rejects incompatible frame metadata", () => {
  assert.throws(
    () => createRitabrataAssetBundle(
      { ...manifest, directionFrame: "wrong-frame" },
      new ArrayBuffer(manifest.templateResponse.uncompressedByteLength),
    ),
    /invalid or incompatible/,
  );
  assert.throws(
    () => createRitabrataAssetBundle(
      { ...manifest, pixelPositionFrame: "wrong-frame" },
      new ArrayBuffer(manifest.templateResponse.uncompressedByteLength),
    ),
    /invalid or incompatible/,
  );
});
