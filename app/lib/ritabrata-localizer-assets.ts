import {
  RITABRATA_KS_GEOMETRY_VERSION,
  RITABRATA_KS_PIXEL_COUNT,
  type LegacyKsAssetBundle,
  type LegacyKsEffectiveAreaRow,
  type LegacyKsTemplate,
} from "./legacy-template-localizer.ts";
import {
  RITABRATA_DETECTOR_FRAME,
  CELOC_UPCAL_RAW_COMPONENT_FRAME,
  createCelocRawPixelVector,
  type CelocRawPixelVector3,
} from "./detector-local-frame-adapter.ts";

export type RitabrataLocalizerManifest = Readonly<{
  schemaVersion: 1;
  assetVersion: string;
  geometryVersion: typeof RITABRATA_KS_GEOMETRY_VERSION;
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  pixelPositionFrame: typeof CELOC_UPCAL_RAW_COMPONENT_FRAME;
  pixelCount: number;
  energyBinCount: number;
  templateCount: number;
  effectiveAreaThetaCount: number;
  pixelIdsInSourceFileOrder: readonly number[];
  pixelPositionVectorsInSourceFileOrder: readonly CelocRawPixelVector3[];
  energyBinEdgesKeV: readonly number[];
  templates: readonly LegacyKsTemplate[];
  effectiveArea: readonly LegacyKsEffectiveAreaRow[];
  templateResponse: Readonly<{
    file: string;
    encoding: "gzip-float32-little-endian";
    layout: "template,pixel,energy";
    uncompressedByteLength: number;
    sha256: string;
  }>;
  provenanceSha256: string;
  rootParity: Readonly<{
    verified: boolean;
    rootVersion: string;
    goldenFixtureId: string;
    goldenOutputSha256: string;
    assetProvenanceSha256: string;
    status: string;
  }>;
}>;

function isLittleEndian(): boolean {
  const bytes = new Uint8Array([1, 0, 0, 0]);
  return new Uint32Array(bytes.buffer)[0] === 1;
}

function littleEndianFloat32(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength % 4 !== 0) throw new RangeError("Template response byte length is not Float32-aligned.");
  if (isLittleEndian()) return new Float32Array(buffer);
  const view = new DataView(buffer);
  const result = new Float32Array(buffer.byteLength / 4);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getFloat32(index * 4, true);
  }
  return result;
}

function assertManifest(manifest: RitabrataLocalizerManifest): void {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.geometryVersion !== RITABRATA_KS_GEOMETRY_VERSION ||
    manifest.directionFrame !== RITABRATA_DETECTOR_FRAME ||
    manifest.pixelPositionFrame !== CELOC_UPCAL_RAW_COMPONENT_FRAME ||
    manifest.pixelCount !== RITABRATA_KS_PIXEL_COUNT ||
    manifest.energyBinCount <= 0 ||
    manifest.templateCount <= 0 ||
    manifest.pixelIdsInSourceFileOrder.length !== manifest.pixelCount ||
    manifest.pixelPositionVectorsInSourceFileOrder.length !== manifest.pixelCount ||
    manifest.energyBinEdgesKeV.length !== manifest.energyBinCount + 1 ||
    manifest.templates.length !== manifest.templateCount ||
    manifest.effectiveArea.length !== manifest.effectiveAreaThetaCount ||
    manifest.templateResponse.encoding !== "gzip-float32-little-endian" ||
    manifest.templateResponse.layout !== "template,pixel,energy" ||
    !/^[a-f0-9]{64}$/.test(manifest.templateResponse.sha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.provenanceSha256)
  ) throw new RangeError("GRB localizer manifest is invalid or incompatible.");
  const expectedBytes = manifest.templateCount * manifest.pixelCount * manifest.energyBinCount * 4;
  if (manifest.templateResponse.uncompressedByteLength !== expectedBytes) {
    throw new RangeError("GRB template-response dimensions do not match its byte length.");
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function decompressGzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not provide the gzip DecompressionStream required by the localizer.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function createRitabrataAssetBundle(
  manifest: RitabrataLocalizerManifest,
  uncompressedTemplateResponse: ArrayBuffer,
): LegacyKsAssetBundle {
  assertManifest(manifest);
  if (uncompressedTemplateResponse.byteLength !== manifest.templateResponse.uncompressedByteLength) {
    throw new RangeError("GRB template response has an unexpected uncompressed byte length.");
  }
  return Object.freeze({
    geometryVersion: manifest.geometryVersion,
    directionFrame: manifest.directionFrame,
    pixelPositionFrame: manifest.pixelPositionFrame,
    pixelIds: Object.freeze(Array.from({ length: RITABRATA_KS_PIXEL_COUNT }, (_, pixelId) => pixelId)),
    pixelPositionRowIds: Object.freeze([...manifest.pixelIdsInSourceFileOrder]),
    pixelPositionVectors: Object.freeze(
      manifest.pixelPositionVectorsInSourceFileOrder.map((vector) =>
        createCelocRawPixelVector(vector[0], vector[1], vector[2])),
    ),
    energyBinEdgesKeV: Object.freeze([...manifest.energyBinEdgesKeV]),
    templates: Object.freeze(manifest.templates.map((template) => Object.freeze({ ...template }))),
    templatePixelEnergyResponse: littleEndianFloat32(uncompressedTemplateResponse),
    effectiveArea: Object.freeze(manifest.effectiveArea.map((row) => Object.freeze({
      thetaDeg: row.thetaDeg,
      areaByEnergyBin: Object.freeze(Array.from(row.areaByEnergyBin)),
    }))),
    provenanceSha256: manifest.provenanceSha256,
    rootParity: Object.freeze({
      verified: manifest.rootParity.verified,
      rootVersion: manifest.rootParity.rootVersion,
      goldenFixtureId: manifest.rootParity.goldenFixtureId,
      goldenOutputSha256: manifest.rootParity.goldenOutputSha256,
      assetProvenanceSha256: manifest.rootParity.assetProvenanceSha256,
    }),
  });
}

/** Lazy browser loader. Call only when a real energy-resolved observation exists. */
export async function loadRitabrataLocalizerAssets(
  manifestUrl: string | URL,
): Promise<LegacyKsAssetBundle> {
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`Cannot load localizer manifest (${manifestResponse.status}).`);
  const manifest = await manifestResponse.json() as RitabrataLocalizerManifest;
  assertManifest(manifest);
  const responseUrl = new URL(manifest.templateResponse.file, manifestResponse.url || manifestUrl);
  const response = await fetch(responseUrl);
  if (!response.ok) throw new Error(`Cannot load localizer template response (${response.status}).`);
  const compressed = await response.arrayBuffer();
  const actualHash = await sha256Hex(compressed);
  if (actualHash !== manifest.templateResponse.sha256) {
    throw new Error("GRB template-response SHA-256 mismatch.");
  }
  return createRitabrataAssetBundle(manifest, await decompressGzip(compressed));
}
