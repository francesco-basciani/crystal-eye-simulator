# CE-SIM-20260806-photo-planar-geometry-alignment

## Task and authorization

- Date: 2026-08-06 (Europe/Rome).
- Objective: reposition and rotate the 126 planar configurator cells to match
  the author-supplied physical-layout photograph while preserving the physical
  `pixelId` identity established at revision `58537e79b77baa8d4317661c160babb29609a391`.
- Baseline revision: `58537e79b77baa8d4317661c160babb29609a391`.
- Authorization: **AUTHOR-APPROVED** for simulator implementation. Push,
  deployment, publication, manuscript changes, OCR of handwritten identifiers,
  and a physical-geometry validation claim were not authorized.

## Inputs, versions, and integrity

- Reference photograph:
  `/var/folders/h_/mmzhw2t13wz1m25tgks2mkqh0000gn/T/codex-clipboard-a120cb47-701d-43c7-a933-760fec0a0e64.png`.
- Image dimensions: 1176 × 1000 pixels; size: 2,461,411 bytes; SHA-256:
  `b4d6e256fd76b01e64abc18b44dddc6a439faf3637f4bed2b16eefdadce90684`.
- The image is byte-identical to the visual reference already recorded in
  `CE-SIM-20260806-pixel-geometry-physical-identity.md`.
- Geometry baseline:
  `app/data/crystal-eye-pixel-configuration.v1.json` at the baseline revision.
- Background/physical-ID contract: `public/data/pixbkg.txt` and the version-2
  migration/runtime behavior documented by
  `CE-SIM-20260806-pixel-geometry-physical-identity.md`.
- Tools used for extraction: Python 3.12.2, Pillow 10.2.0, NumPy 1.26.4.
- Simulator verification runtime: Node.js 24.14.0.
- Random seed: not applicable. Segmentation, splitting, clustering,
  assignment, normalization, and tests are deterministic.

## Observed facts and approved requirements

- Colour-silhouette segmentation finds 30 red connected components, 94 blue
  connected components, and one green connected component.
- One blue region at photograph bounding box `x=643..749`, `y=269..380`
  joins two adjacent silhouettes at the selected threshold. Deterministic
  two-centre spatial splitting yields 95 blue silhouettes.
- The resulting structure is exactly 126 cells: 96 non-red cells arranged as
  six 16-cell clusters and 30 red cells arranged as ten triplets.
- Handwritten marks are ambiguous and are not a defensible identity source.
  No OCR, transcription, or handwritten-number inference is performed.
- The baseline already fixes geometry-slot identity, `PX-001..PX-126` legacy
  identity, physical `pixelId=0..125`, red-seam membership, and the six
  pentagon slots. These fields must not change.

## Method and decisions

1. Segment red, blue, and green silhouettes from RGB dominance thresholds;
   discard components smaller than 200 pixels.
2. Split the sole merged blue component by deterministic two-centre spatial
   clustering. This produces the required `95 blue + 1 green + 30 red` cells.
3. Normalize each silhouette centre directly against the full photograph:
   `xPercent = 100 * centreX / 1176` and
   `yPercent = 100 * centreY / 1000`.
   Full-frame normalization intentionally preserves the photographed scale,
   slight left offset, and perspective instead of artificially stretching the
   cell envelope to the editor bounds. Text, arrows, and handwriting do not
   affect the result because only colour silhouettes contribute centres.
4. Assign non-red detections to the six existing 16-slot blocks and red
   detections to the ten existing three-slot blocks with capacity-constrained
   minimum-cost assignment seeded by the baseline block centroids.
5. Assign cells within each block by minimum-cost matching after iterative
   axis-wise affine registration. This uses the already approved topology, not
   photographed handwriting. All 126 detections and all 126 slots participate
   in one-to-one assignments.
6. Estimate hexagon pose from the length-weighted circular mean of convex-hull
   edge angles modulo 60 degrees. This phase matches the editor's CSS
   convention where zero degrees has horizontal top and bottom edges.
7. Preserve the existing pentagon slots and use the photographed silhouette
   direction: slot 6 points upward (`180°`); slots 23, 39, 54, 70, and 86
   point downward (`0°`).
8. Store centres to four decimal places and hexagon rotations to 0.1 degree.
9. Advance browser persistence to storage key v3. On the first load from a v2
   or v1 record, preserve each geometry slot's physical `pixelId` and
   `legacyAnnotation`, but replace position, rotation, seam, and pentagon fields
   with the photo-aligned default. A valid v3 record is loaded without this
   replacement, so subsequent author edits remain durable.

