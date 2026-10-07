# CE-SIM-20260908 — updated GRB pipeline 1,000-case benchmark

## Record status

| Field | Value |
| --- | --- |
| Task identifier | `CE-SIM-20260908-updated-grb-pipeline-benchmark-1000` |
| Task date | 2026-09-08, Europe/Rome |
| Evidence status | `PROVISIONAL` |
| Reproducibility classification | `LOCAL-REPEATABLE`; **not third-party reproducible** |
| Scientific validation | not domain-validated; C++/ROOT identical-input parity pending |
| Author status | local benchmark execution authorized; no scientific-result approval or publication authorization |
| Publication status | local, uncommitted and unpublished |

The canonical output is
`docs/evidence/rito-updated-grb-pipeline-benchmark-1000-20260908.json`.
It is 2,719,694 bytes and has SHA-256
`1cf2512b67606699ff148011df77f69eb62305a15e3989ad5a519cfb47378a06`.

This audit establishes internal consistency and same-host deterministic
repeatability for a fixed ten-case prefix. It does not establish that a third
party can reconstruct the result from the repository as currently published.
The benchmark script, relevant working-tree changes, converted assets, output,
and this record are not committed. The converted assets are also deliberately
not published. Hashes identify those local bytes but do not make them
available.

## Objective and fixed scope

The benchmark exercises the updated full-sample expectation generator against
the positive-excess centroid and the updated embedded-direction CELoc 5-degree
and 2-degree databases. It is a deterministic, source-only, noise-free
characterization. It is not an operational localization-performance estimate.

Protocol recorded by the runner:

- 1,000 requested directions;
- seed `20260907`, Mulberry32 pseudo-random generator;
- directions uniform in solid angle over detector-local
  `theta=[0,113] deg`, with `phi=[0,360) deg`;
- detector-zenith bin edges `[0,15,30,45,60,75,90,100,113] deg`;
- cutoff power-law parameters: normalization `0.026`, spectral index `-1.07`,
  peak energy `756.4 keV`;
- source-only deterministic expected response;
- background, Poisson sampling, light curve, duration, and occultation excluded;
- Hyndman-Fan type 7 empirical percentiles, descriptive and not confidence
  intervals.

No a priori scientific performance threshold, inferential hypothesis, or
generalization criterion was registered. Acceptance for this execution was
therefore limited to protocol identity, completeness, integrity, deterministic
case identity, and exact reconstruction of descriptive summaries. Method
ordering must not be presented as a validated detector-performance claim.

## Agents, decisions, and tools

| Responsibility | Agent or authority |
| --- | --- |
| Coordination and canonical execution | `ce_coordinator`, `/root/integrate_three_template_grb` |
| Independent reproducibility audit | `reproducibility_auditor`, `/root/integrate_three_template_grb/audit_1000_repro` |
| Prior implementation and tests | recorded in `CE-SIM-20260907-updated-grb-three-template.md` |
| Domain validation | none received for this benchmark |
| Final scientific approval | none received for this benchmark |

Tools used were Git, the bundled Node.js runtime, the Node test runner,
SHA-256 (`shasum` and Node `crypto`), `jq`, `curl`, and read-only host process
inspection. No commit, push, deployment, asset publication, or external write
was performed. `Materiale/` and `Appunti/` were not modified.

The integration decision inherited from the prior record is material: the
browser generator uses full-sample sufficient-statistic expectations, not the
C++ request-dependent prefix-event copy. The run retains `PROVISIONAL` status,
and the benchmark does not change that decision or close its validation gates.

## Repository and environment identity

- Repository root:
  `/Users/basciani/Sviluppo/Workspaces/CODEX/Crystal-Eye Fisica/crystal-eye-simulator`
- branch `main`, tracking `github/main`, base commit
  `73ffa29bb73b859a4cc55f9f5ba4db90b4626aca`, ahead/behind `0/0`;
- the repository was dirty and unstaged; the benchmark script and scientific
  asset directory were untracked, while several imported runtime files were
  modified relative to the base commit;
- canonical host: macOS 26.6.2, build `25G83`, Darwin 25.6.0, `arm64`;
- canonical runtime:
  `/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`,
  version `v24.19.0`;
- host PATH runtime: Node.js `v16.20.2`, which is not an acceptable substitute
  because it is below the repository engine requirement `>=22.13.0` and does
  not provide the required TypeScript strip behavior;
- `package.json` SHA-256
  `365d9d9e87e88ed709ea3cc67c293a338271a7ca9ebcecdb1dad3c8146d956b9`;
- `package-lock.json` SHA-256
  `bc8a4bf6d5ff6f08d0706d797cc563c268bb73231c0d8a1425248b9c15dfcf26`.

