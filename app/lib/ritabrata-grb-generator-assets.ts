import {
  RITABRATA_GRB_PIXEL_COUNT,
  RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
  RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256,
  RITABRATA_GRB_SOURCE_AREA_CM2,
  selectNearestRitabrataGrbDirection,
  selectThreeNearestRitabrataGrbDirections,
  type RitabrataGrbDatabaseDirection,
  type RitabrataGrbGeneratorAssets,
} from "./ritabrata-grb-generator.ts";
import { RITABRATA_DETECTOR_FRAME } from "./detector-local-frame-adapter.ts";

type KernelName =
  | "primaryCounts"
  | "pixelMean"
  | "pixelVariance"
  | "depositedEnergyMean"
  | "depositedEnergyVariance";

type KernelMember = Readonly<{
  directionIndex: number;
  offset: number;
  compressedByteLength: number;
  uncompressedByteLength: number;
  sha256: string;
}>;

type KernelDescriptor = Readonly<{
  file: string;
  encoding: "range-addressable-concatenated-gzip-members-float32-little-endian";
  memberLayout: string;
  totalUncompressedByteLength: number;
  fileByteLength: number;
  fileSha256: string;
  members: readonly KernelMember[];
}>;

export type RitabrataGrbGeneratorManifest = Readonly<{
  schemaVersion: 1 | 2;
  assetVersion: string;
  directionFrame: typeof RITABRATA_DETECTOR_FRAME;
  pixelCount: number;
  directionCount: number;
  primaryEnergyBinCount: number;
  depositedEnergyBinCount: number;
  sourceAreaCm2: number;
  primaryEnergyBinEdgesKeV: readonly number[];
  depositedEnergyBinEdgesKeV: readonly number[];
  directions: readonly RitabrataGrbDatabaseDirection[];
  maximumRequestedThetaDeg?: number;
  interpolation?: Readonly<{
    neighborCount: number;
    weighting: string;
    exactMatch: string;
    responseSemantics: string;
  }>;
  kernels: Readonly<Record<Exclude<KernelName, "primaryCounts">, KernelDescriptor> &
    Partial<Record<"primaryCounts", KernelDescriptor>>>;
  provenanceSha256: string;
  rootParity: Readonly<{
    verified: boolean;
    goldenFixtureId: string;
    goldenOutputSha256: string;
    assetProvenanceSha256: string;
    status: string;
  }>;
}>;

const V1_KERNEL_NAMES: readonly KernelName[] = [
  "pixelMean",
  "pixelVariance",
  "depositedEnergyMean",
  "depositedEnergyVariance",
];
const V2_KERNEL_NAMES: readonly KernelName[] = ["primaryCounts", ...V1_KERNEL_NAMES];

const manifestCache = new Map<string, Promise<Readonly<{
  manifest: RitabrataGrbGeneratorManifest;
  resolvedUrl: string;
}>>>();
const directionAssetCache = new Map<string, Promise<RitabrataGrbGeneratorAssets>>();
export const RITABRATA_GRB_DIRECTION_CACHE_CAPACITY = 24;

function cacheKey(url: string | URL): string {
  return typeof url === "string" ? new URL(url, globalThis.location?.href).href : url.href;
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new RangeError("Invalid SHA-256 metadata.");
}

