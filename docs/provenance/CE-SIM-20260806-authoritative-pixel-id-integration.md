# CE-SIM-20260806-authoritative-pixel-id-integration

## Task, scope, and authorization

- Date: 2026-08-06 (Europe/Rome).
- Objective: integrate the author-supplied physical pixel-ID assignment into
  the simulator, verify its structure and consistency with `pixbkg`, and make
  the assignment durable for existing browser configurations.
- Baseline revision: `11f944d3f18d240223155d0134e730b581583ed7`.
- Authorization: **AUTHOR-APPROVED** for saving the supplied `pixelId`
  assignment. The authorization covers identity only; it does not approve a
  new planar geometry, physical-model claim, push, deployment, publication, or
  manuscript change.
- Human gate decision: merge only the 126 `pixelId` values onto the current
  photo-aligned geometry. The 30 source records with coordinate differences
  are archived as input but are not applied.

## Inputs, versions, and integrity

- Author-supplied input:
  `/Users/basciani/Downloads/crystal-eye-pixel-configuration-3.json`.
- Durable byte-identical copy:
  `docs/provenance/inputs/CE-SIM-20260806-authoritative-pixel-ids.source.json`.
- Input size: 24,224 bytes.
- Input and archived-copy SHA-256:
  `39df72920ca9b4d6dc5c6cb75a04d3032c387d88e2bf6dbcec24625cbc2e8576`.
- Current geometry baseline:
  `app/data/crystal-eye-pixel-configuration.v1.json`, SHA-256
  `6631149e895aa005182504b7f1196b1301137425cbaae516152e5f8e3d27f36f`.
- Background dataset: `public/data/pixbkg.txt`, SHA-256
  `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d`.
- Derived runtime configuration:
  `app/data/crystal-eye-pixel-configuration.v2.json`, pre-validation SHA-256
  `ce8fe587a08b8eff41011a185150e9204f771eea48541b4f56e4eaf2885b8439`.
- Random seed: not applicable; copying, slotwise merge, validation, and tests
  are deterministic.

## Observed facts and verification criteria

- The source top level has exactly `version` and `pixels`; `version` is 2.
- It contains exactly 126 pixel records. Every record has exactly
  `pixelId`, `legacyAnnotation`, `x`, `y`, `isSeam`, `isPentagon`, and
  `rotationDeg`.
- All `pixelId` values are integers, unique, in range 0 through 125, and their
  sorted set is exactly `0..125`.
- `pixbkg` contains exactly 126 ordered records with the same exact ID domain
  `0..125`. Hashing the two sorted comma-separated ID sequences produced the
  same SHA-256:
  `45abc5fde639a2591d9ac213aa01f27d6d708f417eb33ed2726e080720fa168f`.
- Relative to the former slot-derived identity, all 126 geometry slots receive
  a different physical ID. For example, slots 0 through 6 map to
  `117, 118, 116, 124, 120, 115, 125`.
- The supplied source also differs from the current geometry in `x` and/or `y`
  at 30 slots. The maximum absolute source-versus-current difference is
  0.045681 percentage points in `x` and 0.053203 percentage points in `y`.
  These coordinate differences are outside the authorized scope and are not
  included in the derived runtime configuration.

## Implementation decision and behavior

1. Preserve the exact source as a provenance input instead of treating the
   Downloads path as durable.
2. Derive `crystal-eye-pixel-configuration.v2.json` slotwise: take only
   `pixelId` from the source and retain `x`, `y`, `isSeam`, `isPentagon`,
   `rotationDeg`, and the legacy annotation from the existing geometry.
3. Load the derived v2 file as `DEFAULT_PIXEL_CONFIGURATION`. Validation still
   fails closed unless the configuration has exactly 126 records, a bijection
   over integer IDs 0 through 125, the fixed seam contract, and one pentagon in
   each of the six 16-cell clusters.
4. Advance browser persistence from v3 to v4. A valid v4 record remains
   unchanged. A v3 record preserves its stored geometry, shape fields, and
   annotation at every slot while replacing only `pixelId` with the
   authoritative default assignment. Older v2/v1 records first receive the
   already approved photo geometry and then the authoritative IDs.
5. New editor saves target only the v4 key. Older keys are retained as fallback
   inputs and are not deleted.

## Files produced or modified

- Added exact source archive:
  `docs/provenance/inputs/CE-SIM-20260806-authoritative-pixel-ids.source.json`.
- Added derived runtime data:
  `app/data/crystal-eye-pixel-configuration.v2.json`.
- Updated default import, storage v4 constant, and pure identity migration:
  `app/lib/pixel-configuration.ts`.
- Updated browser load/save migration path: `app/page.tsx`.
- Added structural, geometry-preservation, ID-domain, `pixbkg`, and migration
  coverage: `tests/pixel-configuration.test.ts`.
- Added this execution record.

## Agents and tools

- `ce_coordinator`: authorization boundary and author decision relay.
- `simulator_engineer` task: input audit, scoped implementation, tests, and
  provenance record.
- Independent `quantitative_validator`: requested but unavailable because the
  collaboration thread limit had been reached. This remains a pending gate.
- Tools: Git, SHA-256, `cmp`, jq 1.7.1, awk, Node.js 24.14.0, npm, TypeScript
  test runner, ESLint, and Next.js build tooling.

## Commands and local results

```sh
cmp /Users/basciani/Downloads/crystal-eye-pixel-configuration-3.json \
  docs/provenance/inputs/CE-SIM-20260806-authoritative-pixel-ids.source.json
# PASS: no differences

jq '{version, count:(.pixels|length), unique_ids:(.pixels|map(.pixelId)|unique|length),
  min_id:(.pixels|map(.pixelId)|min), max_id:(.pixels|map(.pixelId)|max)}' \
  docs/provenance/inputs/CE-SIM-20260806-authoritative-pixel-ids.source.json
# version=2, count=126, unique_ids=126, min_id=0, max_id=125

export PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
npm test
# PASS: 34/34

npm run lint
# PASS

npm run build:pages
# PASS: compiled, TypeScript checked, and 5/5 static pages generated

git diff --check
# PASS
```

The slotwise comparison found 126/126 exact source-to-derived ID matches and
126/126 exact preservation of all non-identity fields from the current
geometry. All Node-based final gates used Node.js 24.14.0, satisfying the
declared `>=22.13.0` requirement. The shell's default Node.js 16.20.2 was
observed during an earlier metadata check but was not used for the reported
test, lint, or build results.

## Status, limits, and open gates

- Author-supplied file integrity, schema, record count, ID bijection, exact
  `pixbkg` ID-domain equality, slotwise merge, non-identity preservation, unit
  behavior, and local test suite: locally **VERIFIED**.
- The physical correctness of which hardware pixel occupies each geometry
  slot is **AUTHOR-APPROVED** input but is not independently
  **DOMAIN-VALIDATED**. The simulator records the authoritative assignment; it
  does not infer or measure it.
- Independent quantitative validation remains pending because no validator
  thread was available. Publication-grade use must not treat the local checks
  alone as satisfying that independent gate.
- Matching the `pixbkg` ID domain proves referential consistency and complete
  coverage; it does not independently prove the physical slot-to-ID mapping.
- No simulator physics, `pixbkg` values, photo geometry, `Materiale/`,
  `Appunti/`, manuscript, dependencies, dataset services, commit, push,
  deployment, or publication was changed.
