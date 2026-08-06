# CE-SIM-20260806-pixel-geometry-physical-identity

## Task and authorization

- Date: 2026-08-06 (Europe/Rome).
- Objective: adopt the author-supplied manual 126-pixel geometry and replace
  the split internal/display numbering with one physical pixel identity that
  matches the `pixbkg.txt` domain `0..125`.
- Baseline revision:
  `04a1f1210edbef6534a7315c148a83f1734c6631`.
- Author authorization: **AUTHOR-APPROVED** for implementation in the
  simulator on 2026-08-06. No deployment, publication, or manuscript claim was
  authorized.
- Existing approved provisional contract: `pixel_id 0..125` maps directly to
  the simulator's physical pixel identity, as recorded in
  `CE-SIM-20260802-pixbkg-integration.md`.

## Inputs and integrity

1. Manual geometry:
   `/Users/basciani/Downloads/crystal-eye-pixel-configuration-2.json`
   - size: 26852 bytes;
   - SHA-256: `e2ebe03c8adcfd553f7916110fa4b8d2783842234ef82e0b1dae7348a7dd9d12`;
   - schema: legacy version 1, 126 entries.
2. Background profile:
   `/Users/basciani/Downloads/pixbkg.txt`
   - size: 3391 bytes;
   - SHA-256: `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d`;
   - byte-identical to `public/data/pixbkg.txt`.
3. Visual reference:
   `/var/folders/h_/mmzhw2t13wz1m25tgks2mkqh0000gn/T/codex-clipboard-b4b6ba58-a2fc-465c-b615-5c2c240ca288.png`
   - size: 2461411 bytes;
   - SHA-256: `b4d6e256fd76b01e64abc18b44dddc6a439faf3637f4bed2b16eefdadce90684`.

The bundled geometry is reformatted JSON, so its byte hash is different:
`a3e6964249f214701e8851f86aae4d41a15eed35168325dc075415c6b4b1b741`.
Canonical `jq -S` serialization of supplied and bundled JSON is identical with
SHA-256
`70c58fae8debeac1848369aa8b1259399abf3bc630bf429b5ebf8a238c22cc51`.

## Observed facts and requirements

- The manual JSON contains exactly 126 ordered geometry entries, 96 gray
  cluster members, 30 red seam/triplet members, and six pentagons at legacy
  geometry slots `6, 23, 39, 54, 70, 86`.
- Its legacy IDs are the bijection `PX-001..PX-126`; one legacy
  `secondaryId` value (`123`) is present.
- `pixbkg.txt` contains exactly the ordered physical IDs `0..125`.
- The reference image has two handwritten numbers on many cells; several are
  overwritten or not reliably legible. It is sufficient to corroborate the
  overall cluster/triplet pattern but not to establish a defensible ID mapping.
- Required public/runtime identity: one numeric `pixelId` in `0..125`.
  Geometry-array positions remain private implementation slots.

## Decisions implemented

- Schema version 2 exposes and persists only `pixelId: number` as identity.
- A legacy v1 `PX-N` bijection migrates to `pixelId = N - 1`. If legacy
  display IDs are noncanonical, saved geometry is retained and IDs are
  canonicalized by geometry slot.
- Changing a pixel to an occupied ID atomically swaps the two identities,
  preserving the exact `0..125` bijection.
- The legacy `secondaryId` is retained only as `legacyAnnotation`, explicitly
  labelled as not being a pixel ID and never used by runtime behavior or map
  labels.
- Background arrays and detector response arrays are indexed by physical ID;
  each geometry cell resolves its background using
  `pixelBackground.records[configuredPixel.pixelId]`.
- Selection, burst target and footprint, event log, colors, labels, titles,
  ARIA, persistence, import, and export use physical IDs.
- Manual planar geometry is projected to the fixed spherical sampling through
  one cached Hungarian assignment. The mapping is bijective; illumination,
  mount visibility, event rendering, and the 3D model reuse the resulting
  `physical pixelId -> sphere slot` mapping.
- The handwritten numbers in the image were not transcribed or inferred.

## Implementation artifacts

- `app/data/crystal-eye-pixel-configuration.v1.json`: bundled manual input.
- `app/lib/pixel-configuration.ts`: v1 migration, v2 normalization, bijection
  validation, physical-ID lookup, and atomic swap.
