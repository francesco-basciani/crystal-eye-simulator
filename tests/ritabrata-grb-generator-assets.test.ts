import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import {
  clearRitabrataGrbGeneratorAssetCache,
  loadRitabrataGrbGeneratorDirectionAssets,
} from "../app/lib/ritabrata-grb-generator-assets.ts";
import { RITABRATA_GRB_APPROVED_MANIFEST_SHA256 } from "../app/lib/ritabrata-grb-generator.ts";

const directory = new URL("../public/data/ritabrata-grb-generator/", import.meta.url);
const manifestBytes = readFileSync(new URL("ritabrata-grb-generator.manifest.json", directory));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const files = new Map<string, Buffer>([
  ["/ritabrata-grb-generator.manifest.json", manifestBytes],
  ...Object.values(manifest.kernels).map((descriptor) => {
    const file = (descriptor as { file: string }).file;
    return [`/${file}`, readFileSync(new URL(file, directory))] as const;
  }),
]);

test("the Range loader verifies and deduplicates exact direction members", async () => {
  clearRitabrataGrbGeneratorAssetCache();
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    const bytes = files.get(request.url ?? "");
    if (!bytes) return void response.writeHead(404).end();
    const range = request.headers.range;
    if (!range) {
      response.writeHead(200, { "content-length": bytes.byteLength });
      response.end(bytes);
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    assert.ok(match);
    const start = Number(match[1]);
    const end = Number(match[2]);
    const slice = bytes.subarray(start, end + 1);
    response.writeHead(206, {
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${bytes.byteLength}`,
      "content-length": slice.byteLength,
    });
    response.end(slice);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/ritabrata-grb-generator.manifest.json`;
    const [first, second] = await Promise.all([
      loadRitabrataGrbGeneratorDirectionAssets(url, 40, 120),
      loadRitabrataGrbGeneratorDirectionAssets(url, 40, 120),
    ]);
    assert.strictEqual(first, second);
    assert.equal(first.manifestSha256, RITABRATA_GRB_APPROVED_MANIFEST_SHA256);
    assert.equal(first.directions[0].responseKey, "41_117");
    assert.equal(requestCount, 5);
    clearRitabrataGrbGeneratorAssetCache();
    await loadRitabrataGrbGeneratorDirectionAssets(url, 40, 120);
    assert.equal(requestCount, 10);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
    clearRitabrataGrbGeneratorAssetCache();
  }
});

test("the loader rejects a manifest outside the code-pinned trust root", async () => {
  clearRitabrataGrbGeneratorAssetCache();
  const corrupted = Buffer.from(manifestBytes);
  corrupted[corrupted.length - 2] ^= 1;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-length": corrupted.byteLength });
    response.end(corrupted);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(
      loadRitabrataGrbGeneratorDirectionAssets(
        `http://127.0.0.1:${address.port}/ritabrata-grb-generator.manifest.json`,
        40,
        120,
      ),
      /manifest SHA-256 mismatch/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
    clearRitabrataGrbGeneratorAssetCache();
  }
});
