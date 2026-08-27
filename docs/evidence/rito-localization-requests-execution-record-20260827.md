# GRB localization requests — execution record

- Task ID: `CE-DT-20260827-RITO-LOCALIZATION-COMPARISON`
- Date: 2026-08-27 (Europe/Rome)
- Status: `PROVISIONAL`
- Author approval: Francesco Basciani explicitly requested implementation of Rito's four simulator requests in this thread.
- Publication status: local implementation only; no push or deployment authorized in this task.

## Objective

1. Compare positive-excess centroid and template/KS localization on identical GRB responses.
2. Keep requested→CEGen database, database→reconstruction, and requested→reconstruction angular separations distinct.
3. Accept injected source directions as detector-frame ROOT `theta/phi` as well as equatorial RA/Dec.
4. Integrate the supplied nominal 2-degree CELoc grid while retaining the nominal 5-degree grid for A/B comparison.

## Inputs and provenance

| Input | Source | SHA-256 | Notes |
|---|---|---|---|
| `srcpos-2deg.txt` | Rito shared Google Drive, file ID `1ZvcEVFJweJGIVwdwEAgkNyzh_Jhz_28t` | `7e24ff750917e621e626fb58b5946c35457f6677c30db8bc111de6a913c27f22` | 4,980 unique directions |
| `temEdepPix2deg.root` | Rito shared Google Drive, file ID `1Jp_DSPS5ODZKN0c2XijFbbiqSPDUweTU` | `4bfc14d11afb9476861c3897e3f5540b6b76e44f23734a5241e13d69f9bcf571` | 492,992,899 bytes; ROOT format 6.32.00 |
| `CELoc.cc` | Rito shared Google Drive | `99b0ba5321070aa10c3de218174221fb9320b66ba896628e0eae2214114fce04` | Reference implementation |
| `upCal.txt` | Rito shared Google Drive | `5164b59df7df244855d1f7a30385385eab460f30d2af2e0bb5ba3acbe4f942c6` | Source row order retained |
| `allEffArea.root` | Rito shared Google Drive | `d2cbbeee10dd545a968ab926c4007af964013056b6a2a26767c99cf170d6ec85` | Effective area, theta 0–90° |
| CEGenGRB web manifest | repository baseline `16baa78` | `0c1c608ad0c541936d70ea3472ee4b164b1fd069c7b54ab7cb64d1cf2cd01922` | Existing approved generator trust root |
| CELoc nominal 5° manifest | repository baseline `16baa78` | `74b3b64c196089cbe81ae3b2725315b0054900d4f34bb4ad7918d4e93f11ce98` | 742 templates |
| `pixbkg.txt` | repository baseline `16baa78` | `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d` | Centroid candidate normals input |
| `detector-geometry-v2r8.ts` | repository baseline `16baa78` | `45b2ed1e7b7f5b42fa854be8a88d576ad3d1ce8775618cfa7cd155eff3733f89` | Centroid normals construction |
| `burst-direction-reconstruction.ts` | repository baseline `16baa78` | `0f441b38c9b3664568085634d1d3174ebff0aa242f2e245cdc6f11d27e3fb028` | Positive-excess centroid implementation |
| `detector-local-frame-adapter.ts` | repository baseline `16baa78` | `19add650a95291b918ae50af75085faa33722030d437574680401be9dfea9cbe` | ROOT/Three detector-frame transform |

The ROOT source files remain outside the repository. Only derived web assets are in the local worktree.

## Domain confirmations and permission

The domain contributor confirmed in the project email thread that: source normalization is in photons cm^-2 keV^-1 s^-1, spectral index is dimensionless, and peak energy is in keV; 1,296 cm² is the fixed Monte Carlo photon-generation surface; angular projection is already included in the simulated directional response; detector theta is measured from detector +Z and phi is measured in the XY plane from +X; all 985 CEGenGRB directions are intentional. The contributor also explicitly allowed conversion and public distribution of derived web-optimized response data while the original ROOT database remains excluded from the repository. These confirmations are source statements, not independent physical validation.