- `app/page.tsx`: physical-ID runtime integration, geometry projection,
  persistence migration, editor, labels, and ARIA.
- `tests/pixel-configuration.test.ts`: default geometry, migration, user-work
  preservation, swap, background identity, export shape, and negative import
  cases.

Final hashes before this record was added:

- `app/page.tsx`:
  `e3efea71504de305eafce71c9170a6a82c195a0d6698a97f411c266d18513fcb`;
- `app/lib/pixel-configuration.ts`:
  `37fc6cb7a9adca089d04f52cc5a0fc8517d1f7ec1181f30464251fc01d3adbd9`;
- `tests/pixel-configuration.test.ts`:
  `975b7816edf6b618015a1baee956eeb0c497674b3b1e1d18775f9c4eb486bda0`.

## Agents and tools

- `ce_coordinator`: scope, identity contract, human gate, and provenance.
- `simulator_engineer`: implementation and tests.
- `quantitative_validator`: independent geometry, identity, projection, and
  negative-case audit.
- Tools: Git, SHA-256, `jq`, byte comparison, Node 24 test runner, ESLint,
  Next static build, TypeScript, local vinext server, DOM/accessibility
  inspection, and browser screenshots.
- Random seed: not applicable to geometry, migration, or background lookup.
  No stochastic result was used as evidence.

## Commands and results

Canonical runtime path used for Node commands:

```sh
export PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node --version
# v24.14.0

npm test
# PASS: 28/28

npm run lint
# PASS

npm run build:pages
# PASS: compiled, TypeScript checked, 5/5 static pages generated

git diff --check
# PASS

diff -u \
  <(jq -S . /Users/basciani/Downloads/crystal-eye-pixel-configuration-2.json) \
  <(jq -S . app/data/crystal-eye-pixel-configuration.v1.json)
# PASS: no differences
```

Independent projection calculation found a 126/126 bijection. Only one manual
geometry slot has the same numeric spherical slot, confirming that lighting
and visibility cannot safely reuse a raw geometry index. Example assignments:
`0->2`, `1->8`, `2->11`, `6->0`.

The independent quantitative audit completed with **PASS**:

- 1787 field-level geometry assertions passed with zero tolerance;
- the swap `0 <-> 125` moved the expected background values with the physical
  IDs: ID 125 retained `32.803 counts/s` (`6.5606 counts/bin`) and ID 0 retained
  `41.1497 counts/s` (`8.22994 counts/bin`);
- all 126 assigned spherical slots were unique; under the swap, ID 0 moved
  from sphere slot 2 to 120 and ID 125 moved from 120 to 2;
- negative cases for a missing, duplicate, negative, out-of-range,
  non-integer, or missing-record physical ID were rejected;
- an independent Node 22.13.1 run also passed 28/28 tests, lint, TypeScript,
  the static build, and prerendering.

Local UI inspection at `http://localhost:3000/` confirmed:

- 126 detector buttons with unique accessible names `Physical pixel ID 0`
  through `Physical pixel ID 125`;
- the selected summary and editor show only `PIXEL ID N`;
- the editor exposes the legacy value only under `LEGACY NOTE - NOT PIXEL ID`;
- editing physical ID `0` to occupied ID `125` leaves exactly one UI node for
  each ID and updates the selected pixel to `125`; the draft was cancelled and
  not persisted;
- the manual cluster/triplet arrangement is rendered as the default;
- no runtime console errors were observed. One pre-existing Three.js
  deprecation warning for `THREE.Clock` was observed.

## Status and limits

- Input integrity and canonical geometry equality: **VERIFIED**.
- Physical-ID bijection, migration, swap, background lookup, build, and tests:
  **VERIFIED**.
- Implementation scope: **AUTHOR-APPROVED**.
- Physical interpretation of the background-to-hardware mapping:
  **PROVISIONAL**, consistent with the earlier approved simulator contract but
  not domain-validated.
- Handwritten image ID mapping: **INCONCLUSIVE** and not implemented.
- The reference image was used only for qualitative visual comparison; no
  image registration or calibrated geometric error metric was available.
- Random burst selection still uses unseeded `Math.random()`. Deterministic
  mapping and test-burst consumers were verified, but a particular random
  runtime sequence is not bit-for-bit reproducible.
- No simulator deployment, publication, commit, push, manuscript change, or
  domain-validation claim was made.
