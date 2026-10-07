import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createProvisionalScientificStateBundle,
  createProvisionalWorldParameters,
  DigitalTwinExperimentSut,
  generateWorldTrace,
  runDigitalTwinPilot,
  ScientificStateBundleRegistry,
  validateObservationDto,
} from "../app/lib/digital-twin-experiment/index.ts";
import { sha256Fingerprint, stableSerialize } from "../app/lib/digital-twin-experiment/immutability.ts";

const START_MS = Date.parse("2033-01-01T00:00:00Z");

function worldConfig(seed = 1234) {
  return {
    scenarioId: "test-world",
    plantSeed: seed,
    payloadId: "payload-1",
    configurationId: "configuration-1",
    activeBundleId: "bundle-1",
    startTimeMs: START_MS,
    modelFamily: "LINEAR_CONTEXT" as const,
    burstEnabled: true,
    observationFault: "NONE" as const,
    faultAtSequence: null,
    parameters: createProvisionalWorldParameters(),
  };
}

function bundle(id: string, version: number) {
  return createProvisionalScientificStateBundle({
    bundleId: id,
    version,
    payloadId: "payload-1",
    configurationId: "configuration-1",
    validFromMs: START_MS - 10_000,
    validUntilMs: START_MS + 1_000_000,
  });
}

function policyState(stateTimeMs = START_MS - 1) {
  return {
    schemaId: "ce.governance-policy-state.pilot.v1" as const,
    stateTimeMs,
    reconciledFalseAlertRatePerBackgroundSecond: 0,
    downstreamAvailable: true,
    downstreamQueueDepth: 0,
  };
}

function activationOptions(
  targetBundle: ReturnType<typeof bundle>,
  logicalTimeMs: number,
  boundaryId = "test-event-boundary",
  interruptBeforeCommit = false,
) {
  return {
    logicalTimeMs,
    authorityRecord: {
      schemaId: "ce.bundle-authority.pilot.v1" as const,
      authority: "PILOT_ONLY" as const,
      bundleId: targetBundle.bundleId,
      bundleFingerprint: targetBundle.fingerprint,
    },
    expectedPayloadId: targetBundle.payloadId,
    expectedConfigurationId: targetBundle.configurationId,
    eventBoundary: { boundaryId, kind: "BETWEEN_EVENTS" as const },
    interruptBeforeCommit,
  };
}

test("world traces replay deterministically while truth remains sealed", () => {
  const first = generateWorldTrace(worldConfig(72));
  const replay = generateWorldTrace(worldConfig(72));
  assert.deepEqual(first.observations, replay.observations);
  assert.deepEqual(first.predictiveContexts, replay.predictiveContexts);
  assert.match(first.publicTraceFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.publicTraceFingerprint, replay.publicTraceFingerprint);
  assert.deepEqual(Object.keys(first.sealedTruth).sort(), ["kind", "scenarioId"]);
  assert.ok(first.observations.every(validateObservationDto));
  assert.equal(JSON.stringify(first.observations).includes("burstPresent"), false);
  assert.equal(JSON.stringify(first.observations).includes("sourcePixel"), false);
  assert.equal(JSON.stringify(first.observations).includes("plantSeed"), false);
});

test("public trace SHA-256 matches the independent Node implementation", () => {
  const value = { observation: [1, 2, 3], schema: "pilot" };
  const expected = createHash("sha256").update(stableSerialize(value)).digest("hex");
  assert.equal(sha256Fingerprint(value), `sha256:${expected}`);
});

test("observation validation fails closed on a hidden truth property", () => {
  const observation = generateWorldTrace(worldConfig()).observations[0];
  assert.equal(validateObservationDto({ ...observation, truth: { burstPresent: true } }), false);
  assert.equal(validateObservationDto({
    ...observation,
    detector: { ...observation.detector, knownInjectedSource: true },
  }), false);
});

