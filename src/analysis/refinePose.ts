import { fusePoseTracks, type FusedTrack } from '../pose/fusion';
import { LM } from '../pose/landmarks';
import type { Box } from '../pose/onnx/geometry';
import { iou } from '../pose/onnx/geometry';
import type { BoxPoseEstimator, OnnxEngine } from '../pose/onnx/OnnxPoseEstimator';
import type { EstimatorOptions, Keypoint, PoseSource } from '../pose/types';
import { disposeVideo, frameSeekTime, loadVideo, seekTo } from '../video/frames';
import { computeAnalysis } from './computeAnalysis';
import { checkPose, type PoseCheck, type PoseCheckOptions } from './poseCheck';
import type { PoseTrack } from './types';

/**
 * The second pass: the pose of each athlete is checked (poseCheck.ts), the frames where it cannot be trusted are read again by a
 * slower, stronger model (RTMPose-x on a 288 × 384 crop, read plain and mirrored), and the two readings are merged (fusion.ts).
 *
 * The second model does not look for the athlete itself: it reads the box around where the first model saw them (the crop is cut
 * from the frame at full resolution, so a small athlete is read large, without the motion detector's zoom). Where the first model
 * lost them, the box comes from the second model's own reading a moment before, or from the first model's readings on both sides of
 * the gap, and the person detector (YOLOX) puts it on the person nearest to it.
 */

export interface RefineOptions {
  /** The second model. Default RTMPose-x. */
  engine?: OnnxEngine;
  preferGpu: boolean;
  /** For the analysis that the check reads. */
  athleteHeightM: number;
  /** Read every frame again, not only the doubtful ones (to compare, or when the first model is known to be weak on a clip). */
  everyFrame?: boolean;
  check?: Partial<PoseCheckOptions>;
  signal?: AbortSignal;
  onLoad?: EstimatorOptions['onLoad'];
  /** The frames read again so far, of how many. Called once with 0 when the model is ready. */
  onProgress?: (done: number, total: number) => void;
  onBackend?: (description: string) => void;
  /** Tests give a fake model. */
  createEstimator?: (options: EstimatorOptions) => Promise<BoxPoseEstimator>;
}

export interface RefineReport {
  /** The second model and where it ran; '' when nothing had to be read again. */
  backend: string;
  /** The check of each athlete, in the order of the tracks. */
  checks: PoseCheck[];
  /** The merge of each athlete (null when none of their frames was read again). */
  merges: (FusedTrack['counts'] | null)[];
  /** Frames read again (the union over the athletes). */
  frames: number;
}

/** A guide box is grown by this much where the athlete was not seen in the frame itself: they moved since. */
const GUESS_GROWTH = 1.3;
/** The second model's reading of a frame of its own is reused as the box for this many frames. */
const OWN_REACH = 3;
/** The detector's box replaces a guessed one when they overlap this much. */
const DETECTOR_IOU = 0.2;
/** Without the first model's reading to compare with, a reading whose core joints score below this (raw) is nobody. */
const MIN_ALONE_SCORE = 0.45;
/** Points of a reading that count for its box. */
const BOX_VISIBILITY = 0.3;
/** Two readings whose hips are closer than this many torso lengths are the same person. */
const SAME_PERSON_TORSO = 1;

const CORE = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE];

const hipCenter = (pose: Keypoint[]) => ({
  x: (pose[LM.L_HIP].x + pose[LM.R_HIP].x) / 2,
  y: (pose[LM.L_HIP].y + pose[LM.R_HIP].y) / 2,
});

function torsoLength(pose: Keypoint[]): number {
  const h = hipCenter(pose);
  const sx = (pose[LM.L_SHOULDER].x + pose[LM.R_SHOULDER].x) / 2;
  const sy = (pose[LM.L_SHOULDER].y + pose[LM.R_SHOULDER].y) / 2;
  return Math.hypot(sx - h.x, sy - h.y);
}

/** The box around a reading's sure points (pixels), or null when too few are sure. */
export function boxOfPose(pose: Keypoint[], minVisibility = BOX_VISIBILITY): Box | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let n = 0;
  for (const p of pose) {
    if (p.visibility < minVisibility || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
    n++;
  }
  return n >= 4 && x2 > x1 && y2 > y1 ? { x1, y1, x2, y2, score: 1 } : null;
}

