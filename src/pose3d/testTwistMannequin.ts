import { makeRng } from '../analysis/testTracks';
import { LM, LANDMARK_COUNT } from '../pose/landmarks';
import type { WorldPoint } from '../pose/types';
import { add, dot, mid, rotateAbout, scale, sub, unit, type Vec3 } from './vec3';
import type { TwistInput } from './twist';

/**
 * Test support (not used by the app): a rigid 3D athlete with a KNOWN somersault and a KNOWN twist, in the MediaPipe
 * world frame (meters, hip-centered, x right, y down, z away from the camera), plus the ways a real pose model goes wrong.
 * Body frame: (forward, left, up), right-handed. Twist is a rotation about the body's own up axis, + = toward the athlete's left
 * (counter-clockwise seen from above the head); somersault is a rotation about the camera axis, + = clockwise on screen.
 */

export interface TwistJumpSpec {
  fps?: number;
  /** Seconds in the air. */
  flightS?: number;
  /** Seconds standing before takeoff and after landing. */
  groundS?: number;
  /** Somersault turns about the camera axis (+ = clockwise on screen). */
  somersaultTurns?: number;
  /** Twists about the body axis; 1 = a full twist = 360 degrees, + = toward the athlete's left. */
  twistTurns?: number;
  /** +1: faces the right of the image when upright; -1: left. */
  facing?: 1 | -1;
  /** Camera yaw from side-on, degrees (0 = side view, 90 = seen from the front or back). */
  yawDeg?: number;
  /** Constant forward lean of the trunk, degrees (a real pose, not an error). */
  leanDeg?: number;
}

export interface SyntheticTwistJump {
  time: number[];
  world: WorldPoint[][];
  input: TwistInput;
  /** Twist in degrees the athlete really did between takeoff and landing. */
  truthTwistDeg: number;
}

