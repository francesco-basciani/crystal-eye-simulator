export const PROVISIONAL = "PROVISIONAL" as const;

export type ProvisionalParameter = Readonly<{
  value: number;
  unit: string;
  status: typeof PROVISIONAL;
  description: string;
}>;

export function provisional(
  value: number,
  unit: string,
  description: string,
): ProvisionalParameter {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Provisional parameter ${description} must be finite.`);
  }
  return Object.freeze({ value, unit, status: PROVISIONAL, description });
}

export type PayloadStateDto = Readonly<{
  payloadId: string;
  configurationId: string;
  sequence: number;
  eventTimeMs: number;
  receivedTimeMs: number;
  clockUncertaintyMs: number;
  healthScore: number;
  activeBundleId: string;
}>;

export type ObservationDto = Readonly<{
  schemaId: "ce.observation.pilot.v1";
  payload: PayloadStateDto;
  orbitContext: Readonly<{
    normalizedBackgroundDriver: number;
  }>;
  detector: Readonly<{
    exposureMs: number;
    pixelCounts: ReadonlyArray<number>;
    channelAvailability: ReadonlyArray<boolean>;
  }>;
}>;

export type PredictiveContextDto = Readonly<{
  schemaId: "ce.predictive-context.pilot.v1";
  payloadId: string;
  configurationId: string;
  targetSequence: number;
  predictionCreatedAtMs: number;
  targetStartMs: number;
  targetEndMs: number;
  normalizedBackgroundDriver: number;
  expectedHealthScore: number;
}>;

export type ScientificStateBundle = Readonly<{
  schemaId: "ce.scientific-state-bundle.pilot.v1";
  bundleId: string;
  version: number;
  payloadId: string;
  configurationId: string;
  evidenceStatus: typeof PROVISIONAL;
  localAuthorization: "PILOT_ONLY";
  validFromMs: number;
  validUntilMs: number;
  parameters: Readonly<{
    nominalBackgroundCountsPerPixel: ProvisionalParameter;
    contextualBackgroundSlopeCounts: ProvisionalParameter;
    predictionUncertaintyCounts: ProvisionalParameter;
    maximumPredictionUncertaintyCounts: ProvisionalParameter;
    triggerExcessCounts: ProvisionalParameter;
    maximumReconciledFalseAlertRatePerBackgroundSecond: ProvisionalParameter;
    maximumDownstreamQueueDepth: ProvisionalParameter;
    maximumFreshnessMs: ProvisionalParameter;
    maximumClockUncertaintyMs: ProvisionalParameter;
    minimumHealthScore: ProvisionalParameter;
    expectedPixelCount: ProvisionalParameter;
  }>;
  fingerprint: string;
}>;

export type PredictionCommitment = Readonly<{
  schemaId: "ce.prediction-commitment.pilot.v1";
  commitmentId: string;
  payloadId: string;
  configurationId: string;
  bundleId: string;
  bundleFingerprint: string;
  targetSequence: number;
  createdAtMs: number;
  targetStartMs: number;
  targetEndMs: number;
  predictedBackgroundCounts: ReadonlyArray<number>;
  uncertaintyCounts: ProvisionalParameter;
  fingerprint: string;
}>;

export type QualificationPredicates = Readonly<{
  dtoValid: boolean;
  identityConsistent: boolean;
  sequenceMonotonic: boolean;
  temporallyFresh: boolean;
  clockAcceptable: boolean;
  healthAcceptable: boolean;
  detectorShapeValid: boolean;
  bundleConsistent: boolean;
}>;

export type GatePredicates = Readonly<{
  candidateDetected: boolean;
  stateQualified: boolean;
  bundleWithinValidity: boolean;
  commitmentAvailable: boolean;
  commitmentPrecedesWindow: boolean;
  commitmentIntegrityValid: boolean;
  commitmentMatchesEvent: boolean;
  commitmentMatchesBundle: boolean;
  predictionUncertaintyAcceptable: boolean;
  globalFalseAlertPolicySatisfied: boolean;
  downstreamPolicySatisfied: boolean;
}>;

export type GovernancePolicyStateDto = Readonly<{
  schemaId: "ce.governance-policy-state.pilot.v1";
  stateTimeMs: number;
  reconciledFalseAlertRatePerBackgroundSecond: number;
  downstreamAvailable: boolean;
  downstreamQueueDepth: number;
}>;

export type Treatment = "B0_STATIC" | "B1_CONTEXTUAL_UNGOVERNED" | "B2_GOVERNED_DT_PILOT";

export type DecisionRecord = Readonly<{
  schemaId: "ce.decision-record.pilot.v1";
  decisionId: string;
  treatment: Treatment;
  payloadId: string;
  configurationId: string;
  sequence: number;
  eventTimeMs: number;
  bundleId: string;
  bundleFingerprint: string;
  commitmentId: string | null;
  triggerExcessCounts: ProvisionalParameter;
  policyState: GovernancePolicyStateDto;
  predictedBackgroundCounts: ReadonlyArray<number>;
  observedCounts: ReadonlyArray<number>;
  excessCounts: ReadonlyArray<number>;
  candidateDetected: boolean;
  localizedPixelIndex: number | null;
  qualification: QualificationPredicates;
  gatePredicates: GatePredicates;
  actionAuthorized: boolean;
  decisionFingerprint: string;
}>;

export type ReconciliationRecord = Readonly<{
  schemaId: "ce.reconciliation.pilot.v1";
  reconciliationId: string;
  decisionId: string;
  outcome: "ACKNOWLEDGED" | "REJECTED";
  receivedAtMs: number;
  reason: string;
}>;

export type PayloadTwinStateSnapshot = Readonly<{
  schemaId: "ce.payload-twin-state.pilot.v1";
  payloadId: string;
  configurationId: string;
  sequence: number;
  eventTimeMs: number;
  healthScore: number;
  activeBundleId: string;
}>;

export type SynchronizationRecord = Readonly<{
  schemaId: "ce.synchronization-record.pilot.v1";
  sequence: number;
  accepted: boolean;
  snapshot: PayloadTwinStateSnapshot | null;
}>;
