import type {
  DecisionRecord,
  GovernancePolicyStateDto,
  ObservationDto,
  PredictionCommitment,
  ScientificStateBundle,
  Treatment,
} from "./contracts.ts";
import { deterministicFingerprint, deepFreeze } from "./immutability.ts";
import {
  revealWorldTruthForEvaluation,
  type SealedTruthHandle,
} from "./truth-vault.ts";
import {
  validateGovernancePolicyStateDto,
  validateObservationDto,
} from "./validation.ts";

export type TraceMetrics = Readonly<{
  treatment: Treatment;
  denominators: Readonly<{
    traceCount: 1;
    frameCount: number;
    burstEventCount: number;
    burstFrameCount: number;
    backgroundFrameCount: number;
    backgroundExposureSeconds: number;
    localizedBurstFrameCandidateCount: number;
  }>;
  frameCount: number;
  burstFrameCount: number;
  backgroundFrameCount: number;
  truePositiveCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  trueNegativeCount: number;
  detectionRateOnBurstFrames: number | null;
  detectedBurstEventCount: number;
  authorizedBurstEventCount: number;
  burstEventDetectionRate: number | null;
  burstEventAuthorizationRate: number | null;
  falseAlertsPerBackgroundSecond: number | null;
  falsePositiveRatePerBackgroundFrame: number | null;
  localizationExactMatchRate: number | null;
  meanAbsolutePixelIndexError: number | null;
  meanAbsoluteBackgroundPredictionErrorCounts: number;
  authorizedActionCount: number;
  authorizedBurstFrameCount: number;
  contractNonconformingAuthorizationCount: number;
  gateFormulaConsistencyViolationCount: number;
  independentGateOracleMismatchCount: number | null;
  decisionFingerprintFailureCount: number;
  deterministicReexecutionEquivalent: boolean;
  boundedRecordReplayEquivalent: boolean;
}>;

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function recordFingerprintValid(record: DecisionRecord): boolean {
  const { decisionFingerprint: ignored, ...content } = record;
  void ignored;
  return deterministicFingerprint(content) === record.decisionFingerprint;
}

function boundedReplayRecord(record: DecisionRecord): boolean {
  if (record.observedCounts.length !== record.excessCounts.length
    || record.predictedBackgroundCounts.length < record.observedCounts.length) {
    return false;
  }
  const replayedExcess = record.observedCounts.map(
    (count, index) => count - record.predictedBackgroundCounts[index],
  );
  if (!replayedExcess.every((value, index) => value === record.excessCounts[index])) {
    return false;
  }
  const maximumExcess = Math.max(...replayedExcess);
  const candidateDetected = maximumExcess >= record.triggerExcessCounts.value;
  const localizedPixelIndex = candidateDetected ? replayedExcess.indexOf(maximumExcess) : null;
  const actionAuthorized = record.treatment === "B2_GOVERNED_DT_PILOT"
    ? Object.values(record.gatePredicates).every(Boolean)
    : candidateDetected;
  return candidateDetected === record.candidateDetected
    && localizedPixelIndex === record.localizedPixelIndex
    && actionAuthorized === record.actionAuthorized
    && recordFingerprintValid(record);
}

function commitmentFingerprintValid(commitment: PredictionCommitment): boolean {
  const { fingerprint: ignored, ...content } = commitment;
  void ignored;
  return deterministicFingerprint(content) === commitment.fingerprint;
}

