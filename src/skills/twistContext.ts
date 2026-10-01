import type { TwistEstimate } from '../pose3d/twist';
import type { Twist2dEstimate } from './twist2d';
import type { TwistContext } from './types';

/** The 3D estimate's shape for a count read from 2D cues, so that everything downstream can treat both alike. Direction is unknown in 2D. */
export function estimateFrom2d(e: Twist2dEstimate): TwistEstimate {
  return {
    available: e.available,
    totalDeg: e.totalDeg,
    direction: 'none',
    nearestDeg: e.totalDeg,
    halfTwists: e.halfTwists,
    twists: e.twists,
    residualDeg: 0,
    peakAngularVelocityDps: null,
    meanAbsAngularVelocityDps: null,
    confidence: e.confidence,
    reliable: e.reliable,
    parts: { rounding: 1, coverage: e.parts.coverage, steps: 1, monotonic: 1, shoulderHip: 1, axisDepth: 1, depth: 1 },
    cross: { shouldersDeg: null, hipsDeg: null, inPlaneAxisDeg: null },
    shoulderWidthCv: null,
    flips: 0,
    maxStepDeg: null,
    reversalDeg: null,
    axisTiltDeg: null,
    shoulderDepthShare: null,
    limitations: [],
  };
}

/**
 * What the classifier is told about the twist of one jump. A reliable 3D estimate is used as it is, and the 2D count is kept next to
 * it as a second opinion. Without a reliable 3D estimate, a reliable 2D count is used instead and the context says so (`source`), with
 * no trajectory: the 2D fit has a profile of its own that is not a measurement of when the twist happened.
 */
export function twistContextOf(
  est3d: TwistEstimate | null | undefined,
  trajectory: number[] | null,
  est2d: Twist2dEstimate | null | undefined,
): TwistContext | null {
  if (est3d?.available && est3d.reliable)
    return { estimate: est3d, trajectory, source: 'pose3d', second: est2d ?? null };
  if (est2d?.available && est2d.reliable)
    return { estimate: estimateFrom2d(est2d), trajectory: null, source: 'pose2d', second: est2d };
  if (est3d) return { estimate: est3d, trajectory, source: 'pose3d', second: est2d ?? null };
  return null;
}
