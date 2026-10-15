import { estimatorFactory } from '../../pose/engines';
import { CORE_LANDMARKS } from '../../pose/landmarks';
import type { ModelVariant, PoseDetection, PoseEngineId, PoseEstimator, PoseSource } from '../../pose/types';

/**
 * The pose models the debug page can run side by side on the same picture: the three sizes of MediaPipe the app can use, and the two
 * experimental engines (`pose/engines.ts`). Each one is loaded the first time it is ticked, and runs on every frame shown after.
 */
export interface PoseModel {
  id: string;
  label: string;
  engine: PoseEngineId;
  /** The MediaPipe size; the other engines have one. */
  variant: ModelVariant;
}

export const POSE_MODELS: readonly PoseModel[] = [
  { id: 'mediapipe-lite', label: 'MediaPipe lite', engine: 'mediapipe', variant: 'lite' },
  { id: 'mediapipe-full', label: 'MediaPipe full', engine: 'mediapipe', variant: 'full' },
  { id: 'mediapipe-heavy', label: 'MediaPipe heavy', engine: 'mediapipe', variant: 'heavy' },
  { id: 'rtmpose', label: 'RTMPose-m', engine: 'rtmpose', variant: 'full' },
  { id: 'vitpose', label: 'ViTPose-B', engine: 'vitpose', variant: 'full' },
];

/** The model ticked when the page opens: the app's own. */
export const DEFAULT_MODEL = 'mediapipe-full';

/** A point rated this much or more is seen. Every model rates its points its own way, so this is a rough comparison. */
const SEEN = 0.5;

/** The share of the 13 body points every model has (nose, shoulders, elbows, wrists, hips, knees, ankles) that `person` rates as seen. */
export function pointsSeen(person: PoseDetection): number {
  let seen = 0;
  for (const k of CORE_LANDMARKS) if ((person.landmarks[k]?.visibility ?? 0) >= SEEN) seen++;
  return seen / CORE_LANDMARKS.length;
}

/**
 * What a model did over the frames shown: how many, how long it took, and over the frames in which the detector knew where the athlete
 * is (`judged`), in how many it found them, and how much of them.
 */
export interface Tally {
  frames: number;
  judged: number;
  found: number;
  /** `pointsSeen` of the athlete, added up over the frames they were found in. */
  points: number;
  ms: number;
}

export const emptyTally = (): Tally => ({ frames: 0, judged: 0, found: 0, points: 0, ms: 0 });

/** One frame: `judged` when the detector knew where the athlete is, and `athlete` the person the model found there (null: nobody). */
export function addFrame(tally: Tally, judged: boolean, athlete: PoseDetection | null, ms: number): void {
  tally.frames++;
  tally.ms += ms;
  if (!judged) return;
  tally.judged++;
  if (!athlete) return;
  tally.found++;
  tally.points += pointsSeen(athlete);
}

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)} %` : '–');

/** The tally as the cells of the comparison table. */
export function describeTally(tally: Tally): { frames: string; found: string; points: string; ms: string } {
  return {
    frames: String(tally.frames),
    found: percent(tally.found, tally.judged),
    points: percent(tally.points, tally.found),
    ms: tally.frames > 0 ? `${(tally.ms / tally.frames).toFixed(0)} ms` : '–',
  };
}

/**
 * One model on the page: loaded once, and asked about frame after frame. MediaPipe wants a time that always increases, even when the
 * video is played again from the start, so each model counts its own.
 */
export class ModelSlot {
  private estimator: PoseEstimator | null = null;
  private loading: Promise<PoseEstimator | null> | null = null;
  private time = 0;
  /** Let go of (unticked, or the GPU box changed): a model still loading is dropped when it arrives. */
  private disposed = false;
  /** Why the model did not load; it is not asked again until the GPU box changes. */
  error: string | null = null;
  tally = emptyTally();

  constructor(readonly model: PoseModel) {}

  /** Whether the model is loaded and can be asked. */
  get ready(): boolean {
    return this.estimator !== null;
  }

  /** What it runs on, once loaded: "GPU", "CPU", or why it fell back. */
  get backend(): string {
    if (this.error) return 'Did not load';
    if (!this.estimator) return this.loading ? 'Loading…' : '–';
    const { delegate, fallbackReason } = this.estimator.backend;
    return fallbackReason ? `${delegate} (no GPU)` : delegate;
  }

  /** The model, loaded the first time it is asked for; null when it did not load (`error` says why). */
  load(preferGpu: boolean, onLoad: (fraction: number | undefined) => void): Promise<PoseEstimator | null> {
    if (this.estimator) return Promise.resolve(this.estimator);
    if (this.error) return Promise.resolve(null);
    this.loading ??= estimatorFactory(this.model.engine)({
      engine: this.model.engine,
      model: this.model.variant,
      numPoses: 4,
      preferGpu,
      onLoad,
    }).then(
      (estimator) => {
        this.loading = null;
        // Let go while it was loading (unticked, the GPU box changed): it is not kept.
        if (this.disposed) {
          estimator.dispose();
          return null;
        }
        return (this.estimator = estimator);
      },
      (error: unknown) => {
        this.loading = null;
        this.error = error instanceof Error ? error.message : String(error);
        return null;
      },
    );
    return this.loading;
  }

  /** The people the model finds in `source`, and how long it took, ms. `stepMs` is the time between two frames of the video. */
  async detect(source: PoseSource, stepMs: number): Promise<{ people: PoseDetection[]; ms: number } | null> {
    if (!this.estimator) return null;
    this.time += Math.max(1, Math.round(stepMs));
    const t0 = performance.now();
    const people = await this.estimator.detect(source, this.time);
    return { people, ms: performance.now() - t0 };
  }

  dispose(): void {
    this.disposed = true;
    this.estimator?.dispose();
    this.estimator = null;
  }
}
