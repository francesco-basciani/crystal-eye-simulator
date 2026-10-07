# Updated GRB localization benchmark — concise summary for Rito

Status: `PROVISIONAL` scientific result; descriptive calculations independently
verified on 2026-09-08.

We ran 1,000 deterministic source-only GRB cases with the updated
three-neighbour response generator. Requested directions were sampled
isotropically over the detector-local spherical-cap input domain, with theta
between 0 and 113 degrees and phi between 0 and 360 degrees (Mulberry32 seed
20260907). The same cases were reconstructed with the positive-excess centroid,
the browser KS port using the 5-degree templates (`ks-5deg-v2`), and the browser
KS port using the 2-degree templates (`ks-2deg-v2`).

| Method | Median error | P68 | P90 | P95 | Maximum | Available outputs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Positive-excess centroid | 27.277 deg | 35.295 deg | 51.947 deg | 59.025 deg | 65.675 deg | 1,000/1,000 |
| Browser KS port, 5-degree (`ks-5deg-v2`) | 1.662 deg | 2.094 deg | 3.066 deg | 3.574 deg | 5.356 deg | 1,000/1,000 |
| Browser KS port, 2-degree (`ks-2deg-v2`) | 0.951 deg | 1.214 deg | 1.748 deg | 2.004 deg | 3.590 deg | 1,000/1,000 |

“Available outputs” means only that execution returned without an error. P68,
P90, and P95 are Hyndman–Fan type 7 empirical sample percentiles, not
confidence intervals or estimates of operational coverage.

For KS 2-degree, 54.4% of cases were within 1 degree, 94.9% within 2
degrees, 99.7% within 3 degrees, and 100% within 5 degrees. For KS 5-degree,
the corresponding fractions were 21.5%, 64.2%, 88.9%, and 99.6%.

The 2-degree browser KS port had a lower angular error than the 5-degree port in 776 of the 1,000
paired cases; KS 5-degree was lower in 224. KS 2-degree was lower than the
positive-excess centroid in 994 cases, while the centroid was lower in 6.

The centroid is an algorithmic comparator, not the legacy pipeline. All three
methods received the same updated three-neighbour generated response. A paired
legacy-generator versus updated-generator benchmark remains a separate pending
study.

Across the eight requested-theta sample bins, the 2-degree browser KS median
errors ranged from 0.884 to 1.054 degrees:

| Requested theta | Cases | Median | P95 |
| --- | ---: | ---: | ---: |
| 0–15 deg | 23 | 0.988 deg | 1.822 deg |
| 15–30 deg | 62 | 0.935 deg | 1.839 deg |
| 30–45 deg | 101 | 0.884 deg | 2.040 deg |
| 45–60 deg | 147 | 0.912 deg | 1.914 deg |
| 60–75 deg | 172 | 0.903 deg | 1.876 deg |
| 75–90 deg | 191 | 0.941 deg | 1.912 deg |
| 90–100 deg | 138 | 1.054 deg | 2.362 deg |
| 100–113 deg | 166 | 1.013 deg | 1.989 deg |

The positive-excess centroid showed a strong negative theta residual in this
test (mean -28.261 degrees). The benchmark establishes that this behaviour is
present, but does not establish its physical or implementation cause.

The `outside-neighbour-triangle` diagnostic was emitted in 93 cases; no
degenerate-triangle diagnostic occurred. For KS 2-degree, mean error was 1.161
degrees for those 93 cases and 1.006 degrees for the other 907 cases. This is
descriptive and does not demonstrate causality.

Important limits: these are noise-free, source-only expected responses. There
is no background, Poisson sampling, burst time profile, occultation, or detector
systematic uncertainty. Generator and localizer use related simulated response
families, so this is not an independent validation set. The browser generator
uses the documented full-sample expectation approximation, and identical-input
parity with the official C++/ROOT generator and localizer is still pending.
On four fixed inputs, the expectation approximation differed from the C++
prefix-response construction by 3.56–5.62% in relative L2 norm and by
2.03–3.22 degrees as a response-shape angle; these are response differences,
not localization errors.
Therefore the numbers characterize the current port and test protocol; they
must not yet be presented as validated Crystal Eye localization performance.

The retained run is `LOCAL-REPEATABLE`, but not yet reproducible by a third
party: its executed source, evidence, and 361,106,836-byte converted asset tree
remain local, uncommitted, and unpublished. The results are neither
`DOMAIN-VALIDATED` nor `AUTHOR-APPROVED` as scientific conclusions.
