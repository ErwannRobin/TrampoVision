import { estimateCom } from '../analysis/com';
import { syntheticRoutine, type JumpSpec, type PoseBuilder, type RoutineTruth } from '../analysis/testTracks';
import type { PoseTrack } from '../analysis/types';
import { LANDMARK_COUNT, LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';

/**
 * Test helper (not used by the app): an articulated 2D athlete whose joint angles are known, so the
 * skill logic can be checked against ground truth. The body is built in its own frame (origin at the
 * hips, x = the direction the athlete faces, y = up) and then rotated about its center of mass
 * along a ballistic path, like a real jump. Proportions are fractions of the standing height and are
 * only roughly human.
 */

export type ShapeName = 'straight' | 'tuck' | 'pike';

export interface MannequinShape {
  /** Thigh rotated forward from the trunk line, degrees. Interior hip angle = 180 - this. */
  hipFlexDeg: number;
  /** Shank rotated backward from the thigh line, degrees. Interior knee angle = 180 - this. */
  kneeFlexDeg: number;
  /** Upper arm angle from hanging down (0) through forward (90) to overhead (180). */
  armDeg: number;
  /** Elbow flexion, degrees. */
  elbowDeg: number;
  /** 0 = flat foot (toes forward), 1 = pointed toes (foot in line with the shank). */
  pointedToes: number;
}

export const OPEN_SHAPE: MannequinShape = { hipFlexDeg: 4, kneeFlexDeg: 3, armDeg: 150, elbowDeg: 0, pointedToes: 0.9 };
export const SHAPES: Record<ShapeName, MannequinShape> = {
  straight: OPEN_SHAPE,
  tuck: { hipFlexDeg: 125, kneeFlexDeg: 115, armDeg: 55, elbowDeg: 40, pointedToes: 0.6 },
  pike: { hipFlexDeg: 100, kneeFlexDeg: 4, armDeg: 85, elbowDeg: 0, pointedToes: 0.9 },
};

const TRUNK = 0.288;
const HEAD_UP = 0.117;
const THIGH = 0.245;
const SHANK = 0.246;
const UPPER_ARM = 0.188;
const FOREARM = 0.17;
const HAND = 0.06;
const HALF_SHOULDER = 0.008; // side-view left/right offset, so the two sides are not exactly on top of each other

interface P2 {
  x: number;
  y: number;
}
const dir = (angleDeg: number): P2 => {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) }; // angle from "down" toward "forward"
};
const add = (a: P2, b: P2, k = 1): P2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/** All 33 landmarks in the body frame, in units of standing height. */
export function bodyFramePose(s: MannequinShape): P2[] {
  const pts: P2[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }));
  const hip: P2 = { x: 0, y: 0 };
  const shoulder: P2 = { x: 0, y: TRUNK };
  const head: P2 = { x: 0, y: TRUNK + HEAD_UP };
  const knee = add(hip, dir(s.hipFlexDeg), THIGH);
  const shankDir = dir(s.hipFlexDeg - s.kneeFlexDeg);
  const ankle = add(knee, shankDir, SHANK);
  const forward = { x: -shankDir.y, y: shankDir.x }; // shank direction turned toward "forward" (flat-foot direction)
  const p = s.pointedToes;
  const toe = add(add(ankle, forward, (1 - p) * 0.1 + p * 0.03), shankDir, (1 - p) * 0.039 + p * 0.14);
  const heel = add(add(ankle, shankDir, 0.019), forward, -0.02 * p);
  const upperDir = dir(s.armDeg);
  const foreDir = dir(s.armDeg + s.elbowDeg);
  const elbow = add(shoulder, upperDir, UPPER_ARM);
  const wrist = add(elbow, foreDir, FOREARM);
  const fingers = add(wrist, foreDir, HAND);

  const both = (l: number, r: number, at: P2) => {
    pts[l] = { x: at.x - HALF_SHOULDER, y: at.y };
    pts[r] = { x: at.x + HALF_SHOULDER, y: at.y };
  };
  both(LM.L_SHOULDER, LM.R_SHOULDER, shoulder);
  both(LM.L_ELBOW, LM.R_ELBOW, elbow);
  both(LM.L_WRIST, LM.R_WRIST, wrist);
  both(LM.L_PINKY, LM.R_PINKY, fingers);
  both(LM.L_INDEX, LM.R_INDEX, fingers);
  both(LM.L_THUMB, LM.R_THUMB, add(wrist, foreDir, HAND * 0.8));
  both(LM.L_HIP, LM.R_HIP, hip);
  both(LM.L_KNEE, LM.R_KNEE, knee);
  both(LM.L_ANKLE, LM.R_ANKLE, ankle);
  both(LM.L_HEEL, LM.R_HEEL, heel);
  both(LM.L_FOOT, LM.R_FOOT, toe);
  // Head in profile: the face is in front of the ears.
  pts[LM.L_EAR] = { x: head.x - 0.012, y: head.y };
  pts[LM.R_EAR] = { x: head.x - 0.012, y: head.y };
  pts[LM.NOSE] = { x: head.x + 0.05, y: head.y - 0.008 };
  pts[LM.L_EYE_INNER] = { x: head.x + 0.038, y: head.y + 0.012 };
  pts[LM.R_EYE_INNER] = { x: head.x + 0.038, y: head.y + 0.012 };
  pts[LM.L_EYE] = { x: head.x + 0.042, y: head.y + 0.012 };
  pts[LM.R_EYE] = { x: head.x + 0.042, y: head.y + 0.012 };
  pts[LM.L_EYE_OUTER] = { x: head.x + 0.03, y: head.y + 0.012 };
  pts[LM.R_EYE_OUTER] = { x: head.x + 0.03, y: head.y + 0.012 };
  pts[LM.MOUTH_L] = { x: head.x + 0.04, y: head.y - 0.03 };
  pts[LM.MOUTH_R] = { x: head.x + 0.04, y: head.y - 0.03 };
  return pts;
}

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, w: number) => a + (b - a) * w;
const mix = (a: MannequinShape, b: MannequinShape, w: number): MannequinShape => ({
  hipFlexDeg: lerp(a.hipFlexDeg, b.hipFlexDeg, w),
  kneeFlexDeg: lerp(a.kneeFlexDeg, b.kneeFlexDeg, w),
  armDeg: lerp(a.armDeg, b.armDeg, w),
  elbowDeg: lerp(a.elbowDeg, b.elbowDeg, w),
  pointedToes: lerp(a.pointedToes, b.pointedToes, w),
});

