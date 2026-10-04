import { describe, expect, it } from 'vitest';
import type { PoseDetection } from '../pose/types';
import { detectionsInFrame, fromView, isIdentity, squareView, toView, turnedView } from './view';

const frame = { width: 640, height: 360 };

describe('the view the pose model is given', () => {
  it('puts the point it is built around in the middle of a square view, and a turn leaves it there', () => {
    const view = squareView({ x: 300, y: 120 }, 180, 70, 384);
    expect(toView({ x: 300, y: 120 }, view)).toEqual({ x: 192, y: 192 });
  });

  it('scales the square it is made from to the size of the view', () => {
    const view = squareView({ x: 300, y: 120 }, 180, 0, 360);
    // 90 pixels to the right of the centre is a quarter of the square: 180 view pixels.
    expect(toView({ x: 390, y: 120 }, view).x).toBeCloseTo(180 + 180);
    expect(view.scale).toBe(2);
  });

  it('turns an athlete who leans to the right upright: the point above their hips goes straight up', () => {
    // The athlete leans 90° to the right: their head is to the right of their hips, in the frame.
    const hips = { x: 300, y: 200 };
    const head = { x: 380, y: 200 };
    const view = squareView(hips, 200, 90, 400);
    const h = toView(hips, view);
    const t = toView(head, view);
    expect(t.x).toBeCloseTo(h.x, 6);
    expect(t.y).toBeLessThan(h.y);
  });

  it('takes a point back to the frame exactly, whatever the turn, the scale and the move', () => {
    for (const angle of [-170, -90, -30, 0, 15, 90, 135, 180]) {
      const view = squareView({ x: 211.5, y: 98.25 }, 143, angle, 384);
      for (const p of [
        { x: 0, y: 0 },
        { x: 640, y: 360 },
        { x: 250.2, y: 60.7 },
      ]) {
        const back = fromView(toView(p, view), view);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
    const whole = turnedView(frame, { x: 320, y: 180 }, 123);
    const back = fromView(toView({ x: 10, y: 20 }, whole), whole);
    expect(back.x).toBeCloseTo(10, 6);
    expect(back.y).toBeCloseTo(20, 6);
  });

  it('is the frame itself when nothing is turned, moved or scaled', () => {
    expect(isIdentity(turnedView(frame, { x: 320, y: 180 }, 0), frame)).toBe(true);
    expect(isIdentity(turnedView(frame, { x: 320, y: 180 }, 20), frame)).toBe(false);
    expect(isIdentity(squareView({ x: 320, y: 180 }, 360, 0, 360), frame)).toBe(false);
  });
});

describe('what the pose model finds in a view, as it is in the frame', () => {
  const person = (x: number, y: number): PoseDetection => ({
    landmarks: [{ x, y, visibility: 0.9 }],
    world: [{ x: 0.1, y: -0.4, z: 0.2, visibility: 0.8 }],
  });

  it('is the landmarks put back where they were in the frame, in shares of the frame', () => {
    const view = squareView({ x: 300, y: 120 }, 180, 40, 384);
    // A point of the frame, seen in the view by the model as shares of the view.
    const p = { x: 330, y: 150 };
    const q = toView(p, view);
    const [back] = detectionsInFrame([person(q.x / 384, q.y / 384)], view, frame);
    expect(back.landmarks[0].x).toBeCloseTo(p.x / frame.width, 6);
    expect(back.landmarks[0].y).toBeCloseTo(p.y / frame.height, 6);
    expect(back.landmarks[0].visibility).toBe(0.9);
  });

  it('turns the 3D landmarks back by the angle and leaves their depth alone', () => {
    // The model saw the athlete upright, and the athlete leans 90° to the right in the frame: what is up in the view (negative y) is to the right in the frame.
    const view = squareView({ x: 300, y: 120 }, 180, 90, 384);
    const [back] = detectionsInFrame([person(0.5, 0.5)], view, frame);
    expect(back.world![0].x).toBeCloseTo(0.4, 6);
    expect(back.world![0].y).toBeCloseTo(0.1, 6);
    expect(back.world![0].z).toBe(0.2);
  });

  it('leaves out the 3D landmarks the model did not give', () => {
    const view = squareView({ x: 300, y: 120 }, 180, 0, 384);
    const [back] = detectionsInFrame([{ landmarks: [{ x: 0.5, y: 0.5, visibility: 1 }] }], view, frame);
    expect(back.world).toBeUndefined();
  });
});
