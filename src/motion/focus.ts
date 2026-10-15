import { LM } from '../pose/landmarks';
import type { PoseDetection } from '../pose/types';
import type { Box } from './types';

/** A landmark with less visibility than this is a guess, and the middle of a body is not taken from it. */
const SEEN = 0.3;
/** How far outside the box of the athlete the middle of a body may be and still be theirs, as a share of the size of the box: the box is a frame behind a fast jump. */
const SLACK = 0.5;

interface Point {
  x: number;
  y: number;
}

/** The middle of a person's body, normalized picture coordinates: the hips when they are seen, else the mean of the points that are, else of all of them. */
export function bodyCenter(person: PoseDetection): Point {
  const { landmarks } = person;
  const hips = [landmarks[LM.L_HIP], landmarks[LM.R_HIP]].filter((p) => p && p.visibility >= SEEN);
  const points = hips.length ? hips : landmarks.filter((p) => p.visibility >= SEEN);
  const used = points.length ? points : landmarks;
  const sum = used.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / Math.max(1, used.length), y: sum.y / Math.max(1, used.length) };
}

/**
 * A landmark with this visibility or less is not a point of the body at all: the ONNX engines leave the points their model lacks at 0. A
 * point with little visibility is kept: the pose model puts a leg it cannot see where the body says it is, and that is where the leg is.
 */
const PLACED = 0.05;

/**
 * The box around a person's skeleton, in the detector's picture (`picture` is its size): what the mask keeps of them next frame
 * (`TrampolineMotionDetector.seeBodies`). Null when the model placed too few points to say where the body is.
 */
export function bodyBox(person: PoseDetection, picture: { width: number; height: number }): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let placed = 0;
  for (const p of person.landmarks) {
    if (!(p.visibility > PLACED)) continue;
    const x = Math.min(1, Math.max(0, p.x)) * picture.width;
    const y = Math.min(1, Math.max(0, p.y)) * picture.height;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    placed++;
  }
  return placed >= 4 ? { x0, y0, x1, y1 } : null;
}

/**
 * Of the people the pose model found, the athletes: the person whose body is in the box of each athlete the motion detector reports, and nobody
 * else. A person who stands near the bed and is still seen by the model (the mask has a margin) is not the person who jumps. With no athlete
 * boxes (the detector is not sure yet) everybody is returned as found. When an athlete's box has nobody in it (the model lost them) nobody is
 * returned for it: a frame left empty is better than a frame that follows a stranger.
 *
 * `picture` is the size of the detector's picture, the unit of the boxes; the landmarks are normalized (0 to 1).
 */
export function focusOnAthletes(
  people: PoseDetection[],
  athletes: Box[],
  picture: { width: number; height: number },
): PoseDetection[] {
  if (athletes.length === 0 || people.length === 0) return people;
  const centers = people.map(bodyCenter);
  const taken = new Set<number>();
  const kept: number[] = [];
  for (const box of athletes) {
    const w = (box.x1 - box.x0 + 1) / picture.width;
    const h = (box.y1 - box.y0 + 1) / picture.height;
    const cx = box.x0 / picture.width + w / 2;
    const cy = box.y0 / picture.height + h / 2;
    let best = -1;
    let bestDistance = Infinity;
    centers.forEach((c, i) => {
      if (taken.has(i)) return;
      const dx = Math.abs(c.x - cx);
      const dy = Math.abs(c.y - cy);
      if (dx > w * (0.5 + SLACK) || dy > h * (0.5 + SLACK)) return;
      const distance = (dx / w) ** 2 + (dy / h) ** 2;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    if (best >= 0) {
      taken.add(best);
      kept.push(best);
    }
  }
  return kept.sort((a, b) => a - b).map((i) => people[i]);
}
