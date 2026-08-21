# CE-SIM-20260821 — Pixel configuration 4 integration

## Status

- Task status: `IMPLEMENTED`
- Author decision: `AUTHOR-APPROVED` for use as the canonical 2D pixel layout and ID-to-layout mapping.
- ID-domain compatibility with `pixbkg.txt`: `VERIFIED`.
- Physical meaning of the supplied 2D coordinates: `PROVISIONAL`; the layout is a flattened visualization and is not a metric V2R8 detector geometry.
- Publication status: not published in this task.

## Objective and input

Replace the simulator's bundled default pixel configurator layout with the author's file:

- original path: `/Users/basciani/Downloads/crystal-eye-pixel-configuration-4.json`;
- original SHA-256: `d3be5c27bfe596845a6cfe6e75ba7e1af370b6f56ca1d09f4a9ec54b9bca2193`;
- schema: configuration version 2, 126 pixel records.

The repository source copy and bundled asset differ from the original only by one final LF added by the patching workflow. Their SHA-256 is `1e26ced9086daaacad78c72f1a480d28094c8eecba883b7cd39dcf00d5f7ef99`.

## Verified properties

- exactly 126 records;
- integer `pixelId` bijection over 0–125;
- the ID domain equals the 126 IDs in `public/data/pixbkg.txt`;
- one fixed pentagon in each of the six 16-pixel grey groups, at geometry slots 6, 23, 39, 54, 70 and 86;
- 30 seam pixels at geometry slots 96–125;
- finite positions and rotations within the existing normalizer bounds;
- source and bundled JSON content are equal after the final-LF normalization.

Compared with the previous bundled default, 21 geometry slots have a different physical ID and 107 records differ in at least one serialized field. This input therefore supersedes the previous layout; it is not treated as a cosmetic float rewrite.

## Implementation decisions

- `app/data/crystal-eye-pixel-configuration.v3.json` is the new bundled default.
- Browser storage uses `crystal-eye.pixel-configuration.v5`, preventing an older saved layout from overriding this configuration.
- A one-time migration resets geometry, shapes, rotations and IDs to this canonical configuration while preserving non-empty user annotations by physical `pixelId`.
- The editable 2D configuration remains separate from V2R8 physical normals, detector layers and burst-incidence physics.
- No change was made to the layered response model or the legacy localization boundary.

## Files

- `app/data/crystal-eye-pixel-configuration.v3.json`
- `app/lib/pixel-configuration.ts`
- `app/page.tsx`
- `tests/pixel-configuration.test.ts`
- `docs/provenance/inputs/CE-SIM-20260821-pixel-configuration-4.source.json`
- this execution record

## Coordination and tools

- author: approved the supplied configuration as the configuration to remember;
- `ce_coordinator`: performed a read-only schema, mapping and V2R8 compatibility review;
- root agent: implementation and validation;
- tools: local shell inspection, patch application, Node test runner, ESLint, TypeScript and static Pages build.

## Scientific boundary

The supplied x/y layout and rotations are authoritative for the configurator and planar detector view only. Pixel identity connects the view to `pixbkg.txt`; it does not by itself validate physical distances, V2R8 metric positions, per-layer channel mapping or detector-response calibration.
