import {
  PROVISIONAL,
  provisional,
  type ScientificStateBundle,
} from "./contracts.ts";
import {
  AppendOnlyStore,
  deepFreeze,
  deterministicFingerprint,
} from "./immutability.ts";
import { validateBundle } from "./validation.ts";

export type BundleTransitionRecord = Readonly<{
  schemaId: "ce.bundle-transition.pilot.v1";
  transitionId: string;
  operation: "ACTIVATE" | "ROLLBACK";
  requestedBundleId: string;
  previousBundleId: string | null;
  resultingBundleId: string | null;
  committed: boolean;
  interruptedBeforeCommit: boolean;
  interruptionModel: "NONE" | "SIMULATED_BEFORE_COMMIT";
  authorityBundleId: string;
  eventBoundaryId: string;
  eventBoundaryKind: "BETWEEN_EVENTS";
  logicalTimeMs: number;
}>;

export type BundleAuthorityRecord = Readonly<{
  schemaId: "ce.bundle-authority.pilot.v1";
  authority: "PILOT_ONLY";
  bundleId: string;
  bundleFingerprint: string;
}>;

export type ActivationOptions = Readonly<{
  logicalTimeMs: number;
  authorityRecord: BundleAuthorityRecord;
  expectedPayloadId: string;
  expectedConfigurationId: string;
  eventBoundary: Readonly<{
    boundaryId: string;
    kind: "BETWEEN_EVENTS";
  }>;
  interruptBeforeCommit?: boolean;
}>;

export class ScientificStateBundleRegistry {
  readonly #bundles = new Map<string, ScientificStateBundle>();
  readonly #transitions = new AppendOnlyStore<BundleTransitionRecord>();
  readonly #committedActiveHistory: string[] = [];
  #activeBundleId: string | null = null;

  register(bundle: ScientificStateBundle): ScientificStateBundle {
    validateBundle(bundle);
    const { fingerprint: ignored, ...fingerprintedContent } = bundle;
    void ignored;
    if (deterministicFingerprint(fingerprintedContent) !== bundle.fingerprint) {
      throw new Error("Scientific state bundle fingerprint mismatch.");
    }
    if (this.#bundles.has(bundle.bundleId)) {
      throw new Error(`Bundle ${bundle.bundleId} is already registered.`);
    }
    const stored = deepFreeze(structuredClone(bundle));
    this.#bundles.set(stored.bundleId, stored);
    return stored;
  }

  activeSnapshot(): ScientificStateBundle {
    if (!this.#activeBundleId) throw new Error("No scientific state bundle is active.");
    return deepFreeze(structuredClone(this.#bundles.get(this.#activeBundleId)!));
  }

  transitions(): ReadonlyArray<BundleTransitionRecord> {
    return this.#transitions.list();
  }

  activate(bundleId: string, options: ActivationOptions): BundleTransitionRecord {
    const bundle = this.#bundles.get(bundleId);
    if (!bundle) throw new Error(`Unknown bundle ${bundleId}.`);
    this.#assertActivationGuards(bundle, options);
    return this.#commitActivePointer("ACTIVATE", bundleId, options);
  }

  rollback(options: ActivationOptions): BundleTransitionRecord {
    if (this.#committedActiveHistory.length < 2) {
      throw new Error("No previously active bundle is available for rollback.");
    }
    const target = this.#committedActiveHistory[this.#committedActiveHistory.length - 2];
    const active = this.activeSnapshot();
    const targetBundle = this.#bundles.get(target)!;
    this.#assertActivationGuards(targetBundle, options);
    if (target === active.bundleId) {
      throw new Error("Rollback target must differ from the active bundle.");
    }
    if (targetBundle.localAuthorization !== "PILOT_ONLY") {
      throw new Error("Rollback target is not authorized for this pilot.");
    }
    validateBundle(targetBundle);
    const { fingerprint: ignored, ...targetContent } = targetBundle;
    void ignored;
    if (deterministicFingerprint(targetContent) !== targetBundle.fingerprint) {
      throw new Error("Rollback target content is incomplete or has changed.");
    }
    if (options.logicalTimeMs < targetBundle.validFromMs
      || options.logicalTimeMs > targetBundle.validUntilMs) {
      throw new Error("Rollback target is outside its validity interval.");
    }
    if (targetBundle.payloadId !== active.payloadId
      || targetBundle.configurationId !== active.configurationId) {
      throw new Error("Rollback target has a different payload or configuration identity.");
    }
    return this.#commitActivePointer("ROLLBACK", target, options);
  }

  #assertActivationGuards(
    bundle: ScientificStateBundle,
    options: ActivationOptions,
  ): void {
    if (!Number.isFinite(options.logicalTimeMs)
      || options.logicalTimeMs < bundle.validFromMs
      || options.logicalTimeMs > bundle.validUntilMs) {
      throw new Error("Bundle activation is outside its validity interval.");
    }
    if (options.authorityRecord.schemaId !== "ce.bundle-authority.pilot.v1"
      || options.authorityRecord.authority !== "PILOT_ONLY"
      || options.authorityRecord.bundleId !== bundle.bundleId
      || options.authorityRecord.bundleFingerprint !== bundle.fingerprint) {
      throw new Error("Authority record does not authorize the exact bundle.");
    }
    if (options.expectedPayloadId !== bundle.payloadId
      || options.expectedConfigurationId !== bundle.configurationId) {
      throw new Error("Bundle activation identity does not match the expected payload configuration.");
    }
    if (options.eventBoundary.kind !== "BETWEEN_EVENTS"
      || options.eventBoundary.boundaryId.trim().length === 0) {
      throw new Error("Bundle activation requires a declared non-empty event boundary.");
    }
  }

  #commitActivePointer(
    operation: BundleTransitionRecord["operation"],
    requestedBundleId: string,
    options: ActivationOptions,
  ): BundleTransitionRecord {
    const previousBundleId = this.#activeBundleId;
    const interrupted = options.interruptBeforeCommit === true;
    if (!interrupted) {
      this.#activeBundleId = requestedBundleId;
      this.#committedActiveHistory.push(requestedBundleId);
    }
    return this.#transitions.append({
      schemaId: "ce.bundle-transition.pilot.v1",
      transitionId: `transition-${this.#transitions.list().length + 1}`,
      operation,
      requestedBundleId,
      previousBundleId,
      resultingBundleId: this.#activeBundleId,
      committed: !interrupted,
      interruptedBeforeCommit: interrupted,
      interruptionModel: interrupted ? "SIMULATED_BEFORE_COMMIT" : "NONE",
      authorityBundleId: options.authorityRecord.bundleId,
      eventBoundaryId: options.eventBoundary.boundaryId,
      eventBoundaryKind: options.eventBoundary.kind,
      logicalTimeMs: options.logicalTimeMs,
    });
  }
}

