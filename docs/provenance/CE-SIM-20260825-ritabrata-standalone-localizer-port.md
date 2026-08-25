# CE-SIM-20260825 — Ritabrata standalone localizer TypeScript port

## Record status

- Task date: 2026-08-25 (Europe/Rome)
- Implementation status: IMPLEMENTED OFFLINE · RUNTIME FAIL-CLOSED
- Scientific status: `PROVISIONAL`
- Verification status: STRUCTURE `VERIFIED`; ROOT numerical parity `PENDING`
- Repository baseline: `df21859` (`Stage Melissa satellite ground track`)
- Author approval: explicit “Vai prosegui!!” after presentation of the proposed
  ROOT-to-binary conversion, TypeScript port and parity-test plan.
- Publication status: no push, deployment or publication authorized or performed.

## Objective

Acquire the standalone Crystal Eye single-source localization package supplied
by Ritabrata, convert its ROOT assets offline into a browser-efficient format,
port the numerical algorithm to TypeScript, characterize the two supplied
samples, and preserve a fail-closed runtime boundary until independent ROOT
golden outputs and energy-resolved simulator input are available.

The detector-local to spacecraft/RA-Dec conversion is explicitly outside this
task and remains separate.

## Author-supplied source

- Public Drive folder supplied in the project email thread:
  `https://drive.google.com/drive/folders/1XosKmP1SEb-Vz4olmh5lS_itQ0W7koA5`
- Package author: Ritabrata (name used in the supplied repository/email).
- Durable downloaded archive used for acquisition:
  `/Users/basciani/Downloads/CrystalEyeLocalization-20260825T161106Z-1-001.zip`
  (76,301,034 bytes; SHA-256
  `f3f0deb9aac57c5acbd48abca5503da26418cc1b7c2bbbf9c14420f552cfcc05`).
- Local immutable acquisition used for conversion:
  `/tmp/ce-localization.8KsGFg/CrystalEyeLocalization`
- The supplied Linux ELF executable was inspected as a file and never executed.
- `Materiale/` and `Appunti/` were not modified.
- Acquisition method: public Google Drive folder export. The converter manifest
  records the eight individual Drive file IDs as well as their hashes. A
  repeatable alternative is `gdown --folder <Drive-folder-URL>` followed by
  verification against the hashes below; generated `Build/` contents are not
  converter inputs.

### Source SHA-256

| File | SHA-256 |
|---|---|
| `CELoc.cc` | `99b0ba5321070aa10c3de218174221fb9320b66ba896628e0eae2214114fce04` |
| `CMakeLists.txt` | `396b1f271234de694bb000feebc32b1c8245f840568e7a1025fbcbd8e06e729d` |
| `upCal.txt` | `5164b59df7df244855d1f7a30385385eab460f30d2af2e0bb5ba3acbe4f942c6` |
| `srcpos-5deg.txt` | `e1a544f017ab5a91572b410f2e1fa2ec20c21c80d438acc10c71956b51cb7450` |
| `allEffArea.root` | `d2cbbeee10dd545a968ab926c4007af964013056b6a2a26767c99cf170d6ec85` |
| `temEdepPix5deg.root` | `95a0f9cb13e114a5e24fdcc4af8c5395df47c12f8a55d45c063efe7f91ce9104` |
| `sample-src-41-117.root` | `d279556abaa851bd9f98d1b3324102d9a9fb34c2773e543a572aca8c47e7e854` |
| `sample-src-74-349.root` | `a084a3b567c58e21c57facd7333f1bc08aa17c040e62794f988dfd0c589b2783` |

The manifest provenance digest is SHA-256 over the canonical sorted JSON map
of these hashes:
`99556c2ac8d2bd5f4e3ae31017de85583fa042d5d8de31e0f65aacd1c2c55dbf`.

## Inputs and structure verified

- 126 unique pixel IDs (`0..125`) and 126 `(x,y,z)` positions.
- 91 effective-area `TH1F` objects (`hEffArea0` through `hEffArea90`).
- 100 common logarithmic energy bins, approximately 30–100,000 keV.
- 742 detector-local template directions.
- 742 matching `TH2F` responses, each `126 × 100` in
  `(pixel, deposited-energy-bin)` layout.
- Two samples containing `hNormEdepPix` (126 bins), stored pixel errors and
  `hNormEdepTotCal` (100 bins).
- ROOT file format version declared by the inputs: 6.32.00.

The generated dense response contains 9,349,200 little-endian Float32 values:
37,396,800 bytes uncompressed and approximately 25 MiB gzip-compressed.
Compressed SHA-256:
`87582b14a5f8c2e4affc4fddd70d59e940a3e54d31493022e6176f0adf7a2959`.

Final converted output SHA-256 values:

