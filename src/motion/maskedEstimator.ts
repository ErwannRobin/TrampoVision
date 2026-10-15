import { bodySignature, createPixelReader, type Pixels } from '../pose/appearance';
import type { Keypoint, PoseDetection, PoseEstimatorFactory, PoseSource } from '../pose/types';
import type { MotionConfig } from './config';
import { AthleteView, type AthleteViewOptions, type Painter, type Prepared } from './athleteView';
import { bodyBox, focusOnAthletes } from './focus';
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
 * A camera moving faster than this follows the athlete: their hips stay near one spot of the picture and the travel never
 * speaks. The same measurement as `ZOOM_MAX_SPEED`: tripod shots measure 0 to 0.10 shorter sides of the picture a second (the
 * subject's own motion), a broadcast that follows the athlete 0.2 to 0.8.
 */
const FOLLOW_SPEED = 0.18;
/**
 * Once the camera has moved that fast for this long without a pause, the clip is a follow clip, for good, and the detector steps
 * aside: the pose model reads the frame as it is, and every person it finds goes through (the app's tracker chooses, as it does
 * without the motion detector — a shot that follows the athlete has no stander under their path). Measured at 30 Hz: the broadcast
 * clip is over `FOLLOW_SPEED` in 1301 of its 1493 frames, in one unbroken run after a still first 6.4 s, while no other clip ever
 * crosses it (peaks: wide tripod 0.001, synchro 0.112, phone close-up 0.153), so one second tells them apart with a wide margin. Why the whole detector and not only
 * the choice: with the camera's own move taken out imperfectly, the motion box sits off the athlete (on the stands, on a logo) and
 * the mask, keeping 3 to 12% of the picture, hid them; and the panning camera sweeps the people behind the bed through the picture,
 * so their hips "travel" and the travel chose them. Through the whole app on the broadcast clip (25 fps, CPU), frames of the routine
 * (20 to 45.5 s) with the athlete: mask and choice kept 122 of 638 and no somersault was measured; the mask off 151; stepping aside
 * 246 with three somersaults (1.72, 1.97, 2.76 turns) — the plain analysis on the same delegate reads 247 and the same three.
 */
const FOLLOW_KNOWN_S = 1;

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

/**
 * Says, frame by frame, whether the clip is a follow clip: once the camera has moved at `FOLLOW_SPEED` or faster for `FOLLOW_KNOWN_S`
 * without a pause, it is, for good, and the detector steps aside.
 */
export class FollowWatch {
  private fastSinceMs: number | null = null;
  private known = false;

  /** Takes what the detector found in a frame (null when it could not read it) and says whether the clip is a follow clip. */
  push(result: MotionResult | null, timestampMs: number): boolean {
    if (result && result.camera.speed >= FOLLOW_SPEED) {
      this.fastSinceMs ??= timestampMs;
      this.known = this.known || timestampMs - this.fastSinceMs >= FOLLOW_KNOWN_S * 1000;
    } else {
      this.fastSinceMs = null;
    }
    return this.known;
  }

  /** Whether the clip was found to be a follow clip. */
  get followClip(): boolean {
    return this.known;
  }

  /** Forgets it: another clip, or the same one from the start. */
  reset(): void {
    this.fastSinceMs = null;
    this.known = false;
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
   * On a camera that follows the athlete (`FOLLOW_KNOWN_S`) neither is trusted: everybody goes through, and the tracker chooses as it
   * does without the motion detector.
   */
  focus?: boolean | 'travel';
  /**
   * How many people the choice of the jumper keeps (synchro films two). Defaults to the detector's `maxAthletes`. Separate
   * from the detector's own count: two tracks of hips can be told apart in a single motion box.
   */
  athletes?: number;
  /**
   * What is done to the picture after the background is hidden and before the pose model looks at it, once the athlete is found (`AthleteView`):
   * `zoom` gives it a square around the athlete, made big (in the frames where `ZoomGate` says it helps), and `rotate` turns the picture,
   * zoomed or not, so that an athlete in a somersault stands upright. What the model finds is taken back to the frame. Both are off by
   * default; the app asks for the zoom. The turn made things worse on real somersaults, through the whole app with MediaPipe (frames
   * with the athlete, and somersaults measured, without → with): wide tripod 728 → 635 and 525 in two runs, somersaults 4 → 4 and 1;
   * phone close-up 360 → 333, 5 → 3; synchro 402 → 76. Likely why: MediaPipe already turns its own crop to the axis of the body it
   * follows (its person finder reads the body's rotation), so a turned picture only adds the resampling and a turn that can be wrong.
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
 * Every engine reads the painted canvas as well as the video (`PoseSource`): MediaPipe takes any image source, and the ONNX engines
 * measure what they are given (`sourceSize`). The detector itself reads frames from a real video only: given anything else, the mask
 * steps aside and the pose model gets the source as it is.
 */
export function withMotionMask(inner: PoseEstimatorFactory, options: MotionMaskOptions = {}): PoseEstimatorFactory {
  return async (estimatorOptions) => {
    const estimator = await inner(estimatorOptions);
    const layer = options.layer?.() ?? new CanvasMaskLayer(options.config, options.fill);
    const focus = options.focus ?? true;
    const selector = new JumperSelector(Math.max(1, Math.floor(options.athletes ?? options.config?.maxAthletes ?? 1)));
    const zoomGate = new ZoomGate();
    const viewer =
      options.view?.zoom || options.view?.rotate
        ? new AthleteView({ zoom: options.view.zoom ?? false, rotate: options.view.rotate ?? false }, options.paint)
        : null;
    // The colors of each person's clothes, read from the frame itself (not the masked or zoomed view, whose people are put
    // back in the frame first): they let the choice of the jumper tell apart people who are equally near, and know the
    // athlete again across a gap. Null where a canvas cannot be read (tests, workers): the choice then goes without looks.
    let readPixels: (() => Pixels | null) | null | undefined;
    // Whether the camera ever moved fast long enough to call the clip a follow clip — that verdict is never taken back.
    const follow = new FollowWatch();
    let followClip = false;
    let broken = false;
    return {
      get backend() {
        return estimator.backend;
      },
      detect(video, timestampMs) {
        let source: PoseSource = video;
        let athletes: MotionResult | null = null;
        let prepared: Prepared | null = null;
        let frame = { width: 0, height: 0 };
        if (!broken && 'videoWidth' in video) {
          frame = { width: video.videoWidth, height: video.videoHeight };
          try {
            const result = layer.process(video, timestampMs);
            options.onFrame?.(result);
            athletes = result;
            followClip = follow.push(result, timestampMs);
            // A follow clip is read as it is (`FOLLOW_KNOWN_S`).
            if (hidesSomething(result) && !followClip) source = layer.render(video);
            if (viewer && result && !followClip) {
              // The zoom view only where it helps; the turn wherever the athlete is turned, zoomed or not.
              prepared = viewer.prepare(
                source,
                frame,
                result.athletes[0] ?? null,
                result,
                zoomGate.helps(result, timestampMs),
              );
              source = prepared.source as PoseSource;
            }
          } catch (error) {
            broken = true;
            console.warn('[motion] the mask failed; the pose model gets the video as it is from now on:', error);
          }
        }
        if (focus && readPixels === undefined && 'videoWidth' in video) {
          readPixels = createPixelReader(video, video.videoWidth);
        }
        const found = estimator.detect(source, timestampMs);
        // The mask keeps the bodies of the athletes the pose model found next frame, where they do not move enough to be seen moving.
        const keepInMask = (bodies: PoseDetection[]) => {
          if (!athletes || !layer.seeBodies) return;
          const picture = athletes;
          layer.seeBodies(bodies.map((p) => bodyBox(p, picture)).filter((b) => b !== null));
        };
        const narrow = (people: PoseDetection[]): PoseDetection[] => {
          const inFrame = viewer && prepared ? viewer.toFrame(people, prepared, frame) : people;
          if (followClip) return inFrame;
          const inBox = () =>
            athletes?.athletes.length ? (focusOnAthletes(inFrame, athletes.athletes, athletes)[0] ?? null) : null;
          if (!focus) {
            const athlete = inBox();
            keepInMask(athlete ? [athlete] : []);
            viewer?.learn(athlete, frame);
            return inFrame;
          }
          const pixels = frame.width > 0 ? (readPixels?.() ?? null) : null;
          const looks = pixels
            ? inFrame.map((p) =>
                bodySignature(
                  pixels,
                  p.landmarks.map((k): Keypoint => ({
                    x: k.x * frame.width,
                    y: k.y * frame.height,
                    visibility: k.visibility,
                  })),
                ),
              )
            : [];
          // The person whose hips travel like a jumper's; until a track has travelled, the person in the motion box — or,
          // trusting the travel alone, nobody.
          const byTravel = selector.push(inFrame, timestampMs / 1000, looks);
          const byBox = () => (athletes ? focusOnAthletes(inFrame, athletes.athletes, athletes) : inFrame);
          keepInMask(byTravel ?? byBox());
          // The turn is learnt from the person who jumps: once the travel knows them, from them alone (a frame they are not in
          // carries the turn on), and before, from the person in the motion box. Two people who jump (synchro) cannot both be
          // put upright by one turn: the picture is then left as it is.
          viewer?.learn(byTravel === null ? inBox() : byTravel.length === 1 ? byTravel[0] : null, frame);
          if (byTravel !== null) return byTravel;
          if (focus === 'travel') return [];
          return byBox();
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
