# CE-SIM-20260823 — GRB truth versus reconstructed direction

## Task

- Date: 2026-08-23 (Europe/Rome)
- Objective: show and retain, as separate quantities, the injected GRB direction,
  the reconstructed direction, and their angular separation.
- Author approval: explicit request in the project thread on 2026-08-23.
- Starting revision: `3213e82` (`Make simulator layout fully responsive`).
- Publication authorization: not granted for this task; changes remain local.

## Inputs and observed facts

- `app/lib/burst-direction-reconstruction.ts` already reconstructs a direction
  from pixel values, same-frame pixel baseline, detector normals and radial
  boresight. Its public estimator input contains no injected direction.
- `app/lib/burst-direction-truth-score.ts` initially computed a great-circle
  separation after reconstruction from the clamped dot product of two unit
  directions.
- Injected RA/Dec and angular error were already persisted for simulated
  events, but the live reconstruction panel and 3D-stage notification did not
  show both coordinate pairs together. The event-history overview omitted
  truth and separation columns.
- The established convention is the simulator's ECI-like equatorial scene
  convention: RA in degrees `[0, 360)`, Dec in degrees `[-90, +90]`, associated
  with the event's simulated UTC. This is not declared as ICRS/J2000.

## Approved requirement and decisions

1. Display `INJECTED TRUTH`, `RECONSTRUCTED DIRECTION`, and great-circle
   `ANGULAR SEPARATION` together in the live reconstruction panel and burst
   notification.
2. Add the same three quantities to the event-history overview and detail.
3. Preserve truth as evaluation-only data outside the estimator. It must never
   be presented as detector telemetry or estimator input.
4. Persist explicit coordinate metadata on new records. Existing records remain
   readable through their established convention.
5. If an event has no retained injected truth, display `N/A` and do not fabricate
   an error value.
6. Keep the reconstruction and detector response models unchanged.

## Implementation

- `app/lib/burst-event-repository.ts`
  - added coordinate labels/conventions;
  - added an available/unavailable truth-evaluation contract;
  - supports injected-source and future telemetry records;
  - new injected records use additive schema version 2 metadata;
  - legacy records remain readable, and missing truth fails closed to `N/A`;
  - display-time evaluation recalculates separation from the two coordinate
    pairs instead of trusting a stored error value;
  - new writes reject out-of-domain coordinates, injected truth in telemetry
    records, incomplete v2 metadata and inconsistent stored separation.
- `app/lib/burst-direction-truth-score.ts`
  - validates finite input and the declination domain;
  - uses the numerically stable `atan2(|a x b|, a dot b)` great-circle formula.
- `app/components/adaptive-analysis-panel.tsx`
  - shows injected and reconstructed RA/Dec and angular separation separately;
  - states the coordinate convention and that truth is withheld from the
    estimator.
- `app/page.tsx`
  - records schema version 2 coordinate/truth metadata;
  - shows truth, reconstruction, separation and frame/epoch in the 3D-stage
    notification;
  - event-log archive messages contain both coordinate pairs and separation.
- `app/event-history/page.tsx`
  - adds truth RA, truth Dec and angular-separation columns;
  - adds the complete comparison and coordinate convention to event detail;
  - renders `N/A` for records without truth.
- `app/globals.css`
  - adds compact notification grouping and widens only the horizontally
    scrollable event table.
- Tests cover truth availability, fail-closed no-truth behavior, UI wiring, RA
  wrap-around and polar invariance.

## Verification record

Tools: local shell, TypeScript compiler, Node test runner, ESLint and the local
in-app browser against `http://localhost:3000/`.

- TypeScript:
  `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions`
  — passed.
- Tests:
  `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --experimental-strip-types --test tests/*.test.ts`
  — `108/108` passed.
- ESLint:
  `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node node_modules/eslint/bin/eslint.js . --ignore-pattern dist --ignore-pattern .next`
  — zero errors; one pre-existing `next/no-img-element` warning for the supplied
  logo integration.
- Browser, generated GRB example:
  - truth: RA `181.66 deg`, Dec `-13.57 deg`;
  - reconstruction: RA `181.26 deg`, Dec `-17.50 deg`;
  - angular separation: `3.95 deg`;
  - the reconstruction panel, notification and selected archive detail agreed;
  - no browser console errors were recorded.
- Independent quantitative validation (`quantitative_validator`):
  - confirmed the great-circle formula, degree units, RA wrapping, polar and
    antipodal cases, and truth isolation;
  - a deterministic 100,000-pair comparison against a haversine reference
    reported a maximum absolute difference of `5.17e-12 deg` for the original
    formula;
  - identified that persisted error values were trusted and that non-finite or
    out-of-domain directions were not rejected;
  - the implementation was revised with stable scoring, input validation,
    display-time recomputation and write-time consistency checks;
  - independent re-check passed: a second deterministic 100,000-pair sweep had
    maximum absolute difference `3.695e-12 deg` versus haversine, invalid inputs
    were rejected, contradictory telemetry truth was ignored, and inconsistent
    archive writes were rejected before reaching IndexedDB.
- Compact viewport `860 x 900`:
  - no body-level horizontal overflow;
  - event overview remains horizontally scrollable inside its table panel;
  - event detail was reachable and displayed all comparison fields.
- GitHub Pages build:
  `PATH=<workspace bundled Node>:$PATH npm run build:pages`
  — passed in the root coordinator's independent final QA. Earlier attempts
  using system Node `16.20.2` or the ChatGPT-bundled Node were inapplicable
  because of the Next minimum-version requirement and macOS native-module
  Team-ID isolation respectively. No dependencies were replaced.

## Scientific status and limits

- Status: `PROVISIONAL`.
- The truth comparison is a closed-loop synthetic evaluation using an injected
  source and the current engineering response geometry. It is not an
  independent localization-performance measurement.
- The estimator remains a positive-excess weighted centroid. There is no
  confidence region, detector calibration, measured spacecraft roll, blind
  trigger, false-alarm characterization or simultaneous-source resolution.
- The labels deliberately say `SIMULATOR ECI-LIKE EQUATORIAL`; they do not claim
  ICRS/J2000 or another externally validated astronomical reference frame.
- Domain validation by the Crystal Eye physics team and final author approval
  are still required before treating the comparison as scientific evidence.