function reconstructGateAuthorization(input: Readonly<{
  observation: ObservationDto;
  commitment: PredictionCommitment | null;
  bundle: ScientificStateBundle;
  policyState: GovernancePolicyStateDto;
  previousAcceptedSequence: number | null;
}>): Readonly<{ authorized: boolean; stateAccepted: boolean }> {
  const { observation, commitment, bundle, policyState } = input;
  const dtoValid = validateObservationDto(observation);
  const qualification = dtoValid ? {
    dtoValid,
    identityConsistent: observation.payload.payloadId === bundle.payloadId
      && observation.payload.configurationId === bundle.configurationId,
    sequenceMonotonic: input.previousAcceptedSequence === null
      || observation.payload.sequence > input.previousAcceptedSequence,
    temporallyFresh: observation.payload.receivedTimeMs >= observation.payload.eventTimeMs
      && observation.payload.receivedTimeMs - observation.payload.eventTimeMs
        <= bundle.parameters.maximumFreshnessMs.value,
    clockAcceptable: observation.payload.clockUncertaintyMs
      <= bundle.parameters.maximumClockUncertaintyMs.value,
    healthAcceptable: observation.payload.healthScore
      >= bundle.parameters.minimumHealthScore.value,
    detectorShapeValid: observation.detector.pixelCounts.length
      === bundle.parameters.expectedPixelCount.value
      && observation.detector.channelAvailability.every(Boolean),
    bundleConsistent: observation.payload.activeBundleId === bundle.bundleId,
  } : null;
  const stateAccepted = qualification !== null && Object.values(qualification).every(Boolean);
  const predicted = commitment?.predictedBackgroundCounts ?? [];
  const excess = observation.detector.pixelCounts.map(
    (count, index) => count - (predicted[index] ?? Number.POSITIVE_INFINITY),
  );
  const candidateDetected = excess.length > 0
    && Math.max(...excess) >= bundle.parameters.triggerExcessCounts.value;
  const policyValid = validateGovernancePolicyStateDto(policyState);
  const predicates = [
    candidateDetected,
    stateAccepted,
    observation.payload.eventTimeMs >= bundle.validFromMs
      && observation.payload.eventTimeMs <= bundle.validUntilMs,
    commitment !== null,
    commitment !== null && commitment.createdAtMs < commitment.targetStartMs,
    commitment !== null && commitmentFingerprintValid(commitment),
    commitment !== null
      && commitment.payloadId === observation.payload.payloadId
      && commitment.configurationId === observation.payload.configurationId
      && commitment.targetSequence === observation.payload.sequence
      && observation.payload.eventTimeMs >= commitment.targetStartMs
      && observation.payload.eventTimeMs <= commitment.targetEndMs,
    commitment !== null
      && commitment.bundleId === bundle.bundleId
      && commitment.bundleFingerprint === bundle.fingerprint,
    commitment !== null
      && commitment.uncertaintyCounts.value
        <= bundle.parameters.maximumPredictionUncertaintyCounts.value,
    policyValid
      && policyState.reconciledFalseAlertRatePerBackgroundSecond
        <= bundle.parameters.maximumReconciledFalseAlertRatePerBackgroundSecond.value,
    policyValid
      && policyState.downstreamAvailable
      && policyState.downstreamQueueDepth
        <= bundle.parameters.maximumDownstreamQueueDepth.value
      && policyState.stateTimeMs <= observation.payload.eventTimeMs
      && observation.payload.eventTimeMs - policyState.stateTimeMs
        <= bundle.parameters.maximumFreshnessMs.value,
  ];
  return deepFreeze({ authorized: predicates.every(Boolean), stateAccepted });
}