export function createProvisionalScientificStateBundle(input: Readonly<{
  bundleId: string;
  version: number;
  payloadId: string;
  configurationId: string;
  validFromMs: number;
  validUntilMs: number;
  nominalBackgroundCountsPerPixel?: number;
  contextualBackgroundSlopeCounts?: number;
  predictionUncertaintyCounts?: number;
  maximumPredictionUncertaintyCounts?: number;
  triggerExcessCounts?: number;
  maximumReconciledFalseAlertRatePerBackgroundSecond?: number;
  maximumDownstreamQueueDepth?: number;
  maximumFreshnessMs?: number;
  maximumClockUncertaintyMs?: number;
  minimumHealthScore?: number;
  expectedPixelCount?: number;
}>): ScientificStateBundle {
  const content = {
    schemaId: "ce.scientific-state-bundle.pilot.v1" as const,
    bundleId: input.bundleId,
    version: input.version,
    payloadId: input.payloadId,
    configurationId: input.configurationId,
    evidenceStatus: PROVISIONAL,
    localAuthorization: "PILOT_ONLY" as const,
    validFromMs: input.validFromMs,
    validUntilMs: input.validUntilMs,
    parameters: {
      nominalBackgroundCountsPerPixel: provisional(input.nominalBackgroundCountsPerPixel ?? 100, "counts/pixel/frame", "pilot nominal background"),
      contextualBackgroundSlopeCounts: provisional(input.contextualBackgroundSlopeCounts ?? 20, "counts/pixel/frame", "pilot contextual background slope"),
      predictionUncertaintyCounts: provisional(input.predictionUncertaintyCounts ?? 2, "counts", "pilot prediction uncertainty"),
      maximumPredictionUncertaintyCounts: provisional(input.maximumPredictionUncertaintyCounts ?? 5, "counts", "pilot prediction uncertainty gate"),
      triggerExcessCounts: provisional(input.triggerExcessCounts ?? 20, "counts", "pilot candidate threshold"),
      maximumReconciledFalseAlertRatePerBackgroundSecond: provisional(input.maximumReconciledFalseAlertRatePerBackgroundSecond ?? 0.1, "false alerts/background second", "pilot reconciled global false alert policy"),
      maximumDownstreamQueueDepth: provisional(input.maximumDownstreamQueueDepth ?? 4, "requests", "pilot downstream queue policy"),
      maximumFreshnessMs: provisional(input.maximumFreshnessMs ?? 2000, "ms", "pilot payload state freshness bound"),
      maximumClockUncertaintyMs: provisional(input.maximumClockUncertaintyMs ?? 100, "ms", "pilot clock uncertainty bound"),
      minimumHealthScore: provisional(input.minimumHealthScore ?? 0.8, "dimensionless", "pilot minimum payload health"),
      expectedPixelCount: provisional(input.expectedPixelCount ?? 8, "pixels", "pilot detector vector length"),
    },
  };
  return deepFreeze({ ...content, fingerprint: deterministicFingerprint(content) });
}
