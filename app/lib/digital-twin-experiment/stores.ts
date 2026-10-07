import type {
  DecisionRecord,
  PayloadTwinStateSnapshot,
  PredictionCommitment,
  QualificationPredicates,
  ReconciliationRecord,
  SynchronizationRecord,
} from "./contracts.ts";
import { AppendOnlyStore, deepFreeze } from "./immutability.ts";

export class PredictionCommitmentStore {
  readonly #store = new AppendOnlyStore<PredictionCommitment>();
  readonly #ids = new Set<string>();

  append(commitment: PredictionCommitment): PredictionCommitment {
    if (this.#ids.has(commitment.commitmentId)) {
      throw new Error(`Commitment ${commitment.commitmentId} already exists.`);
    }
    this.#ids.add(commitment.commitmentId);
    return this.#store.append(commitment);
  }

  forTarget(sequence: number): PredictionCommitment | null {
    return this.#store.list().find((record) => record.targetSequence === sequence) ?? null;
  }

  list(): ReadonlyArray<PredictionCommitment> {
    return this.#store.list();
  }
}

export class DecisionRecordStore {
  readonly #store = new AppendOnlyStore<DecisionRecord>();
  readonly #ids = new Set<string>();

  append(record: DecisionRecord): DecisionRecord {
    if (this.#ids.has(record.decisionId)) throw new Error(`Decision ${record.decisionId} already exists.`);
    this.#ids.add(record.decisionId);
    return this.#store.append(record);
  }

  list(): ReadonlyArray<DecisionRecord> {
    return this.#store.list();
  }
}

export class ReconciliationStore {
  readonly #store = new AppendOnlyStore<ReconciliationRecord>();
  readonly #decisionIds = new Set<string>();

  append(record: ReconciliationRecord): ReconciliationRecord {
    if (this.#decisionIds.has(record.decisionId)) {
      throw new Error(`Decision ${record.decisionId} has already been reconciled.`);
    }
    this.#decisionIds.add(record.decisionId);
    return this.#store.append(record);
  }

  list(): ReadonlyArray<ReconciliationRecord> {
    return this.#store.list();
  }
}

export class PayloadTwinStateStore {
  readonly #store = new AppendOnlyStore<SynchronizationRecord>();
  #current: PayloadTwinStateSnapshot | null = null;

  current(): PayloadTwinStateSnapshot | null {
    return this.#current ? deepFreeze(structuredClone(this.#current)) : null;
  }

  synchronize(
    candidate: PayloadTwinStateSnapshot,
    qualification: QualificationPredicates,
  ): SynchronizationRecord {
    const accepted = qualification.dtoValid
      && qualification.identityConsistent
      && qualification.sequenceMonotonic
      && qualification.temporallyFresh
      && qualification.clockAcceptable
      && qualification.healthAcceptable
      && qualification.detectorShapeValid
      && qualification.bundleConsistent;
    if (accepted) this.#current = deepFreeze(structuredClone(candidate));
    return this.#store.append({
      schemaId: "ce.synchronization-record.pilot.v1",
      sequence: candidate.sequence,
      accepted,
      snapshot: accepted ? this.#current : null,
    });
  }

  records(): ReadonlyArray<SynchronizationRecord> {
    return this.#store.list();
  }
}
