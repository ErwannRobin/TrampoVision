import { dist, jointAngle, mid } from '../analysis/geometry';
import type { AnalysisResult } from '../analysis/types';
import { unwrapDegrees } from '../analysis/signal';
import { CORE_LANDMARKS, FACE_LANDMARKS, LM } from '../pose/landmarks';
import type { Point } from '../pose/types';
import { classifyPosition } from './bodyPosition';
import type { SkillConfig } from './config';
import { POSITION_CODE } from './types';

/** Joints written to the sequence, in this order. Face points other than the nose only feed the facing cue. */
export const SEQUENCE_JOINTS: { name: string; index: number }[] = [
  ['nose', LM.NOSE],
  ['left_ear', LM.L_EAR],
  ['right_ear', LM.R_EAR],
  ['left_shoulder', LM.L_SHOULDER],
  ['right_shoulder', LM.R_SHOULDER],
  ['left_elbow', LM.L_ELBOW],
  ['right_elbow', LM.R_ELBOW],
  ['left_wrist', LM.L_WRIST],
  ['right_wrist', LM.R_WRIST],
  ['left_hip', LM.L_HIP],
  ['right_hip', LM.R_HIP],
  ['left_knee', LM.L_KNEE],
  ['right_knee', LM.R_KNEE],
  ['left_ankle', LM.L_ANKLE],
  ['right_ankle', LM.R_ANKLE],
  ['left_heel', LM.L_HEEL],
  ['right_heel', LM.R_HEEL],
  ['left_foot_index', LM.L_FOOT],
  ['right_foot_index', LM.R_FOOT],
].map(([name, index]) => ({ name: name as string, index: index as number }));

/** How much a joint sample is trusted, by how it was obtained (see stabilize.ts). */
export const STATE_TRUST = [0, 1, 0.6, 0.4] as const;

const TRUNK_JOINTS = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];

/** Everything measured per analysis sample that the skill logic needs. NaN = not available. */
export interface FrameShape {
  count: number;
  /** Interior angles, degrees (180 = straight). Left and right sides are averaged through their midpoints. */
  hipAngle: Float64Array;
  kneeAngle: Float64Array;
  /** Angle between the shoulder line and the hip line, 0..90 degrees. */
  shoulderHipAxis: Float64Array;
  /** Ankle distance / leg length. */
  legSeparation: Float64Array;
  /** Knees to trunk, in trunk lengths. */
  kneeTorso: Float64Array;
  /** 1 - extent / path length, see JumpFeatures.shape.compactness. */
  compactness: Float64Array;
  /** 2D trunk length in pixels. */
  trunkLengthPx: Float64Array;
  /** Body position of the sample (POSITION_CODE), from the thresholds. */
  position: Uint8Array;
  /** Trust in the core joints 0..1 (see STATE_TRUST), and in the four trunk joints alone. */
  quality: Float64Array;
  trunkQuality: Float64Array;
  /** Facing votes in [-1, 1]; + = the athlete faces the right of the image when upright. */
  faceVote: Float64Array;
  kneeVote: Float64Array;
  footVote: Float64Array;
  /** Body-line (ankles to head) orientation, made continuous like the trunk orientation. */
  lineOrientation: Float64Array;
  /** Joint positions in the body frame (see JumpSequence.frame), units of body length: one series per SEQUENCE_JOINTS entry. */
  bodyX: Float64Array[];
  bodyY: Float64Array[];
}