test("scientific bundles are immutable and activation is atomic under interruption", () => {
  const registry = new ScientificStateBundleRegistry();
  const first = bundle("bundle-1", 1);
  const second = bundle("bundle-2", 2);
  registry.register(first);
  registry.register(second);
  registry.activate(first.bundleId, activationOptions(first, START_MS - 100, "first-boundary"));
  const interrupted = registry.activate(
    second.bundleId,
    activationOptions(second, START_MS - 90, "interrupted-boundary", true),
  );
  assert.equal(interrupted.committed, false);
  assert.equal(interrupted.interruptionModel, "SIMULATED_BEFORE_COMMIT");
  assert.equal(registry.activeSnapshot().bundleId, first.bundleId);
  assert.equal(Object.isFrozen(registry.activeSnapshot()), true);
  registry.activate(second.bundleId, activationOptions(second, START_MS - 80, "second-boundary"));
  const rollback = registry.rollback(activationOptions(first, START_MS - 70, "rollback-boundary"));
  assert.equal(rollback.operation, "ROLLBACK");
  assert.equal(registry.activeSnapshot().bundleId, first.bundleId);
  assert.deepEqual(
    registry.transitions().map((transition) => transition.resultingBundleId),
    ["bundle-1", "bundle-1", "bundle-2", "bundle-1"],
  );
  assert.equal(rollback.authorityBundleId, first.bundleId);
  assert.equal(rollback.eventBoundaryId, "rollback-boundary");
});

test("activation requires validity, exact authority, expected identity, and event boundary", () => {
  const registry = new ScientificStateBundleRegistry();
  const target = bundle("guarded", 1);
  registry.register(target);
  assert.throws(
    () => registry.activate(target.bundleId, activationOptions(target, START_MS - 20_000)),
    /validity/,
  );
  const wrongAuthority = activationOptions(target, START_MS);
  assert.throws(() => registry.activate(target.bundleId, {
    ...wrongAuthority,
    authorityRecord: { ...wrongAuthority.authorityRecord, bundleId: "another-bundle" },
  }), /Authority record/);
  assert.throws(() => registry.activate(target.bundleId, {
    ...activationOptions(target, START_MS),
    expectedPayloadId: "another-payload",
  }), /identity/);
  assert.throws(() => registry.activate(target.bundleId, activationOptions(
    target,
    START_MS,
    "   ",
  )), /boundary/);
  const activated = registry.activate(
    target.bundleId,
    activationOptions(target, START_MS, "declared-boundary"),
  );
  assert.equal(activated.committed, true);
  assert.equal(activated.eventBoundaryKind, "BETWEEN_EVENTS");
});

test("rollback rejects the active bundle, invalid validity, and identity mismatch", () => {
  const sameRegistry = new ScientificStateBundleRegistry();
  const same = bundle("bundle-1", 1);
  sameRegistry.register(same);
  sameRegistry.activate(same.bundleId, activationOptions(same, START_MS - 100));
  sameRegistry.activate(same.bundleId, activationOptions(same, START_MS - 90));
  assert.throws(() => sameRegistry.rollback(activationOptions(same, START_MS)), /must differ/);

  const validityRegistry = new ScientificStateBundleRegistry();
  const expired = createProvisionalScientificStateBundle({
    bundleId: "expired", version: 1, payloadId: "payload-1",
    configurationId: "configuration-1", validFromMs: START_MS - 1000,
    validUntilMs: START_MS - 1,
  });
  const current = bundle("current", 2);
  validityRegistry.register(expired);
  validityRegistry.register(current);
  validityRegistry.activate(expired.bundleId, activationOptions(expired, START_MS - 100));
  validityRegistry.activate(current.bundleId, activationOptions(current, START_MS));
  assert.throws(
    () => validityRegistry.rollback(activationOptions(expired, START_MS)),
    /validity/,
  );

  const identityRegistry = new ScientificStateBundleRegistry();
  const original = bundle("original", 1);
  const differentIdentity = createProvisionalScientificStateBundle({
    bundleId: "different", version: 2, payloadId: "payload-2",
    configurationId: "configuration-2", validFromMs: START_MS - 1000,
    validUntilMs: START_MS + 1000,
  });
  identityRegistry.register(original);
  identityRegistry.register(differentIdentity);
  identityRegistry.activate(original.bundleId, activationOptions(original, START_MS - 100));
  identityRegistry.activate(
    differentIdentity.bundleId,
    activationOptions(differentIdentity, START_MS),
  );
  assert.throws(
    () => identityRegistry.rollback(activationOptions(original, START_MS)),
    /identity/,
  );
});