export interface MannequinJump extends JumpSpec {
  /** Body position held in the air. A name picks the default shape; an object gives the exact joint angles. */
  shape?: ShapeName | MannequinShape;
  /** Direction the athlete faces when upright: +1 = right of the image, -1 = left. Default: the routine's. */
  facing?: 1 | -1;
  /** When the shape is reached / left, as fractions of the flight. */
  closeBy?: number;
  openFrom?: number;
}

export interface MannequinRoutine {
  jumps: MannequinJump[];
  heightM?: number;
  pxPerM?: number;
  fps?: number;
  facing?: 1 | -1;
  leadInS?: number;
  contactS?: number;
  tailS?: number;
}

/** Pose builder for `syntheticRoutine`: the mannequin follows a ballistic center-of-mass path. */
export function mannequinPoseBuilder(o: MannequinRoutine): PoseBuilder {
  const H = o.heightM ?? 1.75;
  const standing = bodyFramePose(OPEN_SHAPE);
  const standingCom = estimateCom(standing)!;
  const feetY = Math.min(...standing.map((p) => p.y));
  const comAboveFeet = standingCom.y - feetY; // in heights

  return (c) => {
    const spec = c.phase === 'flight' ? o.jumps[c.jump] : undefined;
    const facing = spec?.facing ?? o.jumps[Math.max(0, Math.min(c.jump, o.jumps.length - 1))]?.facing ?? o.facing ?? 1;
    let shape: MannequinShape;
    if (c.phase === 'flight' && spec) {
      const target = typeof spec.shape === 'object' ? spec.shape : SHAPES[spec.shape ?? 'straight'];
      const w = smooth(c.u, 0.1, spec.closeBy ?? 0.3) * (1 - smooth(c.u, spec.openFrom ?? 0.72, 0.9));
      shape = mix(OPEN_SHAPE, target, w);
    } else if (c.phase === 'contact') {
      // Knees and hips give a little under load; feet stay flat on the bed.
      const flex = Math.min(60, (c.depthM / H) * 260);
      shape = { ...OPEN_SHAPE, kneeFlexDeg: flex, hipFlexDeg: flex * 0.6, armDeg: 30, pointedToes: 0 };
    } else {
      shape = { ...OPEN_SHAPE, armDeg: 20, pointedToes: 0 };
    }

    const body = bodyFramePose(shape);
    const com = estimateCom(body)!;
    const scale = H * c.pxPerM;
    const comPx = { x: c.x, y: c.footY - comAboveFeet * scale };
    const a = (c.angleDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return body.map<Keypoint>((p) => {
      const dx = facing * (p.x - com.x) * scale;
      const dy = -(p.y - com.y) * scale;
      return { x: comPx.x + dx * cos - dy * sin, y: comPx.y + dx * sin + dy * cos, visibility: 1 };
    });
  };
}

export interface MannequinTruth extends RoutineTruth {
  /** Per jump: the facing used and the shape name. */
  facing: (1 | -1)[];
}

export function mannequinRoutine(o: MannequinRoutine): { track: PoseTrack; truth: MannequinTruth } {
  const { track, truth } = syntheticRoutine({
    jumps: o.jumps,
    fps: o.fps,
    pxPerM: o.pxPerM,
    athleteHeightM: o.heightM,
    leadInS: o.leadInS,
    contactS: o.contactS,
    tailS: o.tailS,
    pose: mannequinPoseBuilder(o),
  });
  return { track, truth: { ...truth, facing: o.jumps.map((j) => j.facing ?? o.facing ?? 1) } };
}

/** Test-only degradations of a track: extra position noise and random landmark dropouts. */
export function degradeTrack(
  track: PoseTrack,
  o: { noisePx?: number; dropout?: number; seed?: number; visibilityJitter?: boolean },
): PoseTrack {
  let s = o.seed ?? 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const noise = o.noisePx ?? 0;
  const drop = o.dropout ?? 0;
  return {
    ...track,
    frames: track.frames.map(
      (f) =>
        f &&
        f.map((p) => {
          const dropped = drop > 0 && (rnd() + 1) / 2 < drop;
          return {
            x: p.x + noise * rnd(),
            y: p.y + noise * rnd(),
            visibility: dropped ? 0.1 : o.visibilityJitter ? 0.6 + (0.4 * (rnd() + 1)) / 2 : p.visibility,
          };
        }),
    ),
  };
}