The mapping-confidence calculation is diagnostic: after local affine
registration, red-triplet RMSE values range from 0.057 to 1.380 percentage
points and gray-cluster RMSE values range from 0.347 to 1.830 percentage
points. The largest individual diagnostic residual is 3.793 percentage points
in gray cluster 6. These values assess correspondence to the former topology;
they are not physical measurement uncertainties.

## Implementation artifacts

- `scripts/align-planar-geometry-from-photo.py`: deterministic silhouette
  extraction, normalization, topology-constrained matching, angle extraction,
  and identity/shape-contract guard. The script emits JSON and does not mutate
  repository files itself.
- `app/data/crystal-eye-pixel-configuration.v1.json`: 126 updated `x`, `y`,
  and photograph-derived pose values.
- `tests/pixel-configuration.test.ts`: updated default sample and exact slot
  invariants for the six pentagons and the 30 red cells; v2-to-v3 migration
  preserves swapped physical IDs and annotations while replacing stale pose
  and shape fields.
- `app/lib/pixel-configuration.ts`: v3 storage key and pure legacy-storage
  migration onto the aligned default geometry.
- `app/page.tsx`: v3-first loading, one-time v2/v1 migration, and v3 saves.

Pre-validation artifact hashes:

- aligned configuration SHA-256:
  `6631149e895aa005182504b7f1196b1301137425cbaae516152e5f8e3d27f36f`;
- extraction script SHA-256:
  `2db32ba789c2ef49e489c0c205b60a6cbf8c47df1a1ec181d122808c5af156cf`;
- geometry tests SHA-256:
  `8443eef39dd7d9371415ed6723f03facae0613024d5bdc00df387a853613989b`;
- pixel-configuration library SHA-256:
  `63b5608bcbb585fc10c5dc882ea1633c7cb0466053570a59365d73f0f660ef9d`;
- application page SHA-256:
  `262f2c0beb85a0dcf863a2aad220150a39884dcd008a82347bd532cb0166c37c`.

## Agents and tools

- `ce_coordinator`: scope, authorization boundary, provenance, integration,
  and browser-based visual inspection.
- `simulator_engineer`: extraction/mapping design; no worker-authored patch was
  incorporated after the worker stalled, so the coordinator applied the
  implementation with the same documented method.
- `quantitative_validator`: independent image segmentation, identity audit,
  quantitative comparison, and deterministic command replication.
- Tools: Git, SHA-256, Python/Pillow/NumPy, the local simulator server, DOM and
  browser screenshots, Node test runner, ESLint, TypeScript, and Next.js static
  build.

## Commands and implementation results

```sh
python3 scripts/align-planar-geometry-from-photo.py \
  /var/folders/h_/mmzhw2t13wz1m25tgks2mkqh0000gn/T/codex-clipboard-a120cb47-701d-43c7-a933-760fec0a0e64.png \
  app/data/crystal-eye-pixel-configuration.v1.json --report
# 126 centres: 96 gray/non-red, 30 red

diff -u app/data/crystal-eye-pixel-configuration.v1.json \
  <(python3 scripts/align-planar-geometry-from-photo.py \
    /var/folders/h_/mmzhw2t13wz1m25tgks2mkqh0000gn/T/codex-clipboard-a120cb47-701d-43c7-a933-760fec0a0e64.png \
    app/data/crystal-eye-pixel-configuration.v1.json)
# PASS: no differences

export PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
npm test
# PASS: 29/29 after the decimal-normalization assertion was corrected

npm run lint
# PASS

npm run build:pages
# PASS: compiled, TypeScript checked, 5/5 static pages generated

git diff --check
# PASS
```

The first test run exposed only a floating-point representation difference:
normalizing `30.1°` produces `30.100000000000023°`. The assertion was changed
to compare the documented one-decimal stored precision; no runtime code or
geometry value was altered to conceal the anomaly.

Contract comparison against the baseline revision reports:

- `index`, legacy `id`, `secondaryId`, `isSeam`, and `isPentagon`: identical
  for all 126 geometry slots;
- positions changed: 126/126;
- stored rotation values changed: 122/126; four already-zero photographed
  poses remain numerically unchanged, while all 126 poses were re-evaluated;
- exact identity domain: 126 unique legacy entries corresponding through the
  established migration to physical `pixelId=0..125`;
- exact shape counts: 30 red/seam cells and six pentagons at slots
  `6, 23, 39, 54, 70, 86`;
- aligned centre bounds: `x=7.7090..85.9958%`,
  `y=12.5520..91.6657%`.

