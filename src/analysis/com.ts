import { LM } from '../pose/landmarks';
import type { Point } from '../pose/types';

/**
 * A body segment for the center-of-mass model. `from`/`to` are lists of landmark indices whose
 * average defines the proximal/distal end (alternatives are tried in order until one is fully
 * available). The segment COM sits at `from + ratio * (to - from)`.
 */
interface Segment {
  name: string;
  mass: number; // fraction of body mass
  from: number[][];
  to: number[][];
  ratio: number;
}

const SHOULDERS = [LM.L_SHOULDER, LM.R_SHOULDER];
const HIPS = [LM.L_HIP, LM.R_HIP];

/**
 * Segment masses and COM positions after de Leva (1996), male values (adapted from
 * Zatsiorsky–Seluyanov), mapped onto MediaPipe landmarks. The numbers were written from memory
 * (mass fractions sum to 1.000, checked in tests) and should be verified before any
 * scientific use. Head: ear midpoint (roughly the head center); trunk: midpoint between the
 * shoulder and hip centers; hand and foot use simple landmark midpoints/ratios, since MediaPipe's
 * finger/toe points don't match the anthropometric end points.
 */
export const SEGMENTS: Segment[] = [
  {
    name: 'head',
    mass: 0.0694,
    from: [[LM.L_EAR, LM.R_EAR], [LM.NOSE]],
    to: [[LM.L_EAR, LM.R_EAR], [LM.NOSE]],
    ratio: 0,
  },
  { name: 'trunk', mass: 0.4346, from: [SHOULDERS], to: [HIPS], ratio: 0.5 },
  { name: 'upperArmL', mass: 0.0271, from: [[LM.L_SHOULDER]], to: [[LM.L_ELBOW]], ratio: 0.5772 },
  { name: 'upperArmR', mass: 0.0271, from: [[LM.R_SHOULDER]], to: [[LM.R_ELBOW]], ratio: 0.5772 },
  { name: 'forearmL', mass: 0.0162, from: [[LM.L_ELBOW]], to: [[LM.L_WRIST]], ratio: 0.4574 },
  { name: 'forearmR', mass: 0.0162, from: [[LM.R_ELBOW]], to: [[LM.R_WRIST]], ratio: 0.4574 },
  { name: 'handL', mass: 0.0061, from: [[LM.L_WRIST]], to: [[LM.L_INDEX, LM.L_PINKY]], ratio: 0.5 },
  { name: 'handR', mass: 0.0061, from: [[LM.R_WRIST]], to: [[LM.R_INDEX, LM.R_PINKY]], ratio: 0.5 },
  { name: 'thighL', mass: 0.1416, from: [[LM.L_HIP]], to: [[LM.L_KNEE]], ratio: 0.4095 },
  { name: 'thighR', mass: 0.1416, from: [[LM.R_HIP]], to: [[LM.R_KNEE]], ratio: 0.4095 },
  { name: 'shankL', mass: 0.0433, from: [[LM.L_KNEE]], to: [[LM.L_ANKLE]], ratio: 0.4459 },
  { name: 'shankR', mass: 0.0433, from: [[LM.R_KNEE]], to: [[LM.R_ANKLE]], ratio: 0.4459 },
  { name: 'footL', mass: 0.0137, from: [[LM.L_HEEL]], to: [[LM.L_FOOT]], ratio: 0.4415 },
  { name: 'footR', mass: 0.0137, from: [[LM.R_HEEL]], to: [[LM.R_FOOT]], ratio: 0.4415 },
];

function resolve(pts: Point[], alternatives: number[][]): Point | null {
  for (const indices of alternatives) {
    let x = 0;
    let y = 0;
    let ok = true;
    for (const i of indices) {
      const p = pts[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        ok = false;
        break;
      }
      x += p.x;
      y += p.y;
    }
    if (ok) return { x: x / indices.length, y: y / indices.length };
  }
  return null;
}

export interface ComEstimate extends Point {
  /** Fraction of body mass that could be located (1 = every segment available). */
  coverage: number;
}

/**
 * Weighted average of the segment centers. Segments with missing landmarks are dropped and the
 * remaining weights renormalized; `coverage` tells how much mass was actually used.
 */
export function estimateCom(pts: Point[]): ComEstimate | null {
  let sx = 0;
  let sy = 0;
  let mass = 0;
  for (const seg of SEGMENTS) {
    const a = resolve(pts, seg.from);
    const b = resolve(pts, seg.to);
    if (!a || !b) continue;
    sx += seg.mass * (a.x + seg.ratio * (b.x - a.x));
    sy += seg.mass * (a.y + seg.ratio * (b.y - a.y));
    mass += seg.mass;
  }
  if (mass <= 0) return null;
  const total = SEGMENTS.reduce((s, seg) => s + seg.mass, 0);
  return { x: sx / mass, y: sy / mass, coverage: mass / total };
}
