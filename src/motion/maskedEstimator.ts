import type { PoseEstimatorFactory } from '../pose/types';
import type { MotionConfig } from './config';
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
 * itself; and if the layer fails once, it is switched off for the rest of the analysis.
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
    let broken = false;
    return {
      get backend() {
        return estimator.backend;
      },
      detect(video, timestampMs) {
        let source: HTMLVideoElement = video;
        if (!broken) {
          try {
            const result = layer.process(video, timestampMs);
            options.onFrame?.(result);
            if (hidesSomething(result)) source = layer.render(video) as unknown as HTMLVideoElement;
          } catch (error) {
            broken = true;
            console.warn('[motion] the mask failed; the pose model gets the video as it is from now on:', error);
          }
        }
        return estimator.detect(source, timestampMs);
      },
      dispose() {
        layer.dispose();
        estimator.dispose();
      },
    };
  };
}