function grow(b: Box, by: number): Box {
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;
  const hw = ((b.x2 - b.x1) / 2) * by;
  const hh = ((b.y2 - b.y1) / 2) * by;
  return { x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh, score: b.score };
}

function lerpBox(a: Box, b: Box, u: number): Box {
  const l = (p: number, q: number) => p + (q - p) * u;
  return { x1: l(a.x1, b.x1), y1: l(a.y1, b.y1), x2: l(a.x2, b.x2), y2: l(a.y2, b.y2), score: 1 };
}

const meanScore = (pose: Keypoint[]) => CORE.reduce((s, k) => s + (pose[k]?.visibility ?? 0), 0) / CORE.length;

/** Where to look for one athlete in frame `f`: their own box, else a guess from around, and whether it is a guess. */
export function guideBox(
  track: PoseTrack,
  second: (Keypoint[] | null)[],
  f: number,
  reach: number,
): { box: Box; guessed: boolean } | null {
  const own = track.frames[f];
  const ownBox = own ? boxOfPose(own) : null;
  if (ownBox) return { box: ownBox, guessed: false };
  for (let g = f - 1; g >= Math.max(0, f - OWN_REACH); g--) {
    const prev = second[g];
    const box = prev ? boxOfPose(prev, MIN_ALONE_SCORE) : null;
    if (box) return { box: grow(box, GUESS_GROWTH), guessed: true };
  }
  let before = -1;
  let after = -1;
  for (let g = f - 1; g >= Math.max(0, f - reach); g--) {
    if (track.frames[g] && boxOfPose(track.frames[g]!)) {
      before = g;
      break;
    }
  }
  for (let g = f + 1; g <= Math.min(track.frames.length - 1, f + reach); g++) {
    if (track.frames[g] && boxOfPose(track.frames[g]!)) {
      after = g;
      break;
    }
  }
  const bb = before >= 0 ? boxOfPose(track.frames[before]!) : null;
  const ab = after >= 0 ? boxOfPose(track.frames[after]!) : null;
  if (bb && ab) return { box: grow(lerpBox(bb, ab, (f - before) / (after - before)), GUESS_GROWTH), guessed: true };
  if (bb || ab) return { box: grow((bb ?? ab)!, GUESS_GROWTH), guessed: true };
  return null;
}

/** Reads frame `f` of the clip into the source the model reads. */
export type FrameReader = (f: number) => Promise<PoseSource>;

/**
 * The second pass over frames already chosen (`frames`: 1 = read again), with any source of frames: the app seeks a video, tests
 * give canvases. Returns the second model's readings of each athlete (pixels), null where it was not asked or found nobody.
 */