The benchmark runtime imports only Node built-ins and local TypeScript modules;
the package lock is retained as project-environment evidence. Exact conversion
dependencies for the local updated assets are not durably known. A temporary
inspection environment contained Python 3.12.2, NumPy 2.4.0, and uproot 5.7.2,
but there is no evidence that this exact environment generated every asset.
The existing `scripts/requirements-ritabrata-localizer.txt` instead pins NumPy
2.5.2 and uproot 5.7.6 and must not be retroactively attributed to this
conversion.

## Canonical execution

The following command ran from the repository root without
`CE_BENCHMARK_CASE_COUNT`, so the script defaulted to 1,000 cases:

```text
/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/benchmark-updated-grb-pipeline.ts scientific-assets/rito-updated-20260907/generator scientific-assets/rito-updated-20260907/localizer-5deg scientific-assets/rito-updated-20260907/localizer-2deg docs/evidence/rito-updated-grb-pipeline-benchmark-1000-20260908.json
```

- execution session: `45883`;
- operating-system PID: `62666`;
- process start: 2026-09-08 09:39:18 Europe/Rome;
- process exit: `0`;
- final progress: `1000/1000`, elapsed `803.3 s`;
- evidence `generatedAtUtc`: `2026-09-08T07:52:43.517Z`;
- runner inner-loop `totalRuntimeMs`: `803287.534875`.

The script and all imported files had modification times earlier than process
start and retained the same SHA-256 values after process completion.

## Executed source identity

| Path | SHA-256 |
| --- | --- |
| `scripts/benchmark-updated-grb-pipeline.ts` | `812aaf31456079fb47ae7923bc9adc3e984af181b01b787fd77e42ee96219548` |
| `app/lib/ritabrata-grb-generator.ts` | `996a4bc8be553bef7bf35fe43a2f1cb0b16ce4683aaf849be8a2077f2e9a833b` |
| `app/lib/ritabrata-localizer-assets.ts` | `e9275dc95c980f7ccaa4e8b8194dc53002fd13104f72ea4f0913cd255edd2eae` |
| `app/lib/legacy-template-localizer.ts` | `3ce113b85953530b29cd17bda8814c01010a753c3d26cd3224985bc6a1aeb125` |
| `app/lib/ritabrata-provisional-pipeline.ts` | `73aae2c5714a95cf5173c2f1e600c49e7581e325d2ee48fd9cedfc7a40702494` |
| `app/lib/ritabrata-grb-generator-assets.ts` | `d51131f9a75284f27b7e41fc00f02941140308342afb90de35d3255a6d392ea2` |
| `app/lib/burst-direction-reconstruction.ts` | `0f441b38c9b3664568085634d1d3174ebff0aa242f2e245cdc6f11d27e3fb028` |
| `app/lib/burst-direction-truth-score.ts` | `abc4a9b0a4e52ddfa843b6cbc2e029617173712eda7e8c6fc70cf9cbc8476f3b` |
| `app/lib/detector-geometry-v2r8.ts` | `45b2ed1e7b7f5b42fa854be8a88d576ad3d1ce8775618cfa7cd155eff3733f89` |
| `app/lib/pixel-background.ts` | `b92f51cec9a5e698820c37fdee8f0f27f672b45856e9329462d2e760fe4a3073` |
| `app/lib/detector-local-frame-adapter.ts` | `19add650a95291b918ae50af75085faa33722030d437574680401be9dfea9cbe` |
| `public/data/pixbkg.txt` | `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d` |

Conversion-related local identities, needed only if rebuilding the converted
assets rather than consuming their exact bytes, are:

| Path | SHA-256 |
| --- | --- |
| `scripts/convert-ritabrata-grb-generator-v2.py` | `74074c3cfad0a1113b9f4eaff62cf21e4e7bf31b650dccdabed793eacda01891` |
| `scripts/convert-ritabrata-localizer.py` | `0c161f24a01ef10874a07966de6c43ed3e229f14054b581b12a1a61e495e1d5f` |
| `scripts/shard-ritabrata-localizer-response.py` | `3f7f42ad467e56435df1eabc348441d47f2c9519312fea4566c790277f41d14a` |
| `scripts/requirements-ritabrata-localizer.txt` | `46a0350733d35c5b27058f610a39d591d03af5bc76e6e2fe35c74084dd3ba659` |

## Dataset and asset identity

All three local converted manifests and every binary payload read by the
benchmark were independently SHA-256 checked. Each payload matched the digest
inside its pinned manifest.

