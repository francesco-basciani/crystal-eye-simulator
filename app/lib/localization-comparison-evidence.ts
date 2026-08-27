export type LocalizationComparisonBand = Readonly<{
  minimumThetaDeg: number;
  maximumThetaDeg: number;
  sampleCount: number;
  centroidMedianErrorDeg: number;
  ks5MedianErrorDeg: number;
  ks5PairedWins: number;
  ks2MedianErrorDeg: number;
  ks2PairedWins: number;
  ks2VsKs5PairedWins: number;
}>;

export const LOCALIZATION_COMPARISON_EVIDENCE = Object.freeze({
  evidenceId: "grb-localizer-comparison-stratified-theta-20260827",
  seed: 20260828,
  status: "PROVISIONAL",
  protocol: "source-only expected response; no background, Poisson noise, duration, or light curve",
  sampling: "24 cases per detector-zenith band, uniform in solid angle within each band",
  overall: Object.freeze({
    sampleCount: 144,
    centroidMedianErrorDeg: 13.273049827051352,
    ks5MedianErrorDeg: 3.5682660800536947,
    ks5PairedWins: 113,
    ks2MedianErrorDeg: 2.647139876022637,
    ks2PairedWins: 125,
    ks2VsKs5PairedWins: 104,
  }),
  bands: Object.freeze<readonly LocalizationComparisonBand[]>([
    Object.freeze({ minimumThetaDeg: 0, maximumThetaDeg: 15, sampleCount: 24, centroidMedianErrorDeg: 2.0619255427904006, ks5MedianErrorDeg: 3.8485073250755573, ks5PairedWins: 3, ks2MedianErrorDeg: 2.5101814040877395, ks2PairedWins: 9, ks2VsKs5PairedWins: 20 }),
    Object.freeze({ minimumThetaDeg: 15, maximumThetaDeg: 30, sampleCount: 24, centroidMedianErrorDeg: 4.0103127985985845, ks5MedianErrorDeg: 3.394621255440776, ks5PairedWins: 14, ks2MedianErrorDeg: 2.223416602081474, ks2PairedWins: 20, ks2VsKs5PairedWins: 18 }),
    Object.freeze({ minimumThetaDeg: 30, maximumThetaDeg: 45, sampleCount: 24, centroidMedianErrorDeg: 9.90024013047735, ks5MedianErrorDeg: 3.0191404685713783, ks5PairedWins: 24, ks2MedianErrorDeg: 2.2927884327584835, ks2PairedWins: 24, ks2VsKs5PairedWins: 15 }),
    Object.freeze({ minimumThetaDeg: 45, maximumThetaDeg: 60, sampleCount: 24, centroidMedianErrorDeg: 16.959837938705274, ks5MedianErrorDeg: 3.532028358377496, ks5PairedWins: 24, ks2MedianErrorDeg: 3.1375478303723385, ks2PairedWins: 24, ks2VsKs5PairedWins: 15 }),
    Object.freeze({ minimumThetaDeg: 60, maximumThetaDeg: 75, sampleCount: 24, centroidMedianErrorDeg: 23.834779675115755, ks5MedianErrorDeg: 3.7795574771955156, ks5PairedWins: 24, ks2MedianErrorDeg: 3.336257057091191, ks2PairedWins: 24, ks2VsKs5PairedWins: 17 }),
    Object.freeze({ minimumThetaDeg: 75, maximumThetaDeg: 90, sampleCount: 24, centroidMedianErrorDeg: 32.17841522031221, ks5MedianErrorDeg: 3.5352084146482703, ks5PairedWins: 24, ks2MedianErrorDeg: 2.313058632184907, ks2PairedWins: 24, ks2VsKs5PairedWins: 19 }),
  ]),
  runtimeReference: Object.freeze({
    sampleCount: 128,
    centroidMedianMs: 0.0824369999972987,
    ks5MedianMs: 178.07783349999954,
    ks2MedianMs: 1157.620666499999,
  }),
});
