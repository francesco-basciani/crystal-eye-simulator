# CE-SIM-20260821 — Physical mount geometry mapping correction

## Task

- Date: 2026-08-21
- Objective: remove isolated detector-response holes caused by mapping physical V2R8 modules onto unrelated synthetic hemisphere slots.
- Author decision: correct the physical mapping without changing the author-supplied planar pixel configuration, rotations, shapes, annotations, or physical IDs.
- Publication status: local checkpoint only; not pushed or deployed by this task.

## Inputs and observed defect

- Canonical planar layout: `app/data/crystal-eye-pixel-configuration.v3.json`.
- Physical angular geometry and IDs: `public/data/pixbkg.txt`, 126 records over IDs 0–125.
- Satellite top surface: 60 × 60 cm; Crystal Eye radius: 15 cm.
- The former greedy `getV2R8CandidateSphereSlots` bridge assigned physical IDs 112, 117, and 122, whose polar angles are respectively 24.1021°, 20.5521°, and 12.0384°, to the synthetic outer ring. At centered placement their sky visibility became approximately 0.015, suppressing the response by about 98.5% and producing isolated cyan/blue pixels among yellow pixels.
- The planar layout and ID bijection were not the cause and remain unchanged.

## Implementation

- Sun, Moon, burst transmission, mount field-of-view statistics, and Earth-albedo support now use the physical module normals derived directly from `pixbkg.txt`.
- A module center is projected onto the satellite top plane as
  `x = 30 mountX + 15 normalX`, `z = 30 mountZ + 15 normalZ`, in centimetres.
- Mount visibility is continuous in the physical normal and retains the existing 4.5 cm engineering attenuation length.
- Nadir albedo remains a point-center model: a module has no invented finite footprint or partial exposed area.
- Earth albedo is restricted to the physical outer crown. The supplied angular data contain a separated outer band at approximately 82.2°–82.4°, after the preceding band at at most 72.2°; the implementation uses an 80° boundary between those bands.
- Only outer-crown module centers extending beyond the opaque 60 × 60 cm platform can receive nadir Earth albedo, and only for positive local solar incidence.

## Files changed

- `app/lib/earth-albedo-occlusion.ts`
- `app/page.tsx`
- `tests/earth-albedo-occlusion.test.ts`
- `tests/payload-mount-visibility.test.ts`
- this execution record

## Agents and tools

- Author: approved correction and preservation of the supplied pixel configuration.
- `ce_coordinator`: verified the root cause and coordinated the bounded implementation.
- `simulator_engineer`: implemented the initial physical-normal bridge.
- Root agent: reviewed, restored/extended tests, enforced outer-crown-only albedo, and performed final verification.
- Tools: local source inspection, patch application, bundled Node toolchain, and read-only browser inspection at `http://localhost:3000/`.

## Verification

- ESLint: pass.
- TypeScript no-emit: pass.
- Automated tests: 104/104 pass.
- Dedicated regression: centered-mount sky visibility is 0.9531 for ID 112, 0.9720 for ID 117, and 0.9952 for ID 122; all three are classified as inner modules and have zero nadir exposure instead of the former erroneous approximately 0.015 visibility.
- Dedicated albedo tests: centered payload has no nadir-exposed pixel center; edge/corner placements expose only mount-dependent subsets of the physical outer crown; nightside and inner modules remain zero.
- Browser Simulation Mode at 74% direct-Sun exposure: IDs 117, 112, and 122 had continuous non-zero heat values 0.7337, 0.4495, and 0.5821 respectively; no former approximately 0.015 suppression remained.
- Browser script-error overlay: 0; browser console errors: 0.
- Production build: recorded after final command below.

## Limits and open questions

- The module-center projection assumes a 15 cm spherical radius and does not yet use metric per-crystal center coordinates or finite crystal footprints.
- The 4.5 cm mount attenuation length remains an engineering visualization/simulation assumption requiring domain validation.
- The 80° outer-crown boundary is unambiguous in the current supplied angular bands but its detector-topology interpretation should still be confirmed by the physics team.
- A separate ID 105/107 neighbourhood inconsistency between planar topology and angular records was observed during review. It does not cause the 112/117/122 defect and is not changed here; it requires a physics mapping confirmation rather than an implicit software correction.
