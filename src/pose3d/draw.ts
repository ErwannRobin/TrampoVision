import { t } from '../i18n/core';
import { LM } from '../pose/landmarks';
import type { WorldPoint } from '../pose/types';
import { lateralPerp, vectorAt } from './torso';
import type { TwistAnalysis } from './twist';
import { add, cross, finite3, mid, rotateAbout, scale, unit, type Vec3 } from './vec3';

/** Drawing of the 3D skeleton, shared by the on-screen view and the video export. */

export interface View {
  yaw: number;
  pitch: number;
}

export interface Pose3DColors {
  ink: string;
  soft: string;
  left: string;
  right: string;
  grid: string;
}

/** Bones drawn in 3D: [from landmark, to landmark, side]. */
const BONES: [number, number, 'l' | 'r' | 'c'][] = [
  [LM.L_SHOULDER, LM.R_SHOULDER, 'c'],
  [LM.L_HIP, LM.R_HIP, 'c'],
  [LM.L_SHOULDER, LM.L_HIP, 'l'],
  [LM.R_SHOULDER, LM.R_HIP, 'r'],
  [LM.L_SHOULDER, LM.L_ELBOW, 'l'],
  [LM.L_ELBOW, LM.L_WRIST, 'l'],
  [LM.R_SHOULDER, LM.R_ELBOW, 'r'],
  [LM.R_ELBOW, LM.R_WRIST, 'r'],
  [LM.L_HIP, LM.L_KNEE, 'l'],
  [LM.L_KNEE, LM.L_ANKLE, 'l'],
  [LM.L_ANKLE, LM.L_FOOT, 'l'],
  [LM.R_HIP, LM.R_KNEE, 'r'],
  [LM.R_KNEE, LM.R_ANKLE, 'r'],
  [LM.R_ANKLE, LM.R_FOOT, 'r'],
];
const AMBER = '#d9a400';

/** Orthographic projection: yaw about the vertical axis, then pitch about the horizontal one. Depth grows away from the viewer. */
function projector(view: View, cx: number, cy: number, pxPerM: number) {
  const a = (view.yaw * Math.PI) / 180;
  const b = (view.pitch * Math.PI) / 180;
  const ca = Math.cos(a),
    sa = Math.sin(a),
    cb = Math.cos(b),
    sb = Math.sin(b);
  return (p: Vec3): [number, number, number] => {
    const x1 = p[0] * ca + p[2] * sa;
    const z1 = -p[0] * sa + p[2] * ca;
    const y2 = p[1] * cb - z1 * sb;
    const z2 = p[1] * sb + z1 * cb;
    return [cx + x1 * pxPerM, cy + y2 * pxPerM, z2];
  };
}

