import { LANDMARK_COUNT, LM } from '../pose/landmarks';
import type { WorldPoint } from '../pose/types';
import { analyzeTwist, type TwistAnalysis } from './twist';
import { add, scale, type Vec3 } from './vec3';

/**
 * A made-up athlete doing one straddle jump, in the same 3D landmark format the pose model produces (meters, hip-centered, x right,
 * y down, z away from the camera). It exists so the first screen can show the 3D view before any video is loaded: it goes through
 * the same drawing code as a real analysis. Nothing here is measured, and nothing else in the app reads it.
 */

export const DEMO_FPS = 30;
const CYCLE_S = 2.4;
/** Where in the cycle (0 to 1) the feet leave the bed and touch it again. */
const TAKEOFF_AT = 0.2;
const LANDING_AT = 0.8;
const JUMP_HEIGHT_M = 0.5;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
/** Blend between keyed values: `[u, value]` pairs in increasing u, eased between them. */
function keyed(keys: readonly (readonly [number, number])[], u: number): number {
  if (u <= keys[0][0]) return keys[0][1];
  for (let k = 1; k < keys.length; k++) {
    if (u <= keys[k][0]) return keys[k - 1][1] + (keys[k][1] - keys[k - 1][1]) * smooth(keys[k - 1][0], keys[k][0], u);
  }
  return keys[keys.length - 1][1];
}

/** How the body is held at one moment, in degrees. */
interface Pose {
  /** Trunk folded forward from upright. */
  trunk: number;
  /** Thighs raised forward from hanging. */
  thigh: number;
  /** Each leg swung out to its side. */
  spread: number;
  /** Knees bent (shins folded back). */
  knee: number;
  /** Arms raised forward from hanging; above 90 is overhead. */
  arm: number;
}

/** A straddle jump: dip, drive up, open the legs to the sides in front of a slightly leaning trunk, hands reaching toward the toes, close, land. */
function poseAt(u: number): Pose {
  return {
    trunk: keyed(
      [
        [0.0, 0],
        [0.1, 25],
        [0.2, 0],
        [0.3, 0],
        [0.42, 24],
        [0.58, 24],
        [0.7, 0],
        [0.82, 20],
        [0.92, 0],
      ],
      u,
    ),
    thigh: keyed(
      [
        [0.0, 0],
        [0.1, 55],
        [0.2, 0],
        [0.3, 0],
        [0.42, 82],
        [0.58, 82],
        [0.7, 0],
        [0.82, 50],
        [0.92, 0],
      ],
      u,
    ),
    spread: keyed(
      [
        [0.3, 0],
        [0.42, 42],
        [0.58, 42],
        [0.7, 0],
      ],
      u,
    ),
    knee: keyed(
      [
        [0.0, 0],
        [0.1, 70],
        [0.2, 0],
        [0.7, 0],
        [0.82, 55],
        [0.92, 0],
      ],
      u,
    ),
    arm: keyed(
      [
        [0.0, 8],
        [0.1, -35],
        [0.22, 165],
        [0.3, 165],
        [0.42, 80],
        [0.58, 80],
        [0.7, 150],
        [0.82, 60],
        [0.92, 8],
      ],
      u,
    ),
  };
}

