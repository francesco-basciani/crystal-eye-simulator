# CE-SIM-20260826 — Ritabrata CEGenGRB offline TypeScript port

## Record status

- Task date: 2026-08-26 (Europe/Rome)
- Repository baseline: `4e95430` (`Port Ritabrata template localizer offline`)
- Author approval: explicit “Vai prosegui!!” for the recommended standalone
  generator/localizer porting workflow.
- Implementation status: IMPLEMENTED OFFLINE · RUNTIME FAIL-CLOSED
- Numerical status: golden fixture regression `VERIFIED` within recorded tolerances
- Scientific/domain status: `PROVISIONAL` · domain validation required
- Publication status: no push, deployment or asset publication performed.

## Objective

Acquire and characterize `CEGenGRB.cc`, convert its ROOT response database into
a browser-efficient representation, implement its deterministic numerical core
in TypeScript, and validate the result against Ritabrata's supplied ROOT output.
The generator is deliberately not connected to the simulator UI or current GRB
claims.

## Source and acquisition

- Author-supplied public Drive folder:
  `https://drive.google.com/drive/folders/1XosKmP1SEb-Vz4olmh5lS_itQ0W7koA5`
- Acquisition tool: isolated `gdown 5.2.0` environment.
- Acquisition directory: `/tmp/cegen-source-20260826`.
- The supplied C/C++ and binaries were not compiled or executed.
- ROOT inputs were read with uproot; no ROOT executable was installed or run.
- `Materiale/` and `Appunti/` were not modified.

| Input | Bytes | Drive file ID | SHA-256 |
|---|---:|---|---|
| `CEGenGRB.cc` | 7,084 | `1arh3EdEkcH33qdkS66CWwxUJY0a2xklb` | `3a497b2eeace489bf0d78de2d25ea1c864e2927a229b95d241bd510265112487` |
| `srcpos-sam-set7.txt` | 26,065 | `1F0jwd-cts6Hteg9Xq0mI1mDA7RbLdpxl` | `4a228215e4fc369f2b11dd65a3ec3bba7334e2436bb4db1ede16809fb159453e` |
| `sampleDataSet.root` | 697,869,601 | `1DymlekOoLOQkq0vE9fH0bahN3j7c-2eH` | `2f3ca611e3252aac0cac2c5f12ee470d66a75914cba0f9d3c7aa23ff21749ba2` |
| `sampleSrc_41_117.root` | 9,575 | `1bZsJJoXEzNTOFRlFiV75N4VkkItvu82y` | `dc146bd6678ceb70667695f66180add745fd64946b4135ba95ab83ffbf897ffe` |

Canonical sorted source-hash digest:
`ac3ecb79f205c1d7436e9343b01f61211800abf03f0cae0e06ff892980fb40ea`.

## Observed algorithm

1. Read detector-local `(theta, phi)` sample positions.
2. Select the single database direction with minimum spherical separation from
   the requested direction.
3. Load its primary-energy histogram and deposited-energy event tree.
4. Define the cut-off power law
   `A (E/100)^alpha exp[-(alpha+2) E/Epeak]`.
5. Integrate that spectrum in each primary-energy bin and multiply by the
   hard-coded `4 × 18 × 18 = 1,296 cm²` source area.
6. Normalize by the number of simulated primaries in the corresponding bin.
7. Attribute each weighted event fractionally to its hit pixels using
   `pixEdep/totEdep`; histogram the same event weight by total deposited energy.
8. Write `hNormEdepPix` and `hNormEdepTotCal`.

`hNormEdepPix` is therefore not a raw hit count: it is a soft event-rate
distribution split across pixels by deposited-energy fraction. The code adds no
background, GRB duration/light curve, Poisson sampling or separate response for
the three physical pixel levels.

## Verified database structure

- The supplied email states 984 directions, but both inputs contain **985**:
  985 unique position rows and 985 matching `TH1F`/`TTree` pairs.
- ROOT version recorded in the source file: 6.32.00.
- 27,508,624 detected-event records.
- 100 logarithmic primary/deposited-energy bins, approximately 30–100,000 keV.
- 126 pixel IDs (`0..125`).
- Direction coverage: theta 1.18096°–89.9813°, phi 0.663897°–359.731°.
- No integer-truncated ROOT response-key collision was found.

The default request `(40°,120°)` selects the stored direction
`(41.9897995°,117.1460037°)`, separated by 2.7317145°. The filename/key
`41_117` is only a truncated identifier. Requested direction, selected direction
and separation are preserved separately by the TypeScript contract.

Independent Monte Carlo coverage characterization (`seed=20260826`, 1,000,000
uniform upper-hemisphere queries) found a nearest-neighbour median of 2.140°,
95th percentile 4.512°, 99th percentile 5.699° and sampled maximum 8.761°.
No scientific acceptance threshold has been supplied.

## Conversion design

The event database is pre-aggregated into first- and second-moment kernels:

- primary-energy × pixel mean;
- primary-energy × pixel variance;
- primary-energy × deposited-energy mean;
- primary-energy × deposited-energy variance.

Second moments are required to reproduce the histogram errors consumed by
`CELoc.cc`. Each database direction is one independent gzip member. The manifest
records member byte offsets, lengths and SHA-256 hashes, enabling an HTTP Range
loader to fetch only the selected direction rather than shipping the 698 MB ROOT
file or every converted response.

Current full converted sizes (not committed or published):