export function evaluateTrace(input: Readonly<{
  sealedTruth: SealedTruthHandle;
  observations: ReadonlyArray<ObservationDto>;
  decisions: ReadonlyArray<DecisionRecord>;
  replayDecisions: ReadonlyArray<DecisionRecord>;
  commitments: ReadonlyArray<PredictionCommitment | null>;
  policyStates: ReadonlyArray<GovernancePolicyStateDto>;
  bundle: ScientificStateBundle;
}>): TraceMetrics {
  const truth = revealWorldTruthForEvaluation(input.sealedTruth);
  if (truth.frames.length !== input.observations.length
    || truth.frames.length !== input.decisions.length
    || truth.frames.length !== input.commitments.length
    || truth.frames.length !== input.policyStates.length) {
    throw new RangeError("Truth and frozen evaluator inputs must have equal lengths.");
  }
  if (input.decisions.length === 0) throw new RangeError("Cannot evaluate an empty trace.");
  const treatment = input.decisions[0].treatment;
  let burstFrames = 0;
  let backgroundFrames = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let authorized = 0;
  let authorizedBurst = 0;
  let nonconformingAuthorization = 0;
  let gateFormulaConsistencyViolation = 0;
  let independentGateOracleMismatch = 0;
  let previousOracleAcceptedSequence: number | null = null;
  let fingerprintFailure = 0;
  let backgroundAbsoluteError = 0;
  let backgroundValueCount = 0;
  const localizationErrors: number[] = [];
  let backgroundExposureMs = 0;
  const burstEvents = new Map<string, { detected: boolean; authorized: boolean }>();

  for (let index = 0; index < truth.frames.length; index += 1) {
    const frame = truth.frames[index];
    const observation = input.observations[index];
    const decision = input.decisions[index];
    if (frame.sequence !== decision.sequence || frame.sequence !== observation.payload.sequence) {
      throw new Error("Trace sequence mismatch.");
    }
    if (frame.burstPresent) {
      if (!frame.burstEventId) throw new Error("Burst frame is missing its private event identifier.");
      const event = burstEvents.get(frame.burstEventId) ?? { detected: false, authorized: false };
      event.detected ||= decision.candidateDetected;
      event.authorized ||= decision.actionAuthorized;
      burstEvents.set(frame.burstEventId, event);
      burstFrames += 1;
      if (decision.candidateDetected) truePositive += 1;
      else falseNegative += 1;
      if (decision.candidateDetected
        && decision.localizedPixelIndex !== null
        && frame.sourcePixelIndex !== null) {
        localizationErrors.push(Math.abs(decision.localizedPixelIndex - frame.sourcePixelIndex));
      }
    } else {
      backgroundFrames += 1;
      backgroundExposureMs += observation.detector.exposureMs;
      if (decision.candidateDetected) falsePositive += 1;
      else trueNegative += 1;
    }
    if (decision.actionAuthorized) {
      authorized += 1;
      if (frame.burstPresent) authorizedBurst += 1;
      if (!Object.values(decision.gatePredicates).every(Boolean)) {
        nonconformingAuthorization += 1;
      }
    }
    const formulaAuthorization = Object.values(decision.gatePredicates).every(Boolean);
    if (decision.treatment === "B2_GOVERNED_DT_PILOT"
      && decision.actionAuthorized !== formulaAuthorization) {
      gateFormulaConsistencyViolation += 1;
    }
    if (decision.treatment === "B2_GOVERNED_DT_PILOT") {
      const commitment = input.commitments[index] ?? null;
      const oracle = reconstructGateAuthorization({
        observation,
        commitment,
        bundle: input.bundle,
        policyState: input.policyStates[index],
        previousAcceptedSequence: previousOracleAcceptedSequence,
      });
      if (oracle.stateAccepted) previousOracleAcceptedSequence = observation.payload.sequence;
      if (decision.actionAuthorized !== oracle.authorized) independentGateOracleMismatch += 1;
    }
    if (!recordFingerprintValid(decision)) fingerprintFailure += 1;
    for (let pixel = 0; pixel < frame.expectedBackgroundCounts.length; pixel += 1) {
      backgroundAbsoluteError += Math.abs(
        (decision.predictedBackgroundCounts[pixel] ?? Number.POSITIVE_INFINITY)
        - frame.expectedBackgroundCounts[pixel],
      );
      backgroundValueCount += 1;
    }
  }
  const deterministicReexecutionEquivalent = input.replayDecisions.length === input.decisions.length
    && input.replayDecisions.every(
      (record, index) => record.decisionFingerprint === input.decisions[index].decisionFingerprint,
    );
  const detectedBurstEvents = [...burstEvents.values()].filter((event) => event.detected).length;
  const authorizedBurstEvents = [...burstEvents.values()].filter((event) => event.authorized).length;
  return deepFreeze({
    treatment,
    denominators: {
      traceCount: 1,
      frameCount: truth.frames.length,
      burstEventCount: burstEvents.size,
      burstFrameCount: burstFrames,
      backgroundFrameCount: backgroundFrames,
      backgroundExposureSeconds: backgroundExposureMs / 1000,
      localizedBurstFrameCandidateCount: localizationErrors.length,
    },
    frameCount: truth.frames.length,
    burstFrameCount: burstFrames,
    backgroundFrameCount: backgroundFrames,
    truePositiveCount: truePositive,
    falsePositiveCount: falsePositive,
    falseNegativeCount: falseNegative,
    trueNegativeCount: trueNegative,
    detectionRateOnBurstFrames: ratio(truePositive, burstFrames),
    detectedBurstEventCount: detectedBurstEvents,
    authorizedBurstEventCount: authorizedBurstEvents,
    burstEventDetectionRate: ratio(detectedBurstEvents, burstEvents.size),
    burstEventAuthorizationRate: ratio(authorizedBurstEvents, burstEvents.size),
    falseAlertsPerBackgroundSecond: ratio(falsePositive, backgroundExposureMs / 1000),
    falsePositiveRatePerBackgroundFrame: ratio(falsePositive, backgroundFrames),
    localizationExactMatchRate: localizationErrors.length === 0
      ? null
      : ratio(localizationErrors.filter((error) => error === 0).length, localizationErrors.length),
    meanAbsolutePixelIndexError: localizationErrors.length === 0
      ? null
      : localizationErrors.reduce((sum, error) => sum + error, 0) / localizationErrors.length,
    meanAbsoluteBackgroundPredictionErrorCounts: backgroundAbsoluteError / backgroundValueCount,
    authorizedActionCount: authorized,
    authorizedBurstFrameCount: authorizedBurst,
    contractNonconformingAuthorizationCount: nonconformingAuthorization,
    gateFormulaConsistencyViolationCount: gateFormulaConsistencyViolation,
    independentGateOracleMismatchCount: treatment === "B2_GOVERNED_DT_PILOT"
      ? independentGateOracleMismatch
      : null,
    decisionFingerprintFailureCount: fingerprintFailure,
    deterministicReexecutionEquivalent,
    boundedRecordReplayEquivalent: input.decisions.every(boundedReplayRecord),
  });
}