- manifest: `c15afbfedd63d7462f185e56b1b950b99000030dd70da66ca35e0105963c577a`;
- sample fixtures: `63c8ff81931feefe870624cd4734cd0b243e68cbdf90b74fe66abc0d3e26757d`;
- gzip response: `87582b14a5f8c2e4affc4fddd70d59e940a3e54d31493022e6176f0adf7a2959`.

## Algorithm ported

The implementation follows `CELoc.cc`:

1. calculate a provisional count-weighted pixel-position vector;
2. take ROOT `TVector3::Theta`, cap it at 90 degrees and truncate to select
   `hEffArea<int(theta)>`;
3. divide the sample calorimeter spectrum by effective area and bin width;
4. scale every template pixel/energy cell by that incident spectrum;
5. project each template to 126 pixel values;
6. apply ROOT `TH1::KolmogorovTest` shape-only semantics, after assigning the
   sample errors to the template projection;
7. retain templates with probability at least 1% of the maximum;
8. calculate the probability-weighted mean ROOT direction vector.

ROOT `TMath::KolmogorovProb` and the relevant default-option 1-D
`TH1::KolmogorovTest` logic were independently checked against the official
ROOT 6.30 source (semantics are also present in the supplied 6.32-era files):

- `https://root.cern.ch/doc/v630/TH1_8cxx_source.html#l08095`
- `https://root.cern.ch/doc/v630/TMath_8cxx_source.html#l00679`

Float32 storage boundaries in `TH1F`, `TH2F`, `Float_t` probabilities and
`Float_t` accumulated probability are deliberately reproduced with
`Math.fround`.

The returned C++ weighted vector is also retained as
`weightedDirectionVector`. `localDirection` is its normalized form for safe
downstream directional use; normalization does not change theta or phi.

## Explicit fidelity decisions and defects discovered

### Pixel row order — preserved for characterization

`upCal.txt` is ordered lexicographically (`0, 1, 10, 100, ...`), while
`CELoc.cc` reads but ignores the ID column and pushes vectors in file order.
Reordering by ID would be a scientific correction rather than a literal port.
The converter therefore preserves source-file row order until Ritabrata
confirms the intended mapping.

This behavior produces provisional centroid theta values of about 91.63 and
113.26 degrees for the supplied samples; both select `hEffArea90` after the
source-code cap.

### Probability filter — deterministic intended behavior

The supplied C++ erases elements from `fVProb` while range-iterating the same
`std::vector`, which invalidates iterators and is undefined behavior. The
TypeScript port implements the stated deterministic rule
`probability >= 0.01 * maximumProbability` without mutation during iteration.
This deviation must be approved by the algorithm author before parity can be
declared.

### Zero-probability guard

The C++ can divide by zero when every probability is zero. TypeScript returns
`zero-template-probability` instead of producing NaN.

## Derived sample characterization

These values were independently replicated from the supplied arrays and the
published ROOT formulas. They are **not** official ROOT golden outputs and do
not establish algorithm accuracy.

| Fixture | Filename direction label | Derived TypeScript theta | Derived TypeScript phi | Selected templates |
|---|---:|---:|---:|---:|
| `sample-src-41-117` | `(41°,117°)` | `42.183986°` | `124.786313°` | 2 |
| `sample-src-74-349` | `(74°,349°)` | `74.394207°` | `-6.634992°` (353.365008°) | 3 |

If, and only if, the filenames encode injected truth, the independently
calculated great-circle separations are approximately 5.300° and 4.218°.
That filename interpretation requires confirmation from Ritabrata.

## Runtime decision

The new numerical core is not connected to simulated bursts and does not
replace the current engineering centroid. The simulator currently lacks:

- a 100-bin deposited-energy observation for each event;
- stored per-pixel statistical errors in the required semantics;
- a validated mapping between the simulator's pixel vector and `upCal` order;
- verified ROOT output for either supplied sample;
- a validated detector-local-to-spacecraft attitude transformation.

`localizeWithLegacyKsTemplates` therefore returns
`root-ks-parity-unverified`. `computeLegacyKsLocalization` is exposed only for
offline characterization and testing. The 25 MiB response is loadable lazily
and is never fetched during ordinary simulator startup.

The runtime observation contract explicitly carries and checks geometry
version, direction frame, pixel IDs/order and energy-bin edges against the
asset bundle. Future adapters cannot become available by matching dimensions
alone. Parity metadata is bound to both a golden-output SHA-256 and the exact
asset provenance SHA-256; both are empty while parity is pending.

## Tools and agents

- Coordination and implementation: `/root/port_ritabrata_localizer`.
- `simulator_engineer` read-only integration audit:
  `/root/port_ritabrata_localizer/inspect_localizer_integration`.
- `quantitative_validator` independent structural and numerical audit:
  `/root/port_ritabrata_localizer/analyze_ritabrata_algorithm`.