| Asset | Compressed bytes | Uncompressed bytes | SHA-256 |
|---|---:|---:|---|
| pixel mean | 31,794,218 | 49,644,000 | `8defd2df8ee92ae9e1914a0d658bf432e4d5fda179cae49f744538d1f8614a71` |
| pixel variance | 32,061,632 | 49,644,000 | `6131c4a92ac3a3830879184a3f1bc9552c0a4d921de00f4f704417cb2e8ee70b` |
| deposited-energy mean | 5,453,761 | 39,400,000 | `cea5de1de9d7b4335f5a31ecff29ae758af7ababa935c75f36990ee7bd17d76b` |
| deposited-energy variance | 5,450,387 | 39,400,000 | `5962641d8a21d65597ff5ade3a1826c1ae3ccc9291c36dcdd1fa29dbc7030728` |

Final offline manifest SHA-256:
`c927d78eb3004fe9caf1d786dff8933c0fcb14cb22f2d6ba8845becedc71ff1a`.
Golden JSON SHA-256:
`7a56f7fc343c3d5a89718932880df7907f60140496bbbd00dd74b701f669cc24`.

The four converted kernel files were byte-identical across two conversions
before and after a golden-metadata precision correction. No converted database,
golden fixture or source asset is tracked in Git pending explicit redistribution
permission.

## TypeScript implementation and regression

The TypeScript implementation provides:

- spherical nearest-neighbour selection;
- Float32 parameter boundaries matching the `Float_t` C++ inputs;
- cut-off power-law evaluation and adaptive integration;
- response generation from mean/variance kernels;
- explicit requested/selected directions and quantization error;
- range-addressable gzip loading with member SHA-256 verification;
- runtime fail-closed behavior until parity metadata is bound to the exact
  asset provenance.

Golden output from `sampleSrc_41_117.root`:

- pixel total: 3,788.386864 counts/s;
- deposited-energy total: 3,788.389383 counts/s;
- relative total difference: `6.648×10^-7`.

Independent direct-event replication using 128-point Gauss–Legendre quadrature
reproduced all histogram contents bit-for-bit and pixel errors within
`1.20×10^-9`. The converted-kernel TypeScript regression passed with:

| Output | Maximum absolute difference | Maximum relative difference |
|---|---:|---:|
| pixel counts | `4.0961×10^-5` | `9.5895×10^-7` |
| pixel errors | `3.9281×10^-8` | `2.1703×10^-8` |
| deposited-energy counts | `6.7988×10^-4` | `7.5112×10^-5` |
| deposited-energy errors | `2.8623×10^-7` | `6.8899×10^-5` |

These differences result from pre-aggregation/Float32 boundaries and remain
inside the recorded regression tolerances. They establish implementation
replication for this fixture, not detector accuracy or physical validation.

The new golden differs from the earlier similarly named localization sample:
3,788.39 versus 3,845.24 counts/s. Their SHA/version identities must not be
merged.

## Files added or modified

- `app/lib/ritabrata-grb-generator.ts`
- `app/lib/ritabrata-grb-generator-assets.ts`
- `scripts/convert-ritabrata-grb-generator.py`
- `scripts/validate-ritabrata-grb-generator.ts`
- `tests/ritabrata-grb-generator.test.ts`
- `package.json`
- this execution record.

## Reproduction

```text
python3 -m venv /tmp/cegen-converter
/tmp/cegen-converter/bin/pip install \
  -r scripts/requirements-ritabrata-localizer.txt
/tmp/cegen-converter/bin/python \
  scripts/convert-ritabrata-grb-generator.py \
  /path/to/source-directory /tmp/cegen-converted
node --experimental-strip-types \
  scripts/validate-ritabrata-grb-generator.ts /tmp/cegen-converted
npm test
npx tsc --noEmit --allowImportingTsExtensions --incremental false
npm run lint
npm run build:pages
git diff --check
```

Recorded project result: 129/129 tests passed; production GitHub Pages build
passed; lint passed with zero errors and one pre-existing `no-img-element`
warning in `app/page.tsx`; `git diff --check` passed.

## Agents and tools

- Coordinator/implementation: `/root/port_ritabrata_grb_generator`.
- Physics requirements analysis:
  `/root/port_ritabrata_grb_generator/analyze_cegen_physics`.
- Independent quantitative validation:
  `/root/port_ritabrata_grb_generator/validate_cegen_assets`.
- Tools: Git, SHA-256, isolated Python 3.12 environments, NumPy 2.5.2,
  uproot 5.7.6, Node/TypeScript, gzip.

## Open domain and author gates

Ritabrata/domain experts must confirm:

1. exact units and allowed ranges for `A`, `alpha` and `Epeak`;
2. why the TF1 domain is 20–1,000,000 keV while transformed data cover
   approximately 30–100,000 keV;
3. physical meaning of the fixed 1,296 cm² area and whether angular projection
   is already represented by the Monte Carlo database;
4. intended semantics of fractional pixel event rates;
5. 985 directions versus the stated 984;
6. detector-local axis orientation and authoritative pixel-ID mapping;
7. geometry, Geant4 version, cuts, seed and primary statistics used to generate
   `sampleDataSet.root`;
8. intended treatment of GRB duration, temporal profile, background and
   statistical sampling;
9. the future three-neighbour interpolation formula and validation target.

The author must explicitly approve asset redistribution, runtime activation and
any scientific claim. Until then the public API returns
`asset-parity-unverified` and no simulator behavior changes.
