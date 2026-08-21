export const V2R8_CANDIDATE_PIXEL_COUNT = 126;
export const V2R8_CANDIDATE_GEOMETRY_VERSION = "CESimulation-V2R8-candidate" as const;

export type DetectorVector3 = readonly [number, number, number];
export type DetectorLayerKind = "acd" | "upper-gagg" | "lower-lyso";
export type DetectorAngularRecord = Readonly<{
  pixelId: number;
  thetaDeg: number;
  phiDeg: number;
}>;
export type DetectorLayerDefinition = Readonly<{
  kind: DetectorLayerKind;
  displayName: string;
  material: "GAGG" | "LYSO" | null;
  componentId: number | null;
  identityStatus: "CANONICAL_UPPER_ID" | "MAPPING_UNAVAILABLE";
  geometryStatus: "CONCEPTUAL_ONLY";
  responseStatus: "UNAVAILABLE";
}>;
export type DetectorModuleV2R8Candidate = Readonly<{
  pixelId: number;
  upperCrystalId: number;
  lowerCrystalId: null;
  upperAcdId: null;
  position: DetectorVector3;
  normal: DetectorVector3;
  layers: readonly DetectorLayerDefinition[];
}>;
export type DetectorGeometryV2R8Candidate = Readonly<{
  geometryVersion: typeof V2R8_CANDIDATE_GEOMETRY_VERSION;
  status: "PROVISIONAL";
  coordinateFrame: "+Y_POLAR_PHI_ATAN2_NEG_Z_X";
  positionScale: "UNIT_SPHERE";
  modules: readonly DetectorModuleV2R8Candidate[];
  bottomAcd: Readonly<{
    scope: "GLOBAL";
    geometryStatus: "CONCEPTUAL_ONLY";
    responseStatus: "UNAVAILABLE";
  }>;
}>;

const DEG_TO_RAD = Math.PI / 180;
function createLayers(pixelId: number): readonly DetectorLayerDefinition[] {
  return Object.freeze([
  Object.freeze({
    kind: "acd" as const,
    displayName: "UPPER ACD",
    material: null,
    componentId: null,
    identityStatus: "MAPPING_UNAVAILABLE" as const,
    geometryStatus: "CONCEPTUAL_ONLY" as const,
    responseStatus: "UNAVAILABLE" as const,
  }),
  Object.freeze({
    kind: "upper-gagg" as const,
    displayName: "UP · GAGG",
    material: "GAGG" as const,
    componentId: pixelId,
    identityStatus: "CANONICAL_UPPER_ID" as const,
    geometryStatus: "CONCEPTUAL_ONLY" as const,
    responseStatus: "UNAVAILABLE" as const,
  }),
  Object.freeze({
    kind: "lower-lyso" as const,
    displayName: "DOWN · LYSO",
    material: "LYSO" as const,
    componentId: null,
    identityStatus: "MAPPING_UNAVAILABLE" as const,
    geometryStatus: "CONCEPTUAL_ONLY" as const,
    responseStatus: "UNAVAILABLE" as const,
  }),
  ]);
}

function unit(vector: DetectorVector3): DetectorVector3 | null {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length <= Number.EPSILON) return null;
  return Object.freeze([
    vector[0] / length,
    vector[1] / length,
    vector[2] / length,
  ] as const);
}

function directionFromAngles(thetaDeg: number, phiDeg: number): DetectorVector3 {
  const theta = thetaDeg * DEG_TO_RAD;
  const phi = phiDeg * DEG_TO_RAD;
  return Object.freeze([
    Math.sin(theta) * Math.cos(phi),
    Math.cos(theta),
    -Math.sin(theta) * Math.sin(phi),
  ] as const);
}

const geometryCache = new WeakMap<object, DetectorGeometryV2R8Candidate>();

