import { LANDMARK_COUNT, LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';

/** Test helper: a straight standing stick figure (feet at y = footY, image y down). */
export function standingPose(cx: number, footY: number, heightPx = 175, angleDeg = 0): Keypoint[] {
  const H = heightPx;
  const pts: Keypoint[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: cx, y: footY, visibility: 1 }));
  const at = (k: number, dx: number, up: number) => {
    pts[k] = { x: cx + dx, y: footY - up, visibility: 1 };
  };
  const sw = 0.13 * H; // half shoulder width
  const hw = 0.05 * H; // half hip width
  at(LM.NOSE, 0, 0.91 * H);
  at(LM.L_EAR, -0.03 * H, 0.935 * H);
  at(LM.R_EAR, 0.03 * H, 0.935 * H);
  at(LM.L_SHOULDER, -sw, 0.818 * H);
  at(LM.R_SHOULDER, sw, 0.818 * H);
  at(LM.L_ELBOW, -sw, 0.63 * H);
  at(LM.R_ELBOW, sw, 0.63 * H);
  at(LM.L_WRIST, -sw, 0.46 * H);
  at(LM.R_WRIST, sw, 0.46 * H);
  at(LM.L_PINKY, -sw, 0.4 * H);
  at(LM.R_PINKY, sw, 0.4 * H);
  at(LM.L_INDEX, -sw, 0.4 * H);
  at(LM.R_INDEX, sw, 0.4 * H);
  at(LM.L_HIP, -hw, 0.53 * H);
  at(LM.R_HIP, hw, 0.53 * H);
  at(LM.L_KNEE, -hw, 0.285 * H);
  at(LM.R_KNEE, hw, 0.285 * H);
  at(LM.L_ANKLE, -hw, 0.039 * H);
  at(LM.R_ANKLE, hw, 0.039 * H);
  at(LM.L_HEEL, -hw, 0.02 * H);
  at(LM.R_HEEL, hw, 0.02 * H);
  at(LM.L_FOOT, -hw + 0.1 * H, 0);
  at(LM.R_FOOT, hw + 0.1 * H, 0);
  return angleDeg === 0 ? pts : rotateAbout(pts, { x: cx, y: footY - 0.53 * H }, angleDeg);
}

/** Rotates points clockwise (as seen on screen) by `deg` about `c`. */
export function rotateAbout(pts: Keypoint[], c: { x: number; y: number }, deg: number): Keypoint[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return pts.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    // y-down coordinates: this matrix rotates clockwise on screen for positive angles
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos, visibility: p.visibility };
  });
}
