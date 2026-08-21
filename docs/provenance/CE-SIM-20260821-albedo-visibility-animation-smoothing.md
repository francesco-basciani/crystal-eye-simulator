# CE-SIM-20260821 — Earth-albedo visibility and animation smoothing

## Task

- Date: 2026-08-21
- Objective: make a physically non-zero Earth-albedo response visibly identifiable on the exposed outer detector crown and remove avoidable stutter from the 3D orbital animation.
- Status: `VERIFIED` as a software behavior; Earth-albedo magnitude and visual cue remain `PROVISIONAL` pending domain validation.

## Inputs and scope

- Existing 126-pixel V2R8 candidate geometry and author-supplied pixel configuration.
- Existing Sun/Moon/satellite ECI replay and binary satellite-platform nadir occlusion model.
- Existing 0.2 s acquisition cadence, signal composition, and IndexedDB photon archive.
- No files in `Materiale/` or `Appunti/` were changed.
- No scientific count, timestamp, ECI, source, or persistence cadence was changed.

## Agents and tools

- `ce_coordinator`: read-only diagnosis of the albedo support and renderer hot paths.
- Primary agent: implementation, local browser verification, lint, type-check, tests, and production build.
- Tools: repository search, patch editing, Node.js test/build runtime, and the local in-app browser.

## Observations

- With a corner payload placement and sunlit Earth, the existing model produced a positive Earth component on 26 outer pixels; the local UI reported `26 exposed outer pixels receiving albedo`.
- At the centered placement, the current binary nadir-ray model correctly produces zero exposed pixel centers because the 60 × 60 cm platform blocks the detector from below.
- The previous Earth-only color occupied only a narrow blue-to-cyan range and its 3D emissive/scale change was difficult to perceive on nearly tangential crown faces.
- The animation loop updated 120 invisible GRB particles and uploaded two particle buffers on every rendered frame even when no burst existed.
- The render-time spherical interpolation allocated multiple temporary arrays and frozen results for each celestial direction on every frame.
- Every successful 0.2 s IndexedDB append also caused an additional React render solely to advance the visible archive counter.

## Decisions and implementation

- Preserve the exact Earth count vector and its mount-dependent support.
- Strengthen only the diagnostic Earth-albedo palette, border, glow, 3D emissive, and scale.
- Add one batched `THREE.Points` visual cue whose draw range contains only physical pixel IDs with positive Earth expected counts. It does not contribute to detector counts.
- Skip all particle calculations and GPU buffer uploads when no GRB particles are visible.
- Replace render-only array-based SLERP calls with an allocation-free equivalent writing into preallocated `THREE.Vector3` instances.
- Keep photon persistence at 5 Hz while publishing the non-scientific archive-count badge at most once per five successful records.
- Submit high-frequency dashboard telemetry and analysis history as React transitions so browser animation can retain priority.
- Do not change the default payload placement; changing center to edge/corner requires an explicit author decision.

### Follow-up: detector color interpolation

- Preserve the authoritative detector vectors as discrete 0.2 s samples.
- Convert each new detector frame into render-only material targets once per sample.
- Interpolate 3D pixel color, emissive color, emissive intensity, and scale from the currently displayed state, reaching the exact target after 120 ms. A retarget therefore remains continuous and a one-bin event reaches its intended visual state before the next 200 ms sample.
- Animate only pixel IDs whose visual target changed; the render loop performs no target recomputation and creates no temporary color objects.
- Replace the planar detector's transition-all rule with explicit 120 ms transitions for color, border, text, and opacity. Box-shadow is deliberately excluded to avoid repainting 126 blurred glows concurrently.
- The 120 ms duration is a `PROVISIONAL` presentation parameter and is never used by signal composition, persistence, filtering, or localization.

### Follow-up: strict zero-albedo visual state

- Browser reproduction established that the nightside scientific state was already exact: `Earth 0 c/s`, zero Earth-only DOM pixels, and zero overlap pixels.
- The misleading brighter outer ring came from two render-only effects: the 120 ms Earth-color falling edge and the emissive material being shared by both the sensitive cylinder cap and its highly visible side wall.
- On a positive-to-zero Earth transition, the Earth visual state is now cleared immediately instead of retaining a 120 ms cyan tail. Other source targets remain authoritative for the same frame.
- Pixel diffuse surfaces are dark and signal color is represented by emissive output, reducing false brightness caused by scene lighting while retaining the 3D mesh.
- Cylinder side/bottom faces now use a separate dark shared material; only the sensitive top cap receives detector-response colors. This prevents the crown side walls from looking like uniformly active pixels.
- A second isolated nightside check revealed residual false highlights from scene lighting, ACES tone mapping, the selected-pixel fill, and the translucent shell. Sensitive caps are therefore now unlit `MeshBasicMaterial` surfaces with `toneMapped=false`: their RGB is driven only by the detector response. Selection no longer alters 3D cap color, intensity, or scale.
- The backing shell is neutral, low-emission, and does not write the depth buffer. It cannot tint or occlude the response caps through their gaps.
- In the planar Detector Map, every pixel with zero excitation now uses the same canonical base blue and zero heat. Rito/background values remain available in numerical readouts and history but no longer masquerade as activation.
- Strong renderer invariant: without Sun, Moon, Earth, or GRB excitation, all 126 sensitive caps and all inactive planar pixels have the same canonical base color; camera, scene light, normal, payload mount, and selected ID cannot change it.

