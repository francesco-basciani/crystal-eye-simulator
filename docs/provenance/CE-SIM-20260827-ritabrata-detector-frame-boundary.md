# CE-SIM-20260827 — Ritabrata detector-frame boundary

## Record status

- Task date: 2026-08-27 (Europe/Rome)
- Approved baseline: `b8a275783327dff679dabd4204f876158c7e392c`
- Remote checkpoint: `github/main` at the same commit and annotated tag
  `checkpoint/pre-ritabrata-frame-2026-08-27`
- Author decision: migrate scientific detector directions to Ritabrata's
  ROOT convention while preserving the current Three.js scene through an
  explicit rigid adapter.
- Implementation status: IMPLEMENTED OFFLINE
- Scientific/domain status: `PROVISIONAL`; roll and raw `upCal` axis semantics
  require domain confirmation.
- Publication status: no push, deployment, runtime activation of CEGenGRB, or
  publication of its large converted assets was performed.

## Objective and scope

Remove the implicit detector-frame ambiguity between the standalone Ritabrata
algorithms and the simulator. Scientific angular data and algorithm outputs are
now tagged as ROOT detector-local coordinates: `+Z` is the polar/boresight axis
and `phi = atan2(Y,X)`. Existing rendering, mount, albedo and UI consumers remain
in the established Three.js detector-local convention: `+Y` is boresight and
`phi = atan2(-Z,X)`.

No UI behavior, pixel identity, planar layout, payload placement, orbit model,
or light-source model was changed in this task.

## Evidence and adapter decision

The exact proper rotation from Ritabrata/ROOT coordinates `R` to the existing
Three.js local coordinates `S` is:

```text
S = Rx(-90 deg) R = [R.x, R.z, -R.y]
R = Rx(+90 deg) S = [S.x, -S.z, S.y]
```

Consequently `+X_R -> +X_S`, `+Y_R -> -Z_S`, and `+Z_R -> +Y_S`. This is a
rigid, orientation-preserving rotation, so norms, dot products, angular
separations and pixel incidence rankings are preserved. The numerical
`theta/phi` values are also preserved across the two declared formulas.

All 126 `pixbkg.txt` angular records were checked: converting their ROOT-angle
unit vectors through the adapter produces exactly the Three.js normals used by
the pre-migration geometry (maximum component difference in the implemented
formula: zero within JavaScript arithmetic).

### Important `upCal.txt` exception

The raw three-component rows from `upCal.txt` are consumed literally by
`CELoc.cc`. Comparison against the current pixel normals found that these stored
numbers already numerically match the simulator's `+Y` geometry (maximum angular
difference about `0.000484 deg`, mean about `0.000111 deg`). Their authoritative
physical axis meaning has not been supplied. They are therefore **not rotated or
reinterpreted**. They carry the separate fail-closed tag
`CELOC_UPCAL_RAW_COMPONENT_ORDER_UNVALIDATED`.

ROOT `+Z` applies to template `theta/phi`, CEGenGRB database directions and the
final direction constructed by the localizer. The localizer returns both the
canonical ROOT result and the explicitly adapted Three.js compatibility result.

## Implementation

- Added frame-tagged vector types and constructors; incompatible vectors cannot
  cross typed boundaries without an explicit adapter or unsafe cast.
- Added exact ROOT-to-Three and inverse rotations plus ROOT spherical helpers.
- The V2R8 geometry now exposes `scientificNormal` in ROOT coordinates and keeps
  adapter-derived `normal` for all existing Three.js consumers.
- Pixel-background angular metadata is declared ROOT `+Z`.
- Ritabrata localizer and CEGenGRB manifests require the exact ROOT frame tag.
- `upCal` raw vector storage has its own exact tag and remains byte/numerically
  unchanged.
- Localizer ROOT output is adapted once at its compatibility boundary; its
  reported `theta/phi` remain derived from the canonical ROOT vector.
- Asset loaders and numerical cores fail closed on incompatible frame metadata.

The assumed detector roll is the pre-existing minimum-rotation attitude used by
the simulator. No scientific roll calibration or spacecraft attitude product is
available; this task does not claim one.

## Deterministic asset-metadata changes

The localizer response gzip, source file hashes and provenance digest are
unchanged. Only explicit frame metadata changed in the tracked JSON files:

| File | Before SHA-256 | After SHA-256 |
|---|---|---|
| `ritabrata-localizer.manifest.json` | `c15afbfedd63d7462f185e56b1b950b99000030dd70da66ca35e0105963c577a` | `afefef86beffde3b1dcae20b4b5b08f9fe6314b30a6db093e32da1c040642a8f` |
| `ritabrata-localizer-samples.json` | `63c8ff81931feefe870624cd4734cd0b243e68cbdf90b74fe66abc0d3e26757d` | `de3e30de52ae776232f8f12ecc1c46d540d9f48dec77ecf3121ce4fcddc6d524` |

The converter scripts emit the same explicit metadata. `upCal` component values
and all sample/count arrays remain unchanged.

## Files added or modified

- `app/lib/detector-local-frame-adapter.ts`
- `app/lib/detector-geometry-v2r8.ts`
- `app/lib/legacy-template-localizer.ts`
- `app/lib/pixel-background.ts`
- `app/lib/ritabrata-localizer-assets.ts`
- `app/lib/ritabrata-grb-generator.ts`
- `app/lib/ritabrata-grb-generator-assets.ts`
- `scripts/convert-ritabrata-localizer.py`
- `scripts/convert-ritabrata-grb-generator.py`
- `scripts/validate-ritabrata-localizer.ts`
- `public/data/ritabrata-localizer/ritabrata-localizer.manifest.json`
- `public/data/ritabrata-localizer/ritabrata-localizer-samples.json`
- focused frame, geometry, localizer, GRB generator, asset and background tests
- this execution record.

## Commands and results

```text
node --experimental-strip-types --test tests/*.test.ts
# PASS: 134/134

npx tsc --noEmit
# PASS

node --experimental-strip-types scripts/validate-ritabrata-localizer.ts
# PASS; both frozen derived characterizations unchanged

npx eslint . --ignore-pattern dist --ignore-pattern .next
# PASS: 0 errors; 1 pre-existing no-img-element warning in app/page.tsx

GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/crystal-eye-simulator npx next build
# PASS; five static routes generated

git diff --check
# PASS
```

Focused tests cover basis mapping, inverse round-trip, angle preservation, all
126 scientific/compatibility normal pairs, ROOT-to-Three localizer output, raw
`upCal` preservation, and fail-closed rejection of incompatible localizer and
CEGenGRB frame metadata.

## Agents and tools

- Coordination and implementation:
  `/root/port_ritabrata_grb_generator`
- Independent read-only scope audit:
  `/root/port_ritabrata_grb_generator/audit_frame_migration_scope`
- Tools: Git, SHA-256, Node.js, TypeScript, Node test runner, ESLint, Next.js.

## Limits and required gates

1. Ritabrata/domain experts must confirm the authoritative physical axis meaning
   of `upCal.txt` and why its stored components differ from the ROOT spherical
   convention used by the same algorithm.
2. A spacecraft attitude/roll definition is still required before converting
   detector-local directions into scientifically defensible celestial RA/Dec.
3. The existing localizer ROOT parity gate and CEGenGRB provenance/parity gates
   remain unchanged and fail closed.
4. This migration demonstrates internal coordinate consistency; it does not
   validate localization accuracy, detector physics, or celestial attitude.
5. Author approval and domain validation remain required before scientific
   claims, runtime activation, asset redistribution or publication.
