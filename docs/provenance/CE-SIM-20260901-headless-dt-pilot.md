# CE SIM 20260901, headless Digital Twin software architecture pilot

## Record status

| Field | Value |
|---|---|
| Task date | 2026-09-01, Europe Rome |
| Task identifier | CE-SIM-20260901-headless-dt-pilot |
| Input software revision | `73ffa29bb73b859a4cc55f9f5ba4db90b4626aca` |
| Repository state before implementation | clean, branch `main`, tracking `github/main` |
| Repository state after implementation | modified working tree, no staged paths |
| Implementation status | implemented and tested locally |
| Scientific status | `PROVISIONAL` |
| Publication status | software architecture pilot only |

## Author decisions and scope

The author approved an entirely simulation based evaluation because Crystal Eye
is prototypal and direct flight experimentation is unavailable.  The approved
increment was a headless pilot with a private world model, truth free
observation interface, three treatments, a governed SUT configuration, and a
separate evaluator.

The implementation was restricted to the simulator repository.  `Materiale`,
`Appunti`, and the simulator user interface were not modified.  No dependency
was added.  The complete factorial design was not implemented.

All physical, temporal, uncertainty, policy, and fault parameters in the pilot
are marked `PROVISIONAL`.  They are engineering fixtures, not approved Crystal
Eye or NIMBUS values.

## Implemented artefacts

| Artefact | Purpose |
|---|---|
| `app/lib/digital-twin-experiment/contracts.ts` | DTO, bundle, commitment, gate, decision, reconciliation, and treatment contracts |
| `app/lib/digital-twin-experiment/world-simulator.ts` | deterministic synthetic world and paired public traces |
| `app/lib/digital-twin-experiment/truth-vault.ts` | module level sealed truth boundary |
| `app/lib/digital-twin-experiment/validation.ts` | strict runtime validation and rejection of explicit truth fields |
| `app/lib/digital-twin-experiment/sut.ts` | static, contextual ungoverned, and governed pilot treatments |
| `app/lib/digital-twin-experiment/bundle-registry.ts` | immutable bundles, guarded in memory activation, simulated interruption, and rollback |
| `app/lib/digital-twin-experiment/stores.ts` | append only in memory commitment, state, decision, and reconciliation stores |
| `app/lib/digital-twin-experiment/evaluator.ts` | event and frame denominators, separately implemented gate reconstruction, and bounded record replay |
| `app/lib/digital-twin-experiment/pilot.ts` | fixed pilot scenarios and paired execution harness |
| `scripts/run-digital-twin-experiment.ts` | command line runner and diagnostic local timing |
| `tests/digital-twin-experiment.test.ts` | focused contract, boundary, lifecycle, and runner tests |
| `package.json` | `experiment:digital-twin` command |

## Fixed pilot design

The runner materializes one immutable public trace for each scenario and reuses
it for `B0_STATIC`, `B1_CONTEXTUAL_UNGOVERNED`, and
`B2_GOVERNED_DT_PILOT`.  The public trace identity uses SHA 256 and is checked
against Node crypto in the test suite.

The fixed campaign contains eight scenarios, three treatments, 24 trace
results, 12 frames per trace, and 288 decision records.  Seven scenarios contain
one synthetic burst event spanning two frames.  One scenario contains only
background.  Observation and commitment faults are injected one at a time.

The synthetic truth records a private burst event identifier and source pixel.
Neither value, nor the plant seed, appears in the observation DTO supplied to
the SUT.  The SUT source has no direct import of the world simulator or truth
vault.

## Audit chronology

### Initial implementation

The initial implementation passed 8 focused tests and the then complete 148 test
suite.  The first independent quantitative audit returned `FAIL` for a claim of
a complete Digital Twin configuration.  The audit identified a circular gate
check, omission of health from state synchronization, regenerated traces without
a retained identity, frame denominators presented as burst events, a caller
controlled commitment timestamp, insufficient rollback guards, a bounded
reexecution presented as replay, and missing uncertainty and policy predicates.

The initial passing tests did not override that audit result.

### Quantitative repair

The repair added health to state synchronization, a harness supplied logical
commit time, one materialized SHA 256 identified trace per scenario, private
burst event identities, separate event and frame denominators, separately
implemented final gate reconstruction, explicit bounded record replay, rollback
guards, and provisional uncertainty, false alert, and downstream policy
predicates.  The treatment name changed from `B2_FULL_DT` to
`B2_GOVERNED_DT_PILOT`.

After this repair, 12 focused tests and the complete 152 test suite passed.  The
second independent quantitative audit returned `CONDITIONAL`.  It accepted the
implementation for claims limited to a software architecture pilot.  It did not
accept claims of physical efficacy, general fault containment, archival replay,
crash atomicity, operational latency, or general overhead.

### Lifecycle repair

The architecture audit found that the initial fixture activated a bundle before
its validity interval and that activation did not enforce all required guards.
The author approved one final repair limited to this finding.

The fixture activation now occurs inside the bundle validity interval.
Activation requires a pilot authority record that binds the exact bundle and
fingerprint, expected payload and configuration identities, and a nonempty
boundary declared as `BETWEEN_EVENTS`.  All guards execute before the active
pointer changes.  Transition records retain those bindings.  Rollback uses the
same guarded operation.

