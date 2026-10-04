import { LM } from '../pose/landmarks';
import type { PoseDetection } from '../pose/types';
import { focusOnAthletes } from './focus';
import type { Box } from './types';
import { trunkAngle, UprightTracker } from './upright';
import { detectionsInFrame, paintView, squareView, turnedView, type View } from './view';

/** The side of the square the pose model is given when the picture is zoomed, pixels: more than the model reads, so that nothing is lost. */
const VIEW_SIDE = 384;
/** The square is this many times the longer side of the athlete's box: the box is the athlete and a little of the jump, and the model wants room around them. */
const ZOOM_SHARE = 1.7;
/** It is never smaller than this share of the frame's shorter side (a box that shrank on noise must not make the picture a speck), and not worth it above the next. */
const MIN_SIDE_SHARE = 0.3;
const MAX_SIDE_SHARE = 0.9;
/** The picture is turned upright once the athlete is expected to be turned by this many degrees, and turned back once less than the second. */
const TURN_FROM = 30;
const TURN_TO = 20;
/** What shows where the view has nothing from the frame. */
const FILL = 'rgb(128, 128, 128)';

interface Size {
  width: number;
  height: number;
}

export interface AthleteViewOptions {
  /** Turn the picture so that the athlete stands upright, when they are turned (a somersault). */
  rotate: boolean;
  /** Give the pose model a square around the athlete, made big, and not the whole frame: a person who is a small part of the frame is often not found in it. */
  zoom: boolean;
}

/** What the pose model is given for a frame, and how to take what it finds back to the frame. */
export interface Prepared {
  /** The picture for the pose model: the frame itself, or a canvas with the view of it. */
  source: CanvasImageSource;
  /** The view, or null when the source is the frame as it is. */
  view: View | null;
}

/** Paints a view of `source` and returns the canvas. */
export type Painter = (source: CanvasImageSource, view: View) => CanvasImageSource;

/** A painter that keeps one canvas and draws every view on it. */
function canvasPainter(): Painter {
  let canvas: HTMLCanvasElement | null = null;
  return (source, view) => {
    canvas ??= document.createElement('canvas');
    if (canvas.width !== view.width || canvas.height !== view.height) {
      canvas.width = view.width;
      canvas.height = view.height;
    }
    paintView(canvas.getContext('2d')!, source, view, FILL);
    return canvas;
  };
}

/**
 * The part of the motion detector that prepares a frame for the pose model, once it knows where the athlete is (their box):
 *
 * - **Zoom**: the model is given a square around the athlete, made big. A person who is a small part of the frame is often not found by the
 *   model in the whole frame (its person finder reads the frame at a small size), and found at once when they fill a crop.
 * - **Turn**: the model's reading of the angle of the trunk, frame after frame, says how far the athlete is turned (`UprightTracker`), and the
 *   picture is turned back by that much before the next frame is looked at, so that a somersault is seen upright. What the model finds is taken
 *   back to the frame, so nothing downstream knows the picture was turned or cut.
 *
 * Neither changes anything while the athlete is not found, or stands upright and is already big in the frame.
 */
export class AthleteView {
  private readonly tracker = new UprightTracker();
  private turning = false;
  private pivot: { x: number; y: number } | null = null;
  /** How far the picture was turned for the last frame, degrees (0 when it was not). */
  angle = 0;

  constructor(
    private readonly options: AthleteViewOptions,
    private readonly paint: Painter = canvasPainter(),
  ) {}

  /** How fast the athlete turns, degrees a frame, as the tracker believes. */
  get turn(): number {
    return this.tracker.turn;
  }

  reset(): void {
    this.tracker.reset();
    this.turning = false;
    this.pivot = null;
    this.angle = 0;
  }

  /**
   * The picture to give the pose model for a frame. `athlete` is the box of the athlete in the detector's picture (`picture` is its size), or null
   * when none is found: the frame is then given as it is.
   */
  prepare(source: CanvasImageSource, frame: Size, athlete: Box | null, picture: Size): Prepared {
    const sx = frame.width / picture.width;
    const sy = frame.height / picture.height;
    const center = athlete
      ? { x: ((athlete.x0 + athlete.x1 + 1) / 2) * sx, y: ((athlete.y0 + athlete.y1 + 1) / 2) * sy }
      : this.pivot;

    this.angle = 0;
    if (this.options.rotate) {
      const predicted = this.tracker.predict();
      this.turning = Math.abs(predicted) >= (this.turning ? TURN_TO : TURN_FROM);
      if (this.turning) this.angle = predicted;
    }

    let view: View | null = null;
    if (this.options.zoom && athlete && center) {
      const short = Math.min(frame.width, frame.height);
      const side = Math.max(
        MIN_SIDE_SHARE * short,
        ZOOM_SHARE * Math.max((athlete.x1 - athlete.x0 + 1) * sx, (athlete.y1 - athlete.y0 + 1) * sy),
      );
      // An athlete who already fills the frame gains nothing from a crop of it.
      if (side < MAX_SIDE_SHARE * short) view = squareView(center, side, this.angle, VIEW_SIDE);
    }
    if (!view && this.angle !== 0 && center) view = turnedView(frame, center, this.angle);
    return view ? { source: this.paint(source, view), view } : { source, view: null };
  }

  /**
   * Takes what the pose model found in the prepared picture back to the frame, and learns from it: the person in the box of the athlete is the
   * athlete, and the angle of their trunk is what the next frame is turned by.
   */
  finish(people: PoseDetection[], prepared: Prepared, frame: Size, athletes: Box[], picture: Size): PoseDetection[] {
    const inFrame = prepared.view ? detectionsInFrame(people, prepared.view, frame) : people;
    const athlete = athletes.length ? focusOnAthletes(inFrame, athletes, picture)[0] : undefined;
    this.tracker.update(athlete ? trunkAngle(athlete.landmarks, frame.width, frame.height) : null);
    if (athlete) {
      const left = athlete.landmarks[LM.L_HIP];
      const right = athlete.landmarks[LM.R_HIP];
      this.pivot = { x: ((left.x + right.x) / 2) * frame.width, y: ((left.y + right.y) / 2) * frame.height };
    }
    return inFrame;
  }
}
