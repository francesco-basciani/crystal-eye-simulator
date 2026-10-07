import type {
  DecisionRecord,
  GatePredicates,
  GovernancePolicyStateDto,
  ObservationDto,
  PayloadTwinStateSnapshot,
  PredictionCommitment,
  PredictiveContextDto,
  QualificationPredicates,
  ReconciliationRecord,
  ScientificStateBundle,
  Treatment,
} from "./contracts.ts";
import { ScientificStateBundleRegistry } from "./bundle-registry.ts";
import { deepFreeze, deterministicFingerprint } from "./immutability.ts";
import {
  DecisionRecordStore,
  PayloadTwinStateStore,
  PredictionCommitmentStore,
  ReconciliationStore,
} from "./stores.ts";
import {
  validateGovernancePolicyStateDto,
  validateObservationDto,
  validatePredictiveContextDto,
} from "./validation.ts";

export function qualifyPayloadState(
  observation: unknown,
  bundle: ScientificStateBundle,
  previousState: PayloadTwinStateSnapshot | null,
): QualificationPredicates {
  const dtoValid = validateObservationDto(observation);
  if (!dtoValid) {
    return deepFreeze({
      dtoValid: false,
      identityConsistent: false,
      sequenceMonotonic: false,
      temporallyFresh: false,
      clockAcceptable: false,
      healthAcceptable: false,
      detectorShapeValid: false,
      bundleConsistent: false,
    });
  }
  return deepFreeze({
    dtoValid: true,
    identityConsistent: observation.payload.payloadId === bundle.payloadId
      && observation.payload.configurationId === bundle.configurationId,
    sequenceMonotonic: previousState === null
      || observation.payload.sequence > previousState.sequence,
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
  });
}

export function authorizeAction(predicates: GatePredicates): boolean {
  return Object.values(predicates).every(Boolean);
}

function predictionForContext(
  context: PredictiveContextDto,
  bundle: ScientificStateBundle,
  contextual: boolean,
): number[] {
  const count = contextual
    ? bundle.parameters.nominalBackgroundCountsPerPixel.value
      + bundle.parameters.contextualBackgroundSlopeCounts.value
        * context.normalizedBackgroundDriver
    : bundle.parameters.nominalBackgroundCountsPerPixel.value;
  return Array.from(
    { length: bundle.parameters.expectedPixelCount.value },
    () => Math.max(0, Math.round(count)),
  );
}

function validCommitmentFingerprint(commitment: PredictionCommitment): boolean {
  const { fingerprint: ignored, ...content } = commitment;
  void ignored;
  return deterministicFingerprint(content) === commitment.fingerprint;
}

export class DigitalTwinExperimentSut {
  readonly #treatment: Treatment;
  readonly #registry: ScientificStateBundleRegistry;
  readonly #fixedBundle: ScientificStateBundle;
  readonly #commitments = new PredictionCommitmentStore();
  readonly #decisions = new DecisionRecordStore();
  readonly #reconciliations = new ReconciliationStore();
  readonly #state = new PayloadTwinStateStore();

  constructor(
    treatment: Treatment,
    registry: ScientificStateBundleRegistry,
    fixedBundle: ScientificStateBundle,
  ) {
    this.#treatment = treatment;
    this.#registry = registry;
    this.#fixedBundle = deepFreeze(structuredClone(fixedBundle));
  }