## Agents, tools, and environment

- Coordination/implementation: `ce_coordinator` and `simulator_engineer` responsibilities executed in the local Codex task.
- Independent checks: `quantitative_validator` and `reproducibility_auditor`; both operated read-only.
- Conversion: Python 3.12.2; independent clean-environment audit used Python 3.12, NumPy 2.5.2, and uproot 5.7.6.
- Simulator/benchmark/test runtime: bundled Node.js 24.19.0. Project minimum is Node 22.13.0; the host default Node 16 is insufficient for `--experimental-strip-types`.
- Host: macOS Darwin 25.5.0, arm64. Runtime measurements are not hardware-normalized.
- Baseline Git commit: `16baa78`. Final candidate commit: pending author-authorized checkpoint; must be added before third-party handoff.

## Conversion and implementation decisions

- The converter was generalized to accept `--grid 5deg|2deg`; the template count is derived from the supplied direction file rather than assumed.
- Every one of the 4,980 declared 2° ROOT histograms was found with shape 126×100 and a unique integer-truncated name.
- The 2° response is 250,992,000 bytes uncompressed and 172,855,804 bytes as one gzip file. It was deterministically split into five shards of 31.8–37.1 MB to keep each Git object below 100 MB and permit hash verification.
- Forty-one template/pixel cells contain energy-axis overflow values. `CELoc.cc` includes these values through ROOT `TH2::ProjectionX` defaults after scaling only normal energy bins. The port therefore stores them in a separate unscaled projection-flow asset and adds them during projection. They were not silently discarded.
- The nominal 5° grid remains the UI default. The nominal 2° grid is selectable but is not declared validated or made default because official CELoc C++/ROOT parity remains pending and its transfer/computation cost is materially higher.
- The labels “2°” and “5°” are treated as domain-author names, not claims of an exact theta step.

## Derived 2° web assets

- Manifest: `c81131bba54231bbd06505b100c4700293879a1421d4f8b901c0cacaadff3538`
- Provenance: `9318b020035b140c0d0a12bca045a8372a19b5d8e1be2ceb6e4d5d9dc76bf9c8`
- Response shards:
  - `d74f359ad25d48bf8a36f0be2c7a4927c04f5cbd3bcc9e17efbd197d049a1331`
  - `eaab5f700e019f19eccc0e09218e73c67c83987719a257bd2033736c46addb52`
  - `078cad365942bd36da71e2fc68b124e364aaaa64a586059ec7fa5867a445acb7`
  - `c9115ea9c5717cd1fd71f5ffdea09becdf8df260f82880da8e5e772286ae47ce`
  - `7aa07adaab7b22a0ccc65b40dde1aeccd701678d948580928c51756bb5a28bd3`
- Projection-flow asset: `22235264223c843b3c0702e5d95bba330ef36c1f8b9671d6bf0978f874d161a8`

## Benchmark protocol

- Generator: CEGenGRB nearest-database response, 985 directions.
- Spectrum: cutoff power law `A=0.026 photons cm^-2 keV^-1 s^-1`, `alpha=-1.07`, `Epeak=756.4 keV`.
- Inputs: source-only expected responses; no Rito background, celestial background, Poisson sampling, duration, or light curve.
- Methods receive the same generated 126-pixel response.
- Random algorithm: Mulberry32, seed `20260828`.
- Global suite: 128 directions uniformly distributed in solid angle over the upper hemisphere.
- Zenith suite: six detector-theta bands `[0,15)`, `[15,30)`, `[30,45)`, `[45,60)`, `[60,75)`, `[75,90]`; 24 directions per band, uniformly distributed in solid angle inside the band; 144 total.
- Percentiles: Hyndman–Fan type 7 empirical percentiles, not confidence intervals.
- Durable results:
  - `docs/evidence/grb-localizer-comparison-20260827.json`, SHA-256 `fbc12fba71d3537276d119f13a4d38c82e021b6e4a10441a0d968a8a4a17496c`
  - `docs/evidence/grb-localizer-comparison-stratified-theta-20260827.json`, SHA-256 `4c6d0277da662d00bcf2a2e3dcd2ecf1819bce9fa71c087d36fa930d93515f41`