/** Accumulated twist at sample i minus the one at the takeoff of the selected jump; null when unknown. */
export function twistSinceTakeoff(twist: TwistAnalysis, takeoff: number | null, i: number): number | null {
  const f = twist.frames;
  if (!f || takeoff === null) return null;
  const a = f.angle[i];
  const b = f.angle[takeoff];
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

export interface Pose3DScene {
  /** 3D landmarks of this frame, or null when there are none. */
  world: WorldPoint[] | null;
  twist: TwistAnalysis;
  /** Takeoff sample of the selected jump, for the twist dial. */
  takeoff: number | null;
  /** Analysis sample being drawn. */
  i: number;
  view: View;
  colors: Pose3DColors;
  /** Only the skeleton: no long axis, chest arrow, twist dial or axes gizmo. For showing the figure without the measurements. */
  minimal?: boolean;
  /** Scale of the figure (1 = the default, which fits a standing person) and the height of the hip-centered origin, as a share of the area. */
  zoom?: number;
  originY?: number;
}

/** Draws one frame of the 3D skeleton with the torso, the longitudinal axis and the twist dial into a width x height area. */
export function drawPose3D(ctx: CanvasRenderingContext2D, width: number, height: number, scene: Pose3DScene) {
  const { world, twist, i, view } = scene;
  const { ink, soft, left, right, grid } = scene.colors;
  const HEIGHT = height;
  ctx.font = '11px system-ui, sans-serif';
  const frames = twist.frames;
  if (!scene.minimal) {
    ctx.fillStyle = grid;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 0, width, HEIGHT);
    ctx.globalAlpha = 1;
  }
  if (!world || !frames) {
    ctx.fillStyle = soft;
    ctx.textAlign = 'center';
    ctx.fillText(t(frames ? 'p3d.noFrame' : 'p3d.noLandmarks'), width / 2, HEIGHT / 2);
    return;
  }

  const P = (k: number): Vec3 => [world[k].x, world[k].y, world[k].z];
  const pxPerM = (Math.min(width, HEIGHT) / 2.2) * (scene.zoom ?? 1);
  const project = projector(view, width / 2, HEIGHT * (scene.originY ?? 0.5), pxPerM);
  const vis = (k: number) => world[k].visibility;

  // Skeleton, farthest bones first.
  const bones = BONES.map(([a, b, side]) => {
    const pa = project(P(a));
    const pb = project(P(b));
    return { pa, pb, side, depth: (pa[2] + pb[2]) / 2, faint: Math.min(vis(a), vis(b)) < 0.5 };
  }).sort((p, q) => q.depth - p.depth);
  // Torso plane.
  const quad = [LM.L_SHOULDER, LM.R_SHOULDER, LM.R_HIP, LM.L_HIP].map((k) => project(P(k)));
  ctx.beginPath();
  quad.forEach((q, n) => (n ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
  ctx.closePath();
  ctx.fillStyle = soft;
  ctx.globalAlpha = 0.14;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  for (const b of bones) {
    ctx.strokeStyle = b.side === 'l' ? left : b.side === 'r' ? right : soft;
    ctx.globalAlpha = b.faint ? 0.3 : 0.95;
    ctx.lineWidth = b.side === 'c' ? 3 : 2.5;
    ctx.beginPath();
    ctx.moveTo(b.pa[0], b.pa[1]);
    ctx.lineTo(b.pb[0], b.pb[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Head.
  const headC = mid(P(LM.L_EAR), P(LM.R_EAR));
  const shMid = mid(P(LM.L_SHOULDER), P(LM.R_SHOULDER));
  const hipMid = mid(P(LM.L_HIP), P(LM.R_HIP));
  if (finite3(headC)) {
    const h = project(headC);
    const s = project(shMid);
    ctx.strokeStyle = soft;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(h[0], h[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h[0], h[1], 0.09 * pxPerM, 0, 2 * Math.PI);
    ctx.stroke();
    const nose = project(P(LM.NOSE));
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(nose[0], nose[1], 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Longitudinal axis: hips to shoulders, extended.
  const u = vectorAt(frames.torso.axis, i);
  if (!scene.minimal && finite3(u)) {
    const a = project(add(hipMid, scale(u, -0.3)));
    const b = project(add(shMid, scale(u, 0.6)));
    ctx.strokeStyle = AMBER;
    ctx.fillStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - 9 * Math.cos(ang - 0.4), b[1] - 9 * Math.sin(ang - 0.4));
    ctx.lineTo(b[0] - 9 * Math.cos(ang + 0.4), b[1] - 9 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText(t('p3d.longAxis'), b[0] + 6, b[1] + 4);

    // Chest direction and the twist dial in the plane perpendicular to the axis, through the shoulders.
    const s = lateralPerp(frames.torso, 'shoulders', i);
    if (s) {
      const fwd = unit(cross(u, s));
      const torsoC = mid(shMid, hipMid);
      const c0 = project(torsoC);
      const c1 = project(add(torsoC, scale(fwd, 0.2)));
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c0[0], c0[1]);
      ctx.lineTo(c1[0], c1[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c1[0], c1[1], 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillText(t('p3d.chest'), c1[0] + 5, c1[1] - 4);

      // Dial: a ring through the shoulders; grey = where the shoulder line pointed at takeoff (carried along with the axis), amber = now.
      const radius = Math.max(0.16, Math.min(0.26, (frames.torso.shoulderWidthM[i] || 0.36) / 2));
      const center = shMid;
      const ringPoint = (dirv: Vec3, angleDeg: number, r: number): Vec3 =>
        add(center, scale(rotateAbout(dirv, u, angleDeg), r));
      ctx.strokeStyle = soft;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = 0; d <= 360; d += 10) {
        const q = project(ringPoint(s, d, radius));
        if (d) ctx.lineTo(q[0], q[1]);
        else ctx.moveTo(q[0], q[1]);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const rel = twistSinceTakeoff(twist, scene.takeoff, i);
      if (rel !== null) {
        const ref = rotateAbout(s, u, -rel);
        const tickRef = [project(center), project(ringPoint(ref, 0, radius * 1.1))];
        ctx.strokeStyle = soft;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(tickRef[0][0], tickRef[0][1]);
        ctx.lineTo(tickRef[1][0], tickRef[1][1]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Arc from the reference to the current direction (the short way; the number below has the full count).
        const wrapped = ((((rel + 180) % 360) + 360) % 360) - 180;
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const steps = Math.max(2, Math.ceil(Math.abs(wrapped) / 6));
        for (let n = 0; n <= steps; n++) {
          const q = project(ringPoint(ref, (wrapped * n) / steps, radius));
          if (n) ctx.lineTo(q[0], q[1]);
          else ctx.moveTo(q[0], q[1]);
        }
        ctx.stroke();
      }
    }
  }

  if (scene.minimal) return;

  // Axes gizmo, so the rotated views can be read.
  const g = (v: Vec3) => project(v);
  const o = [30, HEIGHT - 30];
  ctx.textAlign = 'center';
  for (const [label, v] of [
    ['x', [1, 0, 0]],
    ['y', [0, 1, 0]],
    ['z', [0, 0, 1]],
  ] as [string, Vec3][]) {
    const p = g(v);
    const p0 = g([0, 0, 0]);
    const dx = ((p[0] - p0[0]) / pxPerM) * 18;
    const dy = ((p[1] - p0[1]) / pxPerM) * 18;
    ctx.strokeStyle = soft;
    ctx.fillStyle = soft;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(o[0], o[1]);
    ctx.lineTo(o[0] + dx, o[1] + dy);
    ctx.stroke();
    ctx.fillText(label, o[0] + dx * 1.35, o[1] + dy * 1.35 + 4);
  }
}