function assertManifest(manifest: RitabrataGrbGeneratorManifest): void {
  if (
    (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) || !manifest.assetVersion.trim() ||
    manifest.directionFrame !== RITABRATA_DETECTOR_FRAME ||
    manifest.pixelCount !== RITABRATA_GRB_PIXEL_COUNT ||
    manifest.sourceAreaCm2 !== RITABRATA_GRB_SOURCE_AREA_CM2 ||
    manifest.directionCount !== manifest.directions.length || manifest.directionCount <= 0 ||
    manifest.primaryEnergyBinEdgesKeV.length !== manifest.primaryEnergyBinCount + 1 ||
    manifest.depositedEnergyBinEdgesKeV.length !== manifest.depositedEnergyBinCount + 1
  ) throw new RangeError("GRB response-generator manifest is invalid or incompatible.");
  if (
    manifest.schemaVersion === 2 && (
      manifest.maximumRequestedThetaDeg !== 113 ||
      manifest.interpolation?.neighborCount !== 3 ||
      manifest.interpolation.weighting !== "inverse-angular-distance-normalized" ||
      manifest.interpolation.exactMatch !== "single-template-weight-one" ||
      manifest.interpolation.responseSemantics !== "full-sample-expectation-approximation" ||
      !manifest.kernels.primaryCounts
    )
  ) throw new RangeError("Updated GRB interpolation metadata is invalid.");
  assertSha256(manifest.provenanceSha256);
  for (const name of manifest.schemaVersion === 2 ? V2_KERNEL_NAMES : V1_KERNEL_NAMES) {
    const descriptor = manifest.kernels[name];
    if (!descriptor) throw new RangeError(`Missing ${name} kernel descriptor.`);
    if (
      descriptor.encoding !==
        "range-addressable-concatenated-gzip-members-float32-little-endian" ||
      descriptor.members.length !== manifest.directionCount || descriptor.fileByteLength <= 0
    ) throw new RangeError(`Invalid ${name} kernel descriptor.`);
    assertSha256(descriptor.fileSha256);
    let expectedOffset = 0;
    for (let index = 0; index < descriptor.members.length; index += 1) {
      const member = descriptor.members[index];
      if (
        member.directionIndex !== index || member.offset !== expectedOffset ||
        member.compressedByteLength <= 0 || member.uncompressedByteLength <= 0 ||
        member.uncompressedByteLength % 4 !== 0
      ) throw new RangeError(`Invalid ${name} member metadata.`);
      assertSha256(member.sha256);
      expectedOffset += member.compressedByteLength;
    }
    if (expectedOffset !== descriptor.fileByteLength) {
      throw new RangeError(`${name} member byte ranges do not cover the declared file.`);
    }
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function decompressGzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not provide the required gzip DecompressionStream.");
  }
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
}

function littleEndianFloat32(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength % 4 !== 0) throw new RangeError("Kernel is not Float32-aligned.");
  const probe = new Uint8Array([1, 0, 0, 0]);
  if (new Uint32Array(probe.buffer)[0] === 1) return new Float32Array(buffer);
  const view = new DataView(buffer);
  return Float32Array.from(
    { length: buffer.byteLength / 4 },
    (_, index) => view.getFloat32(index * 4, true),
  );
}

async function loadKernelMember(
  manifestUrl: string | URL,
  descriptor: KernelDescriptor,
  directionIndex: number,
): Promise<Float32Array> {
  const member = descriptor.members[directionIndex];
  const manifestBase = typeof manifestUrl === "string" ? manifestUrl : manifestUrl.toString();
  const fileUrl = new URL(descriptor.file, manifestBase);
  const lastByte = member.offset + member.compressedByteLength - 1;
  const response = await fetch(fileUrl, {
    headers: { Range: `bytes=${member.offset}-${lastByte}` },
  });
  if (!response.ok) throw new Error(`Cannot load GRB kernel member (${response.status}).`);
  const responseBytes = await response.arrayBuffer();
  let memberBytes: ArrayBuffer;
  if (response.status === 206) {
    if (responseBytes.byteLength !== member.compressedByteLength) {
      throw new RangeError("Partial GRB kernel response has an unexpected length.");
    }
    memberBytes = responseBytes;
  } else {
    if (responseBytes.byteLength !== descriptor.fileByteLength) {
      throw new RangeError("Server ignored Range and returned an unexpected kernel file length.");
    }
    memberBytes = responseBytes.slice(member.offset, lastByte + 1);
  }
  if (await sha256Hex(memberBytes) !== member.sha256) {
    throw new Error("GRB response-kernel member SHA-256 mismatch.");
  }
  const uncompressed = await decompressGzip(memberBytes);
  if (uncompressed.byteLength !== member.uncompressedByteLength) {
    throw new RangeError("GRB kernel member has an unexpected uncompressed length.");
  }
  return littleEndianFloat32(uncompressed);
}

async function loadManifest(
  manifestUrl: string | URL,
): Promise<Readonly<{ manifest: RitabrataGrbGeneratorManifest; resolvedUrl: string }>> {
  const key = cacheKey(manifestUrl);
  let pending = manifestCache.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(key);
      if (!response.ok) throw new Error(`Cannot load GRB generator manifest (${response.status}).`);
      const bytes = await response.arrayBuffer();
      const manifestSha256 = await sha256Hex(bytes);
      if (
        manifestSha256 !== RITABRATA_GRB_APPROVED_MANIFEST_SHA256 &&
        manifestSha256 !== RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256
      ) {
        throw new Error("GRB response-generator manifest SHA-256 mismatch.");
      }
      const manifest = JSON.parse(new TextDecoder().decode(bytes)) as RitabrataGrbGeneratorManifest;
      const approvedManifestHash = manifest.schemaVersion === 2
        ? RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256
        : RITABRATA_GRB_APPROVED_MANIFEST_SHA256;
      if (manifestSha256 !== approvedManifestHash) {
        throw new Error("GRB response-generator schema does not match its trust root.");
      }
      assertManifest(manifest);
      return Object.freeze({ manifest, resolvedUrl: response.url || key });
    })();
    manifestCache.set(key, pending);
    const created = pending;
    created.catch(() => {
      if (manifestCache.get(key) === created) manifestCache.delete(key);
    });
  }
  return pending;
}

