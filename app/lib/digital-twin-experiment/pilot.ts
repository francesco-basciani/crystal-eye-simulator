import type {
  DecisionRecord,
  GovernancePolicyStateDto,
  PredictionCommitment,
  ScientificStateBundle,
  Treatment,
} from "./contracts.ts";
import {
  createProvisionalScientificStateBundle,
  ScientificStateBundleRegistry,
  type ActivationOptions,
  type BundleTransitionRecord,
} from "./bundle-registry.ts";
import { evaluateTrace, type TraceMetrics } from "./evaluator.ts";
import { deepFreeze } from "./immutability.ts";
import { DigitalTwinExperimentSut } from "./sut.ts";
import {
  createProvisionalWorldParameters,
  generateWorldTrace,
  type ObservationFault,
  type WorldScenarioConfig,
  type WorldModelParameters,
} from "./world-simulator.ts";

export type PilotScenario = Readonly<{
  scenarioId: string;
  plantSeed: number;
  burstEnabled: boolean;
  modelFamily: WorldScenarioConfig["modelFamily"];
  observationFault: ObservationFault;
  faultAtSequence: number | null;
  corruptCommitmentAtSequence: number | null;
}>;

export type PilotTraceResult = Readonly<{
  scenarioId: string;
  treatment: Treatment;
  metrics: TraceMetrics;
  decisionCount: number;
  commitmentCount: number;
  synchronizationAcceptedCount: number;
  reconciliationCount: number;
  publicTraceFingerprint: string;
}>;

export type PilotReport = Readonly<{
  schemaId: "ce.digital-twin-pilot-report.v1";
  evidenceStatus: "PROVISIONAL";
  experimentScope: "SOFTWARE_ARCHITECTURE_PILOT_ONLY";
  scenarios: ReadonlyArray<PilotScenario>;
  worldModelParameters: WorldModelParameters;
  scientificStateBundle: ScientificStateBundle;
  traces: ReadonlyArray<PilotTraceResult>;
  lifecycle: Readonly<{
    interruptedActivationPreservedPreviousBundle: boolean;
    rollbackRestoredPreviousBundle: boolean;
    transitions: ReadonlyArray<BundleTransitionRecord>;
  }>;
}>;

const START_MS = Date.parse("2033-01-01T00:00:00Z");
const PAYLOAD_ID = "CE-PILOT-PAYLOAD";
const CONFIGURATION_ID = "CE-PILOT-CONFIG";
const BUNDLE_ONE_ID = "CE-PILOT-BUNDLE-1";

function activationOptions(
  bundle: ScientificStateBundle,
  logicalTimeMs: number,
  boundaryId: string,
  interruptBeforeCommit = false,
): ActivationOptions {
  return deepFreeze({
    logicalTimeMs,
    authorityRecord: {
      schemaId: "ce.bundle-authority.pilot.v1",
      authority: "PILOT_ONLY",
      bundleId: bundle.bundleId,
      bundleFingerprint: bundle.fingerprint,
    },
    expectedPayloadId: bundle.payloadId,
    expectedConfigurationId: bundle.configurationId,
    eventBoundary: { boundaryId, kind: "BETWEEN_EVENTS" },
    interruptBeforeCommit,
  });
}

