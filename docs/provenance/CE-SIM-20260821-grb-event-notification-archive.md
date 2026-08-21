# CE-SIM-20260821 — GRB reconstruction notification and event archive

## Status

- Implementation status: `IMPLEMENTED`.
- Reconstruction and event contents: `PROVISIONAL`.
- Per-layer response: `UNAVAILABLE`.
- Publication status: not published in this task.

## Author request

Show a notification in the 3D orbital stage when a burst is reconstructed and provide a searchable event table containing position, signal information and the response of every pixel and detector level.

## Implemented scope

- The existing 3D-stage GRB alert now shows the provisional reconstructed RA/Dec, expected positive-excess counts per 0.2 s, positive-excess module count and synthetic input intensity.
- The notification links to `/event-history/` and remains visible during the source plus approximately eight seconds after the last peak update.
- A separate IndexedDB database (`crystal-eye-burst-events`) stores one upserted record per `runId:burstId` and preserves the highest positive-excess reconstruction reached by the current algorithm.
- The GRB Events page provides simulated-UTC filters, reverse keyset pagination and a detail view with all 126 physical pixel IDs.
- Each pixel record stores aggregate expected counts, configured background expected counts, source-excess expected counts and relative impact at the peak frame.
- Upper ACD, Upper GAGG and Lower LYSO are present for every pixel but explicitly carry `UNAVAILABLE`, `null` counts and the reason `per-layer-response-model-unavailable`.
- Events outside the FOV remain in the generic event log and are not placed in the reconstruction archive. Simultaneous sources remain unavailable because the current reconstruction cannot resolve them.

## Scientific boundary

The current stream does not contain observed per-pixel Poisson telemetry or calibrated flux/energy. `detectorHits` is the composed expected 126-module response. Consequently:

- the archive uses `expected`, not `measured`, for pixel-level values;
- synthetic input intensity is a percentage, not physical power;
- physical power is displayed as `UNAVAILABLE`;
- truth RA/Dec is stored separately and labelled evaluation-only;
- the displayed position is produced by `positive-excess-weighted-centroid-v1`, not copied from injected truth;
- the feature is not a blind detection claim or a calibrated localization result.

## Persistence decision

The archive follows the existing local Photon History architecture and is stored in IndexedDB in the current browser. It survives page navigation and local reloads but is not shared across browsers or devices. Platform-backed/shared persistence would introduce a new service and requires a separate author decision.

## Files

- `app/lib/burst-event-repository.ts`
- `app/event-history/page.tsx`
- `app/page.tsx`
- `app/components/app-nav.tsx`
- `app/globals.css`
- `tests/burst-event-repository.test.ts`
- `tests/dashboard-layout.test.ts`
- this execution record

## Coordination

- author: requested the event notification and detailed history;
- `ce_coordinator`: read-only analysis of the existing burst lifecycle, reconstruction, layers and persistence boundary;
- root agent: implementation and verification;
- no external dataset, dependency or service was introduced.

## Validation executed

- 76/76 automated tests passed, including the 126-pixel serializer, fail-closed layer fields, repository upsert/count/pagination and unavailable IndexedDB;
- ESLint passed;
- TypeScript no-emit check passed;
- GitHub Pages static build passed and generated `/event-history` together with all existing routes;
- `git diff --check` passed;
- local HTTP checks returned 200 for the simulator and the final Event History route.