| Asset | Stored bytes | SHA-256 |
| --- | ---: | --- |
| generator manifest | 1,538,380 | `0d9790bb74ecf5a15d53b99eb8008e8e353d470560bbe08c27c17e90d47bfbd5` |
| generator `primaryCounts` | 238,305 | `931d386d90621bada1c0561e5374016ba120660e66e41f93b7505d68165f126f` |
| generator `pixelMean` | 33,737,975 | `e32f9a2abfad900a899e2fac46139dd2e84a3a6efcb544d7b741f365e7c056cb` |
| generator `pixelVariance` | 34,032,556 | `385006003778abed459edba31e8f8f9842b0ab404053dc5d6bc787e2be817efc` |
| generator `depositedEnergyMean` | 5,697,844 | `7fa42bff55d710ef98879e6b0d88ddff5a72beefb9de0b5a16508d20a5f3ce2c` |
| generator `depositedEnergyVariance` | 5,693,825 | `9b6602ba696ec1ee41819835a0c9e88328ee44e6921c57caddcda6edb6cab991` |
| 5-degree localizer manifest | 389,758 | `35a5ec42eecb87cdf2e0e4a69cf811ea68b649c977b74e85281eec5129dd7619` |
| 5-degree response | 36,482,288 | `052d9e01c4d4be923f7b1bf5ae031e5c59a4202a4a8fe3d9c29efb0e5ccffca4` |
| 5-degree projection flow | 668 | `e463238a803a8ef695dd02e7155f1ab33aa9701612ffb28b22e49a53ed852c29` |
| 2-degree localizer manifest | 1,128,753 | `d55e6f5d8dddf6827d7527cdbd3642cb674c37604cdd20f5d71c277f6f269dda` |
| 2-degree response shard 00 | 37,052,200 | `d74f359ad25d48bf8a36f0be2c7a4927c04f5cbd3bcc9e17efbd197d049a1331` |
| 2-degree response shard 01 | 35,665,009 | `eaab5f700e019f19eccc0e09218e73c67c83987719a257bd2033736c46addb52` |
| 2-degree response shard 02 | 34,646,149 | `078cad365942bd36da71e2fc68b124e364aaaa64a586059ec7fa5867a445acb7` |
| 2-degree response shard 03 | 33,646,192 | `c9115ea9c5717cd1fd71f5ffdea09becdf8df260f82880da8e5e772286ae47ce` |
| 2-degree response shard 04 | 32,481,158 | `79448f2082de0c54fb9b3b88975efdc67a03742280c45c157d8ebfc5fc0d74e7` |
| 2-degree response shard 05 | 31,776,983 | `b400c2ccd4c45270fa0576a8b39f53fa94b8f568ba4677d3b3512692e3e71c8d` |
| 2-degree response shard 06 | 32,238,885 | `0ceb949c973db1b30a6b6c25d3148984cefe98d8488dbd7387ef9cb76c3c9a4a` |
| 2-degree response shard 07 | 4,655,905 | `5c61b82da339fcad7587433486196f7a1a56797793c61e964cdb742140cd7f4b` |
| 2-degree projection flow | 3,917 | `a5ded064d89f92de7fa49fa29c703c1cc3773695ecb2b6c2e785e203cc8cff4f` |

The generator, 5-degree localizer, and 2-degree localizer manifest provenance
digests are respectively
`d0874e93bbc81e6b21d395c84f987334c17e5d9549b34c6708bc0373976afb88`,
`be33e6c3031202e496e79e52ac7849f4ca26933f8fefb5642d9a00e44c2718ae`,
and `73362092474766ba4fecc8946b25784be13facf6901d7ab80ddf77529025db17`.

### Original-source access check

The manifests retain public Google Drive identifiers and source SHA-256
digests. Anonymous requests on 2026-09-08 returned byte ranges for every
identifier. The four small files were downloaded independently and matched
their source digest. The three large ROOT inputs were checked for anonymous
range access, filename, and total size only; their full remote SHA-256 values
were not re-established during this audit.

