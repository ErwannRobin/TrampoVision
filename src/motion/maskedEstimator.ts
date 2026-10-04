import type { PoseDetection, PoseEstimatorFactory } from '../pose/types';
import type { MotionConfig } from './config';
import { AthleteView, type AthleteViewOptions, type Painter, type Prepared } from './athleteView';
import { focusOnAthletes } from './focus';
import { CanvasMaskLayer, type MaskLayer } from './layer';
import type { MotionResult } from './types';

/** A mask that keeps this much of the picture or more hides nothing worth the trouble: the picture goes to the pose model as it is. */
const NOTHING_HIDDEN = 0.999;

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
   * Give back only the person who jumps (the one in the box the detector reports) and not the people who stand near the bed and are still
   * seen through the margin of the mask. Default true. Nobody is dropped while the detector does not know where the athlete is.
   */
  focus?: boolean;
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
            if (viewer && result) {
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
          return focus && athletes ? focusOnAthletes(inFrame, athletes.athletes, athletes) : inFrame;
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
