# CE-SIM-20260907 — updated three-template GRB pipeline

Status: `PROVISIONAL`

## Objective and author approval

The author explicitly approved integrating the updated GRB generation and
localization files supplied by the domain contributor on 2026-09-07. This task
does not authorize publication, deployment, a Git commit, or scientific
validation.

Requirements and acceptance criteria:

1. Select the three nearest detector-frame directions using spherical angular
   distance and normalized inverse-distance weights. Acceptance: deterministic
   tests cover selection, weights, and tie ordering.
2. Handle an exact database direction without division by zero. Acceptance: an
   exact match returns one template with weight 1.
3. Preserve the C++ containment diagnostics. Acceptance: runtime exposes
   degenerate/outside-triangle warnings and the UI displays them.
4. Accept requested detector zenith angles through 113 degrees. Acceptance:
   theta=113 is accepted and theta>113 is rejected.
5. Use the updated embedded-direction CELoc databases at nominal 5-degree and
   2-degree spacing. Acceptance: converted assets validate against pinned
   manifests, dimensions, hashes, and non-negative finite values.
6. Show all selected directions, separations, and weights. Acceptance: the
   localization panel renders the three rows and warning state.
7. Retain the old single-template implementation as an explicit `LEGACY`
   choice, not as a silent fallback. Acceptance: `UPDATED` is the default;
   missing updated assets fail closed with `updated-assets-not-configured`.

## Source inputs

The original ROOT data remain outside the repository. The converter records the
public Google Drive file IDs in each generated manifest.

| Input | SHA-256 | Size |
| --- | --- | ---: |
| `CEGenGRB.cc` | `1d18decbeabaf9d1d72896efd86f39ae46a9b1d838f7047ee84122c0db4f16fc` | 11,041 B |
| `CELoc.cc` | `0b272e5c39310877a1947c602790dc4fd05f8fbf349a4ac048e74f8a6149cf39` | 7,738 B |
| `temDataSet5degNew.root` | `52cddade7195f9f1c7d03659f19599f116c56a03f2120684b39ec20eb1f14d01` | 949,681,528 B |
| `temEdepPix5degNew.root` | `6f79fd2c68da2c2df92e3aca94c63c68073b0b999e6a6876c1359966036ff0ee` | 103,907,662 B |
| `temEdepPix2degNew.root` | `e77cb7800e497bfa5d375a0f0e1ac7b94e2121982c9b08114d9ad6a1aa5caf4e` | 692,555,360 B |
| `upCal.txt` | `5164b59df7df244855d1f7a30385385eab460f30d2af2e0bb5ba3acbe4f942c6` | 3,432 B |
| `allEffArea.root` | `d2cbbeee10dd545a968ab926c4007af964013056b6a2a26767c99cf170d6ec85` | 193,264 B |

Observed source dimensions:

- updated generator database: 1,093 directions, theta 0–115.312 degrees;
- updated 5-degree localization database: 1,093 templates;
- updated 2-degree localization database: 7,143 templates;
- user-requested generator domain: theta 0–113 degrees;
- 126 canonical pixel histogram bins and 100 energy bins.

Directions beyond 113 degrees are retained only as interpolation/localization
support templates. They do not expand the approved user-request domain.

## Implementation decision

`CEGenGRB.cc` copies `floor(entries * weight)` leading events from each of the
three selected ROOT trees, while normalizing with weighted full histograms.
Shipping request-dependent raw Monte Carlo event trees to the browser would be
impractical. The web conversion instead stores sufficient statistics for every
direction and energy bin:

- primary event counts;
- normalized pixel mean and Sumw2 kernels;
- normalized deposited-energy mean and Sumw2 kernels.

At runtime the code reconstructs raw sufficient statistics, mixes them with the
three inverse-distance weights, divides by the weighted primary counts, and
then applies the approved cutoff power-law spectrum and 1,296 cm2 generation
area. This is a full-sample expectation approximation, not an exact port of the
C++ prefix-event sampling.

The updated generator is allowed to execute only when both its manifest and
source-provenance hashes match code-pinned trust anchors. `rootParity` remains
false and the UI states that identical-input C++/ROOT parity is pending.

The reproducible comparison in
`docs/evidence/rito-three-template-expectation-audit-20260907.json`, generated
by `scripts/compare-ritabrata-generator-approximation.py`, measures the effect
of this decision for four fixed inputs. The expectation response differs from
the deterministic C++ prefix response by 3.56–5.62% in relative pixel-vector
L2 norm and by 2.03–3.22 degrees as a normalized response-shape angle. These
are method-comparison diagnostics, not localization errors or confidence
intervals.

