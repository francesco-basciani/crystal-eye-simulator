import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "public/data/ritabrata-localizer");
const manifest = JSON.parse(readFileSync(
  resolve(directory, "ritabrata-localizer.manifest.json"),
  "utf8",
));
const samplePath = resolve(directory, "ritabrata-localizer-samples.json");
const document = JSON.parse(readFileSync(samplePath, "utf8"));
const canonical = Array.from({ length: 126 }, (_, pixelId) => pixelId);
for (const fixture of document.fixtures) {
  if (JSON.stringify(fixture.pixelIds) !== JSON.stringify(canonical)) {
    assert.deepEqual(
      fixture.pixelIds,
      manifest.pixelIdsInSourceFileOrder,
      `${fixture.fixtureId} carries neither historical upCal row IDs nor canonical histogram IDs`,
    );
  }
  fixture.pixelIds = canonical;
}
const output = `${JSON.stringify(document, null, 2)}\n`;
writeFileSync(samplePath, output, "utf8");
console.log(JSON.stringify({
  samplePath,
  sha256: createHash("sha256").update(output).digest("hex"),
  status: "PASS",
}, null, 2));