### Global 128-case result

| Method | Successful | Requested→reconstructed median | p95 | Median calculation time |
|---|---:|---:|---:|---:|
| Positive-excess centroid | 128/128 | 17.361° | 33.110° | 0.082 ms |
| Template/KS nominal 5° | 128/128 | 3.309° | 6.825° | 178.078 ms |
| Template/KS nominal 2° | 128/128 | 2.560° | 5.328° | 1,157.621 ms |

On paired cases, nominal 5° KS had lower requested→reconstructed error than the centroid in 120/128 cases; nominal 2° KS did so in 123/128 cases. These are internal synthetic characterization results, not detector performance claims.

### Equal-N detector-zenith result

Each row uses 24 paired cases. “Wins” counts cases in which the indicated KS grid has a strictly lower requested→reconstructed error than the positive-excess centroid.

| Requested detector θ | Centroid median | KS 5° median | KS 5° wins vs centroid | KS 2° median | KS 2° wins vs centroid | KS 2° wins vs KS 5° |
|---|---:|---:|---:|---:|---:|---:|
| 0°–15° | 2.062° | 3.849° | 3/24 | 2.510° | 9/24 | 20/24 |
| 15°–30° | 4.010° | 3.395° | 14/24 | 2.223° | 20/24 | 18/24 |
| 30°–45° | 9.900° | 3.019° | 24/24 | 2.293° | 24/24 | 15/24 |
| 45°–60° | 16.960° | 3.532° | 24/24 | 3.138° | 24/24 | 15/24 |
| 60°–75° | 23.835° | 3.780° | 24/24 | 3.336° | 24/24 | 17/24 |
| 75°–90° | 32.178° | 3.535° | 24/24 | 2.313° | 24/24 | 19/24 |
| **All equal-N bands** | **13.273°** | **3.568°** | **113/144** | **2.647°** | **125/144** | **104/144** |

This stratified source-only suite shows a method interaction with detector zenith: the centroid is lower-error in most 0°–15° cases, whereas both KS grids are lower-error in every sampled case from 30° to 90°. This is a descriptive result for this synthetic protocol, not a detector-performance or generalization claim.

A direct paired KS 2° versus KS 5° statistic is stored for every case: KS 2° had lower requested→reconstructed error in 104/144 stratified cases and KS 5° in 40/144, with no exact ties. Thus 2° is lower-error more often in this protocol, but not on every individual case. Runtime figures are single-host descriptive measurements and varied on independent rerun; they are not performance guarantees.

Both evidence files now retain all per-case requested, selected-database, and reconstructed detector directions plus the three angular errors for each successful method. Deterministic scientific-case digests are `a27e25706fb2e7e8d97215896e0fe34c945dd32fb178040b1f2523d3db1e802a` (global 128) and `f45c963e4d93ef861bb72ec5445138616b207999b32518c6b71f8099a3093660` (stratified 144). Host-dependent `runtimeMs` values are retained in the evidence but explicitly excluded from these digests.

The simulator exposes this summary in a dedicated `LOCALIZATION COMPARISON` dialog. The dialog is labeled `PROVISIONAL`, `source-only`, and `noise-free`, and its compact constants are verified against the durable JSON by an automated test.

## Commands and checks