export function createV2R8CandidateDetectorGeometry(
  records: readonly DetectorAngularRecord[],
): DetectorGeometryV2R8Candidate {
  const cacheKey = records as object;
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;
  if (records.length !== V2R8_CANDIDATE_PIXEL_COUNT) {
    throw new RangeError(`V2R8 candidate geometry requires exactly ${V2R8_CANDIDATE_PIXEL_COUNT} records.`);
  }
  const sorted = [...records].sort((a, b) => a.pixelId - b.pixelId);
  sorted.forEach((record, expectedPixelId) => {
    if (
      record.pixelId !== expectedPixelId ||
      !Number.isFinite(record.thetaDeg) ||
      record.thetaDeg < 0 ||
      record.thetaDeg > 90 ||
      !Number.isFinite(record.phiDeg) ||
      record.phiDeg < -180 ||
      record.phiDeg > 180
    ) {
      throw new RangeError(`Invalid V2R8 candidate record for physical pixel ID ${expectedPixelId}.`);
    }
  });
  const modules = Object.freeze(sorted.map((record) => {
    const normal = directionFromAngles(record.thetaDeg, record.phiDeg);
    return Object.freeze({
      pixelId: record.pixelId,
      upperCrystalId: record.pixelId,
      lowerCrystalId: null,
      upperAcdId: null,
      position: normal,
      normal,
      layers: createLayers(record.pixelId),
    });
  }));
  const geometry = Object.freeze({
    geometryVersion: V2R8_CANDIDATE_GEOMETRY_VERSION,
    status: "PROVISIONAL" as const,
    coordinateFrame: "+Y_POLAR_PHI_ATAN2_NEG_Z_X" as const,
    positionScale: "UNIT_SPHERE" as const,
    modules,
    bottomAcd: Object.freeze({
      scope: "GLOBAL" as const,
      geometryStatus: "CONCEPTUAL_ONLY" as const,
      responseStatus: "UNAVAILABLE" as const,
    }),
  });
  geometryCache.set(cacheKey, geometry);
  return geometry;
}

export function getV2R8CandidateNormals(
  geometry: DetectorGeometryV2R8Candidate,
): readonly DetectorVector3[] {
  return geometry.modules.map((detectorModule) => detectorModule.normal);
}

export function getV2R8CosineIncidence(
  geometry: DetectorGeometryV2R8Candidate,
  pixelId: number,
  rawSourceDirection: DetectorVector3,
): number {
  const sourceDirection = unit(rawSourceDirection);
  const detectorModule = geometry.modules[pixelId];
  if (!sourceDirection) {
    throw new RangeError("V2R8 incidence requires a finite non-zero source direction.");
  }
  if (!detectorModule || detectorModule.pixelId !== pixelId) {
    throw new RangeError(`Unknown V2R8 candidate physical pixel ID ${pixelId}.`);
  }
  return Math.max(0,
    detectorModule.normal[0] * sourceDirection[0] +
    detectorModule.normal[1] * sourceDirection[1] +
    detectorModule.normal[2] * sourceDirection[2],
  );
}

export function rankV2R8PixelsForDirection(
  geometry: DetectorGeometryV2R8Candidate,
  sourceDirection: DetectorVector3,
  requestedCount: number,
): number[] {
  const normalizedDirection = unit(sourceDirection);
  if (!normalizedDirection) {
    throw new RangeError("V2R8 ranking requires a finite non-zero source direction.");
  }
  if (!Number.isFinite(requestedCount)) {
    throw new RangeError("V2R8 ranking requires a finite pixel count.");
  }
  const count = Math.min(
    V2R8_CANDIDATE_PIXEL_COUNT,
    Math.max(0, Math.trunc(requestedCount)),
  );
  return geometry.modules
    .map((detectorModule) => ({
      pixelId: detectorModule.pixelId,
      incidence: getV2R8CosineIncidence(
        geometry,
        detectorModule.pixelId,
        normalizedDirection,
      ),
    }))
    .filter(({ incidence }) => incidence > 0)
    .sort((a, b) => b.incidence - a.incidence || a.pixelId - b.pixelId)
    .slice(0, count)
    .map(({ pixelId }) => pixelId);
}