- `reproducibility_auditor` independent clean-environment audit:
  `/root/port_ritabrata_localizer/audit_localizer_reproducibility`.
- `scientific_reviewer` adversarial candidate review:
  `/root/port_ritabrata_localizer/review_localizer_candidate`.
- Tools: Git, SHA-256, isolated Python 3 virtual environment, `numpy`,
  `uproot`, Node/TypeScript, gzip, ESLint and Next.js build.
- No Geant4 or ROOT executable was installed or executed.
- Random seed: not applicable; acquisition, conversion and localization are
  deterministic and contain no random operation.

## Files produced or modified

- `app/lib/legacy-template-localizer.ts`
- `app/lib/ritabrata-localizer-assets.ts`
- `scripts/convert-ritabrata-localizer.py`
- `scripts/requirements-ritabrata-localizer.txt`
- `scripts/validate-ritabrata-localizer.ts`
- `public/data/ritabrata-localizer/ritabrata-localizer.manifest.json`
- `public/data/ritabrata-localizer/ritabrata-localizer-samples.json`
- `public/data/ritabrata-localizer/ritabrata-template-response.f32.gz`
- `tests/legacy-template-localizer.test.ts`
- `tests/ritabrata-localizer-assets.test.ts`
- `package.json`
- this execution record.

## Reproduction commands

Conversion uses Python 3.12.2, NumPy 2.5.2 and uproot 5.7.6. Install the pinned
tool-only environment before conversion:

```text
python3 -m venv /tmp/ce-localizer-converter
/tmp/ce-localizer-converter/bin/pip install \
  -r scripts/requirements-ritabrata-localizer.txt
```

Then convert:

```text
python scripts/convert-ritabrata-localizer.py \
  /path/to/CrystalEyeLocalization \
  public/data/ritabrata-localizer
```

Validation and project checks:

```text
npm run validate:ritabrata-localizer
npm test
npx tsc --noEmit --allowImportingTsExtensions --incremental false
npm run lint
npm run build:pages
git diff --check
```

Recorded results for this candidate:

- converter repeated into a second temporary directory: byte-identical
  manifest, sample fixture and gzip response (`PASS`);
- `npm run validate:ritabrata-localizer`: `PASS` for both derived
  characterization fixtures; ROOT parity remains explicitly pending;
- `npm test`: 124/124 `PASS`, including an end-to-end local HTTP fetch,
  SHA-256 verification, gzip decompression and typed-array loader test;
- TypeScript no-emit check: `PASS`;
- GitHub Pages production build: `PASS`, 6/6 static pages;
- ESLint: zero errors, one pre-existing `no-img-element` logo warning;
- `git diff --check`: `PASS`.

The independent reproducibility audit repeated acquisition and conversion in
a fresh environment and obtained byte-identical outputs. Its verdict is
`PASS WITH CONDITIONS` for offline structural/derived characterization and
`FAIL` for ROOT-equivalent/scientific localization claims, which remain
explicitly disabled.

## Human/domain gates still open

Ask Ritabrata to confirm:

1. exact `CELoc` output theta/phi for both sample files, ROOT version and
   compiler;
2. whether the sample filenames encode injected theta/phi;
3. whether `upCal.txt` must be indexed by its first-column ID;
4. approval of the deterministic 1%-filter correction;
5. local axes, handedness, photon-arrival convention and canonical phi range;
6. the effective-area selection rule and intended interpolation, if any;
7. the statistical meaning of `hNormEdepPix` errors;
8. the official mapping between V2R8 IDs and simulator/display IDs.

Before changing `rootParity.verified` to true, add a durable golden artifact
containing the official ROOT outputs, tolerances, ROOT/compiler versions and
asset provenance. Its externally reviewed SHA-256 must be frozen in an
independent test; a hash declared only inside the asset manifest is not a
sufficient trust anchor.

Additional gates:

- obtain explicit permission before redistributing the supplied/derived assets
  through GitHub or GitHub Pages;
- receive or implement a domain-validated energy-resolved sample generator;
- obtain physics-team domain validation and final author approval before
  declaring the method validated or using it for scientific conclusions.

## Known limits

- KS p-values on weighted, binned histograms are not automatically calibrated
  confidence levels.
- The source uses effective-area division as an approximate correction and
  contains a TODO for a real unfolding method.
- The absolute maximum probabilities for the two fixtures are small; the
  supplied algorithm uses a relative cut only.
- No uncertainty region/confidence ellipse is produced.
- The algorithm assumes a single source.
- The standalone code performs no background subtraction; it consumes the
  supplied normalized sample histograms. A future adapter must define and
  validate preprocessing rather than silently subtracting simulator terms.
- Local theta/phi is not RA/Dec.