export const PILOT_SCENARIOS: ReadonlyArray<PilotScenario> = deepFreeze([
  { scenarioId: "nominal-background", plantSeed: 1001, burstEnabled: false, modelFamily: "LINEAR_CONTEXT", observationFault: "NONE", faultAtSequence: null, corruptCommitmentAtSequence: null },
  { scenarioId: "nominal-burst", plantSeed: 1002, burstEnabled: true, modelFamily: "LINEAR_CONTEXT", observationFault: "NONE", faultAtSequence: null, corruptCommitmentAtSequence: null },
  { scenarioId: "held-out-model-burst", plantSeed: 1003, burstEnabled: true, modelFamily: "HELD_OUT_NONLINEAR_CONTEXT", observationFault: "NONE", faultAtSequence: null, corruptCommitmentAtSequence: null },
  { scenarioId: "stale-state-burst", plantSeed: 1004, burstEnabled: true, modelFamily: "LINEAR_CONTEXT", observationFault: "STALE_RECEIPT", faultAtSequence: 5, corruptCommitmentAtSequence: null },
  { scenarioId: "configuration-mismatch-burst", plantSeed: 1005, burstEnabled: true, modelFamily: "LINEAR_CONTEXT", observationFault: "CONFIGURATION_MISMATCH", faultAtSequence: 5, corruptCommitmentAtSequence: null },
  { scenarioId: "clock-uncertainty-burst", plantSeed: 1006, burstEnabled: true, modelFamily: "LINEAR_CONTEXT", observationFault: "HIGH_CLOCK_UNCERTAINTY", faultAtSequence: 5, corruptCommitmentAtSequence: null },
  { scenarioId: "detector-shape-burst", plantSeed: 1007, burstEnabled: true, modelFamily: "LINEAR_CONTEXT", observationFault: "PIXEL_TRUNCATION", faultAtSequence: 5, corruptCommitmentAtSequence: null },
  { scenarioId: "commitment-integrity-burst", plantSeed: 1008, burstEnabled: true, modelFamily: "LINEAR_CONTEXT", observationFault: "NONE", faultAtSequence: null, corruptCommitmentAtSequence: 5 },
]);

function createRegistry() {
  const registry = new ScientificStateBundleRegistry();
  const bundle = createProvisionalScientificStateBundle({
    bundleId: BUNDLE_ONE_ID,
    version: 1,
    payloadId: PAYLOAD_ID,
    configurationId: CONFIGURATION_ID,
    validFromMs: START_MS - 10_000,
    validUntilMs: START_MS + 1_000_000,
  });
  registry.register(bundle);
  registry.activate(bundle.bundleId, activationOptions(
    bundle,
    START_MS - 9_000,
    "pilot-initial-boundary",
  ));
  return { registry, bundle };
}

function scenarioConfig(
  scenario: PilotScenario,
  parameters: WorldModelParameters,
): WorldScenarioConfig {
  return deepFreeze({
    scenarioId: scenario.scenarioId,
    plantSeed: scenario.plantSeed,
    payloadId: PAYLOAD_ID,
    configurationId: CONFIGURATION_ID,
    activeBundleId: BUNDLE_ONE_ID,
    startTimeMs: START_MS,
    modelFamily: scenario.modelFamily,
    burstEnabled: scenario.burstEnabled,
    observationFault: scenario.observationFault,
    faultAtSequence: scenario.faultAtSequence,
    parameters,
  });
}

function corruptCommitment(commitment: PredictionCommitment): PredictionCommitment {
  return deepFreeze({
    ...commitment,
    predictedBackgroundCounts: commitment.predictedBackgroundCounts.map((count) => count + 1),
  });
}

function executeTrace(
  scenario: PilotScenario,
  world: ReturnType<typeof generateWorldTrace>,
  modelParameters: WorldModelParameters,
  treatment: Treatment,
): Readonly<{
  decisions: ReadonlyArray<DecisionRecord>;
  suppliedCommitments: ReadonlyArray<PredictionCommitment | null>;
  suppliedPolicyStates: ReadonlyArray<GovernancePolicyStateDto>;
  sut: DigitalTwinExperimentSut;
  bundle: ScientificStateBundle;
  world: ReturnType<typeof generateWorldTrace>;
}> {
  const { registry, bundle } = createRegistry();
  const sut = new DigitalTwinExperimentSut(treatment, registry, bundle);
  const decisions: DecisionRecord[] = [];
  const suppliedCommitments: Array<PredictionCommitment | null> = [];
  const suppliedPolicyStates: GovernancePolicyStateDto[] = [];
  for (let index = 0; index < world.observations.length; index += 1) {
    const runtimeLogicalNowMs = START_MS
      + index * modelParameters.frameIntervalMs.value
      - modelParameters.frameIntervalMs.value;
    const commitment = sut.prepare(world.predictiveContexts[index], runtimeLogicalNowMs);
    const supplied = commitment && scenario.corruptCommitmentAtSequence === index
      ? corruptCommitment(commitment)
      : commitment;
    suppliedCommitments.push(supplied);
    const policyState: GovernancePolicyStateDto = deepFreeze({
      schemaId: "ce.governance-policy-state.pilot.v1",
      stateTimeMs: runtimeLogicalNowMs,
      reconciledFalseAlertRatePerBackgroundSecond: 0,
      downstreamAvailable: true,
      downstreamQueueDepth: 0,
    });
    suppliedPolicyStates.push(policyState);
    decisions.push(sut.process(world.observations[index], supplied, policyState));
  }
  const lastAuthorized = [...decisions].reverse().find((record) => record.actionAuthorized);
  if (lastAuthorized) {
    sut.reconcile({
      decisionId: lastAuthorized.decisionId,
      outcome: "ACKNOWLEDGED",
      receivedAtMs: lastAuthorized.eventTimeMs + 10_000,
      reason: "synthetic follow-up acknowledgment for the architecture pilot",
    });
  }
  return deepFreeze({
    decisions,
    suppliedCommitments,
    suppliedPolicyStates,
    sut,
    bundle,
    world,
  });
}

