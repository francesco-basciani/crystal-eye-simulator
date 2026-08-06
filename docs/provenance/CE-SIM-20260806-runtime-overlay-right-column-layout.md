# CE-SIM-20260806-runtime-overlay-right-column-layout

## Task and authorization

- Date: 2026-08-06 (Europe/Rome).
- Objective: diagnose and mitigate the opaque localhost `Script error.`
  overlay, place the photon light curve in the right-hand Photon Stream panel,
  and render the configured planar detector map at full right-column width
  without changing its geometry or physical identity.
- Baseline revision:
  `6806527bba0088c8bb7eaf10a74af55a2a6cefc2`.
- Authorization: **AUTHOR-APPROVED** for simulator implementation. No commit,
  push, deployment, publication, manuscript change, or physical-model change
  was authorized.

## Inputs and versions

1. Author-supplied error screenshot:
   `/var/folders/h_/mmzhw2t13wz1m25tgks2mkqh0000gn/T/codex-clipboard-e689bf3c-75b1-4bb5-97ba-b84a0d6f277c.png`
   - 1326 x 396 pixels;
   - SHA-256:
     `0bb1f6146aae149f652e95ea672c63c1ea2c377425a7ec9642bfd47891621a6d`.
2. Repository source and bundled detector configuration at the baseline
   revision.
3. Canonical local Node.js runtime: `v24.14.0`.
4. Relevant installed packages: vinext `0.0.50`, Vite `8.0.13`, Next.js
   `16.2.6`, React `19.2.6`, Three.js `0.185.1`, and Wrangler `4.92.0`.
5. Browser verification viewport: 1280 x 720 CSS pixels at
   `http://localhost:3000/`.

No random seed applies to the layout, source checks, or build. Runtime photon
simulation continued normally but its stochastic values were not used as
evidence for this task.

## Observed facts, inference, and requirements

### Observed facts

- The screenshot contains only an opaque cross-origin `Script error.` reported
  by `node_modules/vinext/dist/server/dev-error-overlay.js`; it contains no
  application stack or actionable source location.
- A clean local page load exposed no application error in the browser console.
  The only repeatable console entry was the pre-existing Three.js
  `THREE.Clock` deprecation warning.
- Diagnostic development-server logs showed reload activity and transient RSC
  fetch failures while generated `.next/` and `out/` build trees were being
  rewritten. Those trees are production outputs, not development inputs.
- Before the layout change, the light curve was in the left column while its
  navigation heading, `PHOTON STREAM`, was in the right column.
- The right detector map already consumed the configured `x`, `y`, and
  `rotationDeg` values directly, but its flexible track could clip the map and
  its cells used `6.8%` width. The configurator intended a `1.18` aspect ratio,
  but independent width and height constraints could render it at another
  ratio.

### Diagnostic inference

- Generated build-file reloads can produce a transient cross-origin error that
  vinext can report only as `Script error.`. The screenshot alone cannot prove
  a unique initiating exception, so this remains a bounded diagnostic
  inference rather than an application-stack attribution.

### Approved UI/runtime requirements

- Prevent `.next/` and `out/` production artifacts from triggering development
  HMR.
- Do not show a full-screen overlay for an opaque, non-actionable cross-origin
  error; retain browser-console diagnostics.
- Place the light curve directly below the Photon Stream heading in the right
  column.
- Preserve every configured pixel's position, rotation, shape, and physical
  ID; use the full right-column width at exactly the configurator's `1.18`
  aspect ratio.
- Reduce right-map cell width slightly so adjacent cells do not crowd.

## Decisions and implementation

- `vite.config.ts` ignores `**/.next/**` and `**/out/**` in the development
  watcher and disables only the Vite HMR overlay with
  `hmr: { overlay: false }`. Browser-console error reporting remains enabled.
  Seatbelt polling settings are merged into the same watcher configuration.
- `app/page.tsx` moves the existing `SignalChart` instance, without changing
  its data or calculations, from the left panel to immediately below the
  right-panel Photon Stream heading.
- `app/globals.css` gives the right panel explicit content rows and vertical
  overflow for short viewports. The detector section reserves its header,
  summary, and full-width map height so the map is not clipped.
- At desktop heights up to 900 pixels, nonessential chart/header detail is
  hidden and chart, status, and test-burst controls use compact spacing. This
  keeps the complete 329-pixel-wide map and all right-panel controls inside a
  720-pixel-high browser canvas without side-column scrolling.
- Both the configurator and right map now resolve to an actual `1.18` rendered
  aspect. The same configured percentage positions and rotations remain the
  source for both views.