/** Body-frame landmark positions (forward, left, up) in meters, standing straight with the arms at the sides. */
function bodyLandmarks(): Vec3[] {
  const p: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
  const both = (l: number, r: number, f: number, y: number, z: number) => {
    p[l] = [f, y, z];
    p[r] = [f, -y, z];
  };
  p[LM.NOSE] = [0.08, 0, 0.66];
  both(LM.L_EYE_INNER, LM.R_EYE_INNER, 0.07, 0.02, 0.68);
  both(LM.L_EYE, LM.R_EYE, 0.07, 0.04, 0.68);
  both(LM.L_EYE_OUTER, LM.R_EYE_OUTER, 0.06, 0.06, 0.68);
  both(LM.L_EAR, LM.R_EAR, 0, 0.08, 0.67);
  both(LM.MOUTH_L, LM.MOUTH_R, 0.07, 0.025, 0.62);
  both(LM.L_SHOULDER, LM.R_SHOULDER, 0, 0.19, 0.5);
  both(LM.L_ELBOW, LM.R_ELBOW, 0, 0.22, 0.22);
  both(LM.L_WRIST, LM.R_WRIST, 0, 0.23, -0.04);
  both(LM.L_PINKY, LM.R_PINKY, 0, 0.24, -0.1);
  both(LM.L_INDEX, LM.R_INDEX, 0.02, 0.23, -0.11);
  both(LM.L_THUMB, LM.R_THUMB, 0.03, 0.22, -0.09);
  both(LM.L_HIP, LM.R_HIP, 0, 0.1, 0);
  both(LM.L_KNEE, LM.R_KNEE, 0, 0.1, -0.42);
  both(LM.L_ANKLE, LM.R_ANKLE, 0, 0.1, -0.85);
  both(LM.L_HEEL, LM.R_HEEL, -0.05, 0.1, -0.9);
  both(LM.L_FOOT, LM.R_FOOT, 0.12, 0.1, -0.9);
  return p;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function syntheticTwistJump(spec: TwistJumpSpec = {}): SyntheticTwistJump {
  const fps = spec.fps ?? 30;
  const flightS = spec.flightS ?? 1;
  const groundS = spec.groundS ?? 0.4;
  const facing = spec.facing ?? -1;
  const som = spec.somersaultTurns ?? 0;
  const twist = spec.twistTurns ?? 0;
  const yaw = spec.yawDeg ?? 0;
  const lean = spec.leanDeg ?? 0;
  const total = 2 * groundS + flightS;
  const n = Math.round(total * fps) + 1;
  const takeoff = Math.round(groundS * fps);
  const landing = Math.round((groundS + flightS) * fps);
  const up: Vec3 = [0, -1, 0];
  const fwd: Vec3 = [facing, 0, 0];
  const left: Vec3 = [0, 0, facing];
  const body = bodyLandmarks();
  const time: number[] = [];
  const world: WorldPoint[][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    time.push(t);
    const u = Math.min(Math.max((t - groundS) / flightS, 0), 1);
    const somDeg = 360 * som * u;
    const twistDeg = 360 * twist * smoothstep(0.15, 0.85, u);
    const pts = body.map<WorldPoint>((local) => {
      // Lean about the body's left axis, then twist about its up axis.
      const lc = (lean * Math.PI) / 180;
      const a0 = local[0] * Math.cos(lc) + local[2] * Math.sin(lc);
      const c0 = -local[0] * Math.sin(lc) + local[2] * Math.cos(lc);
      const tc = (twistDeg * Math.PI) / 180;
      const a = a0 * Math.cos(tc) - local[1] * Math.sin(tc);
      const b = a0 * Math.sin(tc) + local[1] * Math.cos(tc);
      let w = add(add(scale(fwd, a), scale(left, b)), scale(up, c0));
      w = rotateAbout(w, [0, 0, 1], somDeg); // somersault about the camera axis
      w = rotateAbout(w, [0, 1, 0], yaw); // camera yaw
      return { x: w[0], y: w[1], z: w[2], visibility: 0.99 };
    });
    world.push(pts);
  }
  const cycle = { takeoff, landing, takeoffTimeS: takeoff / fps, landingTimeS: landing / fps, complete: true };
  return { time, world, input: { world, time, fps, cycles: [cycle] }, truthTwistDeg: 360 * twist };
}

export interface WorldDegrade {
  /** Gaussian noise on every coordinate, meters. */
  xyNoiseM?: number;
  /** Gaussian noise on the depth coordinate only, meters. Monocular models are worst there. */
  depthNoiseM?: number;
  /**
   * A constant error in the estimated depth of the trunk: the shoulders are reported this share of a trunk length closer to (+) or
   * farther from (-) the camera than the hips, along the trunk's direction in the image. 0.27 is about the 15 degrees seen on real output.
   */
  trunkLeanBias?: number;
  /** Probability that a whole frame has no 3D at all. */
  dropout?: number;
  /** Frames [from, to] (inclusive) where the model swaps left and right labels. */
  swapLeftRight?: [number, number];
  seed?: number;
}

const gauss = (rnd: () => number) => {
  const u1 = Math.max((rnd() + 1) / 2, 1e-9);
  const u2 = (rnd() + 1) / 2;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/** Left/right landmark pairs in the 33-point topology. */
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

export function degradeWorld(world: WorldPoint[][], opts: WorldDegrade): (WorldPoint[] | null)[] {
  const rnd = makeRng(opts.seed ?? 7);
  return world.map((f, i) => {
    if (opts.dropout && (rnd() + 1) / 2 < opts.dropout) return null;
    let pts = f.map((p) => ({ ...p }));
    if (opts.trunkLeanBias) {
      const hipMid = mid([f[LM.L_HIP].x, f[LM.L_HIP].y, f[LM.L_HIP].z], [f[LM.R_HIP].x, f[LM.R_HIP].y, f[LM.R_HIP].z]);
      const shMid = mid(
        [f[LM.L_SHOULDER].x, f[LM.L_SHOULDER].y, f[LM.L_SHOULDER].z],
        [f[LM.R_SHOULDER].x, f[LM.R_SHOULDER].y, f[LM.R_SHOULDER].z],
      );
      const trunk = sub(shMid, hipMid);
      const inPlane = unit([trunk[0], trunk[1], 0]);
      pts = pts.map((p) => ({ ...p, z: p.z + opts.trunkLeanBias! * dot(sub([p.x, p.y, p.z], hipMid), inPlane) }));
    }
    if (opts.xyNoiseM || opts.depthNoiseM) {
      pts = pts.map((p) => ({
        ...p,
        x: p.x + (opts.xyNoiseM ?? 0) * gauss(rnd),
        y: p.y + (opts.xyNoiseM ?? 0) * gauss(rnd),
        z: p.z + ((opts.xyNoiseM ?? 0) + (opts.depthNoiseM ?? 0)) * gauss(rnd),
      }));
    }
    if (opts.swapLeftRight && i >= opts.swapLeftRight[0] && i <= opts.swapLeftRight[1]) {
      for (const [l, r] of PAIRS) [pts[l], pts[r]] = [pts[r], pts[l]];
    }
    return pts;
  });
}
