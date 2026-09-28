import { mid } from '../analysis/geometry';
import { LM } from './landmarks';
import type { Keypoint, Point } from './types';

export type Side = 'left' | 'right' | 'center';
export interface Bone { a: Point; b: Point; side: Side }
export interface Joint { name: string; p: Point; side: Side }
export interface Wireframe { bones: Bone[]; joints: Joint[]; head: Point | null; headRadius: number }

const ok = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Simplified stick figure for display: head, shoulders, elbows, wrists, hips, knees, ankles.
 * Pure geometry (no drawing), so a different renderer (WebGL, 3D) can reuse it.
 */
export function buildWireframe(kp: Keypoint[]): Wireframe {
  const g = (i: number) => (ok(kp[i]) ? kp[i] : null);
  const bones: Bone[] = [];
  const joints: Joint[] = [];
  const joint = (name: string, i: number, side: Side) => {
    const p = g(i);
    if (p) joints.push({ name, p, side });
  };
  const bone = (a: Point | null, b: Point | null, side: Side) => {
    if (a && b) bones.push({ a, b, side });
  };
  const midOf = (i: number, j: number) => {
    const a = g(i);
    const b = g(j);
    return a && b ? mid(a, b) : null;
  };

  const head = midOf(LM.L_EAR, LM.R_EAR) ?? g(LM.NOSE);
  const shoulders = midOf(LM.L_SHOULDER, LM.R_SHOULDER);
  const hips = midOf(LM.L_HIP, LM.R_HIP);

  bone(head, shoulders, 'center');
  bone(g(LM.L_SHOULDER), g(LM.R_SHOULDER), 'center');
  bone(g(LM.L_HIP), g(LM.R_HIP), 'center');
  bone(g(LM.L_SHOULDER), g(LM.L_HIP), 'left');
  bone(g(LM.R_SHOULDER), g(LM.R_HIP), 'right');
  bone(g(LM.L_SHOULDER), g(LM.L_ELBOW), 'left');
  bone(g(LM.L_ELBOW), g(LM.L_WRIST), 'left');
  bone(g(LM.R_SHOULDER), g(LM.R_ELBOW), 'right');
  bone(g(LM.R_ELBOW), g(LM.R_WRIST), 'right');
  bone(g(LM.L_HIP), g(LM.L_KNEE), 'left');
  bone(g(LM.L_KNEE), g(LM.L_ANKLE), 'left');
  bone(g(LM.R_HIP), g(LM.R_KNEE), 'right');
  bone(g(LM.R_KNEE), g(LM.R_ANKLE), 'right');

  joint('L shoulder', LM.L_SHOULDER, 'left');
  joint('R shoulder', LM.R_SHOULDER, 'right');
  joint('L elbow', LM.L_ELBOW, 'left');
  joint('R elbow', LM.R_ELBOW, 'right');
  joint('L wrist', LM.L_WRIST, 'left');
  joint('R wrist', LM.R_WRIST, 'right');
  joint('L hip', LM.L_HIP, 'left');
  joint('R hip', LM.R_HIP, 'right');
  joint('L knee', LM.L_KNEE, 'left');
  joint('R knee', LM.R_KNEE, 'right');
  joint('L ankle', LM.L_ANKLE, 'left');
  joint('R ankle', LM.R_ANKLE, 'right');
  if (head) joints.push({ name: 'head', p: head, side: 'center' });

  const trunkLen = shoulders && hips ? Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) : 40;
  return { bones, joints, head, headRadius: Math.max(6, trunkLen * 0.2) };
}