const nan = (n: number) => new Float64Array(n).fill(NaN);
const ok = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Midpoint of a left/right pair; falls back to the one that exists. */
function pairMid(a: Point, b: Point): Point | null {
  if (ok(a) && ok(b)) return mid(a, b);
  if (ok(a)) return a;
  if (ok(b)) return b;
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Distance from p to the segment a-b. */
function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Smaller angle between two undirected lines, 0..90 degrees. */
function lineAngleBetween(a1: Point, a2: Point, b1: Point, b2: Point): number {
  const ta = Math.atan2(a2.y - a1.y, a2.x - a1.x);
  const tb = Math.atan2(b2.y - b1.y, b2.x - b1.x);
  let d = Math.abs(((ta - tb) * 180) / Math.PI) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

/** Measures the pose of every sample of an analysis: joint angles, distances, body-frame coordinates, facing cues. */
export function computeFrameShape(result: AnalysisResult, cfg: SkillConfig): FrameShape {
  const n = result.meta.count;
  const body = result.meta.bodyLengthPx;
  const fs: FrameShape = {
    count: n,
    hipAngle: nan(n),
    kneeAngle: nan(n),
    shoulderHipAxis: nan(n),
    legSeparation: nan(n),
    kneeTorso: nan(n),
    compactness: nan(n),
    trunkLengthPx: nan(n),
    position: new Uint8Array(n).fill(POSITION_CODE.unknown),
    quality: new Float64Array(n),
    trunkQuality: new Float64Array(n),
    faceVote: nan(n),
    kneeVote: nan(n),
    footVote: nan(n),
    lineOrientation: unwrapDegrees(result.lineAngle),
    bodyX: SEQUENCE_JOINTS.map(() => nan(n)),
    bodyY: SEQUENCE_JOINTS.map(() => nan(n)),
  };

  for (let i = 0; i < n; i++) {
    // Trust: how the core joints of this sample were obtained.
    let q = 0;
    for (const k of CORE_LANDMARKS) q += STATE_TRUST[result.jointState[k][i]] ?? 0;
    fs.quality[i] = q / CORE_LANDMARKS.length;
    let qt = 0;
    for (const k of TRUNK_JOINTS) qt += STATE_TRUST[result.jointState[k][i]] ?? 0;
    fs.trunkQuality[i] = qt / TRUNK_JOINTS.length;

    const pts = result.landmarks[i];
    if (!pts) continue;
    const shoulders = pairMid(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]);
    const hips = pairMid(pts[LM.L_HIP], pts[LM.R_HIP]);
    const knees = pairMid(pts[LM.L_KNEE], pts[LM.R_KNEE]);
    const ankles = pairMid(pts[LM.L_ANKLE], pts[LM.R_ANKLE]);
    if (!shoulders || !hips) continue;
    const trunk = dist(shoulders, hips);
    if (!(trunk > 1e-6)) continue;
    fs.trunkLengthPx[i] = trunk;

    // Body frame: origin at the hips, y along the trunk, x to its right (the image x when upright).
    const uy = { x: (shoulders.x - hips.x) / trunk, y: (shoulders.y - hips.y) / trunk };
    const ux = { x: -uy.y, y: uy.x };
    const toBody = (p: Point) => {
      const dx = p.x - hips.x;
      const dy = p.y - hips.y;
      return { x: dx * ux.x + dy * ux.y, y: dx * uy.x + dy * uy.y };
    };
    SEQUENCE_JOINTS.forEach((j, s) => {
      const p = pts[j.index];
      if (!ok(p)) return;
      const b = toBody(p);
      fs.bodyX[s][i] = b.x / body;
      fs.bodyY[s][i] = b.y / body;
    });

    if (knees) fs.hipAngle[i] = jointAngle(shoulders, hips, knees);
    if (knees && ankles) {
      fs.kneeAngle[i] = jointAngle(hips, knees, ankles);
      const legLen = dist(hips, knees) + dist(knees, ankles);
      if (legLen > 1e-6) {
        if (ok(pts[LM.L_ANKLE]) && ok(pts[LM.R_ANKLE]))
          fs.legSeparation[i] = dist(pts[LM.L_ANKLE], pts[LM.R_ANKLE]) / legLen;
      }
    }
    if (knees) fs.kneeTorso[i] = pointSegmentDistance(knees, hips, shoulders) / trunk;

    const ls = pts[LM.L_SHOULDER];
    const rs = pts[LM.R_SHOULDER];
    const lh = pts[LM.L_HIP];
    const rh = pts[LM.R_HIP];
    if (ok(ls) && ok(rs) && ok(lh) && ok(rh) && dist(ls, rs) > 0.03 * trunk && dist(lh, rh) > 0.03 * trunk) {
      fs.shoulderHipAxis[i] = lineAngleBetween(ls, rs, lh, rh);
    }

    // Compactness: how much shorter the head-to-feet extent is than the path through the joints.
    const head = ok(pts[LM.NOSE]) ? pts[LM.NOSE] : pairMid(pts[LM.L_EAR], pts[LM.R_EAR]);
    if (head && knees && ankles) {
      const chain = [head, shoulders, hips, knees, ankles];
      const path = dist(head, shoulders) + trunk + dist(hips, knees) + dist(knees, ankles);
      let extent = 0;
      for (let a = 0; a < chain.length; a++)
        for (let b = a + 1; b < chain.length; b++) extent = Math.max(extent, dist(chain[a], chain[b]));
      if (path > 1e-6) fs.compactness[i] = Math.max(0, 1 - extent / path);
    }

    fs.position[i] =
      POSITION_CODE[
        classifyPosition(
          { hipAngle: fs.hipAngle[i], kneeAngle: fs.kneeAngle[i], kneeTorso: fs.kneeTorso[i] },
          cfg.position,
        ).label
      ];

    // Facing cues, in the body frame (+x = right of the trunk when upright).
    const earMid = pairMid(pts[LM.L_EAR], pts[LM.R_EAR]);
    const faceBody = FACE_LANDMARKS.map((k) => pts[k])
      .filter(ok)
      .map(toBody);
    if (earMid && faceBody.length >= 3) {
      const fx = faceBody.reduce((s, p) => s + p.x, 0) / faceBody.length;
      const ex = toBody(earMid).x;
      fs.faceVote[i] = clamp((fx - ex) / trunk / cfg.facing.faceSaturation, -1, 1);
    }
    if (knees && ankles) {
      const a = toBody(ankles);
      const k = toBody(knees);
      const len = Math.hypot(a.x, a.y);
      const legLen = dist(hips, knees) + dist(knees, ankles);
      if (len > 0.15 * legLen) {
        // Signed distance of the knee from the hip-ankle line; a knee only bends forward, so + = facing +x.
        const forward = (a.x * k.y - a.y * k.x) / len;
        fs.kneeVote[i] = clamp(forward / (cfg.facing.kneeSaturation * legLen), -1, 1);
      }
    }
    const toes = pairMid(pts[LM.L_FOOT], pts[LM.R_FOOT]);
    const heels = pairMid(pts[LM.L_HEEL], pts[LM.R_HEEL]);
    if (toes && heels) fs.footVote[i] = clamp((toBody(toes).x - toBody(heels).x) / (0.25 * trunk), -1, 1);
  }
  return fs;
}
