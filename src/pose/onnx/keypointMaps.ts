import { LANDMARK_COUNT, LM } from '../landmarks';
import type { Keypoint } from '../types';

/**
 * The app reads the 33-point BlazePose topology (see landmarks.ts). The other models give fewer points; each map lists, for
 * every point of the model, the landmark it fills (-1: the app has no such landmark). Landmarks no model point fills stay
 * unseen (visibility 0), and the analysis already copes with missing points (center of mass: `coverage`).
 */
export type KeypointMap = readonly number[];

/** COCO 17 (ViTPose): nose, eyes, ears and the body. No feet beyond the ankle and no hands: heels, toes and fingers stay unseen. */
export const COCO17: KeypointMap = [
  LM.NOSE,
  LM.L_EYE,
  LM.R_EYE,
  LM.L_EAR,
  LM.R_EAR,
  LM.L_SHOULDER,
  LM.R_SHOULDER,
  LM.L_ELBOW,
  LM.R_ELBOW,
  LM.L_WRIST,
  LM.R_WRIST,
  LM.L_HIP,
  LM.R_HIP,
  LM.L_KNEE,
  LM.R_KNEE,
  LM.L_ANKLE,
  LM.R_ANKLE,
];

/**
 * Halpe 26 (RTMPose body7-halpe26): COCO 17, then head top, neck, hip center, big toes, small toes, heels. The big toe stands for
 * BlazePose's "foot index" (the toe tip); the head top, neck, hip center and small toes have no BlazePose counterpart.
 */
export const HALPE26: KeypointMap = [
  ...COCO17,
  -1, // head top
  -1, // neck
  -1, // hip center
  LM.L_FOOT,
  LM.R_FOOT,
  -1, // left small toe
  -1, // right small toe
  LM.L_HEEL,
  LM.R_HEEL,
];

/** A point of a model, in the units the caller wants, with its score in [0, 1]. */
export interface ScoredPoint {
  x: number;
  y: number;
  score: number;
}

const unseen = (): Keypoint => ({ x: 0, y: 0, visibility: 0 });

/** The model's points as the app's 33 landmarks. */
export function toLandmarks(points: readonly ScoredPoint[], map: KeypointMap): Keypoint[] {
  const out: Keypoint[] = Array.from({ length: LANDMARK_COUNT }, unseen);
  map.forEach((target, i) => {
    const p = points[i];
    if (target < 0 || !p) return;
    out[target] = { x: p.x, y: p.y, visibility: Math.min(1, Math.max(0, p.score)) };
  });
  return out;
}