| Source | Drive ID | Bytes returned by Drive | SHA-256 from manifest | Audit check |
| --- | --- | ---: | --- | --- |
| `CEGenGRB.cc` | `1UJeHpDSWlZwKIWDC2ijNNvtKR_yI4ROj` | 11,041 | `1d18decbeabaf9d1d72896efd86f39ae46a9b1d838f7047ee84122c0db4f16fc` | full hash matched |
| `temDataSet5degNew.root` | `1NPqQwPq97VgiISXY69wSSsyX1uhXnFJ5` | 949,681,528 | `52cddade7195f9f1c7d03659f19599f116c56a03f2120684b39ec20eb1f14d01` | anonymous range and size only |
| `CELoc.cc` | `1KWfWqGAIjIUJiX0Hd-gPsmexu1o54pV1` | 7,738 | `0b272e5c39310877a1947c602790dc4fd05f8fbf349a4ac048e74f8a6149cf39` | full hash matched |
| `upCal.txt` | `1XRglTfOSB9SuOiGRF5okQrjMepl0MtcE` | 3,440 | `5164b59df7df244855d1f7a30385385eab460f30d2af2e0bb5ba3acbe4f942c6` | full hash matched |
| `allEffArea.root` | `1yqtIT39ob3SDJtnCzD8RW1ia1Dgl2m0F` | 194,001 | `d2cbbeee10dd545a968ab926c4007af964013056b6a2a26767c99cf170d6ec85` | full hash matched |
| `temEdepPix5degNew.root` | `1IvIODfqCX5QEMPoDFKlyT0QiY8yWOwIv` | 103,907,662 | `6f79fd2c68da2c2df92e3aca94c63c68073b0b999e6a6876c1359966036ff0ee` | anonymous range and size only |
| `temEdepPix2degNew.root` | `1JdmTSKWk6Y3_4_hIsjmhEbVdDo-R61dX` | 692,555,360 | `e77cb7800e497bfa5d375a0f0e1ac7b94e2121982c9b08114d9ad6a1aa5caf4e` | anonymous range and size only |

The earlier `CE-SIM-20260907` record reports 3,432 bytes for `upCal.txt` and
193,264 bytes for `allEffArea.root`. Current anonymous Drive responses report
3,440 and 194,001 bytes, respectively, while the full downloaded hashes still
match the manifests. The digest is the authoritative identity; the earlier
size fields are inaccurate and should not be used as acceptance criteria.

## Acceptance criteria and results

The reproducibility auditor fixed the following mechanical criteria while the
canonical process was still running. This was an audit checklist, not a formal
scientific preregistration.

1. Exit zero and write schema 2 with benchmark version
   `updated-three-neighbour-source-only-isotropic-1000-v1`.
2. Retain the exact protocol above and exactly 1,000 ordered case indices
   `0..999`.
3. Match every code, manifest, and payload identity recorded above.
4. Recreate every requested direction independently from the seed and
   Mulberry32 definition.
5. Recompute `caseRecordsSha256` after recursively excluding only `runtimeMs`.
6. Recompute generation summaries, every method's global and zenith-bin
   summaries, failure counts, and all paired comparisons directly from the
   raw per-case records.
7. Check per-case residual identities, angular separation, nearest-template
   distance, finite positive generated total, and interpolation weights summing
   to one.
8. Rerun ten fixed cases and require exact equality with the canonical first
   ten scientific records, excluding only timing.
9. Keep all interpretations `PROVISIONAL`; do not publish or claim domain or
   author approval.

All nine mechanical gates passed locally. In particular:

- 1,000 generation cases and all 3,000 method executions succeeded;
- 907 cases had no containment warning, 93 had
  `outside-neighbour-triangle`, and none had
  `degenerate-neighbour-triangle`;
- the independent request-prefix digest for the first ten requested directions
  was `357117b46e230a6008f66e2bb2ad6ce91f08a70bd2b2b8cc31d204c64fde5151`;
- the full scientific case digest independently recomputed as
  `9852d4739a173ba76f8aeaf8eeccd9fa0ed3ecaf20a100097432686989c98f71`,
  exactly matching the evidence;
- every stored global summary, every zenith-bin summary, and every paired
  comparison was exactly equal to an independently implemented recomputation.

The primary descriptive angular-separation summaries are:

| Method | Successful | Median | P68 | P90 | P95 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| positive-excess centroid | 1,000 | 27.276597° | 35.295026° | 51.947028° | 59.024514° | 65.674786° |
| KS 5-degree | 1,000 | 1.662451° | 2.094211° | 3.066139° | 3.573800° | 5.356367° |
| KS 2-degree | 1,000 | 0.951173° | 1.213835° | 1.748482° | 2.003994° | 3.590440° |

Pairwise lower-error counts were 979/21 for KS 5-degree versus centroid,
994/6 for KS 2-degree versus centroid, and 776/224 for KS 2-degree versus KS
5-degree, with no exact ties. These are descriptive outcomes from related,
noise-free response families, not validated superiority claims.

## Independent ten-case repeat

After the canonical process exited, the auditor ran:

```text
CE_BENCHMARK_CASE_COUNT=10 /Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/benchmark-updated-grb-pipeline.ts scientific-assets/rito-updated-20260907/generator scientific-assets/rito-updated-20260907/localizer-5deg scientific-assets/rito-updated-20260907/localizer-2deg /tmp/ce-rito-updated-benchmark-audit-10-20260908.json
```