test("B2 freezes pre-window commitments, decisions, state transitions, and delayed reconciliation", () => {
  const registry = new ScientificStateBundleRegistry();
  const activeBundle = bundle("bundle-1", 1);
  registry.register(activeBundle);
  registry.activate(activeBundle.bundleId, activationOptions(activeBundle, START_MS - 100));
  const world = generateWorldTrace(worldConfig());
  const sut = new DigitalTwinExperimentSut("B2_GOVERNED_DT_PILOT", registry, activeBundle);
  const untrustedContextTimestamp = {
    ...world.predictiveContexts[0],
    predictionCreatedAtMs: world.predictiveContexts[0].targetStartMs + 10_000,
  };
  const commitment = sut.prepare(untrustedContextTimestamp, START_MS - 1_000);
  assert.ok(commitment);
  assert.equal(commitment.createdAtMs, START_MS - 1_000);
  assert.ok(commitment.createdAtMs < commitment.targetStartMs);
  assert.equal(Object.isFrozen(commitment), true);
  assert.throws(
    () => sut.prepare(world.predictiveContexts[1], world.predictiveContexts[1].targetStartMs),
    /must precede/,
  );
  assert.throws(
    () => sut.prepare(world.predictiveContexts[0], START_MS - 1_000),
    /already exists/,
  );
  const decision = sut.process(world.observations[0], commitment, policyState());
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(
    decision.actionAuthorized,
    Object.values(decision.gatePredicates).every(Boolean),
  );
  assert.equal(sut.records().synchronizations[0].accepted, true);
  const reconciliation = sut.reconcile({
    decisionId: decision.decisionId,
    outcome: "ACKNOWLEDGED",
    receivedAtMs: decision.eventTimeMs + 1,
    reason: "test acknowledgment",
  });
  assert.equal(Object.isFrozen(reconciliation), true);
  assert.throws(() => sut.reconcile({
    decisionId: decision.decisionId,
    outcome: "ACKNOWLEDGED",
    receivedAtMs: decision.eventTimeMs + 2,
    reason: "duplicate test acknowledgment",
  }), /already been reconciled/);
});

test("health qualification participates in synchronized twin state acceptance", () => {
  const registry = new ScientificStateBundleRegistry();
  const activeBundle = bundle("bundle-1", 1);
  registry.register(activeBundle);
  registry.activate(activeBundle.bundleId, activationOptions(activeBundle, START_MS - 100));
  const world = generateWorldTrace(worldConfig());
  const sut = new DigitalTwinExperimentSut("B2_GOVERNED_DT_PILOT", registry, activeBundle);
  const commitment = sut.prepare(world.predictiveContexts[0], START_MS - 1_000);
  const unhealthyObservation = {
    ...world.observations[0],
    payload: { ...world.observations[0].payload, healthScore: 0 },
  };
  const decision = sut.process(unhealthyObservation, commitment, policyState());
  assert.equal(decision.qualification.healthAcceptable, false);
  assert.equal(sut.records().synchronizations[0].accepted, false);
  assert.equal(decision.actionAuthorized, false);
});

test("B2 pilot gate includes uncertainty, global false alert, and downstream policies", () => {
  const registry = new ScientificStateBundleRegistry();
  const activeBundle = createProvisionalScientificStateBundle({
    bundleId: "bundle-1", version: 1, payloadId: "payload-1",
    configurationId: "configuration-1", validFromMs: START_MS - 10_000,
    validUntilMs: START_MS + 1_000_000, predictionUncertaintyCounts: 6,
    maximumPredictionUncertaintyCounts: 5,
  });
  registry.register(activeBundle);
  registry.activate(activeBundle.bundleId, activationOptions(activeBundle, START_MS - 100));
  const world = generateWorldTrace(worldConfig());
  const sut = new DigitalTwinExperimentSut("B2_GOVERNED_DT_PILOT", registry, activeBundle);
  const context = world.predictiveContexts[5];
  const commitment = sut.prepare(context, context.targetStartMs - 1_000);
  const decision = sut.process(world.observations[5], commitment, {
    ...policyState(context.targetStartMs - 1_000),
    reconciledFalseAlertRatePerBackgroundSecond: 1,
    downstreamAvailable: false,
    downstreamQueueDepth: 10,
  });
  assert.equal(decision.candidateDetected, true);
  assert.equal(decision.gatePredicates.predictionUncertaintyAcceptable, false);
  assert.equal(decision.gatePredicates.globalFalseAlertPolicySatisfied, false);
  assert.equal(decision.gatePredicates.downstreamPolicySatisfied, false);
  assert.equal(decision.actionAuthorized, false);
});

