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

export const APPROVED_LOCALIZER_MANIFEST_SHA256 = Object.freeze({
  "ritabrata-standalone-celoc-v1":
    "74b3b64c196089cbe81ae3b2725315b0054900d4f34bb4ad7918d4e93f11ce98",
  "ritabrata-standalone-celoc-2deg-v1":
    "c81131bba54231bbd06505b100c4700293879a1421d4f8b901c0cacaadff3538",
} as const);

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
    encoding: "gzip-float32-little-endian";
    layout: "template,pixel,energy";
    uncompressedByteLength: number;
    file?: string;
    sha256?: string;
    shards?: readonly Readonly<{
      file: string;
      templateStart: number;
      templateCount: number;
      uncompressedByteLength: number;
      sha256: string;
    }>[];
  }>;
  templateProjectionFlow?: Readonly<{
    file: string;
    encoding: "gzip-float32-little-endian";
    layout: "template,pixel";
    uncompressedByteLength: number;
    sha256: string;
    nonzeroCellCount: number;
    semantics: string;
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
    !/^[a-f0-9]{64}$/.test(manifest.provenanceSha256)
  ) throw new RangeError("GRB localizer manifest is invalid or incompatible.");
  const expectedBytes = manifest.templateCount * manifest.pixelCount * manifest.energyBinCount * 4;
  if (manifest.templateResponse.uncompressedByteLength !== expectedBytes) {
    throw new RangeError("GRB template-response dimensions do not match its byte length.");
  }
  const monolithic = manifest.templateResponse.file && manifest.templateResponse.sha256;
  const shards = manifest.templateResponse.shards;
  if (Boolean(monolithic) === Boolean(shards)) {
    throw new RangeError("GRB localizer response must be monolithic or sharded, not both.");
  }
  if (monolithic && !/^[a-f0-9]{64}$/.test(manifest.templateResponse.sha256!)) {
    throw new RangeError("GRB localizer response hash is invalid.");
  }
  if (shards) {
    let expectedTemplateStart = 0;
    let shardBytes = 0;
    for (const shard of shards) {
      if (
        shard.templateStart !== expectedTemplateStart ||
        !Number.isInteger(shard.templateCount) || shard.templateCount <= 0 ||
        shard.uncompressedByteLength !== shard.templateCount * manifest.pixelCount *
          manifest.energyBinCount * 4 ||
        !/^[a-f0-9]{64}$/.test(shard.sha256)
      ) throw new RangeError("GRB localizer response shards are invalid.");
      expectedTemplateStart += shard.templateCount;
      shardBytes += shard.uncompressedByteLength;
    }
    if (expectedTemplateStart !== manifest.templateCount || shardBytes !== expectedBytes) {
      throw new RangeError("GRB localizer response shards are incomplete.");
    }
  }
  if (manifest.templateProjectionFlow) {
    const flow = manifest.templateProjectionFlow;
    if (
      flow.encoding !== "gzip-float32-little-endian" ||
      flow.layout !== "template,pixel" ||
      flow.uncompressedByteLength !== manifest.templateCount * manifest.pixelCount * 4 ||
      !/^[a-f0-9]{64}$/.test(flow.sha256) ||
      !Number.isInteger(flow.nonzeroCellCount) ||
      flow.nonzeroCellCount < 0 ||
      flow.nonzeroCellCount > manifest.templateCount * manifest.pixelCount
    ) throw new RangeError("GRB localizer projection-flow descriptor is invalid.");
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
  uncompressedTemplateProjectionFlow?: ArrayBuffer,
): LegacyKsAssetBundle {
  assertManifest(manifest);
  if (uncompressedTemplateResponse.byteLength !== manifest.templateResponse.uncompressedByteLength) {
    throw new RangeError("GRB template response has an unexpected uncompressed byte length.");
  }
  if (
    manifest.templateProjectionFlow &&
    uncompressedTemplateProjectionFlow?.byteLength !==
      manifest.templateProjectionFlow.uncompressedByteLength
  ) {
    throw new RangeError("GRB template projection-flow has an unexpected uncompressed byte length.");
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
    templatePixelUnscaledProjectionFlow: manifest.templateProjectionFlow
      ? littleEndianFloat32(uncompressedTemplateProjectionFlow!)
      : undefined,
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
  const manifestBytes = await manifestResponse.arrayBuffer();
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as RitabrataLocalizerManifest;
  const approvedHash = APPROVED_LOCALIZER_MANIFEST_SHA256[
    manifest.assetVersion as keyof typeof APPROVED_LOCALIZER_MANIFEST_SHA256
  ];
  if (!approvedHash || await sha256Hex(manifestBytes) !== approvedHash) {
    throw new Error("GRB localizer manifest is outside the approved trust root.");
  }
  assertManifest(manifest);
  const baseUrl = manifestResponse.url || manifestUrl;
  let uncompressedResponse: ArrayBuffer;
  if (manifest.templateResponse.shards) {
    const result = new Uint8Array(manifest.templateResponse.uncompressedByteLength);
    let byteOffset = 0;
    for (const shard of manifest.templateResponse.shards) {
      const shardResponse = await fetch(new URL(shard.file, baseUrl));
      if (!shardResponse.ok) {
        throw new Error(`Cannot load localizer template-response shard (${shardResponse.status}).`);
      }
      const compressedShard = await shardResponse.arrayBuffer();
      if (await sha256Hex(compressedShard) !== shard.sha256) {
        throw new Error("GRB template-response shard SHA-256 mismatch.");
      }
      const uncompressedShard = await decompressGzip(compressedShard);
      if (uncompressedShard.byteLength !== shard.uncompressedByteLength) {
        throw new Error("GRB template-response shard byte-length mismatch.");
      }
      result.set(new Uint8Array(uncompressedShard), byteOffset);
      byteOffset += uncompressedShard.byteLength;
    }
    uncompressedResponse = result.buffer;
  } else {
    const responseUrl = new URL(manifest.templateResponse.file!, baseUrl);
    const response = await fetch(responseUrl);
    if (!response.ok) throw new Error(`Cannot load localizer template response (${response.status}).`);
    const compressed = await response.arrayBuffer();
    const actualHash = await sha256Hex(compressed);
    if (actualHash !== manifest.templateResponse.sha256) {
      throw new Error("GRB template-response SHA-256 mismatch.");
    }
    uncompressedResponse = await decompressGzip(compressed);
  }
  let projectionFlow: ArrayBuffer | undefined;
  if (manifest.templateProjectionFlow) {
    const flowUrl = new URL(
      manifest.templateProjectionFlow.file,
      baseUrl,
    );
    const flowResponse = await fetch(flowUrl);
    if (!flowResponse.ok) {
      throw new Error(`Cannot load localizer projection flow (${flowResponse.status}).`);
    }
    const compressedFlow = await flowResponse.arrayBuffer();
    if (await sha256Hex(compressedFlow) !== manifest.templateProjectionFlow.sha256) {
      throw new Error("GRB template projection-flow SHA-256 mismatch.");
    }
    projectionFlow = await decompressGzip(compressedFlow);
  }
  return createRitabrataAssetBundle(
    manifest,
    uncompressedResponse,
    projectionFlow,
  );
}
