import {
  RITABRATA_GRB_PIXEL_COUNT,
  RITABRATA_GRB_SOURCE_AREA_CM2,
  selectNearestRitabrataGrbDirection,
  type RitabrataGrbDatabaseDirection,
  type RitabrataGrbGeneratorAssets,
} from "./ritabrata-grb-generator.ts";
import { RITABRATA_DETECTOR_FRAME } from "./detector-local-frame-adapter.ts";

type KernelName =
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
  schemaVersion: 1;
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
  kernels: Readonly<Record<KernelName, KernelDescriptor>>;
  provenanceSha256: string;
  rootParity: Readonly<{
    verified: boolean;
    goldenFixtureId: string;
    goldenOutputSha256: string;
    assetProvenanceSha256: string;
    status: string;
  }>;
}>;

const KERNEL_NAMES: readonly KernelName[] = [
  "pixelMean",
  "pixelVariance",
  "depositedEnergyMean",
  "depositedEnergyVariance",
];

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new RangeError("Invalid SHA-256 metadata.");
}

function assertManifest(manifest: RitabrataGrbGeneratorManifest): void {
  if (
    manifest.schemaVersion !== 1 || !manifest.assetVersion.trim() ||
    manifest.directionFrame !== RITABRATA_DETECTOR_FRAME ||
    manifest.pixelCount !== RITABRATA_GRB_PIXEL_COUNT ||
    manifest.sourceAreaCm2 !== RITABRATA_GRB_SOURCE_AREA_CM2 ||
    manifest.directionCount !== manifest.directions.length || manifest.directionCount <= 0 ||
    manifest.primaryEnergyBinEdgesKeV.length !== manifest.primaryEnergyBinCount + 1 ||
    manifest.depositedEnergyBinEdgesKeV.length !== manifest.depositedEnergyBinCount + 1
  ) throw new RangeError("Ritabrata GRB generator manifest is invalid or incompatible.");
  assertSha256(manifest.provenanceSha256);
  for (const name of KERNEL_NAMES) {
    const descriptor = manifest.kernels[name];
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
    throw new Error("Ritabrata GRB kernel member SHA-256 mismatch.");
  }
  const uncompressed = await decompressGzip(memberBytes);
  if (uncompressed.byteLength !== member.uncompressedByteLength) {
    throw new RangeError("GRB kernel member has an unexpected uncompressed length.");
  }
  return littleEndianFloat32(uncompressed);
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
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Cannot load GRB generator manifest (${response.status}).`);
  const manifest = await response.json() as RitabrataGrbGeneratorManifest;
  assertManifest(manifest);
  const selection = selectNearestRitabrataGrbDirection(thetaDeg, phiDeg, manifest.directions);
  if (!selection) throw new RangeError("Requested GRB direction is invalid.");
  const directionIndex = manifest.directions.indexOf(selection.direction);
  const loaded = await Promise.all(KERNEL_NAMES.map((name) =>
    loadKernelMember(response.url || manifestUrl, manifest.kernels[name], directionIndex)));
  return Object.freeze({
    assetVersion: manifest.assetVersion,
    directionFrame: manifest.directionFrame,
    pixelCount: manifest.pixelCount,
    sourceAreaCm2: manifest.sourceAreaCm2,
    primaryEnergyBinEdgesKeV: Object.freeze([...manifest.primaryEnergyBinEdgesKeV]),
    depositedEnergyBinEdgesKeV: Object.freeze([...manifest.depositedEnergyBinEdgesKeV]),
    directions: Object.freeze([selection.direction]),
    pixelMeanKernel: loaded[0],
    pixelVarianceKernel: loaded[1],
    depositedEnergyMeanKernel: loaded[2],
    depositedEnergyVarianceKernel: loaded[3],
    provenanceSha256: manifest.provenanceSha256,
    rootParity: Object.freeze({
      verified: manifest.rootParity.verified,
      goldenFixtureId: manifest.rootParity.goldenFixtureId,
      goldenOutputSha256: manifest.rootParity.goldenOutputSha256,
      assetProvenanceSha256: manifest.rootParity.assetProvenanceSha256,
    }),
  });
}
