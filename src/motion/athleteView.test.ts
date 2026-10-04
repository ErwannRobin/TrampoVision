import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT, LM } from '../pose/landmarks';
import type { PoseDetection } from '../pose/types';
import { AthleteView, type Painter } from './athleteView';
import type { Box } from './types';
import { toView, type View } from './view';

const frame = { width: 640, height: 360 };
const picture = { width: 128, height: 72 };
const source = { name: 'the frame' } as unknown as CanvasImageSource;

/** A painter that gives a marker, and remembers the views it was asked for. */
function painter() {
  const views: View[] = [];
  const paint: Painter = (_source, view) => {
    views.push(view);
    return { name: 'a view' } as unknown as CanvasImageSource;
  };
  return { paint, views };
}

/** The box of an athlete 20 × 30 detector pixels, around (x, y). */
const boxAt = (x: number, y: number): Box => ({ x0: x - 10, x1: x + 9, y0: y - 15, y1: y + 14 });

/**
 * What a perfect pose model finds for an athlete whose hips are at (hx, hy) of the frame, pixels, and who leans `lean` degrees to the right: its
 * landmarks in the prepared picture, as shares of it (a view, or the frame).
 */
function found(hx: number, hy: number, lean: number, view: View | null): PoseDetection {
  const rad = (lean * Math.PI) / 180;
  const trunk = 70;
  const spot = (x: number, y: number) => {
    const q = view ? toView({ x, y }, view) : { x, y };
    const size = view ?? frame;
    return { x: q.x / size.width, y: q.y / size.height, visibility: 1 };
  };
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => spot(hx, hy));
  landmarks[LM.L_HIP] = spot(hx - 8, hy);
  landmarks[LM.R_HIP] = spot(hx + 8, hy);
  const sx = hx + Math.sin(rad) * trunk;
  const sy = hy - Math.cos(rad) * trunk;
  landmarks[LM.L_SHOULDER] = spot(sx - 8, sy);
  landmarks[LM.R_SHOULDER] = spot(sx + 8, sy);
  return { landmarks };
}

