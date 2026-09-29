import { fillGaps } from '../analysis/signal';
import { LM } from '../pose/landmarks';
import type { WorldPoint } from '../pose/types';
import type { TwistConfig } from './config';
import { finite3, mid, norm, perpendicular, sub, unit, type Vec3 } from './vec3';

/**
 * The torso as a moving frame, per sample, from the 3D landmarks:
 *  - axis: the longitudinal body axis, from the hip center to the shoulder center (unit vector);
 *  - shoulders / hips: direction of the line from the left to the right shoulder / hip (unit vectors, not yet made perpendicular to the axis);
 * plus the measurements that say how far the data can be trusted.
 * Vectors are stored as x, y, z triples in flat arrays (3 numbers per sample). NaN = no data.
 */
export interface TorsoFrames {
  count: number;
  fps: number;
  axis: Float64Array;
  shoulders: Float64Array;
  hips: Float64Array;
  /** 1 where the axis is known (measured or bridged over a short gap). */
  valid: Uint8Array;
  /** 1 where the four torso landmarks were measured in that sample (not bridged). */
  measured: Uint8Array;
  /** Distance between the two shoulders / hips in meters. A rigid body keeps it constant: its variation is a depth-quality check. */
  shoulderWidthM: Float64Array;
  hipWidthM: Float64Array;
  torsoLengthM: Float64Array;
  /** Share of the shoulder / hip line that is perpendicular to the axis (1 = square to it). Low = the line is (nearly) along the axis: no twist can be read. */
  shoulderShare: Float64Array;
  hipShare: Float64Array;
  /** Share of the shoulder line that points along the camera axis (|z| / length). 1 = the shoulders line up with the viewing direction: twist then shows only through depth. */
  shoulderDepthShare: Float64Array;
  /** Lowest visibility of the four torso landmarks. */
  visibility: Float64Array;
  /** Angle of the axis out of the image plane, degrees (0 = the trunk lies in the image plane, 90 = points at the camera). */
  axisTiltDeg: Float64Array;
  /** Angle of the axis in the image plane, degrees from up, clockwise = +, the same convention as the 2D trunk angle. */
  axisAngleDeg: Float64Array;
}

const get = (a: Float64Array, i: number): Vec3 => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];
export const vectorAt = get;

function fillVectors(a: Float64Array, count: number, maxGap: number) {
  for (let c = 0; c < 3; c++) {
    const comp = new Float64Array(count);
    for (let i = 0; i < count; i++) comp[i] = a[3 * i + c];
    const filled = fillGaps(comp, maxGap, 'linear');
    for (let i = 0; i < count; i++) a[3 * i + c] = filled[i];
  }
  for (let i = 0; i < count; i++) {
    const v = unit(get(a, i));
    a[3 * i] = v[0];
    a[3 * i + 1] = v[1];
    a[3 * i + 2] = v[2];
  }
}

/** Builds the torso frames from the world landmarks of a whole clip. `world` may hold nulls (nobody found). */
export function computeTorsoFrames(world: (WorldPoint[] | null)[], fps: number, cfg: TwistConfig): TorsoFrames {
  const n = world.length;
  const nan3 = () => new Float64Array(3 * n).fill(NaN);
  const nan1 = () => new Float64Array(n).fill(NaN);
  const out: TorsoFrames = {
    count: n,
    fps,
    axis: nan3(),
    shoulders: nan3(),
    hips: nan3(),
    valid: new Uint8Array(n),
    measured: new Uint8Array(n),
    shoulderWidthM: nan1(),
    hipWidthM: nan1(),
    torsoLengthM: nan1(),
    shoulderShare: nan1(),
    hipShare: nan1(),
    shoulderDepthShare: nan1(),
    visibility: new Float64Array(n),
    axisTiltDeg: nan1(),
    axisAngleDeg: nan1(),
  };

  for (let i = 0; i < n; i++) {
    const f = world[i];
    if (!f || f.length <= LM.R_HIP) continue;
    const idx = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
    const vis = Math.min(...idx.map((k) => f[k].visibility));
    out.visibility[i] = vis;
    if (vis < cfg.minVisibility) continue;
    const p = (k: number): Vec3 => [f[k].x, f[k].y, f[k].z];
    if (![LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP].every((k) => finite3(p(k)))) continue;
    const shoulderMid = mid(p(LM.L_SHOULDER), p(LM.R_SHOULDER));
    const hipMid = mid(p(LM.L_HIP), p(LM.R_HIP));
    const trunk = sub(shoulderMid, hipMid);
    const len = norm(trunk);
    if (len < 1e-6) continue;
    const u = unit(trunk);
    const s = sub(p(LM.R_SHOULDER), p(LM.L_SHOULDER));
    const h = sub(p(LM.R_HIP), p(LM.L_HIP));
    const ns = norm(s);
    const nh = norm(h);
    out.measured[i] = 1;
    out.torsoLengthM[i] = len;
    out.shoulderWidthM[i] = ns;
    out.hipWidthM[i] = nh;
    out.axisTiltDeg[i] = (Math.asin(Math.min(1, Math.abs(u[2]))) * 180) / Math.PI;
    out.axisAngleDeg[i] = (Math.atan2(u[0], -u[1]) * 180) / Math.PI;
    out.axis.set(u, 3 * i);
    if (ns > 1e-6) {
      const share = norm(perpendicular(s, u)) / ns;
      out.shoulderShare[i] = share;
      out.shoulderDepthShare[i] = Math.abs(s[2]) / ns;
      if (share >= cfg.minLateralShare) out.shoulders.set(unit(s), 3 * i);
    }
    if (nh > 1e-6) {
      const share = norm(perpendicular(h, u)) / nh;
      out.hipShare[i] = share;
      if (share >= cfg.minLateralShare) out.hips.set(unit(h), 3 * i);
    }
  }

  // Short gaps are bridged (component-wise, then re-normalized); longer ones stay empty.
  const maxGap = Math.max(1, Math.round(cfg.maxGapS * fps));
  fillVectors(out.axis, n, maxGap);
  fillVectors(out.shoulders, n, maxGap);
  fillVectors(out.hips, n, maxGap);
  for (let i = 0; i < n; i++) out.valid[i] = finite3(get(out.axis, i)) ? 1 : 0;
  // Angles of bridged samples follow the bridged axis.
  for (let i = 0; i < n; i++) {
    if (out.valid[i] && !out.measured[i]) {
      const u = get(out.axis, i);
      out.axisTiltDeg[i] = (Math.asin(Math.min(1, Math.abs(u[2]))) * 180) / Math.PI;
      out.axisAngleDeg[i] = (Math.atan2(u[0], -u[1]) * 180) / Math.PI;
    }
  }
  return out;
}

/** The lateral line (shoulders or hips) with its component along the axis removed and re-normalized, or null. */
export function lateralPerp(frames: TorsoFrames, line: 'shoulders' | 'hips', i: number): Vec3 | null {
  const l = get(frames[line], i);
  const u = get(frames.axis, i);
  if (!finite3(l) || !finite3(u)) return null;
  const p = unit(perpendicular(l, u));
  return finite3(p) ? p : null;
}
