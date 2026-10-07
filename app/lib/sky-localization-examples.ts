import { createSkyLocalizationEvent, type SkyLocalizationEvent } from "./sky-localization.ts";

/** Supplied historical FITS comparison; never a simulated event or reconstruction. */
export const SKY_REFERENCE_EVENT: SkyLocalizationEvent = Object.freeze({
  ...createSkyLocalizationEvent({ eventKey: "reference:sky-comparison", burstId: 0,
    simulatedDate: "2017-08-17T12:41:04.444458Z", raDeg: 197.45, decDeg: -23.38,
    gridLabel: "Supplied FITS maps · illustrative CE radii" }),
  dataOrigin: "reference", status: "available", referenceOverlay: "rito-gbm-bayestar",
  coordinateFrame: "ICRS · historical reference comparison",
  reason: "Supplied historical FITS maps and illustrative CE radii; not a simulated burst reconstruction.",
});
