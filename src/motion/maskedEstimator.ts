import type { PoseDetection, PoseEstimatorFactory } from '../pose/types';
import type { MotionConfig } from './config';
import { AthleteView, type AthleteViewOptions, type Painter, type Prepared } from './athleteView';
import { focusOnAthletes } from './focus';
import { JumperSelector } from './jumperSelect';
import { CanvasMaskLayer, type MaskLayer } from './layer';
import type { MotionResult } from './types';

/** A mask that keeps this much of the picture or more hides nothing worth the trouble: the picture goes to the pose model as it is. */
const NOTHING_HIDDEN = 0.999;

/**
 * The zoom view is used only while the athlete is smaller than this share of the picture's shorter side, on a steady shot. Measured at 30
 * frames a second on real footage (share of frames in which the chosen athlete is seen, plain → zoomed): it lifts a small athlete — a wide
 * tripod shot (share 0.21) 7% → 55%, a synchro one (0.31) 28% → 61%, a competition clip filmed from behind the end deck (0.26) 0% → 54% —
 * and it hurts a big one (a phone close-up, 0.60: 87% → 58%) and a broadcast with cuts and tilts (55% → 36%), whose box is often wrong.
 */
const ZOOM_MAX_SHARE = 0.4;
/** ... and stays in use until the athlete grows past this: the smoothed share wobbles around a threshold (it reaches 0.45 on the competition clip when the boxes of the jumper and the spotter join). */
const ZOOM_OFF_SHARE = 0.5;
/** The camera must be slower than this, shorter sides of the picture a second: tripod shots measure 0 to 0.10 (the subject's own motion), a broadcast that follows the athlete 0.2 to 0.8. The kind of shot is not used — a tripod synchro clip is called "tracking" from the jumpers' own motion. */
const ZOOM_MAX_SPEED = 0.12;
/** ... and the zoom view lets go above this: the speed wobbles too. */
const ZOOM_OFF_SPEED = 0.18;
/** The shot must have been steady, with a small athlete, this long before the zoom view cuts in: the phone close-up passes below `ZOOM_MAX_SHARE` for about a second while its share settles. */
const ZOOM_WARMUP_S = 2;

/**
 * Says, frame by frame, whether the zoomed view of the athlete would help the pose model: yes once the shot has been steady (slow) with a
 * small athlete for `ZOOM_WARMUP_S`, and until the athlete grows or the camera moves (`ZOOM_MAX_SHARE`, `ZOOM_MAX_SPEED`).
 */
export class ZoomGate {
  private smallSinceMs: number | null = null;
  private on = false;

  helps(result: MotionResult, timestampMs: number): boolean {
    const { athleteShare, speed } = result.camera;
    const small =
      athleteShare > 0 &&
      athleteShare < (this.on ? ZOOM_OFF_SHARE : ZOOM_MAX_SHARE) &&
      speed < (this.on ? ZOOM_OFF_SPEED : ZOOM_MAX_SPEED);
    if (!small) {
      this.smallSinceMs = null;
      this.on = false;
      return false;
    }
    this.smallSinceMs ??= timestampMs;
    this.on = this.on || timestampMs - this.smallSinceMs >= ZOOM_WARMUP_S * 1000;
    return this.on;
  }
}

/** Whether a frame is worth painting over: the detector found a region and the mask hides something. When not, the pose model gets the video. */
export function hidesSomething(result: MotionResult | null): boolean {
  return result !== null && result.coverage < NOTHING_HIDDEN;
}

export interface MotionMaskOptions {
  config?: Partial<MotionConfig>;
  /** What shows where the picture is hidden (a CSS color). Default: a flat gray. */
  fill?: string;
  /** Told what the detector found in every frame (null when the frame could not be read), for a debug view. */
  onFrame?: (result: MotionResult | null) => void;
  /**
   * Give back only the person who jumps, and not the people who stand near the bed and are still seen through the margin of the mask.
   * The person whose hips travel up and down like a jumper's is the athlete (`JumperSelector`); while no one has travelled yet (the
   * first jump, or a camera that follows the athlete and keeps them still in the picture), the person in the box the detector reports
   * is. Default true. Nobody is dropped while neither knows where the athlete is. `'travel'` trusts the travel alone: until it knows,
   * every frame is left empty — for the app's tracker, which locks on the first person it is given and must not be given the spotter.
   */
  focus?: boolean | 'travel';
  /**
   * How many people the choice of the jumper keeps (synchro films two). Defaults to the detector's `maxAthletes`. Separate
   * from the detector's own count: two tracks of hips can be told apart in a single motion box.
   */
  athletes?: number;
  /**
   * What is done to the picture after the background is hidden and before the pose model looks at it, once the athlete is found (`AthleteView`):
   * `zoom` gives it a square around the athlete, made big, and `rotate` turns the picture so that an athlete in a somersault stands upright. What
   * the model finds is taken back to the frame. Both are off by default: neither has been tried on real footage.
   */
  view?: Partial<AthleteViewOptions>;
  /** Where the views are painted. Default: a canvas. Tests give a fake one. */
  paint?: Painter;
  /** Where the frames are read and painted. Default: canvases. Tests give a fake one. */
  layer?: () => MaskLayer;
}