The final focused suite passed 13 of 13 tests.  The complete suite passed 153 of
153 tests.  The focused lifecycle audit returned `PASS` for the precise claim
of guarded in memory activation in the pilot.

## Commands and results

The commands used the bundled Node.js 24.19.0 runtime because the host default
Node.js 16.20.2 does not support `experimental-strip-types`.

```text
node --experimental-strip-types --test tests/digital-twin-experiment.test.ts
PASS, 13 tests

node node_modules/typescript/bin/tsc --noEmit
PASS

node node_modules/eslint/bin/eslint.js app/lib/digital-twin-experiment scripts/run-digital-twin-experiment.ts tests/digital-twin-experiment.test.ts
PASS

node --experimental-strip-types --test tests/*.test.ts
PASS, 153 tests

node --experimental-strip-types scripts/run-digital-twin-experiment.ts
PASS, 8 scenarios, 24 trace results, 288 decisions

git diff --check
PASS
```

The second quantitative auditor reported SHA 256
`5b0ef6526b19f93a1414508d4515c616f6ad9240881308a4ab5bd285672669c1`
for its audited runner output.  That output includes local diagnostic timing and
the hash is evidence for that execution only, not a stable scientific result.

## Canonical runner output

The stable runner output is retained at
`docs/evidence/digital-twin-pilot-canonical-20260901.json`.  It contains the
complete report, removes only `runnerMeasurement`, whose values depend on local
wall time, and sorts every JSON key recursively.  Its SHA 256 is
`07721ca052e13c8ba5daacbef2fbed9244720e630df9b7512bf5e4839fdc626b`.

From the simulator repository root, regenerate it with the following command,
using the bundled Node.js 24.19.0 executable recorded for this task:

```text
/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-digital-twin-experiment.ts | /usr/bin/jq -S 'del(.runnerMeasurement)' > docs/evidence/digital-twin-pilot-canonical-20260901.json
```

The regenerated byte stream was checked with `shasum -a 256` and matched the
retained identity above.

## Working tree identity and reconstruction boundary

The implementation starts from Git commit
`73ffa29bb73b859a4cc55f9f5ba4db90b4626aca` on branch `main`, tracking
`github/main`.  At closure, `package.json` is modified and the pilot module,
runner, test, canonical output, and this record are untracked.  `git diff
--cached --quiet` succeeds, so the Git index has not been modified.

The SHA 256 manifest is retained at
`docs/provenance/CE-20260901-pilot-paper-working-tree.sha256`.  Paths in the
manifest are relative to the workspace root and cover all new or modified pilot
and paper artefacts known to this task, except the manifest itself.  Self
inclusion is excluded because it would make the manifest hash recursive.

The manifest identifies the exact local contents but does not reconstruct the
noncommitted working tree by itself.  No commit, patch, archive, or public
replication package was created in this task.  Reproduction therefore requires
the base commit plus access to the identified local files.

## Verified claims

The evidence supports only the following claims.

1. A deterministic headless software architecture pilot executes three paired
   treatments over the same SHA 256 identified public traces.
2. Explicit plant truth fields are absent from the SUT observation DTO, and the
   SUT has no direct dependency on the truth vault.
3. The governed pilot commits predictions before target windows, qualifies the
   composite payload observation, applies a conjunctive provisional gate, and
   retains immutable records in memory.
4. A separately implemented evaluator reconstructs the final gate authorization
   for the exercised decisions.
5. Bounded record replay reconstructs only the detection, discrete pixel
   localization, and gate calculations retained in each decision record.
6. Guarded in memory activation checks validity, exact pilot authority, expected
   identity, and a declared event boundary before changing the active pointer.
7. A simulated interruption before pointer commit preserves the prior pointer,
   and guarded rollback restores the previous valid pointer in the exercised
   lifecycle trace.

## Explicitly unsupported claims

The evidence does not support physical burst discrimination or localization
performance, a general false alert rate, statistical fault containment,
operational safety, flight readiness, NIMBUS latency, architectural overhead,
durable persistence, crash recovery, concurrent activation, a complete bundle
lifecycle, mission authority, autonomous archival replay, or scientific
reconciliation.  It does not answer RQ1 or RQ2.

The module level truth boundary is not process isolation.  The evaluator shares
schema validation and fingerprint utilities with the SUT, so common
specification errors remain possible.  The logical clock, expected identity,
and event boundary are supplied by the harness.  `PILOT_ONLY` is not an
operational authority.

## Agents and tools

| Responsibility | Role |
|---|---|
| Coordination and evidence gates | `ce_coordinator` |
| Implementation and tests | `simulator_engineer` |
| Contract and lifecycle review | `dt_architect` |
| Quantitative audit | `quantitative_validator` |
| Tools | Git, Node.js, TypeScript, Node test runner, ESLint, SHA 256, and the headless runner |

## Outstanding human gates

Physics experts must validate the world model, detector response, background,
burst family, noise, units, uncertainty semantics, false alert policy, and the
meaning of downstream usefulness.  The author must approve every such model and
parameter after domain validation.

Mission stakeholders and the author must define operational authority, payload
and configuration identities, event boundaries, clock guarantees, persistence,
rollback policy, NIMBUS execution target, and latency budget before operational
claims are considered.