```text
curl -L 'https://drive.usercontent.google.com/download?id=1rfJUfU8dX6tfX2tSRrQpJfH62oVpaTD6&export=download&confirm=t' -o CELoc.cc
curl -L 'https://drive.usercontent.google.com/download?id=1XRglTfOSB9SuOiGRF5okQrjMepl0MtcE&export=download&confirm=t' -o upCal.txt
curl -L 'https://drive.usercontent.google.com/download?id=1yqtIT39ob3SDJtnCzD8RW1ia1Dgl2m0F&export=download&confirm=t' -o allEffArea.root
curl -L 'https://drive.usercontent.google.com/download?id=1ZvcEVFJweJGIVwdwEAgkNyzh_Jhz_28t&export=download&confirm=t' -o srcpos-2deg.txt
curl -L 'https://drive.usercontent.google.com/download?id=1Jp_DSPS5ODZKN0c2XijFbbiqSPDUweTU&export=download&confirm=t' -o temEdepPix2deg.root
shasum -a 256 CELoc.cc upCal.txt allEffArea.root srcpos-2deg.txt temEdepPix2deg.root
python3 scripts/convert-ritabrata-localizer.py /path/to/verified-source /tmp/ritabrata-localizer-2deg-converted --grid 2deg
python3 scripts/shard-ritabrata-localizer-response.py /tmp/ritabrata-localizer-2deg-converted /tmp/ritabrata-localizer-2deg-sharded --templates-per-shard 1000
npm run validate:localizer-grids
npm run benchmark:grb-localizers
npm run benchmark:grb-localizers:stratified
npm test
npm run lint
npm run build:pages
```

The two npm benchmark commands expand to the exact generator directory, evidence output path, sample count, and both 5° and 2° localizer directories recorded in `package.json`.

- Asset validators: PASS for 742- and 4,980-template grids.
- Unit/integration tests: 140/140 PASS, including an exact comparison-dialog projection check against the durable stratified JSON.
- Lint: zero errors; one pre-existing Next.js `<img>` performance warning.
- GitHub Pages build: PASS.
- Browser QA on `http://localhost:3000/`: detector-frame θ=40°, φ=120° ran end to end on both grids. Independent root QA also ran θ=45°, φ=120° on 2° after first-load (quantization 1.33°, requested→KS 1.57°, requested→centroid 12.63°). The dedicated comparison dialog opened with the overall row, all six theta bands, and the direct 2°-versus-5° paired counts visible. No application errors were observed. One unrelated Three.js deprecation warning was present.

## Independent audit outcomes

- Quantitative audit: `VERIFIED` for internal deterministic angular metrics. Both suites were rerun with zero difference in aggregate angular summaries; independent direct angular-separation checks agreed within 5.6×10^-12 degrees and Type-7 percentile checks matched. Scientific method validity remains `PROVISIONAL`.
- Reproducibility audit: after correcting deterministic JSON key order, a clean Python environment reproduced all eight derived 2° files byte-for-byte from the hashed ROOT inputs. Validator PASS: 4,980 templates, 250,992,000 response bytes, and 41 projection-flow cells.
- Publication/claim gate: not passed. No final commit exists yet, official identical-input C++/ROOT parity is pending, and domain/author validation of scientific interpretation is pending.

## Limits and open gates

- `CELoc` TypeScript output has not yet been compared with official C++/ROOT outputs for identical observations; status remains `PROVISIONAL`.
- CEGenGRB and CELoc databases are not an independent test set.
- The centroid comparison uses the current candidate 126-pixel physical normals from `pixbkg.txt`; its strong zenith-dependent bias requires domain review before interpretation.
- Asset loading time is excluded from the per-event calculation times. The first 2° use transfers approximately 173 MB compressed and expands approximately 253 MB including projection flow.
- Rito should confirm that nominal “2°/5°” means target angular grid separation, since theta-ring increments are not exactly 2°/5°.
- Scientific interpretation and any claim of improved localization require physicist validation and explicit author approval.
- Google Drive is mutable and non-archival. The Drive IDs and SHA-256 checks permit present-day verification, but the source package should later be deposited in an immutable research archive.

## GitHub Pages packaging decision

The first publication attempt from commit `ecbbf60` built successfully but the GitHub Pages deploy timed out after 10 minutes because the generated artifact was 267 MB. The scientific assets and numerical results were not changed. The 2-degree bundle remains versioned and content-hash verified in Git, while the browser loads it lazily from the immutable raw GitHub URL pinned to commit `ecbbf60`. It is stored outside `public/` in subsequent commits so that it is not duplicated in each Pages deployment artifact. The 5-degree default bundle remains packaged with the application. This hosting-only change preserves the approved manifest hash and all member hashes.
