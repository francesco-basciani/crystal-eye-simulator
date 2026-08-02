# CE-SIM-20260802-pixbkg-integration

## Objective and authorization

- Date: 2026-08-02 (Europe/Rome).
- Objective: integrate the researcher-provided per-pixel background profile
  into the Crystal Eye simulator.
- Baseline simulator revision:
  `cc8372269f34052eb0e70d081fc02139ac358a34`.
- Author decision: **AUTHOR-APPROVED** for a provisional simulator
  integration on 2026-08-02.
- Publication status at record creation: implementation pending commit and
  deployment.

## Approved provisional contract

1. Dataset `pixel_id 0..125` maps directly to internal simulator indices
   `0..125`.
2. Column 4 is a constant deterministic background rate for each pixel in
   `counts/s`.
3. The profile replaces the former scalar base background of `360 counts/s`.
4. The display bin is fixed at `0.2 s`; expected counts are
   `rate × 0.2 s` and do not scale with time warp.
5. Sun, Moon, and Earth-albedo rates remain separate additive provisional
   components. GRB counts remain a separate source component.
6. No Poisson or other random background sampler is introduced.
7. Theta and phi are parsed and retained but do not replace pixel normals until
   their coordinate convention is domain-validated.
8. The runtime and UI must identify the model as `PROVISIONAL`.

This approval authorizes implementation for exploration. It does not confer
`DOMAIN-VALIDATED` status or authorize a manuscript result.

## Input

- Archived source: `../Materiale/pixbkg.txt`.
- Runtime asset: `public/data/pixbkg.txt`.
- Runtime asset SHA-256:
  `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d`.
- Size: 3391 bytes; 126 LF-terminated TSV records.
- Source/runtime byte comparison: identical.
- Ingestion record:
  `../docs/provenance/CE-DATA-INGEST-20260802-pixbkg.md`.

## Implementation

- `app/lib/pixel-background.ts`
  - strict 126-record parser;
  - finite/range/order validation;
  - runtime SHA-256 verification and fail-closed loading;
  - explicit rate and expected-count representations;
  - fixed-bin conversion and deterministic composition.
- `app/page.tsx`
  - asynchronous validated profile loading;
  - removal of the scalar `BASE_BACKGROUND_RATE`;
  - one profile used by tick and reset paths;
  - per-pixel baseline rates and expected counts in detector telemetry;
  - aggregate background converted from `counts/s` to counts per 0.2 s bin;
  - separate GRB source and celestial components;
  - explicit provisional/loading/error UI state;
  - blue-only baseline palette, kept distinct from Earth/GRB impact colors;
  - corrected history and CSV units.
- `app/globals.css`
  - visual status for provisional, loading, and unavailable states.
- `tests/pixel-background.test.ts`
  - golden asset/hash/content test;
  - mapping, aggregate, and bin-conversion tests;
  - composition test;
  - malformed/reordered/negative/truncated input rejection.
- `package.json`
  - deterministic Node test command.

## Verified quantitative results

- Pixel IDs: exactly `0..125`.
- Total profile rate: `5711.5784 counts/s`.
- Fixed-bin duration: `0.2 s`.
- Total expected baseline: `1142.31568 counts / 0.2 s`.
- Pixel 0 expected baseline:
  `41.1497 × 0.2 = 8.22994 counts / 0.2 s`.
- Baseline per-pixel expected counts sum equals the aggregate expected baseline
  within floating-point tolerance.
- Dataset rate is independent of orbit phase and time-warp value in the
  implemented provisional contract.

## Agents and tools

- `ce_coordinator`: scope, decision gates, requirements, and implementation
  coordination.
- `physics_requirements_analyst`: independent physical-assumption and
  validity-domain analysis.
- `quantitative_validator`: independent byte, parser, mapping, unit,
  arithmetic, composition, build-asset, and negative-case audit.
- Primary agent: final unit reconciliation, verification, source control, and
  deployment.
- Tools: SHA-256, byte comparison, Node test runner, ESLint, Next static build,
  vinext deployment build, Git, GitHub Pages, and Sites.
- Seed: not applicable; the approved background mode is deterministic.

## Commands and results

```sh
npm test
# PASS: 4/4 tests

npm run lint
# PASS

npm run build:pages
# PASS

npm run build
# PASS; non-blocking existing chunk-size warning (>500 kB)

cmp ../Materiale/pixbkg.txt public/data/pixbkg.txt
# PASS
```

Independent mutation audit: 17/17 malformed dataset variants were rejected.
The built runtime asset remained byte-identical to the archived source.

Final audited hashes before commit:

- `app/page.tsx`:
  `7275ba8ff51a0023312e76a721f1b442802f6c20630dddecdf5aa9d95ecdda65`;
- `app/lib/pixel-background.ts`:
  `e533cfc68a2cc72277bfb865d1cbf8576efb9c14c087a75f071206792af7dc76`;
- `tests/pixel-background.test.ts`:
  `0c047f6246920584db4b8469a74b730dfdcd1be986aefbeb190c6a9f6acd9e92`;
- `public/data/pixbkg.txt`:
  `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d`.

The blue background palette produced 61 distinct RGB values for the 126
distinct rates because of 8-bit color quantization; the physical numeric rates
remain distinct and unchanged.

## Status

- Dataset byte integrity and parser behavior: **VERIFIED**.
- Arithmetic and fixed-bin conversion: **VERIFIED**.
- Implementation and build: **VERIFIED**.
- Provisional integration decision: **AUTHOR-APPROVED**.
- Physical meaning, mapping, and validity domain: **PROVISIONAL**.
- Domain validation: pending.
- Manuscript use: not authorized.

## Known limitations and open questions

1. The direct dataset-ID to simulator-index mapping is an author-approved
   provisional mapping, not a physics-validated geometry mapping.
2. Theta/phi are preserved but not applied to the visual or response geometry;
   their frame, axes, orientation, and handedness remain unknown.
3. The dataset may already contain environmental components. Adding the
   separate Sun/Moon/Earth terms can double-count them until the researcher
   clarifies dataset composition.
4. Aggregate celestial additions and pixelwise detector response do not fully
   reconcile: Sun and Moon are not distributed per pixel, while Earth and GRB
   use existing heuristic spatial formulas.
5. Time warp advances mission time by `0.2 × speed` per display sample while
   the exposure remains fixed at 0.2 s. The exposure contract is explicit, but
   interpretation per simulated mission second remains unresolved.
6. No live time, dead time, energy band, thresholds, uncertainty, covariance,
   or stochastic counting model is available.
7. Significance remains an exploratory heuristic and is not a validated
   statistical result.