  prepare(context: PredictiveContextDto, logicalNowMs: number): PredictionCommitment | null {
    if (this.#treatment !== "B2_GOVERNED_DT_PILOT") return null;
    if (!validatePredictiveContextDto(context)) {
      throw new TypeError("Invalid predictive context DTO.");
    }
    if (!Number.isFinite(logicalNowMs) || logicalNowMs >= context.targetStartMs) {
      throw new RangeError("Runtime logical time must precede the commitment target window.");
    }
    const bundleSnapshot = this.#registry.activeSnapshot();
    const content = {
      schemaId: "ce.prediction-commitment.pilot.v1" as const,
      commitmentId: `commitment-${context.payloadId}-${context.targetSequence}`,
      payloadId: context.payloadId,
      configurationId: context.configurationId,
      bundleId: bundleSnapshot.bundleId,
      bundleFingerprint: bundleSnapshot.fingerprint,
      targetSequence: context.targetSequence,
      createdAtMs: logicalNowMs,
      targetStartMs: context.targetStartMs,
      targetEndMs: context.targetEndMs,
      predictedBackgroundCounts: predictionForContext(context, bundleSnapshot, true),
      uncertaintyCounts: bundleSnapshot.parameters.predictionUncertaintyCounts,
    };
    return this.#commitments.append(deepFreeze({
      ...content,
      fingerprint: deterministicFingerprint(content),
    }));
  }

  process(
    observation: ObservationDto,
    suppliedCommitment?: PredictionCommitment | null,
    policyState?: GovernancePolicyStateDto,
  ): DecisionRecord {
    if (!validateGovernancePolicyStateDto(policyState)) {
      throw new TypeError("Invalid governance policy state DTO.");
    }
    const bundleSnapshot = this.#treatment === "B2_GOVERNED_DT_PILOT"
      ? this.#registry.activeSnapshot()
      : this.#fixedBundle;
    const previousState = this.#state.current();
    const qualification = qualifyPayloadState(observation, bundleSnapshot, previousState);
    if (!qualification.dtoValid) throw new TypeError("Invalid observation DTO.");
    const stateCandidate: PayloadTwinStateSnapshot = deepFreeze({
      schemaId: "ce.payload-twin-state.pilot.v1",
      payloadId: observation.payload.payloadId,
      configurationId: observation.payload.configurationId,
      sequence: observation.payload.sequence,
      eventTimeMs: observation.payload.eventTimeMs,
      healthScore: observation.payload.healthScore,
      activeBundleId: observation.payload.activeBundleId,
    });
    this.#state.synchronize(stateCandidate, qualification);
    const commitment = this.#treatment === "B2_GOVERNED_DT_PILOT"
      ? suppliedCommitment ?? this.#commitments.forTarget(observation.payload.sequence)
      : null;
    const predicted = commitment?.predictedBackgroundCounts
      ?? predictionForContext({
        schemaId: "ce.predictive-context.pilot.v1",
        payloadId: observation.payload.payloadId,
        configurationId: observation.payload.configurationId,
        targetSequence: observation.payload.sequence,
        predictionCreatedAtMs: observation.payload.eventTimeMs - 1,
        targetStartMs: observation.payload.eventTimeMs,
        targetEndMs: observation.payload.eventTimeMs + observation.detector.exposureMs,
        normalizedBackgroundDriver: observation.orbitContext.normalizedBackgroundDriver,
        expectedHealthScore: observation.payload.healthScore,
      }, bundleSnapshot, this.#treatment !== "B0_STATIC");
    const excess = observation.detector.pixelCounts.map(
      (count, index) => count - (predicted[index] ?? Number.POSITIVE_INFINITY),
    );
    const maximumExcess = Math.max(...excess);
    const candidateDetected = maximumExcess >= bundleSnapshot.parameters.triggerExcessCounts.value;
    const localizedPixelIndex = candidateDetected ? excess.indexOf(maximumExcess) : null;
    const gatePredicates: GatePredicates = deepFreeze({
      candidateDetected,
      stateQualified: Object.values(qualification).every(Boolean),
      bundleWithinValidity: observation.payload.eventTimeMs >= bundleSnapshot.validFromMs
        && observation.payload.eventTimeMs <= bundleSnapshot.validUntilMs,
      commitmentAvailable: commitment !== null,
      commitmentPrecedesWindow: commitment !== null
        && commitment.createdAtMs < commitment.targetStartMs,
      commitmentIntegrityValid: commitment !== null && validCommitmentFingerprint(commitment),
      commitmentMatchesEvent: commitment !== null
        && commitment.payloadId === observation.payload.payloadId
        && commitment.configurationId === observation.payload.configurationId
        && commitment.targetSequence === observation.payload.sequence
        && observation.payload.eventTimeMs >= commitment.targetStartMs
        && observation.payload.eventTimeMs <= commitment.targetEndMs,
      commitmentMatchesBundle: commitment !== null
        && commitment.bundleId === bundleSnapshot.bundleId
        && commitment.bundleFingerprint === bundleSnapshot.fingerprint,
      predictionUncertaintyAcceptable: commitment !== null
        && commitment.uncertaintyCounts.value
          <= bundleSnapshot.parameters.maximumPredictionUncertaintyCounts.value,
      globalFalseAlertPolicySatisfied:
        policyState.reconciledFalseAlertRatePerBackgroundSecond
          <= bundleSnapshot.parameters.maximumReconciledFalseAlertRatePerBackgroundSecond.value,
      downstreamPolicySatisfied: policyState.downstreamAvailable
        && policyState.downstreamQueueDepth
          <= bundleSnapshot.parameters.maximumDownstreamQueueDepth.value
        && policyState.stateTimeMs <= observation.payload.eventTimeMs
        && observation.payload.eventTimeMs - policyState.stateTimeMs
          <= bundleSnapshot.parameters.maximumFreshnessMs.value,
    });
    const actionAuthorized = this.#treatment === "B2_GOVERNED_DT_PILOT"
      ? authorizeAction(gatePredicates)
      : candidateDetected;
    const content = {
      schemaId: "ce.decision-record.pilot.v1" as const,
      decisionId: `decision-${this.#treatment}-${observation.payload.payloadId}-${observation.payload.sequence}`,
      treatment: this.#treatment,
      payloadId: observation.payload.payloadId,
      configurationId: observation.payload.configurationId,
      sequence: observation.payload.sequence,
      eventTimeMs: observation.payload.eventTimeMs,
      bundleId: bundleSnapshot.bundleId,
      bundleFingerprint: bundleSnapshot.fingerprint,
      commitmentId: commitment?.commitmentId ?? null,
      triggerExcessCounts: bundleSnapshot.parameters.triggerExcessCounts,
      policyState,
      predictedBackgroundCounts: [...predicted],
      observedCounts: [...observation.detector.pixelCounts],
      excessCounts: excess,
      candidateDetected,
      localizedPixelIndex,
      qualification,
      gatePredicates,
      actionAuthorized,
    };
    return this.#decisions.append(deepFreeze({
      ...content,
      decisionFingerprint: deterministicFingerprint(content),
    }));
  }

  reconcile(input: Omit<ReconciliationRecord, "schemaId" | "reconciliationId">): ReconciliationRecord {
    const decision = this.#decisions.list().find((record) => record.decisionId === input.decisionId);
    if (!decision) throw new Error(`Unknown decision ${input.decisionId}.`);
    if (input.receivedAtMs <= decision.eventTimeMs) {
      throw new RangeError("Reconciliation must occur after the decision event time.");
    }
    return this.#reconciliations.append({
      schemaId: "ce.reconciliation.pilot.v1",
      reconciliationId: `reconciliation-${input.decisionId}`,
      ...input,
    });
  }

  records() {
    return deepFreeze({
      commitments: this.#commitments.list(),
      decisions: this.#decisions.list(),
      reconciliations: this.#reconciliations.list(),
      synchronizations: this.#state.records(),
    });
  }
}