Under the approved full-frame normalization, displacement of the previous
manual centres from the extracted photograph centres was 3.964 percentage
points RMSE (3.488 mean, 6.872 p95, 10.658 maximum). The aligned values are the
extracted centres rounded to four decimals, so their maximum rounding residual
is bounded by 0.000071 percentage points. This is a digital registration
metric, not a calibrated physical distance.

Local browser inspection after `RESTORE DEFAULT DRAFT` confirmed 126 rendered
editor nodes, 126 unique accessible names `Physical pixel ID 0..125`, 30 red
nodes, and six pentagon nodes. The first rendered node exposes
`x=47.034%`, `y=39.6831%`, and `rotation=30.1°`, matching the bundled JSON.
After the v3 migration was added, a fresh reload with an existing v2 record
showed the same aligned values without invoking `RESTORE DEFAULT DRAFT`. Unit
coverage also confirms that swapped physical IDs and legacy annotations survive
the migration while stale pose and pentagon placement do not.

## Independent quantitative validation

The `quantitative_validator` used independent RGB-difference thresholds and no
OCR. It reproduced 95 blue, one green, and 30 red silhouettes. Direct
full-frame matching to the implemented configuration was bijective with zero
colour-class mismatches.

- Centre residual in photograph pixels: 0.2065 mean, 0.1585 median, 0.5926
  p95, and 1.5511 maximum; acceptance tolerance: 2 pixels.
- Independent hexagon rotation estimate using a sixth complex moment on 120
  hexagons, evaluated modulo 60 degrees: 0.3189° mean, 0.7831° p95, and
  1.0579° maximum; acceptance tolerance: 1.2°.
- The six pentagons were checked separately with a fifth complex moment and the
  CSS pentagon phase modulo 72 degrees. Residuals for slots
  `6, 23, 39, 54, 70, 86` were respectively
  `0.083°, 0.699°, 0.886°, 0.945°, 3.298°, 1.333°`; maximum 3.30°.
- All `index`, `id`, `secondaryId`, `isSeam`, and `isPentagon` field values are
  unchanged from revision `58537e7`.
- The legacy `PX-001..PX-126` bijection still migrates to physical
  `pixelId=0..125`; the validator found six 16-cell non-red blocks, ten
  three-cell red blocks, and unchanged pentagon slots
  `6, 23, 39, 54, 70, 86`.
- Two independent extraction replays from the baseline were byte-identical to
  the working configuration with SHA-256
  `6631149e895aa005182504b7f1196b1301137425cbaae516152e5f8e3d27f36f`.

The validator first encountered Node.js 16.20.2, below the declared
`>=22.13.0` requirement, and correctly treated that attempt as inconclusive.
After switching to the canonical Node.js 24.14.0 runtime, the validator
independently obtained 29/29 tests, lint, vinext build, Next static build,
prerender, and `git diff --check` PASS results. The static output included a
refreshed `out/index.html` at 17:29:47 local time. Independent browser DOM
inspection in a fresh local session exposed the complete accessible-name set
`Physical pixel ID 0..125`; selected ID 0 showed
`x=47.03`, `y=39.68`, and `rotation=30.1°`.

## Status, limits, and open issues

- Task scope and simulator implementation: **AUTHOR-APPROVED**.
- Reference integrity, deterministic extraction, centre count, slot
  bijection, identity preservation, image registration, hexagon pose, build,
  lint, and automated tests: **VERIFIED**, including independent quantitative
  validation of geometry and identity.
- Physical interpretation and hardware identity of photographed cells:
  **PROVISIONAL**. No handwritten identifier was used and no domain-validation
  claim is made.
- The photograph is not a calibrated orthographic survey. Paper perspective,
  camera perspective, lighting, hand-cut silhouette variation, and threshold
  sensitivity remain in the coordinates and orientations.
- A threshold-sensitivity ensemble preserved all 126 detections and all colour
  counts. Centre variation was 0.305 pixels at p95; one bottommost blue
  hexagon (slot 79) reached 6.284 pixels under the aggressive `B-R>24`
  threshold. This single silhouette is explicitly threshold-sensitive even
  though the declared pipeline is byte-deterministic.
- The editor uses fixed-size idealized CSS hexagons/pentagons. It cannot
  reproduce photographed per-cell scale, shear, or irregular cut edges.
- The input image lives in an operating-system temporary path. Its exact hash,
  dimensions, and size are recorded, but a durable redistribution decision was
  not authorized.
- Existing version-2 and version-1 browser records are migrated once to v3 as
  documented above. This intentionally replaces their former pose and shape
  edits so all existing users receive the approved photo alignment, while
  preserving physical identity assignments and annotations. Existing valid v3
  records are not rewritten.
- No commit, push, deployment, publication, manuscript change, or physical
  domain validation was performed.