export async function readAgain(
  tracks: PoseTrack[],
  frames: Uint8Array,
  wanted: Uint8Array[],
  estimator: BoxPoseEstimator,
  readFrame: FrameReader,
  options: Pick<RefineOptions, 'signal' | 'onProgress'> & { reach: number },
): Promise<(Keypoint[] | null)[][]> {
  const n = frames.length;
  const second = tracks.map(() => Array.from({ length: n }, (): Keypoint[] | null => null));
  const total = frames.reduce((s, v) => s + v, 0);
  let done = 0;
  options.onProgress?.(0, total);
  for (let f = 0; f < n; f++) {
    if (!frames[f]) continue;
    if (options.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    const source = await readFrame(f);
    const { width, height } = tracks[0];
    const guides = tracks.map((tr, a) => (wanted[a][f] ? guideBox(tr, second[a], f, options.reach) : null));
    // The detector only where a box is a guess: it puts the guess on the person nearest to it.
    const people = guides.some((g) => g?.guessed) ? await estimator.findPeople(source, 6) : [];
    const boxes: Box[] = [];
    const who: number[] = [];
    guides.forEach((g, a) => {
      if (!g) return;
      let box = g.box;
      if (g.guessed && people.length) {
        const best = people.reduce((p, q) => (iou(q, g.box) > iou(p, g.box) ? q : p));
        if (iou(best, g.box) >= DETECTOR_IOU) box = best;
      }
      boxes.push(box);
      who.push(a);
    });
    const read = boxes.length ? await estimator.detectInBoxes(source, boxes) : [];
    // The people the athletes are in this frame: a reading alone must not be one of them under another athlete's name. On a
    // broadcast clip the first pass can split one athlete into several tracks, and each track's gaps would be filled with them.
    const held = tracks.map((tr) => (tr.frames[f] ? hipCenter(tr.frames[f]!) : null));
    read.forEach((d, i) => {
      const a = who[i];
      const pose = d.landmarks.map((p) => ({ x: p.x * width, y: p.y * height, visibility: p.visibility }));
      if (!tracks[a].frames[f]) {
        // Next to a reading of the first model, the merge decides; alone, a reading must look like somebody, and nobody else.
        if (meanScore(pose) < MIN_ALONE_SCORE) return;
        const hips = hipCenter(pose);
        const reach = SAME_PERSON_TORSO * torsoLength(pose);
        if (held.some((h, b) => b !== a && h && Math.hypot(h.x - hips.x, h.y - hips.y) < reach)) return;
        held[a] = hips;
      }
      second[a][f] = pose;
    });
    done++;
    options.onProgress?.(done, total);
  }
  return second;
}

/** Checks each athlete's track, reads the doubtful frames again, and merges. Tracks that need nothing come back as they were. */
export async function refinePoseTracks(
  url: string,
  tracks: PoseTrack[],
  options: RefineOptions,
): Promise<{ tracks: PoseTrack[]; report: RefineReport }> {
  const settings = { athleteHeightM: options.athleteHeightM, scaleSource: 'athlete' as const, calibration: null };
  const checks = tracks.map((tr) => checkPose(tr, computeAnalysis(tr, settings), options.check));
  const n = tracks[0]?.frames.length ?? 0;
  const wanted = checks.map((c) => (options.everyFrame ? new Uint8Array(n).fill(1) : c.frames));
  const frames = new Uint8Array(n);
  for (const w of wanted) for (let f = 0; f < n; f++) frames[f] |= w[f];
  const count = frames.reduce((s, v) => s + v, 0);
  const report: RefineReport = { backend: '', checks, merges: tracks.map(() => null), frames: count };
  if (!count) return { tracks, report };

  const engine = options.engine ?? 'rtmpose-x';
  // Loaded on demand, like the experimental engines: a run without the second pass never downloads ONNX Runtime.
  const onnx = await import('../pose/onnx/OnnxPoseEstimator');
  const estimator = await (options.createEstimator ?? onnx.createOnnxEstimator(engine))({
    engine,
    model: 'full',
    numPoses: 6,
    preferGpu: options.preferGpu,
    onLoad: options.onLoad,
  });
  const { backend } = estimator;
  report.backend = `${backend.engine} (${backend.delegate})`;
  options.onBackend?.(
    `${backend.engine} · ${backend.delegate}${backend.fallbackReason ? ' (GPU failed, using CPU)' : ''}`,
  );
  const joints = onnx.onnxEngineJoints(engine);
  const video = await loadVideo(url);
  try {
    const { duration } = video;
    const sourceFps = tracks[0].sourceFps;
    const second = await readAgain(
      tracks,
      frames,
      wanted,
      estimator,
      async (f) => {
        // The frame of the clip the first pass read (its time), seeked the way the first pass seeked it.
        const frame = Math.round(tracks[0].times[f] * sourceFps);
        await seekTo(video, Math.min(frameSeekTime(frame, sourceFps), duration - 1e-3));
        return video;
      },
      { signal: options.signal, onProgress: options.onProgress, reach: Math.round(tracks[0].fps * 1) },
    );
    const out = tracks.map((tr, a) => {
      if (!wanted[a].some(Boolean)) return tr;
      const fused = fusePoseTracks({
        first: tr.frames,
        firstWorld: tr.world,
        second: second[a],
        checked: wanted[a],
        secondJoints: joints,
      });
      report.merges[a] = fused.counts;
      const doubtful = checks[a].flights.filter((fl) => fl.doubts.length).length;
      console.info(
        `[pose] second look, athlete ${a + 1}: ${doubtful}/${checks[a].flights.length} flights doubtful, ${checks[a].lostFrames} frames lost near them; ` +
          `${fused.counts.checked} read again by ${report.backend}: both ${fused.counts.both}, first kept ${fused.counts.first}, ` +
          `second ${fused.counts.second} (over the first ${fused.counts.replaced}), dropped ${fused.counts.dropped}, nobody ${fused.counts.none}`,
      );
      return {
        ...tr,
        frames: fused.frames,
        world: tr.world ? fused.world : undefined,
        backend: `${tr.backend} + ${report.backend}`,
      };
    });
    return { tracks: out, report };
  } finally {
    disposeVideo(video);
    estimator.dispose();
  }
}
