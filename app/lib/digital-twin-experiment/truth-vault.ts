import { deepFreeze } from "./immutability.ts";

export type WorldTruthFrame = Readonly<{
  sequence: number;
  burstPresent: boolean;
  burstEventId: string | null;
  sourcePixelIndex: number | null;
  expectedBackgroundCounts: ReadonlyArray<number>;
}>;

export type WorldTruthTrace = Readonly<{
  scenarioId: string;
  modelFamily: "LINEAR_CONTEXT" | "HELD_OUT_NONLINEAR_CONTEXT";
  frames: ReadonlyArray<WorldTruthFrame>;
}>;

export type SealedTruthHandle = Readonly<{
  kind: "sealed-world-truth";
  scenarioId: string;
}>;

const truthByHandle = new WeakMap<object, WorldTruthTrace>();

export function sealWorldTruth(truth: WorldTruthTrace): SealedTruthHandle {
  const handle = Object.freeze({
    kind: "sealed-world-truth" as const,
    scenarioId: truth.scenarioId,
  });
  truthByHandle.set(handle, deepFreeze(structuredClone(truth)));
  return handle;
}

// Architectural boundary: this function is imported only by the independent evaluator.
export function revealWorldTruthForEvaluation(handle: SealedTruthHandle): WorldTruthTrace {
  const truth = truthByHandle.get(handle);
  if (!truth) {
    throw new Error("Unknown or expired sealed truth handle.");
  }
  return truth;
}
