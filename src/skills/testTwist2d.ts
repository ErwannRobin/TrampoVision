import { makeRng } from '../analysis/testTracks';
import { LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { syntheticTwistJump, type TwistJumpSpec } from '../pose3d/testTwistMannequin';
import type { Twist2dInput } from './twist2d';

/**
 * Test support (not used by the app): the 3D twisting athlete of `pose3d/testTwistMannequin.ts` as a camera sees it, i.e. the 2D
 * landmarks a pose model would return, with the ways such a model goes wrong. Orthographic camera, pixels, y down.
 */

export interface Degrade2d {
  /** Gaussian noise on every landmark, pixels (the trunk is about 90 px long). */
  noisePx?: number;
  /** Probability that a whole frame has no skeleton. */
  dropout?: number;
  /** Frames [from, to] (inclusive, flight-relative) where the model swaps left and right labels. */
  swapLeftRight?: [number, number];
  /** The pose model's visibility says nothing about the face (a constant). */
  noFaceVisibility?: boolean;
  /** Shoulder and hip width multiplied by this (a wider or narrower athlete than the prior). */
  widthScale?: number;
  seed?: number;
}

const PX_PER_M = 180;
const PAIRS: [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];

const gauss = (rnd: () => number) => {
  const u1 = Math.max((rnd() + 1) / 2, 1e-9);
  const u2 = (rnd() + 1) / 2;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

export interface SyntheticTwist2d {
  input: Twist2dInput;
  truthHalfTwists: number;
}

/** A jump with a known twist as `Twist2dInput`. The flight is 1 s plus 0.25 s per twist unless the spec says otherwise. */
export function syntheticTwist2d(spec: TwistJumpSpec = {}, degrade: Degrade2d = {}): SyntheticTwist2d {
  const twist = spec.twistTurns ?? 0;
  const jump = syntheticTwistJump({ flightS: 1 + 0.25 * twist, ...spec });
  const rnd = makeRng(degrade.seed ?? 11);
  const cycle = jump.input.cycles[0];
  const fps = jump.input.fps;
  const takeoff = cycle.takeoff!;
  const landing = cycle.landing!;
  const width = degrade.widthScale ?? 1;
  const frames = jump.world.map<Keypoint[] | null>((f, i) => {
    if (degrade.dropout && (rnd() + 1) / 2 < degrade.dropout) return null;
    const hip = { x: (f[LM.L_HIP].x + f[LM.R_HIP].x) / 2, y: (f[LM.L_HIP].y + f[LM.R_HIP].y) / 2 };
    const sh = { x: (f[LM.L_SHOULDER].x + f[LM.R_SHOULDER].x) / 2, y: (f[LM.L_SHOULDER].y + f[LM.R_SHOULDER].y) / 2 };
    const trunk = { x: sh.x - hip.x, y: sh.y - hip.y };
    const tl = Math.hypot(trunk.x, trunk.y) || 1;
    const perp = { x: -trunk.y / tl, y: trunk.x / tl };
    const earMidZ = (f[LM.L_EAR].z + f[LM.R_EAR].z) / 2;
    // The face looks toward the camera when the nose is nearer to it than the ears (z points away from the camera).
    const faceToward = f[LM.NOSE].z - earMidZ < 0;
    const kp: Keypoint[] = f.map((p, k) => {
      let x = p.x;
      let y = p.y;
      if (width !== 1 && (k === LM.L_SHOULDER || k === LM.R_SHOULDER || k === LM.L_HIP || k === LM.R_HIP)) {
        // Widen the line along its own direction in the image (about the line's midpoint).
        const mid = k === LM.L_SHOULDER || k === LM.R_SHOULDER ? sh : hip;
        const d = (x - mid.x) * perp.x + (y - mid.y) * perp.y;
        x += (width - 1) * d * perp.x;
        y += (width - 1) * d * perp.y;
      }
      let visibility = 0.99;
      if (!degrade.noFaceVisibility) {
        if (k === LM.NOSE || k === LM.L_EYE || k === LM.R_EYE || k === LM.L_EYE_INNER || k === LM.R_EYE_INNER) {
          visibility = faceToward ? 0.95 : 0.12;
        } else if (k === LM.L_EAR) visibility = f[LM.L_EAR].z < f[LM.R_EAR].z ? 0.95 : 0.45;
        else if (k === LM.R_EAR) visibility = f[LM.R_EAR].z < f[LM.L_EAR].z ? 0.95 : 0.45;
      }
      return {
        x: 640 + PX_PER_M * x + (degrade.noisePx ?? 0) * gauss(rnd),
        y: 360 + PX_PER_M * y + (degrade.noisePx ?? 0) * gauss(rnd),
        visibility,
      };
    });
    const k0 = i - takeoff;
    if (degrade.swapLeftRight && k0 >= degrade.swapLeftRight[0] && k0 <= degrade.swapLeftRight[1]) {
      for (const [l, r] of PAIRS) [kp[l], kp[r]] = [kp[r], kp[l]];
    }
    return kp;
  });
  return {
    input: {
      frames,
      time: jump.time,
      fps,
      cycles: [{ takeoffTimeS: takeoff / fps, landingTimeS: landing / fps, complete: true }],
    },
    truthHalfTwists: Math.round(Math.abs(twist) * 2),
  };
}
