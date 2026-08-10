export const DETECTOR_PIXEL_COUNT = 126;

const ZERO_DETECTOR_FRAME = Object.freeze(
  Array.from({ length: DETECTOR_PIXEL_COUNT }, () => 0),
);

/**
 * An absent vector is permitted only as a transient UI bootstrap/HMR state and
 * resolves to a complete zero frame. Present but malformed vectors fail loudly.
 */
export function resolveDetectorFrameVector(
  values: readonly number[] | undefined,
  label: string,
): readonly number[] {
  if (values === undefined) return ZERO_DETECTOR_FRAME;
  if (values.length !== DETECTOR_PIXEL_COUNT) {
    throw new RangeError(
      `${label} must contain exactly ${DETECTOR_PIXEL_COUNT} pixel values.`,
    );
  }
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError(`${label} must contain finite non-negative values.`);
  }
  return values;
}

export function createZeroDetectorFrame(): number[] {
  return [...ZERO_DETECTOR_FRAME];
}