function exerciseLifecycle() {
  const { registry, bundle } = createRegistry();
  const second = createProvisionalScientificStateBundle({
    bundleId: "CE-PILOT-BUNDLE-2",
    version: 2,
    payloadId: PAYLOAD_ID,
    configurationId: CONFIGURATION_ID,
    validFromMs: START_MS - 10_000,
    validUntilMs: START_MS + 1_000_000,
    triggerExcessCounts: 22,
  });
  registry.register(second);
  registry.activate(second.bundleId, activationOptions(
    second,
    START_MS - 9_000,
    "pilot-simulated-interruption-boundary",
    true,
  ));
  const preserved = registry.activeSnapshot().bundleId === bundle.bundleId;
  registry.activate(second.bundleId, activationOptions(
    second,
    START_MS - 8_000,
    "pilot-second-activation-boundary",
  ));
  registry.rollback(activationOptions(
    bundle,
    START_MS - 7_000,
    "pilot-rollback-boundary",
  ));
  return deepFreeze({
    interruptedActivationPreservedPreviousBundle: preserved,
    rollbackRestoredPreviousBundle: registry.activeSnapshot().bundleId === bundle.bundleId,
    transitions: registry.transitions(),
  });
}

export const PILOT_TREATMENTS: ReadonlyArray<Treatment> = deepFreeze([
    "B0_STATIC",
    "B1_CONTEXTUAL_UNGOVERNED",
    "B2_GOVERNED_DT_PILOT",
]);

export function runDigitalTwinPilot(
  treatments: ReadonlyArray<Treatment> = PILOT_TREATMENTS,
): PilotReport {
  if (treatments.length === 0 || new Set(treatments).size !== treatments.length) {
    throw new RangeError("Pilot treatments must be a non-empty set.");
  }
  const traces: PilotTraceResult[] = [];
  const worldModelParameters = createProvisionalWorldParameters();
  const materializedWorlds = PILOT_SCENARIOS.map((scenario) => ({
    scenario,
    world: generateWorldTrace(scenarioConfig(scenario, worldModelParameters)),
  }));
  for (const { scenario, world } of materializedWorlds) {
    for (const treatment of treatments) {
      const primary = executeTrace(scenario, world, worldModelParameters, treatment);
      const replay = executeTrace(scenario, world, worldModelParameters, treatment);
      const records = primary.sut.records();
      traces.push(deepFreeze({
        scenarioId: scenario.scenarioId,
        treatment,
        metrics: evaluateTrace({
          sealedTruth: primary.world.sealedTruth,
          observations: primary.world.observations,
          decisions: primary.decisions,
          replayDecisions: replay.decisions,
          commitments: primary.suppliedCommitments,
          policyStates: primary.suppliedPolicyStates,
          bundle: primary.bundle,
        }),
        decisionCount: records.decisions.length,
        commitmentCount: records.commitments.length,
        synchronizationAcceptedCount: records.synchronizations.filter((item) => item.accepted).length,
        reconciliationCount: records.reconciliations.length,
        publicTraceFingerprint: world.publicTraceFingerprint,
      }));
    }
  }
  return deepFreeze({
    schemaId: "ce.digital-twin-pilot-report.v1",
    evidenceStatus: "PROVISIONAL",
    experimentScope: "SOFTWARE_ARCHITECTURE_PILOT_ONLY",
    scenarios: PILOT_SCENARIOS,
    worldModelParameters,
    scientificStateBundle: createRegistry().bundle,
    traces,
    lifecycle: exerciseLifecycle(),
  });
}