## Converted assets

The generated web assets live under
`scientific-assets/rito-updated-20260907/`, not `public/`, so the current Pages
bundle remains near its previous size.

| Asset | Manifest SHA-256 | Approx. stored size |
| --- | --- | ---: |
| generator | `0d9790bb74ecf5a15d53b99eb8008e8e353d470560bbe08c27c17e90d47bfbd5` | 80 MiB |
| CELoc 5-degree | `35a5ec42eecb87cdf2e0e4a69cf811ea68b649c977b74e85281eec5129dd7619` | 35 MiB |
| CELoc 2-degree, eight shards | `d55e6f5d8dddf6827d7527cdbd3642cb674c37604cdd20f5d71c277f6f269dda` | 237 MiB |

The generator uses range-addressable concatenated gzip members and downloads
only five small members for each selected direction. The 2-degree localizer is
split into eight Git-compatible shards; it still has a substantial client
download and memory cost.

## Local and future publication wiring

The updated runtime is configured with:

```text
NEXT_PUBLIC_RITO_V2_ASSET_BASE_URL=<origin containing generator/, localizer-5deg/, localizer-2deg/>
```

`scripts/serve-scientific-assets.mjs` provides a development-only CORS and
byte-range asset server. Without the environment variable, the default
`UPDATED` mode fails closed. The previous implementation remains available only
through the explicit `LEGACY` selector.

For a local interactive run, use two terminals:

```text
npm run serve:rito-v2-assets
npm run dev:rito-v2
```

A later, separately authorized publication should use two commits:

1. publish the reviewed files under `scientific-assets/rito-updated-20260907`;
2. pin the application asset base to `raw.githubusercontent.com` at the exact
   immutable asset commit SHA, then build and deploy the lightweight Pages
   bundle.

No placeholder commit SHA is embedded in this working tree.

## Commands and verification

Conversion commands:

```text
python scripts/convert-ritabrata-grb-generator-v2.py <source-dir> <generator-output>
python scripts/convert-ritabrata-localizer.py <source-dir> <localizer-5-output> --grid 5deg --updated
python scripts/convert-ritabrata-localizer.py <source-dir> <localizer-2-monolithic> --grid 2deg --updated
python scripts/shard-ritabrata-localizer-response.py <localizer-2-monolithic> <localizer-2-output> --templates-per-shard 1000
python scripts/compare-ritabrata-generator-approximation.py <source-dir> docs/evidence/rito-three-template-expectation-audit-20260907.json
node --experimental-strip-types scripts/validate-ritabrata-grb-generator-v2.ts scientific-assets/rito-updated-20260907/generator
node --experimental-strip-types scripts/validate-ritabrata-localizer-grid.ts scientific-assets/rito-updated-20260907/localizer-5deg
node --experimental-strip-types scripts/validate-ritabrata-localizer-grid.ts scientific-assets/rito-updated-20260907/localizer-2deg
```

Final working-tree verification used Node.js 22.22.0 and produced:

- `npm test`: PASS, 160/160 tests;
- `npx tsc --noEmit`: PASS;
- `npm run lint`: PASS with one pre-existing `next/no-img-element` warning in
  `app/page.tsx`;
- all three updated-asset validators above: PASS;
- `npm run build:pages`: PASS, including the legacy asset regression gates;
- exported `out/`: 110 MiB; `public/`: 103 MiB. The 352 MiB updated scientific
  assets remain outside both directories;
- local scientific-asset server: a 128-byte request returned `206 Partial
  Content`, `Accept-Ranges: bytes`, and `Access-Control-Allow-Origin: *`.

The paired localization benchmark comparing the legacy and updated generator /
localizer combinations is a separate pending quantitative-validation task; it
is not implied by these integrity and build checks.

## Limits and pending validation

- Identical-input parity with the updated C++/ROOT generator is not established.
- Identical-input parity with the updated C++/ROOT localizer is not established.
- The full-sample approximation can differ materially from deterministic C++
  prefix sampling; the separate comparison evidence quantifies this difference.
- Template containment warnings are diagnostic and do not invalidate a result;
  the supplied C++ also continues with the three nearest templates.
- The 2-degree asset has high download and client-memory cost.
- No result from this task is `DOMAIN-VALIDATED` or `AUTHOR-APPROVED` for use as
  a scientific conclusion.