- Right-map cells use `5.2%` width, down from `6.8%`. The configurator retains
  its `5.4%` editing cells; the right-map display cells are therefore slightly
  smaller than the editor cells without changing their centres.
- `tests/dashboard-layout.test.ts` adds source-level regression checks for
  chart ownership, geometry coordinate/rotation wiring, aspect/full-width CSS,
  cell size, overlay configuration, and ignored build-output trees.

## Files and integrity

Modified or added:

- `app/page.tsx`;
- `app/globals.css`;
- `vite.config.ts`;
- `tests/dashboard-layout.test.ts`;
- this provenance record.

Pre-record implementation hashes:

- `app/page.tsx`:
  `397c46331a6062d803458ec32b95089242d5840d838fa603b37d1e0a8fd09a7c`;
- `app/globals.css`:
  `87abff69fda7ba8ae0ef0296528b2429a759786c0626b5fd4d5b6312f8fab9d3`;
- `vite.config.ts`:
  `77c4af1dc9d06393ad2996b79f5ba35d5733f60e09ae931ed1c16a28c18afdf8`;
- `tests/dashboard-layout.test.ts`:
  `35c1a6169c6fb454c7ed0b88aa9f98055db4cc258985cfd276d1e6a53df5d75b`.

Physical/configuration artifacts were not modified. Their hashes remain:

- `app/data/crystal-eye-pixel-configuration.v1.json`:
  `6631149e895aa005182504b7f1196b1301137425cbaae516152e5f8e3d27f36f`;
- `public/data/pixbkg.txt`:
  `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d`.

## Agents, tools, and execution results

- `ce_coordinator`: authorization boundary, diagnosis, implementation,
  browser verification, and provenance.
- `simulator_engineer`: delegation was attempted before implementation but the
  global agent-thread limit prevented the role from starting. The coordinator
  therefore applied the minimal patch directly.
- `quantitative_validator`: independent validation was attempted after the
  implementation, but the same thread limit prevented the role from starting.
  Automated and browser checks below are verified execution evidence, but not
  an independent-agent audit.
- Tools: Git, SHA-256, Node test runner, ESLint, Next static build, vinext local
  development server, and in-app browser DOM/console/layout inspection.

Commands and results with Node.js 24.14.0:

```sh
npm test
# PASS: 32/32, including three dashboard/runtime regression tests

npm run lint
# PASS

npm run build:pages
# PASS: compiled, TypeScript checked, and 5/5 static pages generated

git diff --check
# PASS

git diff --quiet HEAD -- app/data app/lib public/data
# PASS: no physical/configuration/library data diff
```

Fresh browser verification after the production build reported:

- no `UNHANDLED SCRIPT ERROR` overlay;
- zero console errors and only the known `THREE.Clock` warning;
- one right-column Photon Stream chart and zero left-column chart instances;
- right panel `clientHeight=630` and `scrollHeight=630`, hence no side-column
  scrolling at 1280 x 720;
- 126 detector cells;
- right detector map `329 x 278.8125` CSS pixels, rendered aspect
  `1.18000448` (rounding from the declared `1.18`), full right-column width,
  and fully contained in its detector section;
- configurator canvas rendered aspect `1.17999285`;
- exact equality for all 126 configurator/right-map `x`, `y`, and rotation
  style triples;
- first right-map cell computed width `17.1016px`, corresponding to the
  declared `5.2%` map width.
- compact component heights at 1280 x 720: chart `66.5px`, persistence status
  `30.5px`, background status `30.7422px`, and test-burst panel `113px`.

## Status, limits, and open issues

- Implementation scope: **AUTHOR-APPROVED**.
- Tests, lint, static build, source-level contracts, physical-data non-change,
  and browser layout measurements: **VERIFIED** by the implementing
  coordinator.
- Independent quantitative-agent validation: **NOT COMPLETED** because the
  global agent-thread limit remained exhausted; no stronger independence claim
  is made.
- Physical model, detector identity, background profile, and simulation
  calculations: unchanged. No new physical claim or domain validation is
  involved.
- Disabling the Vite HMR overlay applies to all development errors. Developers
  must use the browser console and terminal for diagnostic detail; those paths
  remain active.
- Ignored `.next/` and `out/` changes intentionally do not hot-reload the
  development page. Source changes remain watched.
- The right panel becomes vertically scrollable when the viewport is too short
  to display the full map and burst controls simultaneously; the detector map
  itself is never squashed or clipped.
- The pre-existing Three.js `THREE.Clock` deprecation warning remains outside
  this task.
- No commit, push, deployment, publication, manuscript edit, dependency
  change, dataset change, or external service was performed.