## Files modified by this task

- `app/page.tsx`
- `app/globals.css`
- `docs/provenance/CE-SIM-20260821-albedo-visibility-animation-smoothing.md`

## Verification

Browser verification at `http://localhost:3000/`:

- Script error overlay count: 0.
- Simulation Mode, corner placement, sunlit Earth: 26 positive outer-pixel Earth responses observed in the detector map.
- UI reconciliation example: `EARTH · 23% illuminated`, `26 exposed outer pixels receiving albedo`, `+7.4 c/s`.
- After the injected burst ended, the Earth contribution remained present and the 3D detector showed the strengthened crown cue.
- Follow-up browser verification: Simulation Mode active, no script-error overlay, 26 Earth-only planar pixels at `EARTH · 26% illuminated` and `+8.7 c/s` while the visual interpolation was enabled.
- Strict nightside browser verification: `EARTH · 0% illuminated`, `nightside · zero local solar incidence`, `0 c/s`, `GRB ×0`, zero Earth-only pixels, and no script error. Satellite Top View showed dark pixel side walls with only the canonical blue sensitive caps visible.
- Final isolated screenshot verification under the same zero-source state showed all sensitive 3D caps at one uniform base blue, with dark sides and no central or crown highlight.

Commands executed with the bundled Node 24 runtime:

```text
eslint . --ignore-pattern dist --ignore-pattern .next
tsc --noEmit --incremental false --tsBuildInfoFile /dev/null --allowImportingTsExtensions
node --experimental-strip-types --test tests/*.test.ts
vinext build
```

Results:

- ESLint: pass.
- TypeScript: pass.
- Tests: 96/96 pass.
- Production build: pass; existing chunk-size warning only.

## Limits and open questions

- The binary nadir-ray model does not model partial pixel area, scattering, wavelength/energy response, or calibrated albedo flux.
- The added point overlay is an explicitly diagnostic visual cue, not an additional physical signal.
- Browser QA confirms removal of the identified unnecessary work, but no instrumented frame-time benchmark has yet been archived.
- The payload remains centered for a new browser profile and therefore has zero Earth-albedo support until the author selects edge/corner placement in Configuration.

## Follow-up: continuous angular source response

### Objective and observed cause

- Remove the visually abrupt on/off transition when a strong source crosses the detector field-of-view or a payload-occlusion boundary.
- The discontinuity was not only a rendering issue: Sun and Moon counts were multiplied by binary angular gates, and mount visibility selected a single best pixel. Crossing either boundary could therefore remove a positive count contribution in one 0.2 s telemetry step.

### Author decision and implementation

- The author explicitly approved introduction of a gradual response on 2026-08-21.
- Sun and Moon now use a continuous angular acceptance
  `A(theta) = max(0, cos(theta))^2 * smoothstep(0, 1, (H - theta) / W)`,
  where `theta` and `H` are angles in degrees and the edge roll-off width is currently `W = 10 deg`.
- Payload visibility is a continuous positive-cosine-squared weighted average over the physical pixel directions instead of a winner-takes-all pixel selection.
- Earth albedo reaches exactly zero only at zero local solar incidence; arbitrarily small positive incidence remains continuous rather than being removed by a 0.01 threshold.
- The visual detector transition was increased from 120 ms to 220 ms. This affects presentation only; the scientific vectors remain sampled at the established cadence.
- Per-frame `pixel / maximumPixel` color normalization was replaced by the absolute continuous presentation mapping `1 - exp(-expectedCounts / 0.75 counts/bin)`. Source amplitude can therefore fade visibly instead of retaining a saturated color until the final non-zero frame.
- The earlier immediate 3D albedo clear is superseded: the final, already small terminator contribution now follows the same 220 ms visual transition to canonical blue.
- No validation-status label was added to the simulator UI.

### Status and limits

- The mathematical continuity and implementation are `VERIFIED` by automated tests.
- The 10 deg roll-off width, cosine-squared angular law, and 0.75 counts/bin presentation reference are engineering assumptions requiring calibration and domain validation before they can represent Crystal Eye's measured response.
- At the 500x time preset, each 0.2 s update advances about 100 simulated seconds, so the displayed transition is naturally sampled more coarsely than at 1x or 50x even though the response itself is continuous.

### Additional files modified

- `app/lib/angular-acceptance.ts`
- `app/lib/earth-albedo-occlusion.ts`
- `tests/angular-acceptance.test.ts`
- `tests/earth-albedo-occlusion.test.ts`

### Follow-up verification

- ESLint: pass.
- TypeScript: pass.
- Tests: 101/101 pass.
- Production build: pass; existing chunk-size warning only.