/**
 * Puts the motion detector in front of a pose estimator: every frame is given to the detector first, and what the pose model sees is the
 * frame with everything that is not where the athlete jumps painted over. It plugs into the seam that already exists
 * (`ExtractOptions.createEstimator`), so nothing in the pose or the analysis changes:
 *
 *     extractPoseTracks(url, { ...options, createEstimator: withMotionMask(estimatorFactory('mediapipe')) })
 *
 * It never makes things worse than they were: while no athlete is found, or when a frame cannot be read, the pose model gets the video
 * itself; and if the layer fails once, it is switched off for the rest of the analysis. Once it knows who jumps, the people the pose model
 * finds are narrowed to that person (`focus`), and the picture can be zoomed on them and turned upright (`view`).
 *
 * Only for MediaPipe, which takes a canvas as well as a video. `PoseEstimator.detect` says "video" because the app has only ever given it
 * one, and the pose code is not to be touched yet: the canvas is passed through one cast, here. The experimental ONNX engines read
 * `videoWidth` and would not work with it, so they are refused.
 */
export function withMotionMask(inner: PoseEstimatorFactory, options: MotionMaskOptions = {}): PoseEstimatorFactory {
  return async (estimatorOptions) => {
    if (estimatorOptions.engine && estimatorOptions.engine !== 'mediapipe') {
      throw new Error('The motion mask works with the MediaPipe engine only.');
    }
    const estimator = await inner(estimatorOptions);
    const layer = options.layer?.() ?? new CanvasMaskLayer(options.config, options.fill);
    const focus = options.focus ?? true;
    const selector = new JumperSelector(Math.max(1, Math.floor(options.athletes ?? options.config?.maxAthletes ?? 1)));
    const zoomGate = new ZoomGate();
    const viewer =
      options.view?.zoom || options.view?.rotate
        ? new AthleteView({ zoom: options.view.zoom ?? false, rotate: options.view.rotate ?? false }, options.paint)
        : null;
    let broken = false;
    return {
      get backend() {
        return estimator.backend;
      },
      detect(video, timestampMs) {
        let source: HTMLVideoElement = video;
        let athletes: MotionResult | null = null;
        let prepared: Prepared | null = null;
        const frame = { width: video.videoWidth, height: video.videoHeight };
        if (!broken) {
          try {
            const result = layer.process(video, timestampMs);
            options.onFrame?.(result);
            if (hidesSomething(result)) source = layer.render(video) as unknown as HTMLVideoElement;
            athletes = result;
            if (viewer && result && zoomGate.helps(result, timestampMs)) {
              prepared = viewer.prepare(
                source as unknown as CanvasImageSource,
                frame,
                result.athletes[0] ?? null,
                result,
              );
              source = prepared.source as unknown as HTMLVideoElement;
            }
          } catch (error) {
            broken = true;
            console.warn('[motion] the mask failed; the pose model gets the video as it is from now on:', error);
          }
        }
        const found = estimator.detect(source, timestampMs);
        const narrow = (people: PoseDetection[]): PoseDetection[] => {
          const inFrame =
            viewer && prepared && athletes
              ? viewer.finish(people, prepared, frame, athletes.athletes, athletes)
              : people;
          if (!focus) return inFrame;
          // The person whose hips travel like a jumper's; until a track has travelled, the person in the motion box — or,
          // trusting the travel alone, nobody.
          const byTravel = selector.push(inFrame, timestampMs / 1000);
          if (byTravel !== null) return byTravel;
          if (focus === 'travel') return [];
          return athletes ? focusOnAthletes(inFrame, athletes.athletes, athletes) : inFrame;
        };
        return found instanceof Promise ? found.then(narrow) : narrow(found);
      },
      dispose() {
        layer.dispose();
        estimator.dispose();
      },
    };
  };
}
