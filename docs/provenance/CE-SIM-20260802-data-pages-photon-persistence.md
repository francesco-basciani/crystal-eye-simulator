# CE-SIM-20260802-data-pages-photon-persistence

## Task, authorization, and scope

- Date: 2026-08-02 (Europe/Rome).
- Task identifier: `CE-SIM-20260802-data-pages-photon-persistence`.
- Objective: provide static, client-side Ephemeris and Photon History pages and
  replace unbounded in-memory photon history with bounded chart state plus
  durable browser-local records.
- Baseline simulator revision: `9f135e685a88106d75a7c65219344994bce5c48f`;
  the pre-existing uncommitted ECI integration was preserved as task input.
- Authorization: the route, storage schema, query contract, failure behavior,
  navigation, and acceptance criteria were explicitly **AUTHOR-APPROVED** on
  2026-08-02 through the `ce_coordinator`.
- Exclusions: no retention or automatic deletion, dependency, external
  service, scientific-model change, manuscript edit, deployment, commit, or
  publication was authorized or performed.

## Requirements and acceptance evidence

1. **Static data routes and common navigation.** `app/ephemeris/page.tsx` and
   `app/photon-history/page.tsx` are client pages reached at `/ephemeris/` and
   `/photon-history/`. `app/components/app-nav.tsx` uses
   `NEXT_PUBLIC_BASE_PATH` and trailing-slash links for Simulator, Ephemeris,
   and Photon History. The GitHub Pages static build emitted both route
   directories with `index.html`.
2. **Ephemeris query without dataset duplication.** The page calls the
   existing validated `loadEciEphemerisProfile` with the base-path-prefixed TSV
   URL. `app/lib/ephemeris-query.ts` binary-searches the ordered record array
   for inclusive UTC bounds and returns only the requested 100-record page.
   Search covers normalized UTC text and every displayed vector value.
3. **Durable photon records.** `app/lib/photon-repository.ts` opens native
   IndexedDB database `crystal-eye-simulator`, version 1, with auto-increment
   key-path `id` in store `photonRecords`. Compound indexes are
   `bySimulatedAt = [simulatedAtMs, id]` and unique
   `byRunBin = [runId, bin]`. Each asynchronous append resolves only after the
   read/write transaction completes.
4. **Bounded twin/UI state.** `app/page.tsx` retains at most 120 photon samples
   for the live graph and a numeric persisted-record counter. It does not keep
   the acquisition archive in React state. Reset sets bin zero and creates a
   new run identifier without deleting any previous record.
5. **UTC query and stable paging.** Photon History uses the reverse
   `bySimulatedAt` compound cursor and an exclusive `(simulatedAtMs, id)`
   keyset cursor. Filters are inclusive and pages contain at most 100 rows.
   Tests exercise equal timestamps at a page boundary and reproduce all IDs
   without a gap or duplicate.
6. **Truthful degraded mode.** IndexedDB open, quota, transaction, or write
   errors stop persistence but not simulation. The simulator continues its
   120-sample volatile graph window and exposes a `NOT PERSISTING` alert with
   the storage error. No retention or hidden deletion is implemented.
7. **Basic accessibility.** Navigation is labelled and exposes
   `aria-current`; filter controls have labels; tables have captions and
   header scopes; loading/error state uses status/alert roles; keyboard focus
   styles and reduced-width layouts are retained.

## Files produced or modified

- `app/components/app-nav.tsx`: shared base-path-compatible navigation.
- `app/ephemeris/page.tsx`: static client ephemeris view.
- `app/photon-history/page.tsx`: static client IndexedDB history view.
- `app/lib/ephemeris-query.ts`: binary-bound/filter/page query service.
- `app/lib/photon-repository.ts`: IndexedDB schema, append, count, and keyset
  query repository.
- `app/page.tsx`: navigation, durable append wiring, bounded graph window,
  run reset, counter, and degraded-mode banner.
- `app/globals.css`: shared navigation/data-page/persistence-state styles.
- `tests/ephemeris-query.test.ts`: inclusive filters, paging, and search.
- `tests/photon-repository.test.ts`: transaction, uniqueness, compound-keyset
  query, and unavailable-storage behavior.
- This execution record.

No files under `Materiale/` or `Appunti/` were read or modified.

## Agents, tools, inputs, and versions

- Coordination and approved contract: `ce_coordinator`.
- Implementation and verification: `simulator_engineer` subtask.
- Inputs: existing simulator code; existing canonical
  `public/data/eci-ephemeris-2033.tsv`; existing ECI loader and tests.
- External sources or datasets added: none.
- New dependencies or services: none; native browser IndexedDB is used.
- Tools: Git status/diff, `rg`, `apply_patch`, Node test runner, TypeScript,
  ESLint, and Next.js static build.
- Verification runtime: Node 22.19.0, satisfying repository requirement
  `>=22.13.0`.
- Randomness: run IDs use browser `crypto.randomUUID()` when available, with a
  timestamp/random fallback. They identify acquisition runs and do not affect
  the scientific simulation or query ordering.

## Commands and results

```sh
npx --yes node@22.19.0 --experimental-strip-types --test tests/*.test.ts
# PASS: 16/16 tests

npx --yes node@22.19.0 node_modules/typescript/bin/tsc \
  --noEmit --allowImportingTsExtensions --incremental false
# PASS

npx --yes node@22.19.0 node_modules/eslint/bin/eslint.js . \
  --ignore-pattern dist --ignore-pattern .next
# PASS

GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/crystal-eye-simulator \
  npx --yes node@22.19.0 node_modules/next/dist/bin/next build
# PASS: /, /ephemeris, and /photon-history statically prerendered;
# out/ephemeris/index.html and out/photon-history/index.html emitted

git diff --check
# PASS
```

The first plain `npm run build:pages` attempt stopped before compilation
because the active shell exposed Node 16.20.2 while Next.js requires at least
20.9.0. It was rerun successfully with Node 22.19.0. An incidental
`tsconfig.tsbuildinfo` produced during an earlier typecheck was removed; no
dependency or package-manager file changed.

## Assumptions, status, and limitations

- The implementation is an **AUTHOR-APPROVED** engineering capability. It
  does not add or validate a scientific model, parameter, formula, dataset, or
  manuscript claim.
- Persistence is origin- and browser-profile-local. Private browsing,
  permissions, quota, eviction, user clearing, or browser storage policy can
  make records unavailable; the UI reports the failure and continues
  simulation without claiming persistence.
- Writes are asynchronous. Abrupt tab/process termination can lose a record
  whose transaction has not completed.
- No automated retention or deletion exists, by explicit scope decision.
  Long simulations can consume increasing browser storage until the browser
  rejects a write; at that point the simulator reports `NOT PERSISTING`.
- A page query is a point-in-time cursor traversal. New concurrent records are
  visible when returning to the first page or reapplying filters; the keyset
  prevents overlap with the already loaded older page.
- The persistent-record counter is initialized from IndexedDB and increases
  only after successful transaction completion. It is not a scientific count
  of photons; it counts stored acquisition-bin records.
- Automated unit, type, lint, and static-export checks passed. Browser-level
  reload/quota UI behavior was not automated in this dependency-free MVP and
  remains a manual integration check.