// Body frame: (forward, left, up). Angles in radians below.
const rad = (d: number) => (d * Math.PI) / 180;
/** Raises a vector forward from straight down by `deg` (a swing in the forward-up plane, about the left axis). */
const swingForward = (v: Vec3, deg: number): Vec3 => {
  const a = rad(deg);
  return [v[0] * Math.cos(a) - v[2] * Math.sin(a), v[1], v[0] * Math.sin(a) + v[2] * Math.cos(a)];
};
/** Tips a point forward about the hip line: up toward forward. */
const foldForward = (p: Vec3, deg: number): Vec3 => {
  const a = rad(deg);
  return [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
};
/** Swings a vector out to the side about the forward axis; `dir` is +1 for the left, -1 for the right. */
const abduct = (v: Vec3, deg: number, dir: 1 | -1): Vec3 => {
  const a = rad(deg) * dir;
  return [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
};
const along = (from: Vec3, dir: Vec3, length: number): Vec3 => add(from, scale(dir, length));

const THIGH = 0.42;
const SHIN = 0.43;
const UPPER_ARM = 0.3;
const FOREARM = 0.27;

/** The 33 landmarks in the body frame (forward, left, up), hip at the origin. */
function bodyAt(p: Pose): Vec3[] {
  const out: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
  const both = (l: number, r: number, f: number, y: number, z: number, fold = p.trunk) => {
    out[l] = foldForward([f, y, z], fold);
    out[r] = foldForward([f, -y, z], fold);
  };
  // The trunk, neck and head fold together about the hips.
  out[LM.NOSE] = foldForward([0.08, 0, 0.66], p.trunk);
  both(LM.L_EYE_INNER, LM.R_EYE_INNER, 0.07, 0.02, 0.68);
  both(LM.L_EYE, LM.R_EYE, 0.07, 0.04, 0.68);
  both(LM.L_EYE_OUTER, LM.R_EYE_OUTER, 0.06, 0.06, 0.68);
  both(LM.L_EAR, LM.R_EAR, 0, 0.08, 0.67);
  both(LM.MOUTH_L, LM.MOUTH_R, 0.07, 0.025, 0.62);
  both(LM.L_SHOULDER, LM.R_SHOULDER, 0, 0.19, 0.5);

  // Arms hang from the shoulders and swing in the forward-up plane; a little splay keeps them off the trunk.
  for (const [side, dir] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const shoulder = out[LM[`${side}_SHOULDER`]];
    const upper = abduct(swingForward([0, 0, -1], p.arm), 8, dir);
    const elbow = along(shoulder, upper, UPPER_ARM);
    const wrist = along(elbow, abduct(swingForward([0, 0, -1], p.arm + 6), 8, dir), FOREARM);
    out[LM[`${side}_ELBOW`]] = elbow;
    out[LM[`${side}_WRIST`]] = wrist;
    out[LM[`${side}_PINKY`]] = along(wrist, upper, 0.07);
    out[LM[`${side}_INDEX`]] = along(wrist, upper, 0.09);
    out[LM[`${side}_THUMB`]] = along(wrist, upper, 0.06);
  }

  // Legs: swing out to the side, then raise forward, so a straddle reads as a V from above and as two legs in the air from the side.
  for (const [side, dir] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const hip: Vec3 = [0, 0.1 * dir, 0];
    const down: Vec3 = [0, 0, -1];
    const thighDir = swingForward(abduct(down, p.spread, dir), p.thigh);
    const knee = along(hip, thighDir, THIGH);
    const shinDir = swingForward(thighDir, -p.knee);
    const ankle = along(knee, shinDir, SHIN);
    out[LM[`${side}_HIP`]] = hip;
    out[LM[`${side}_KNEE`]] = knee;
    out[LM[`${side}_ANKLE`]] = ankle;
    out[LM[`${side}_HEEL`]] = along(ankle, swingForward(shinDir, 100), -0.05);
    out[LM[`${side}_FOOT`]] = along(ankle, swingForward(shinDir, 25), 0.14);
  }
  return out;
}

export interface DemoJump {
  fps: number;
  world: WorldPoint[][];
  twist: TwistAnalysis;
  /** Sample of the takeoff, for the twist dial. */
  takeoff: number;
  /** The frame where the legs are wide open. */
  apex: number;
}

let cached: DemoJump | null = null;

/** The straddle jump, one cycle, ready for `drawPose3D`. Built once. */
export function demoStraddleJump(): DemoJump {
  if (cached) return cached;
  const n = Math.round(CYCLE_S * DEMO_FPS);
  const world: WorldPoint[][] = [];
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const body = bodyAt(poseAt(u));
    // Feet on the bed while it dips and lands, the hip on a parabola in the air.
    const airborne = smooth(TAKEOFF_AT - 0.04, TAKEOFF_AT + 0.02, u) - smooth(LANDING_AT - 0.02, LANDING_AT + 0.04, u);
    const t = Math.min(Math.max((u - TAKEOFF_AT) / (LANDING_AT - TAKEOFF_AT), 0), 1);
    const lift = JUMP_HEIGHT_M * 4 * t * (1 - t);
    const lowestFoot = Math.min(body[LM.L_FOOT][2], body[LM.R_FOOT][2], body[LM.L_HEEL][2], body[LM.R_HEEL][2]);
    const rise = (1 - airborne) * (-0.9 - lowestFoot) + airborne * lift;
    world.push(
      body.map<WorldPoint>((b) => ({
        // World frame: x = forward, y = down, z = the athlete's left, away from the camera.
        x: b[0],
        y: -(b[2] + rise),
        z: b[1],
        visibility: 0.99,
      })),
    );
  }
  const takeoff = Math.round(TAKEOFF_AT * n);
  const landing = Math.round(LANDING_AT * n);
  const time = world.map((_, i) => i / DEMO_FPS);
  const twist = analyzeTwist({
    world,
    time,
    fps: DEMO_FPS,
    cycles: [{ takeoff, landing, takeoffTimeS: takeoff / DEMO_FPS, landingTimeS: landing / DEMO_FPS, complete: true }],
  });
  cached = { fps: DEMO_FPS, world, twist, takeoff, apex: Math.round(0.5 * n) };
  return cached;
}