test("pilot runs paired B0, B1, and governed B2 traces across nominal and single faults", () => {
  const first = runDigitalTwinPilot();
  const replay = runDigitalTwinPilot();
  assert.deepEqual(first, replay);
  assert.equal(first.scenarios.length, 8);
  assert.equal(first.traces.length, 24);
  assert.ok(Object.values(first.worldModelParameters).every(
    (parameter) => parameter.status === "PROVISIONAL",
  ));
  assert.ok(Object.values(first.scientificStateBundle.parameters).every(
    (parameter) => parameter.status === "PROVISIONAL",
  ));
  assert.deepEqual(
    new Set(first.traces.map((trace) => trace.treatment)),
    new Set(["B0_STATIC", "B1_CONTEXTUAL_UNGOVERNED", "B2_GOVERNED_DT_PILOT"]),
  );
  assert.ok(first.traces.every(
    (trace) => trace.metrics.deterministicReexecutionEquivalent,
  ));
  assert.ok(first.traces.every((trace) => trace.metrics.boundedRecordReplayEquivalent));
  assert.ok(first.traces.every((trace) => trace.metrics.decisionFingerprintFailureCount === 0));
  assert.ok(first.traces
    .filter((trace) => trace.treatment === "B2_GOVERNED_DT_PILOT")
    .every((trace) => trace.metrics.gateFormulaConsistencyViolationCount === 0));
  assert.ok(first.traces
    .filter((trace) => trace.treatment === "B2_GOVERNED_DT_PILOT")
    .every((trace) => trace.commitmentCount === trace.decisionCount));
  for (const scenario of first.scenarios) {
    const fingerprints = new Set(first.traces
      .filter((trace) => trace.scenarioId === scenario.scenarioId)
      .map((trace) => trace.publicTraceFingerprint));
    assert.equal(fingerprints.size, 1, `${scenario.scenarioId} is not paired`);
    assert.match([...fingerprints][0], /^sha256:[0-9a-f]{64}$/);
  }
  assert.ok(first.traces.every((trace) =>
    trace.metrics.denominators.frameCount === trace.metrics.frameCount
    && trace.metrics.denominators.traceCount === 1));
  assert.ok(first.traces
    .filter((trace) => trace.treatment === "B2_GOVERNED_DT_PILOT")
    .every((trace) => trace.metrics.independentGateOracleMismatchCount === 0));
  for (const trace of first.traces) {
    const expectedBurstEvents = trace.scenarioId === "nominal-background" ? 0 : 1;
    assert.equal(trace.metrics.denominators.burstEventCount, expectedBurstEvents);
    assert.ok(trace.metrics.denominators.burstFrameCount >= expectedBurstEvents);
  }
});

test("governed B2 contains single observation and commitment faults while B1 remains ungoverned", () => {
  const report = runDigitalTwinPilot();
  for (const scenarioId of [
    "stale-state-burst",
    "configuration-mismatch-burst",
    "clock-uncertainty-burst",
    "detector-shape-burst",
    "commitment-integrity-burst",
  ]) {
    const b1 = report.traces.find(
      (trace) => trace.scenarioId === scenarioId
        && trace.treatment === "B1_CONTEXTUAL_UNGOVERNED",
    );
    const b2 = report.traces.find(
      (trace) => trace.scenarioId === scenarioId
        && trace.treatment === "B2_GOVERNED_DT_PILOT",
    );
    assert.ok(b1);
    assert.ok(b2);
    assert.ok(b1.metrics.authorizedBurstFrameCount >= b2.metrics.authorizedBurstFrameCount);
    assert.equal(b2.metrics.contractNonconformingAuthorizationCount, 0);
  }
});

test("pilot lifecycle preserves the active bundle on failure and restores it on rollback", () => {
  const lifecycle = runDigitalTwinPilot().lifecycle;
  assert.equal(lifecycle.interruptedActivationPreservedPreviousBundle, true);
  assert.equal(lifecycle.rollbackRestoredPreviousBundle, true);
  assert.ok(lifecycle.transitions.every(Object.isFrozen));
});

test("SUT has no dependency on the world simulator, truth vault, or plant seed", () => {
  const source = readFileSync(
    new URL("../app/lib/digital-twin-experiment/sut.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /world-simulator|truth-vault|plantSeed/);
});
