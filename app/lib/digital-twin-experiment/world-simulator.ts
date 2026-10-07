import {
  provisional,
  type ObservationDto,
  type PredictiveContextDto,
  type ProvisionalParameter,
} from "./contracts.ts";
import { deepFreeze, sha256Fingerprint } from "./immutability.ts";
import {
  sealWorldTruth,
  type SealedTruthHandle,
  type WorldTruthFrame,
} from "./truth-vault.ts";

export type ObservationFault =
  | "NONE"
  | "STALE_RECEIPT"
  | "CONFIGURATION_MISMATCH"
  | "HIGH_CLOCK_UNCERTAINTY"
  | "PIXEL_TRUNCATION";

export type WorldModelParameters = Readonly<{
  frameCount: ProvisionalParameter;
  pixelCount: ProvisionalParameter;
  frameIntervalMs: ProvisionalParameter;
  exposureMs: ProvisionalParameter;
  nominalBackgroundCountsPerPixel: ProvisionalParameter;
  backgroundContextAmplitudeCounts: ProvisionalParameter;
  observationPerturbationCounts: ProvisionalParameter;
  burstStartFrame: ProvisionalParameter;
  burstDurationFrames: ProvisionalParameter;
  burstAmplitudeCounts: ProvisionalParameter;
  burstSourcePixelIndex: ProvisionalParameter;
  nominalClockUncertaintyMs: ProvisionalParameter;
  nominalTransportDelayMs: ProvisionalParameter;
  injectedStaleDelayMs: ProvisionalParameter;
  injectedClockUncertaintyMs: ProvisionalParameter;
  nominalHealthScore: ProvisionalParameter;
}>;

export type WorldScenarioConfig = Readonly<{
  scenarioId: string;
  plantSeed: number;
  payloadId: string;
  configurationId: string;
  activeBundleId: string;
  startTimeMs: number;
  modelFamily: "LINEAR_CONTEXT" | "HELD_OUT_NONLINEAR_CONTEXT";
  burstEnabled: boolean;
  observationFault: ObservationFault;
  faultAtSequence: number | null;
  parameters: WorldModelParameters;
}>;

export type GeneratedWorldTrace = Readonly<{
  scenarioId: string;
  predictiveContexts: ReadonlyArray<PredictiveContextDto>;
  observations: ReadonlyArray<ObservationDto>;
  publicTraceFingerprint: string;
  sealedTruth: SealedTruthHandle;
}>;

function assertIntegerParameter(parameter: ProvisionalParameter, minimum: number): number {
  if (parameter.status !== "PROVISIONAL"
    || !Number.isSafeInteger(parameter.value)
    || parameter.value < minimum) {
    throw new RangeError(`${parameter.description} must be a PROVISIONAL integer >= ${minimum}.`);
  }
  return parameter.value;
}

function createPlantRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("Plant seed must be a safe integer.");
  }
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function backgroundDriver(sequence: number, frameCount: number): number {
  if (frameCount === 1) return 0;
  return -1 + (2 * sequence) / (frameCount - 1);
}

function contextualContribution(
  driver: number,
  amplitude: number,
  family: WorldScenarioConfig["modelFamily"],
): number {
  if (family === "LINEAR_CONTEXT") return amplitude * driver;
  return amplitude * Math.sign(driver) * driver * driver;
}

function applyObservationFault(
  observation: ObservationDto,
  fault: ObservationFault,
  parameters: WorldModelParameters,
): ObservationDto {
  if (fault === "NONE") return observation;
  if (fault === "STALE_RECEIPT") {
    return deepFreeze({
      ...observation,
      payload: {
        ...observation.payload,
        receivedTimeMs: observation.payload.eventTimeMs + parameters.injectedStaleDelayMs.value,
      },
    });
  }
  if (fault === "CONFIGURATION_MISMATCH") {
    return deepFreeze({
      ...observation,
      payload: { ...observation.payload, configurationId: `${observation.payload.configurationId}-fault` },
    });
  }
  if (fault === "HIGH_CLOCK_UNCERTAINTY") {
    return deepFreeze({
      ...observation,
      payload: {
        ...observation.payload,
        clockUncertaintyMs: parameters.injectedClockUncertaintyMs.value,
      },
    });
  }
  return deepFreeze({
    ...observation,
    detector: {
      ...observation.detector,
      pixelCounts: observation.detector.pixelCounts.slice(0, -1),
      channelAvailability: observation.detector.channelAvailability.slice(0, -1),
    },
  });
}