/** Test/support boundary; runtime normally retains manifest and direction members. */
export function clearRitabrataGrbGeneratorAssetCache(): void {
  manifestCache.clear();
  directionAssetCache.clear();
}

/**
 * Load only the nearest database direction using HTTP byte ranges. The four
 * response members are fetched lazily; the ~698 MB ROOT source is never shipped.
 */
export async function loadRitabrataGrbGeneratorDirectionAssets(
  manifestUrl: string | URL,
  thetaDeg: number,
  phiDeg: number,
): Promise<RitabrataGrbGeneratorAssets> {
  const { manifest, resolvedUrl } = await loadManifest(manifestUrl);
  const selectedDirections = manifest.schemaVersion === 2
    ? selectThreeNearestRitabrataGrbDirections(thetaDeg, phiDeg, manifest.directions)?.selections
    : (() => {
        const selection = selectNearestRitabrataGrbDirection(thetaDeg, phiDeg, manifest.directions);
        return selection ? [{ ...selection, weight: 1 }] : undefined;
      })();
  if (!selectedDirections) throw new RangeError("Requested GRB direction is invalid.");
  const directionIndices = selectedDirections.map((selection) =>
    manifest.directions.indexOf(selection.direction));
  const directionKey = `${cacheKey(manifestUrl)}#${directionIndices.join(",")}`;
  let pending = directionAssetCache.get(directionKey);
  if (!pending) {
    pending = (async () => {
      const kernelNames = manifest.schemaVersion === 2 ? V2_KERNEL_NAMES : V1_KERNEL_NAMES;
      const loadedByDirection = await Promise.all(directionIndices.map((directionIndex) =>
        Promise.all(kernelNames.map((name) =>
          loadKernelMember(resolvedUrl, manifest.kernels[name]!, directionIndex)))));
      const merged = new Map<KernelName, Float32Array>();
      kernelNames.forEach((name, kernelIndex) => {
        const members = loadedByDirection.map((loaded) => loaded[kernelIndex]);
        const length = members.reduce((sum, member) => sum + member.length, 0);
        const values = new Float32Array(length);
        let offset = 0;
        for (const member of members) {
          values.set(member, offset);
          offset += member.length;
        }
        merged.set(name, values);
      });
      return Object.freeze({
        assetVersion: manifest.assetVersion,
        manifestSha256: manifest.schemaVersion === 2
          ? RITABRATA_GRB_V2_APPROVED_MANIFEST_SHA256
          : RITABRATA_GRB_APPROVED_MANIFEST_SHA256,
        directionFrame: manifest.directionFrame,
        pixelCount: manifest.pixelCount,
        sourceAreaCm2: manifest.sourceAreaCm2,
        primaryEnergyBinEdgesKeV: Object.freeze([...manifest.primaryEnergyBinEdgesKeV]),
        depositedEnergyBinEdgesKeV: Object.freeze([...manifest.depositedEnergyBinEdgesKeV]),
        directions: Object.freeze(selectedDirections.map((selection) => selection.direction)),
        primaryCountsKernel: merged.get("primaryCounts"),
        pixelMeanKernel: merged.get("pixelMean")!,
        pixelVarianceKernel: merged.get("pixelVariance")!,
        depositedEnergyMeanKernel: merged.get("depositedEnergyMean")!,
        depositedEnergyVarianceKernel: merged.get("depositedEnergyVariance")!,
        provenanceSha256: manifest.provenanceSha256,
        rootParity: Object.freeze({
          verified: manifest.rootParity.verified,
          goldenFixtureId: manifest.rootParity.goldenFixtureId,
          goldenOutputSha256: manifest.rootParity.goldenOutputSha256,
          assetProvenanceSha256: manifest.rootParity.assetProvenanceSha256,
        }),
      });
    })();
    directionAssetCache.set(directionKey, pending);
    while (directionAssetCache.size > RITABRATA_GRB_DIRECTION_CACHE_CAPACITY) {
      const oldestKey = directionAssetCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      directionAssetCache.delete(oldestKey);
    }
    const created = pending;
    created.catch(() => {
      if (directionAssetCache.get(directionKey) === created) {
        directionAssetCache.delete(directionKey);
      }
    });
  } else {
    directionAssetCache.delete(directionKey);
    directionAssetCache.set(directionKey, pending);
  }
  return pending;
}