describe('preparing a frame for the pose model', () => {
  it('gives the frame as it is while no athlete is found', () => {
    const view = new AthleteView({ rotate: true, zoom: true }, painter().paint);
    expect(view.prepare(source, frame, null, picture)).toEqual({ source, view: null });
  });

  it('is told nothing to do, and does nothing', () => {
    const { paint, views } = painter();
    const view = new AthleteView({ rotate: false, zoom: false }, paint);
    expect(view.prepare(source, frame, boxAt(64, 40), picture)).toEqual({ source, view: null });
    expect(views).toHaveLength(0);
  });

  describe('zoom', () => {
    it('gives a square around the athlete, which is bigger than their box and the same size every frame', () => {
      const { paint, views } = painter();
      const view = new AthleteView({ rotate: false, zoom: true }, paint);
      const a = view.prepare(source, frame, boxAt(64, 40), picture);
      expect(a.view).not.toBeNull();
      expect(a.source).not.toBe(source);
      // The box is 20 × 30 detector pixels = 100 × 150 frame pixels: the square is 1.7 times the longer side.
      expect(views[0].cx).toBeCloseTo(((54 + 74) / 2) * 5, 6);
      expect(views[0].cy).toBeCloseTo(((25 + 55) / 2) * 5, 6);
      expect(views[0].width).toBe(384);
      expect(views[0].width / views[0].scale).toBeCloseTo(1.7 * 150, 6);
      const b = view.prepare(source, frame, boxAt(70, 35), picture);
      expect(b.view!.width).toBe(a.view!.width);
    });

    it('does not make a square smaller than a share of the frame, when the box shrank on noise', () => {
      const { paint, views } = painter();
      const view = new AthleteView({ rotate: false, zoom: true }, paint);
      view.prepare(source, frame, { x0: 62, x1: 64, y0: 38, y1: 40 }, picture);
      expect(views[0].width / views[0].scale).toBeCloseTo(0.3 * 360, 6);
    });

    it('leaves an athlete who already fills the frame alone', () => {
      const view = new AthleteView({ rotate: false, zoom: true }, painter().paint);
      expect(view.prepare(source, frame, { x0: 30, x1: 98, y0: 4, y1: 68 }, picture)).toEqual({ source, view: null });
    });

    it('takes what the model finds in the square back to the frame', () => {
      const prepared = new AthleteView({ rotate: false, zoom: true }, painter().paint);
      const box = boxAt(64, 40);
      const p = prepared.prepare(source, frame, box, picture);
      // The athlete is at (330, 200) of the frame, and the model saw them in the square.
      const [back] = prepared.finish([found(330, 200, 0, p.view)], p, frame, [box], picture);
      expect(back.landmarks[LM.L_HIP].x * frame.width).toBeCloseTo(322, 4);
      expect(back.landmarks[LM.L_HIP].y * frame.height).toBeCloseTo(200, 4);
    });
  });

  describe('turning the picture', () => {
    /** Runs a somersault of `perFrame` degrees a frame through the view, with a perfect pose model, and gives the angle each frame was turned by. */
    function somersault(perFrame: number, frames: number, zoom = false) {
      const { paint } = painter();
      const view = new AthleteView({ rotate: true, zoom }, paint);
      const box = boxAt(64, 40);
      const turned: number[] = [];
      for (let f = 0; f < frames; f++) {
        const p = view.prepare(source, frame, box, picture);
        turned.push(view.angle);
        const lean = f * perFrame;
        view.finish([found(320, 200, lean, p.view)], p, frame, [box], picture);
      }
      return { turned, view };
    }

    it('leaves an athlete who stands upright alone', () => {
      const { turned } = somersault(0, 20);
      expect(turned.every((angle) => angle === 0)).toBe(true);
    });

    it('turns the picture by about the angle the athlete will have, once they are turned by 30° or more', () => {
      const { turned } = somersault(15, 40);
      // Frame f has the athlete at 15 f degrees: the picture is turned by what was expected for it, a few degrees off at most.
      for (let f = 6; f < 40; f++) {
        const truth = ((((f * 15 + 180) % 360) + 360) % 360) - 180;
        if (Math.abs(truth) < 40) continue;
        expect(turned[f]).not.toBe(0);
        expect(Math.abs(((((turned[f] - truth + 180) % 360) + 360) % 360) - 180)).toBeLessThan(8);
      }
    });

    it('does not turn the picture for the part of the turn that is nearly upright', () => {
      const { turned } = somersault(15, 40);
      // Around 0 and 360° (frames 24 or so) the athlete is within 20° of upright.
      expect(turned[24]).toBe(0);
    });

    it('gives the model the same athlete upright in every frame: what it saw is what a standing athlete looks like', () => {
      const { paint, views } = painter();
      const view = new AthleteView({ rotate: true, zoom: true }, paint);
      const box = boxAt(64, 40);
      const leans: number[] = [];
      for (let f = 0; f < 30; f++) {
        const p = view.prepare(source, frame, box, picture);
        const lean = f * 15;
        if (p.view) {
          // The trunk in the view: from the hips to the shoulders, as the model sees it.
          const d = found(320, 200, lean, p.view).landmarks;
          const h = { x: (d[LM.L_HIP].x + d[LM.R_HIP].x) / 2, y: (d[LM.L_HIP].y + d[LM.R_HIP].y) / 2 };
          const s = {
            x: (d[LM.L_SHOULDER].x + d[LM.R_SHOULDER].x) / 2,
            y: (d[LM.L_SHOULDER].y + d[LM.R_SHOULDER].y) / 2,
          };
          if (f >= 8) leans.push((Math.atan2(s.x - h.x, -(s.y - h.y)) * 180) / Math.PI);
        }
        view.finish([found(320, 200, lean, p.view)], p, frame, [box], picture);
      }
      expect(views.length).toBeGreaterThan(5);
      expect(leans.length).toBeGreaterThan(5);
      // The athlete in the view is within a few degrees of upright whenever the picture was turned.
      for (const angle of leans) expect(Math.abs(angle)).toBeLessThan(20);
    });

    it('learns from the person who is in the box of the athlete, and not from somebody else', () => {
      const { paint } = painter();
      const view = new AthleteView({ rotate: true, zoom: false }, paint);
      const box = boxAt(64, 40);
      for (let f = 0; f < 20; f++) {
        const p = view.prepare(source, frame, box, picture);
        // The athlete somersaults at 15° a frame; a coach, far from the box, stands upright.
        view.finish([found(560, 300, 0, p.view), found(320, 200, f * 15, p.view)], p, frame, [box], picture);
      }
      expect(view.turn).toBeCloseTo(15, 0);
    });

    it('forgets the turn when it is reset', () => {
      const { view } = somersault(15, 20);
      view.reset();
      expect(view.turn).toBe(0);
      expect(view.angle).toBe(0);
    });
  });
});
