# CE-SIM-20260821 — V2R8 layered detector and TypeScript localizer core

## Record status

- Task date: 2026-08-21 (Europe/Rome)
- Task status: IMPLEMENTED · `PROVISIONAL` scientific status
- Evidence labels used in this record: `VERIFIED`, `PROVISIONAL`, `PLANNED`
- Repository baseline: `crystal-eye-simulator` commit
  `f6be35c185c94359fdd5f314225024910aee22ef`
- Worktree at start: clean; branch `main`, 21 commits ahead of
  `github/main`
- Preservation decision: the exact baseline commit above is the reversible
  checkpoint. No commit, push, deployment, or publication is authorized by
  this task.

## Objective

Implement the author-approved candidate architecture in the web simulator:

1. represent Crystal Eye as 126 physical modules with explicit IDs and
   unit-sphere directions/normals numerically equivalent to the V2R8 candidate;
2. represent each module conceptually as ACD + upper GAGG + lower LYSO while
   refusing to invent layer-resolved response data;
3. decouple the manually edited 2D projection from physical burst response;
4. add a fail-closed TypeScript contract/core for the legacy
   template/Kolmogorov-Smirnov localization workflow;
5. retain existing aggregate response only as a clearly labelled provisional
   compatibility path where layer-resolved data are absent.

## Inputs and provenance

- Author approval in the project thread on 2026-08-21: “Vai proviamo a fare
  come consigli!” following the proposed V2R8/module/layer/TypeScript plan.
- Upstream repository snapshot: `ritabrata-s/CESimulation`, commit
  `52bf8e89c405bb5e76bd4bffb19764a1bc2ab150`.
- Candidate geometry evidence inspected upstream:
  `data/Geom/upCrystalPos-V2R8.txt`. No upstream raw coordinate or mapping file
  is redistributed by this change. Runtime directions are derived from the
  already versioned local `public/data/pixbkg.txt` angles.
- Legacy localization sources inspected at that snapshot:
  `src/analysis/CELocalization.cc`, `include/analysis/CELocalization.hh`, and
  `src/analysis/CELoc.cc`.
- Existing local detector/background inputs are read-only for this task.
  `Materiale/` and `Appunti/` must not be modified.

## Facts, assumptions, and decisions

### VERIFIED from source inspection

- The candidate V2R8 position file contains 126 explicit pixel IDs and 3D
  coordinates.
- The upstream classical localizer consumes both a 126-pixel distribution and
  an energy-deposition spectrum, plus background, effective-area, direction
  grid, and template-bank inputs.
- Geant4 is not called by the mathematical localization routine; ROOT is used
  for file/array/histogram operations and the KS comparison.
- The public upstream snapshot does not include the full template/effective
  area/background fixture required for scientific parity testing.

### AUTHOR-APPROVED architecture decision

- V2R8 is adopted as a **candidate** physical geometry, not as a validated
  final detector geometry.
- A candidate module uses the upper GAGG ID as canonical ID and represents
  upper ACD, upper GAGG, and mapped lower LYSO conceptually. Lower/ACD mapping
  IDs remain unavailable until licensed authoritative data are supplied.
- The bottom ACD is a separate global component, not one of the 126 localizer
  bins.
- The editable 2D layout is visualization metadata only.
- The TypeScript localizer must fail closed when required scientific inputs are
  missing or invalid.

### PROVISIONAL limitations

- No layer-specific ACD/GAGG/LYSO counts or deposited-energy allocation may be
  inferred from aggregate counts.
- Existing aggregate display/response remains a compatibility model, not a
  Geant4-equivalent detector response.
- V2R8 and all detector-frame conventions require confirmation by the physics
  team before they can be labelled `DOMAIN-VALIDATED`.
- ROOT KS parity cannot be claimed until a golden fixture and exact ROOT
  comparison output are supplied.
- The 126 localizer bins are interpreted as combined GAGG+LYSO calorimetric
  response. ACD contributes to trigger/veto semantics and is not added as a
  third count layer.
- The current angular response powers and unit-sphere matching remain an
  existing engineering compatibility model, not a Geant4 response.

## Agents and tools

- `ce_coordinator`: author-gate orchestration
- `simulator_engineer`: implementation and developer tests
- `physics_requirements_analyst`: independent domain-requirements audit
- `quantitative_validator`: independent numerical/test replication after the
  implementation is frozen
- Tools: Git inspection, ripgrep, patch application, TypeScript/Node test
  runner, ESLint, TypeScript compiler, GitHub Pages production build, and
  in-app browser QA on localhost

## Files changed

- `app/lib/detector-geometry-v2r8.ts` — candidate module/direction model,
  conceptual layers, fail-closed incidence/ranking.
- `app/lib/legacy-template-localizer.ts` — typed ROOT/KS asset boundary,
  validation and unavailable result contract; numerical core intentionally
  inactive pending golden parity.
- `app/page.tsx` — V2R8-equivalent directions for Sun/Moon/GRB response,
  burst footprint and reconstruction; 3D placement; corrected layer labels.
- `tests/detector-geometry-v2r8.test.ts`.
- `tests/legacy-template-localizer.test.ts`.
- `tests/dashboard-layout.test.ts`.
- This execution record.

## Commands, tests, and results

- Node runtime: bundled Node `24.19.0`.
- `npm test`: PASS, 71/71 tests.
- `npm run lint`: PASS, zero errors/warnings.
- `npx tsc --noEmit --allowImportingTsExtensions --incremental false`: PASS.
- `npm run build:pages`: PASS, 5/5 static pages generated.
- `git diff --check`: PASS.
- Independent quantitative checks:
  - 126 unique ordered canonical IDs;
  - unit normals;
  - `theta`/`phi` reconstruction follows `phi = atan2(-Z,X)`;
  - invalid and opposite/no-incidence directions do not fabricate pixel IDs;
  - localizer boundary remains unavailable without complete assets and ROOT
    golden parity.
- Browser QA at `http://localhost:3000/`: PASS. Reference and Simulation Mode
  render without console errors; layered labels are present and unsupported
  `CH` labels absent; one random GRB produced a V2R8-directed footprint and a
  single onset marker. Only the pre-existing Three.js `Clock` deprecation
  warning remains.
- Frozen output hashes before handoff:
  - geometry module: `49de935c13c88308d9c2042b13a816f6071f1fecb7149c85222ecfe0d9d64cd8`;
  - localizer boundary: `10555c2e30905e2d3552cbd5c420dfa58a76d79713398a576fd0d113d8540fd6`;
  - page: `0e7c8d1de023d42cac18b923668fb76c1a06f4ddabd888868e7430eb98897a20`.

## Open questions and human gates

- Physics-team confirmation that V2R8 is the authoritative geometry.
- Exact semantic mapping of ACD, upper GAGG, and lower LYSO channels.
- Layer-resolved response/template assets, energy-bin edges and units,
  exposures, background scaling, and one golden localization fixture.
- Confirmation of detector-frame axes and mapping from local theta/phi to the
  spacecraft attitude frame.
- Confirmation or correction of the upstream V2R8 file ordering behavior.
- Written reuse/distribution permission or a repository license before
  redistributing upstream data publicly.
- Implementation of the numerical KS/template core remains `PLANNED`, not a
  current localization capability.

## Release state

- No commit created.
- No push, GitHub Pages deployment, Sites deployment, or other publication
  performed. Publication remains an explicit author gate.
