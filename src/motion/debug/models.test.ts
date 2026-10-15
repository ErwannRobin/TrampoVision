import { describe, expect, it } from 'vitest';
import { CORE_LANDMARKS, LANDMARK_COUNT } from '../../pose/landmarks';
import type { PoseDetection } from '../../pose/types';
import { addFrame, describeTally, emptyTally, pointsSeen, POSE_MODELS } from './models';

/** A person whose first `seen` body points are rated 0.9 and the rest 0.2. */
function person(seen: number): PoseDetection {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }));
  CORE_LANDMARKS.slice(0, seen).forEach((k) => (landmarks[k].visibility = 0.9));
  return { landmarks };
}

describe('the models to compare', () => {
  it('are the three MediaPipe sizes and the two experimental engines, each once', () => {
    expect(POSE_MODELS.map((m) => m.engine)).toEqual(['mediapipe', 'mediapipe', 'mediapipe', 'rtmpose', 'vitpose']);
    expect(new Set(POSE_MODELS.map((m) => m.id)).size).toBe(POSE_MODELS.length);
  });
});

describe('what a model did', () => {
  it('counts the body points it rates as seen, out of the 13 every model has', () => {
    expect(pointsSeen(person(13))).toBe(1);
    expect(pointsSeen(person(0))).toBe(0);
    expect(pointsSeen(person(13 - 13 / 13))).toBeCloseTo(12 / 13);
  });

  it('adds up the frames, those with the athlete, how much of them was seen and the time', () => {
    const tally = emptyTally();
    addFrame(tally, true, person(13), 20);
    addFrame(tally, true, person(0), 30);
    addFrame(tally, true, null, 40);
    addFrame(tally, true, null, 10);
    expect(describeTally(tally)).toEqual({ frames: '4', found: '50 %', points: '50 %', ms: '25 ms' });
  });

  it('judges the athlete only in the frames where the detector knew where they are', () => {
    const tally = emptyTally();
    addFrame(tally, false, null, 10);
    addFrame(tally, false, null, 10);
    addFrame(tally, true, person(13), 10);
    expect(describeTally(tally)).toMatchObject({ frames: '3', found: '100 %' });
  });

  it('says nothing before the first frame', () => {
    expect(describeTally(emptyTally())).toEqual({ frames: '0', found: '–', points: '–', ms: '–' });
  });
});
