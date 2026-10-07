import {
  PILOT_TREATMENTS,
  runDigitalTwinPilot,
} from "../app/lib/digital-twin-experiment/pilot.ts";

const startedAt = performance.now();
const report = runDigitalTwinPilot();
const elapsedMs = performance.now() - startedAt;
const benchmarkIterations = 20;
const elapsedByTreatment = Object.fromEntries(PILOT_TREATMENTS.map((treatment) => {
  const treatmentStartedAt = performance.now();
  for (let iteration = 0; iteration < benchmarkIterations; iteration += 1) {
    runDigitalTwinPilot([treatment]);
  }
  return [treatment, (performance.now() - treatmentStartedAt) / benchmarkIterations];
}));
const b0ElapsedMs = elapsedByTreatment.B0_STATIC;

process.stdout.write(`${JSON.stringify({
  ...report,
  runnerMeasurement: {
    elapsedMs,
    benchmarkIterations,
    elapsedMsPerPilotByTreatment: elapsedByTreatment,
    ratioToB0: Object.fromEntries(Object.entries(elapsedByTreatment).map(
      ([treatment, treatmentElapsedMs]) => [treatment, treatmentElapsedMs / b0ElapsedMs],
    )),
    timingScope: "relative local headless runner wall time; not an operational latency bound",
  },
}, null, 2)}\n`);