export function generateWorldTrace(config: WorldScenarioConfig): GeneratedWorldTrace {
  const frameCount = assertIntegerParameter(config.parameters.frameCount, 1);
  const pixelCount = assertIntegerParameter(config.parameters.pixelCount, 1);
  const intervalMs = assertIntegerParameter(config.parameters.frameIntervalMs, 1);
  const burstStart = assertIntegerParameter(config.parameters.burstStartFrame, 0);
  const burstDuration = assertIntegerParameter(config.parameters.burstDurationFrames, 1);
  const sourcePixel = assertIntegerParameter(config.parameters.burstSourcePixelIndex, 0);
  if (sourcePixel >= pixelCount) throw new RangeError("Burst source pixel lies outside the detector vector.");
  for (const parameter of Object.values(config.parameters)) {
    if (parameter.status !== "PROVISIONAL" || !Number.isFinite(parameter.value)) {
      throw new TypeError("World model parameters must be finite and marked PROVISIONAL.");
    }
  }
  const random = createPlantRandom(config.plantSeed);
  const observations: ObservationDto[] = [];
  const predictiveContexts: PredictiveContextDto[] = [];
  const truthFrames: WorldTruthFrame[] = [];
  for (let sequence = 0; sequence < frameCount; sequence += 1) {
    const eventTimeMs = config.startTimeMs + sequence * intervalMs;
    const driver = backgroundDriver(sequence, frameCount);
    const expectedBackground = Math.max(0, Math.round(
      config.parameters.nominalBackgroundCountsPerPixel.value
      + contextualContribution(
        driver,
        config.parameters.backgroundContextAmplitudeCounts.value,
        config.modelFamily,
      ),
    ));
    const burstPresent = config.burstEnabled
      && sequence >= burstStart
      && sequence < burstStart + burstDuration;
    const counts = Array.from({ length: pixelCount }, (_, pixelIndex) => {
      const perturbation = Math.round(
        (random() * 2 - 1) * config.parameters.observationPerturbationCounts.value,
      );
      const burstContribution = burstPresent && pixelIndex === sourcePixel
        ? config.parameters.burstAmplitudeCounts.value
        : 0;
      return Math.max(0, Math.round(expectedBackground + perturbation + burstContribution));
    });
    predictiveContexts.push(deepFreeze({
      schemaId: "ce.predictive-context.pilot.v1" as const,
      payloadId: config.payloadId,
      configurationId: config.configurationId,
      targetSequence: sequence,
      predictionCreatedAtMs: eventTimeMs - intervalMs,
      targetStartMs: eventTimeMs,
      targetEndMs: eventTimeMs + config.parameters.exposureMs.value,
      normalizedBackgroundDriver: driver,
      expectedHealthScore: config.parameters.nominalHealthScore.value,
    }));
    const nominalObservation: ObservationDto = deepFreeze({
      schemaId: "ce.observation.pilot.v1" as const,
      payload: {
        payloadId: config.payloadId,
        configurationId: config.configurationId,
        sequence,
        eventTimeMs,
        receivedTimeMs: eventTimeMs + config.parameters.nominalTransportDelayMs.value,
        clockUncertaintyMs: config.parameters.nominalClockUncertaintyMs.value,
        healthScore: config.parameters.nominalHealthScore.value,
        activeBundleId: config.activeBundleId,
      },
      orbitContext: { normalizedBackgroundDriver: driver },
      detector: {
        exposureMs: config.parameters.exposureMs.value,
        pixelCounts: counts,
        channelAvailability: Array.from({ length: pixelCount }, () => true),
      },
    });
    observations.push(
      config.faultAtSequence === sequence
        ? applyObservationFault(nominalObservation, config.observationFault, config.parameters)
        : nominalObservation,
    );
    truthFrames.push(deepFreeze({
      sequence,
      burstPresent,
      burstEventId: burstPresent ? `${config.scenarioId}-burst-1` : null,
      sourcePixelIndex: burstPresent ? sourcePixel : null,
      expectedBackgroundCounts: Array.from({ length: pixelCount }, () => expectedBackground),
    }));
  }
  const publicTrace = { predictiveContexts, observations };
  return deepFreeze({
    scenarioId: config.scenarioId,
    ...publicTrace,
    publicTraceFingerprint: sha256Fingerprint(publicTrace),
    sealedTruth: sealWorldTruth({
      scenarioId: config.scenarioId,
      modelFamily: config.modelFamily,
      frames: truthFrames,
    }),
  });
}

export function createProvisionalWorldParameters(
  overrides: Partial<Record<keyof WorldModelParameters, number>> = {},
): WorldModelParameters {
  const value = (key: keyof WorldModelParameters, fallback: number) => overrides[key] ?? fallback;
  return deepFreeze({
    frameCount: provisional(value("frameCount", 12), "frames", "pilot trace length"),
    pixelCount: provisional(value("pixelCount", 8), "pixels", "synthetic detector vector length"),
    frameIntervalMs: provisional(value("frameIntervalMs", 1000), "ms", "synthetic frame cadence"),
    exposureMs: provisional(value("exposureMs", 500), "ms", "synthetic frame exposure"),
    nominalBackgroundCountsPerPixel: provisional(value("nominalBackgroundCountsPerPixel", 100), "counts/pixel/frame", "synthetic nominal background"),
    backgroundContextAmplitudeCounts: provisional(value("backgroundContextAmplitudeCounts", 20), "counts/pixel/frame", "synthetic context effect amplitude"),
    observationPerturbationCounts: provisional(value("observationPerturbationCounts", 2), "counts/pixel/frame", "bounded synthetic observation perturbation"),
    burstStartFrame: provisional(value("burstStartFrame", 5), "frame index", "synthetic burst onset"),
    burstDurationFrames: provisional(value("burstDurationFrames", 2), "frames", "synthetic burst duration"),
    burstAmplitudeCounts: provisional(value("burstAmplitudeCounts", 35), "counts/pixel/frame", "synthetic burst contribution"),
    burstSourcePixelIndex: provisional(value("burstSourcePixelIndex", 3), "pixel index", "synthetic burst source pixel"),
    nominalClockUncertaintyMs: provisional(value("nominalClockUncertaintyMs", 1), "ms", "synthetic nominal clock uncertainty"),
    nominalTransportDelayMs: provisional(value("nominalTransportDelayMs", 1), "ms", "synthetic nominal observation transport delay"),
    injectedStaleDelayMs: provisional(value("injectedStaleDelayMs", 60_000), "ms", "synthetic stale observation delay"),
    injectedClockUncertaintyMs: provisional(value("injectedClockUncertaintyMs", 60_000), "ms", "synthetic high clock uncertainty fault"),
    nominalHealthScore: provisional(value("nominalHealthScore", 1), "dimensionless", "synthetic payload health score"),
  });
}
