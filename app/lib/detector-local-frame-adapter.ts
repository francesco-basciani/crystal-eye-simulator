export const RITABRATA_DETECTOR_FRAME =
  "RITABRATA_ROOT_PLUS_Z_POLAR_PHI_ATAN2_Y_X" as const;
export const THREE_DETECTOR_LOCAL_FRAME =
  "THREE_LOCAL_PLUS_Y_POLAR_PHI_ATAN2_NEG_Z_X" as const;
export const CELOC_UPCAL_RAW_COMPONENT_FRAME =
  "CELOC_UPCAL_RAW_COMPONENT_ORDER_UNVALIDATED" as const;

declare const ritabrataFrameBrand: unique symbol;
declare const threeDetectorLocalFrameBrand: unique symbol;
declare const celocRawPixelFrameBrand: unique symbol;

export type RitabrataDetectorVector3 = readonly [number, number, number] & {
  readonly [ritabrataFrameBrand]: typeof RITABRATA_DETECTOR_FRAME;
};

export type ThreeDetectorLocalVector3 = readonly [number, number, number] & {
  readonly [threeDetectorLocalFrameBrand]: typeof THREE_DETECTOR_LOCAL_FRAME;
};

/** Raw upCal storage used literally by CELoc; physical axis semantics are unvalidated. */
export type CelocRawPixelVector3 = readonly [number, number, number] & {
  readonly [celocRawPixelFrameBrand]: typeof CELOC_UPCAL_RAW_COMPONENT_FRAME;
};

function finiteVector(
  x: number,
  y: number,
  z: number,
  frame: string,
): readonly [number, number, number] {
  if (![x, y, z].every(Number.isFinite)) {
    throw new RangeError(`${frame} vector components must be finite.`);
  }
  return Object.freeze([x, y, z] as const);
}

export function createRitabrataDetectorVector(
  x: number,
  y: number,
  z: number,
): RitabrataDetectorVector3 {
  return finiteVector(x, y, z, RITABRATA_DETECTOR_FRAME) as RitabrataDetectorVector3;
}

export function createThreeDetectorLocalVector(
  x: number,
  y: number,
  z: number,
): ThreeDetectorLocalVector3 {
  return finiteVector(x, y, z, THREE_DETECTOR_LOCAL_FRAME) as ThreeDetectorLocalVector3;
}

export function createCelocRawPixelVector(
  x: number,
  y: number,
  z: number,
): CelocRawPixelVector3 {
  return finiteVector(x, y, z, CELOC_UPCAL_RAW_COMPONENT_FRAME) as CelocRawPixelVector3;
}

/** Proper rotation Rx(-90°): ROOT +Z boresight becomes Three.js local +Y. */
export function ritabrataToThreeDetectorLocal(
  vector: RitabrataDetectorVector3,
): ThreeDetectorLocalVector3 {
  return createThreeDetectorLocalVector(vector[0], vector[2], -vector[1]);
}

/** Inverse rotation Rx(+90°): Three.js local +Y becomes ROOT +Z. */
export function threeDetectorLocalToRitabrata(
  vector: ThreeDetectorLocalVector3,
): RitabrataDetectorVector3 {
  return createRitabrataDetectorVector(vector[0], -vector[2], vector[1]);
}

export function ritabrataDirectionFromAngles(
  thetaDeg: number,
  phiDeg: number,
): RitabrataDetectorVector3 {
  if (
    !Number.isFinite(thetaDeg) || thetaDeg < 0 || thetaDeg > 180 ||
    !Number.isFinite(phiDeg)
  ) {
    throw new RangeError("Ritabrata theta/phi must be finite, with theta within [0, 180].");
  }
  const theta = thetaDeg * Math.PI / 180;
  const phi = phiDeg * Math.PI / 180;
  return createRitabrataDetectorVector(
    Math.sin(theta) * Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
    Math.cos(theta),
  );
}

export function ritabrataAnglesFromDirection(
  rawVector: RitabrataDetectorVector3,
): Readonly<{ thetaDeg: number; phiDeg: number }> {
  const magnitude = Math.hypot(...rawVector);
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
    throw new RangeError("Ritabrata angles require a finite non-zero vector.");
  }
  return Object.freeze({
    thetaDeg: Math.acos(Math.max(-1, Math.min(1, rawVector[2] / magnitude))) * 180 / Math.PI,
    phiDeg: ((Math.atan2(rawVector[1], rawVector[0]) * 180 / Math.PI) % 360 + 360) % 360,
  });
}
