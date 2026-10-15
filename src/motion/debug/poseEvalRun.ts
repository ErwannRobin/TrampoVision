import { bodySignature, createPixelReader, type Pixels } from '../../pose/appearance';
import { estimatorFactory } from '../../pose/engines';
import type { ModelVariant } from '../../pose/types';
import { disposeVideo, loadVideo, seekTo } from '../../video/frames';
import { bodyCenter } from '../focus';
import { torsoLength } from '../jumperSelect';
import { withMotionMask, ZoomGate } from '../maskedEstimator';

/**
 * Runs the real pose model over a clip and boils every frame down to where the people are: what `scripts/pose-eval.ts` runs in a
 * headless browser (MediaPipe needs one) to check the choice of the jumper on real footage. Pure measurement: no masking, no choice —
 * the choice is replayed offline from these rows, so a threshold can be tried without running the model again.
 */

/** A landmark with less visibility than this is a guess and stays out of the box. */
const SEEN = 0.3;

/** One person of one frame, in normalized picture coordinates: enough to replay the choice of the jumper offline. */
export interface EvalPerson {
  /** The middle of the hips (`bodyCenter`). */
  x: number;
  y: number;
  /** The shoulder-to-hip length. */
  torso: number;
  /** The box around the landmarks that are seen. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The mean visibility of the landmarks. */
  vis: number;
  /** The colors of the person's clothes (`bodySignature`: shirt and thighs, RGB 0..1), when the frame's pixels could be read. */
  look?: { t: [number, number, number] | null; l: [number, number, number] | null } | null;
}

export interface EvalFrame {
  /** Seconds into the clip. */
  t: number;
  people: EvalPerson[];
  /** What the motion detector said about the camera (with `zoom`): its speed and the athlete's share of the picture. */
  cam?: { speed: number; share: number };
}

export interface PoseEvalCapture {
  width: number;
  height: number;
  durationS: number;
  rateHz: number;
  model: ModelVariant;
  numPoses: number;
  backend: string;
  frames: EvalFrame[];
}

export interface PoseEvalOptions {
  /** Frames read a second (the clip is seeked, so the rate is exact). Default 15: a jump takes 1.4 to 2.2 s. */
  rateHz?: number;
  /** People the model looks for. Default 5, what the app asks for (`extractPoseTrack`). */
  numPoses?: number;
  /** Default 'full', the app's default. */
  model?: ModelVariant;
  /** Try the GPU delegate first, as the app does by default. Default false: the CPU delegate is deterministic across machines. */
  preferGpu?: boolean;
  /** Stop after this many seconds of the clip. */
  maxS?: number;
  /**
   * Put the motion detector in front of the pose model and give it a zoomed view of the athlete's box (`withMotionMask` with
   * `view.zoom`): what the model finds is mapped back to the frame. The choice of the jumper is left out (`focus: false`): the
   * replay offline makes it, so a threshold can be tried without running the model again.
   */
  zoom?: boolean;
  /** With `zoom`: also turn the view so that an athlete in a somersault stands upright (`AthleteView.rotate`). */
  rotate?: boolean;
  /** With `zoom`: let `withMotionMask` narrow the people to the chosen athlete, exactly as the app reads them (`focus: 'travel'`; default false: everybody is captured and the choice is replayed offline). */
  focused?: boolean;
  /** Told every few seconds of the clip, to show life. */
  onProgress?: (atS: number) => void;
}

export async function runPoseEval(url: string, options: PoseEvalOptions = {}): Promise<PoseEvalCapture> {
  const rateHz = options.rateHz ?? 15;
  const numPoses = options.numPoses ?? 5;
  const model = options.model ?? 'full';
  const video = await loadVideo(url);
  try {
    let zoomed = 0;
    const gate = new ZoomGate();
    let atMs = 0;
    let cam: EvalFrame['cam'];
    const factory = options.zoom
      ? withMotionMask(estimatorFactory('mediapipe'), {
          focus: options.focused ? 'travel' : false,
          view: { zoom: true, rotate: options.rotate },
          onFrame: (r) => {
            if (r && gate.helps(r, atMs)) zoomed++;
            const round = (v: number) => Math.round(v * 1e3) / 1e3;
            cam = r ? { speed: round(r.camera.speed), share: round(r.camera.athleteShare) } : cam;
          },
        })
      : estimatorFactory('mediapipe');
    const estimator = await factory({ model, numPoses, preferGpu: options.preferGpu ?? false });
    const readPixels = createPixelReader(video, video.videoWidth);
    try {
      const frames: EvalFrame[] = [];
      const end = Math.max(0, Math.min(video.duration - 1e-3, options.maxS ?? Infinity));
      let timestampMs = 0;
      for (let k = 0; k / rateHz <= end; k++) {
        const t = k / rateHz;
        await seekTo(video, Math.min(t, end));
        timestampMs = Math.max(timestampMs + 1, Math.round(t * 1000));
        atMs = timestampMs;
        const people = await estimator.detect(video, timestampMs);
        // The clothes are read from the clip itself, as the app does (`withMotionMask`): the zoomed view's people are
        // already put back in the frame by the time they are seen here.
        const pixels = readPixels?.() ?? null;
        frames.push({
          t,
          people: people.map((p) => compact(p, pixels, video.videoWidth, video.videoHeight)),
          ...(cam ? { cam } : {}),
        });
        if (k % (5 * rateHz) === 0) options.onProgress?.(t);
      }
      const { backend } = estimator;
      if (options.zoom) console.log(`[pose-eval] zoom view used in ${zoomed} of ${frames.length} frames`);
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        durationS: video.duration,
        rateHz,
        model,
        numPoses,
        backend: `${backend.engine} (${backend.delegate})`,
        frames,
      };
    } finally {
      estimator.dispose();
    }
  } finally {
    disposeVideo(video);
  }
}

function compact(
  person: { landmarks: { x: number; y: number; visibility: number }[] },
  pixels: Pixels | null,
  width: number,
  height: number,
): EvalPerson {
  const hip = bodyCenter(person);
  const seen = person.landmarks.filter((p) => p.visibility >= SEEN);
  const points = seen.length ? seen : person.landmarks;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const rgb = (c: [number, number, number] | null) =>
    c && (c.map((v) => Math.round(v * 1e3) / 1e3) as [number, number, number]);
  const signature = pixels
    ? bodySignature(
        pixels,
        person.landmarks.map((k) => ({ x: k.x * width, y: k.y * height, visibility: k.visibility })),
      )
    : null;
  return {
    x: round(hip.x),
    y: round(hip.y),
    torso: round(torsoLength(person)),
    x0: round(Math.min(...points.map((p) => p.x))),
    y0: round(Math.min(...points.map((p) => p.y))),
    x1: round(Math.max(...points.map((p) => p.x))),
    y1: round(Math.max(...points.map((p) => p.y))),
    vis: round(person.landmarks.reduce((a, p) => a + p.visibility, 0) / Math.max(1, person.landmarks.length)),
    look: signature && { t: rgb(signature.torso), l: rgb(signature.legs) },
  };
}
