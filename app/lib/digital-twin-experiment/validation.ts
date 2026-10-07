import type {
  GovernancePolicyStateDto,
  ObservationDto,
  PredictiveContextDto,
  ScientificStateBundle,
} from "./contracts.ts";

const FORBIDDEN_OBSERVATION_KEYS = new Set([
  "truth",
  "groundTruth",
  "burstActive",
  "knownInjectedSource",
  "sourcePixel",
  "sourceDirection",
  "plantSeed",
  "seed",
]);

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenKey);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => FORBIDDEN_OBSERVATION_KEYS.has(key) || containsForbiddenKey(child),
  );
}

function hasExactKeys(value: object, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateObservationDto(value: unknown): value is ObservationDto {
  if (value === null || typeof value !== "object" || containsForbiddenKey(value)) return false;
  const candidate = value as Partial<ObservationDto>;
  if (!hasExactKeys(value, ["schemaId", "payload", "orbitContext", "detector"])) return false;
  if (candidate.schemaId !== "ce.observation.pilot.v1") return false;
  if (!candidate.payload || !hasExactKeys(candidate.payload, [
    "payloadId", "configurationId", "sequence", "eventTimeMs", "receivedTimeMs",
    "clockUncertaintyMs", "healthScore", "activeBundleId",
  ])) return false;
  if (!candidate.orbitContext || !hasExactKeys(candidate.orbitContext, ["normalizedBackgroundDriver"])) return false;
  if (!candidate.detector || !hasExactKeys(candidate.detector, ["exposureMs", "pixelCounts", "channelAvailability"])) return false;
  const payload = candidate.payload;
  const detector = candidate.detector;
  return typeof payload.payloadId === "string"
    && typeof payload.configurationId === "string"
    && Number.isSafeInteger(payload.sequence) && payload.sequence >= 0
    && finite(payload.eventTimeMs)
    && finite(payload.receivedTimeMs)
    && finite(payload.clockUncertaintyMs) && payload.clockUncertaintyMs >= 0
    && finite(payload.healthScore) && payload.healthScore >= 0 && payload.healthScore <= 1
    && typeof payload.activeBundleId === "string"
    && finite(candidate.orbitContext.normalizedBackgroundDriver)
    && finite(detector.exposureMs) && detector.exposureMs > 0
    && Array.isArray(detector.pixelCounts)
    && detector.pixelCounts.every((count) => Number.isSafeInteger(count) && count >= 0)
    && Array.isArray(detector.channelAvailability)
    && detector.channelAvailability.every((available) => typeof available === "boolean")
    && detector.pixelCounts.length === detector.channelAvailability.length;
}

export function validatePredictiveContextDto(value: unknown): value is PredictiveContextDto {
  if (value === null || typeof value !== "object" || containsForbiddenKey(value)) return false;
  if (!hasExactKeys(value, [
    "schemaId", "payloadId", "configurationId", "targetSequence", "predictionCreatedAtMs",
    "targetStartMs", "targetEndMs", "normalizedBackgroundDriver", "expectedHealthScore",
  ])) return false;
  const candidate = value as Partial<PredictiveContextDto>;
  return candidate.schemaId === "ce.predictive-context.pilot.v1"
    && typeof candidate.payloadId === "string"
    && typeof candidate.configurationId === "string"
    && Number.isSafeInteger(candidate.targetSequence) && (candidate.targetSequence ?? -1) >= 0
    && finite(candidate.predictionCreatedAtMs)
    && finite(candidate.targetStartMs)
    && finite(candidate.targetEndMs)
    && (candidate.targetStartMs ?? 1) <= (candidate.targetEndMs ?? 0)
    && finite(candidate.normalizedBackgroundDriver)
    && finite(candidate.expectedHealthScore)
    && (candidate.expectedHealthScore ?? -1) >= 0
    && (candidate.expectedHealthScore ?? 2) <= 1;
}

export function validateGovernancePolicyStateDto(
  value: unknown,
): value is GovernancePolicyStateDto {
  if (value === null || typeof value !== "object" || containsForbiddenKey(value)) return false;
  if (!hasExactKeys(value, [
    "schemaId", "stateTimeMs", "reconciledFalseAlertRatePerBackgroundSecond",
    "downstreamAvailable", "downstreamQueueDepth",
  ])) return false;
  const candidate = value as Partial<GovernancePolicyStateDto>;
  return candidate.schemaId === "ce.governance-policy-state.pilot.v1"
    && finite(candidate.stateTimeMs)
    && finite(candidate.reconciledFalseAlertRatePerBackgroundSecond)
    && (candidate.reconciledFalseAlertRatePerBackgroundSecond ?? -1) >= 0
    && typeof candidate.downstreamAvailable === "boolean"
    && Number.isSafeInteger(candidate.downstreamQueueDepth)
    && (candidate.downstreamQueueDepth ?? -1) >= 0;
}

export function validateBundle(bundle: ScientificStateBundle): void {
  if (bundle.schemaId !== "ce.scientific-state-bundle.pilot.v1") {
    throw new TypeError("Unsupported scientific state bundle schema.");
  }
  if (bundle.validFromMs > bundle.validUntilMs) {
    throw new RangeError("Bundle validity interval is inverted.");
  }
  const parameters = Object.values(bundle.parameters);
  if (parameters.some((parameter) => parameter.status !== "PROVISIONAL" || !Number.isFinite(parameter.value))) {
    throw new TypeError("Every pilot parameter must be finite and marked PROVISIONAL.");
  }
  if (!Number.isSafeInteger(bundle.parameters.expectedPixelCount.value)
    || bundle.parameters.expectedPixelCount.value <= 0) {
    throw new RangeError("Expected pixel count must be a positive integer.");
  }
}