The repeat exited zero with 10/10 successful cases for every method. Its
scientific digest was
`0ad0b335536128f627706b2d715e9a310707dca6dc72c94af491c9383e18afd5`,
exactly equal to a separately computed digest of the first ten canonical
scientific records. A deep structural comparison of those records passed;
only `runtimeMs`, `totalRuntimeMs`, and generation time metadata differed as
expected. The temporary complete repeat file is 59,809 bytes with execution-
specific SHA-256
`03cb0e2908cd3303d6b312bbc245c217d4c7e07614a935dc2053f2deb55a98df`.
That byte hash is not expected to repeat because the file retains timings and
`generatedAtUtc`.

## Focused tests and asset validators

The auditor independently ran the four focused updated-pipeline test files with
the bundled Node runtime: 23/23 tests passed. The generator-v2, localizer
5-degree, and localizer 2-degree validators all passed and reported the exact
manifest identities above, 1,093 generator directions, 1,093 5-degree
templates, and 7,143 2-degree templates. These focused checks do not substitute
for the earlier whole-project 160-test, type-check, lint, and build results
recorded in `CE-SIM-20260907-updated-grb-three-template.md`; this audit did not
rerun the complete project suite.

## Findings by replicability impact

### Critical — no third-party replication package

The canonical result cannot currently be reconstructed from a fresh clone.
The benchmark script and evidence are untracked, the executed runtime changes
are uncommitted, and the 361,106,836-byte local converted asset tree is
untracked and unpublished. Neither hashes nor the base commit reconstruct these
bytes. A reviewed commit/archive plus an authorized, immutable asset location
or content-addressed replication bundle is required before claiming
third-party reproducibility.

### High — converted-asset regeneration environment is unproven

Original inputs and conversion scripts are identified, but the exact Python,
NumPy, uproot, OS, and compression versions that produced all three retained
asset directories are not durably recorded. Existing dependency pins conflict
with the observed temporary inspection environment and cannot be assumed.
Therefore exact regeneration of the manifest and compressed payload hashes is
not established even for a party able to download the source ROOT files.

### High — bitwise digest portability is not established

`caseRecordsSha256` hashes unrounded JSON floating-point values. Transcendental
functions such as `acos`, floating-point reduction order, JSON serialization,
and decompression/runtime behavior are not protected by a container or a
cross-platform golden test. The same macOS/arm64/Node 24.19.0 host repeated the
ten-case prefix exactly, but this does not prove identical bytes on another OS,
architecture, or Node version. A portable acceptance scheme should either pin
a runnable environment or define scientifically justified numeric tolerances
and canonical rounding separately from the raw forensic digest.

### Medium — two source sizes in the prior record are inaccurate

The prior provenance byte counts for `upCal.txt` and `allEffArea.root` do not
match current anonymous Drive content, although the full SHA-256 values match.
The corrected counts are recorded above. This does not change the identified
content but could cause a size-based reconstruction gate to fail.

### Medium — no registered scientific acceptance threshold

The protocol supports reproducible descriptive statistics only. It has no
independent validation set, uncertainty model, hypothesis test, effect-size
criterion, or author-approved performance threshold. This does not prevent
re-execution, but it prevents promoting the observed method ordering into a
scientific conclusion.

### Low — complete JSON byte identity is intentionally unstable

The output retains wall-clock timings and `generatedAtUtc`, so its whole-file
SHA-256 is execution-specific. The separate scientific case digest correctly
excludes every `runtimeMs` field. Consumers must compare the scoped scientific
digest or numeric records, not require the complete JSON hash to recur.

## Remaining domain, author, and publication gates

- identical-input generator and localizer parity with the official C++/ROOT
  implementation remains pending;
- the generator and localizers use related response families and are not an
  independent scientific validation dataset;
- no background, counting noise, duration, light curve, occultation, detector
  systematics, or operational conditions are represented;
- physics experts have not validated these benchmark results or their allowed
  interpretation;
- the author has not approved a scientific result, conclusion, asset
  redistribution, commit, deployment, or publication;
- a future replication package must make the exact executed source and assets
  available, pin or capture the conversion and runtime environments, retain
  this full evidence JSON, and document the immutable artifact identifiers.

Until those issues are resolved, the strongest defensible statement is:
the retained 1,000-case evidence is internally consistent and its deterministic
scientific prefix is locally repeatable under the recorded host and exact local
bytes; it is **not yet third-party reproducible** and is not a validated Crystal
Eye performance result.
