import { estimateCom } from '../analysis/com';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { wrapDegrees } from '../analysis/signal';
import { makeRng } from '../analysis/testTracks';
import type { AnalysisOptions, AnalysisResult, PoseTrack } from '../analysis/types';
import { CORE_LANDMARKS, LM } from '../pose/landmarks';
import type { Keypoint } from '../pose/types';
import { analyzeSkills } from './analyzeSkills';
import type { DeepPartial, SkillConfig } from './config';
import { mannequinRoutine, type MannequinJump, type MannequinShape } from './testMannequin';
import type { KnownPosition, SkillClassifier } from './types';

/**
 * A second synthetic check (test support, not used by the app), for what `evaluation.ts` leaves out: the skills of a competition
 * routine — double and triple somersaults, 1.4 to 1.9 s in the air, turning faster while the body is folded — read by a pose model
 * that fails the way one does on a fast athlete: frames with nobody while the body is upside down, points smeared along their own
 * motion, the head read where the feet are, a reading that has nothing to do with the body.
 *
 * Like `evaluation.ts` it answers a narrow question: with a pose model that fails like this simulated one, does the analysis still
 * count the somersaults and name the skill? How a real model fails on real footage is an assumption here, not a measurement.
 */

export interface CompetitionSkill {
  somersaults: 1 | 2 | 3;
  direction: 'front' | 'back';
  position: KnownPosition;
}

/** How the simulated pose model fails on a fast athlete. Every chance is per frame. */
export interface FastFailure {
  name: string;
  /** Landmark jitter, uniform +-, as a fraction of the athlete's height. */
  noise: number;
  /**
   * Motion blur: each point is read somewhere along the path it travelled since the frame before, up to this share of it back (0.5 is
   * a shutter open for half of the frame interval). A point that does not move is not smeared.
   */
  blur: number;
  /** An upside-down frame starts a run of frames with nobody found, and how likely the run goes on. */
  lost: number;
  lostStay: number;
  /** Same for a run of frames read with the head where the feet are (turned by 180° about the hips). */
  flip: number;
  flipStay: number;
  /** An upside-down frame is read at an angle that has nothing to do with the body (the skeleton turned about the hips by any angle). */
  wild: number;
  /** A point of an upside-down frame is given with a low score. */
  drop: number;
}

export const CLEAN: FastFailure = {
  name: 'clean',
  noise: 0,
  blur: 0,
  lost: 0,
  lostStay: 0,
  flip: 0,
  flipStay: 0,
  wild: 0,
  drop: 0,
};
/** A sharp video and a model that mostly holds: a little blur, a few lost frames. */
export const MILD: FastFailure = {
  name: 'mild',
  noise: 0.01,
  blur: 0.3,
  lost: 0.06,
  lostStay: 0.5,
  flip: 0.03,
  flipStay: 0.5,
  wild: 0.02,
  drop: 0.1,
};
/** A broadcast at 25 frames a second with a slow shutter: the model loses the athlete in much of every somersault. */
export const HARD: FastFailure = {
  name: 'hard',
  noise: 0.02,
  blur: 0.5,
  lost: 0.18,
  lostStay: 0.7,
  flip: 0.08,
  flipStay: 0.6,
  wild: 0.06,
  drop: 0.25,
};

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** How many times faster a folded body turns than a stretched one (the ratio of the moments of inertia; rough figures). */
const SPIN_GAIN: Record<KnownPosition, number> = { straight: 1, pike: 2, tuck: 3 };

/**
 * The share of the rotation done at each share of the flight when the body folds between `closeBy` and `openFrom`: the angular
 * momentum is kept, so the body turns `gain` times faster while it is folded.
 */
export function spinProfile(gain: number, closeBy: number, openFrom: number): (u: number) => number {
  const N = 200;
  const cumulative = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const u = (i - 0.5) / N;
    const folded = smooth(u, 0.1, closeBy) * (1 - smooth(u, openFrom, 0.9));
    cumulative[i] = cumulative[i - 1] + 1 + (gain - 1) * folded;
  }
  return (u) => {
    const f = Math.min(Math.max(u, 0), 1) * N;
    const i = Math.min(N - 1, Math.floor(f));
    return (cumulative[i] + (cumulative[i + 1] - cumulative[i]) * (f - i)) / cumulative[N];
  };
}

const range = (rnd: () => number, lo: number, hi: number) => lo + ((rnd() + 1) / 2) * (hi - lo);
const pick = <T>(rnd: () => number, items: readonly T[]): T =>
  items[Math.min(items.length - 1, Math.floor(((rnd() + 1) / 2) * items.length))];

/** The skills drawn: one, two or three somersaults, front or back, in every position a person does them in (no triple straight). */
export const COMPETITION_SKILLS: readonly CompetitionSkill[] = ([1, 2, 3] as const).flatMap((somersaults) =>
  (['front', 'back'] as const).flatMap((direction) =>
    (['tuck', 'pike', 'straight'] as const)
      .filter((position) => !(somersaults === 3 && position === 'straight'))
      .map((position) => ({ somersaults, direction, position })),
  ),
);

function shapeOf(rnd: () => number, position: KnownPosition): MannequinShape {
  const arms = { armDeg: range(rnd, 20, 170), elbowDeg: range(rnd, 0, 40), pointedToes: range(rnd, 0.5, 1) };
  if (position === 'straight') return { hipFlexDeg: range(rnd, 0, 12), kneeFlexDeg: range(rnd, 0, 8), ...arms };
  if (position === 'tuck') return { hipFlexDeg: range(rnd, 110, 145), kneeFlexDeg: range(rnd, 95, 130), ...arms };
  return { hipFlexDeg: range(rnd, 85, 125), kneeFlexDeg: range(rnd, 0, 10), ...arms };
}

/** One skill as a jump of the mannequin: the height a person needs for it, a landing a little short or past, the fold held through the turn. */
export function competitionJump(rnd: () => number, skill: CompetitionSkill): MannequinJump {
  const facing = (rnd() < 0 ? -1 : 1) as 1 | -1;
  const closeBy = range(rnd, 0.18, 0.28);
  const openFrom = range(rnd, 0.68, 0.8);
  const turns = skill.somersaults * range(rnd, 0.95, 1.03);
  // Front = the top of the body moves toward the face. Facing right + clockwise = front.
  const clockwise = skill.direction === 'front' ? facing > 0 : facing < 0;
  // Time in the air: 1.3 to 1.6 s for one somersault, up to 1.9 s for three.
  const flightS = range(rnd, 1.2, 1.5) + 0.13 * skill.somersaults;
  return {
    v0: (9.81 * flightS) / 2,
    turns: clockwise ? turns : -turns,
    facing,
    shape: shapeOf(rnd, skill.position),
    closeBy,
    openFrom,
    spin: spinProfile(SPIN_GAIN[skill.position], closeBy, openFrom),
    driftM: range(rnd, -0.4, 0.4),
  };
}

const hipsOf = (f: Keypoint[]) => ({
  x: (f[LM.L_HIP].x + f[LM.R_HIP].x) / 2,
  y: (f[LM.L_HIP].y + f[LM.R_HIP].y) / 2,
});

function turnAbout(f: Keypoint[], c: { x: number; y: number }, deg: number): Keypoint[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return f.map((p) => ({
    ...p,
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
  }));
}

export interface FailureCount {
  /** Frames upside down, and what the simulated model did with them. */
  inverted: number;
  lost: number;
  flipped: number;
  wild: number;
}

/**
 * The track as a failing pose model would give it. `angleDeg` is the true rotation of the body in each frame (the truth of the
 * routine): a frame counts as upside down when the body is more than a quarter turn from upright.
 */
export function failFast(
  track: PoseTrack,
  angleDeg: ArrayLike<number>,
  failure: FastFailure,
  bodyPx: number,
  seed = 1,
): { track: PoseTrack; counts: FailureCount; failed: Uint8Array } {
  const rnd = makeRng(seed);
  // 1 where the model lost the athlete, turned them over or read them at any angle.
  const failed = new Uint8Array(track.frames.length);
  const chance = (p: number) => p > 0 && (rnd() + 1) / 2 < p;
  const counts: FailureCount = { inverted: 0, lost: 0, flipped: 0, wild: 0 };
  let lostRun = false;
  let flipRun = false;
  const frames = track.frames.map((f, i) => {
    if (!f) return f;
    const inverted = Math.abs(wrapDegrees(angleDeg[i])) > 90;
    if (!inverted) {
      lostRun = false;
      flipRun = false;
    } else {
      counts.inverted++;
      lostRun = chance(lostRun ? failure.lostStay : failure.lost);
      flipRun = chance(flipRun ? failure.flipStay : failure.flip);
    }
    if (lostRun) {
      counts.lost++;
      failed[i] = 1;
      return null;
    }
    const before = i > 0 ? track.frames[i - 1] : null;
    let pose = f.map((p, k) => {
      // Smeared along its own path since the frame before, then jittered.
      const back = before && failure.blur > 0 ? ((rnd() + 1) / 2) * failure.blur : 0;
      const q = before ? before[k] : p;
      return {
        x: p.x + (q.x - p.x) * back + failure.noise * bodyPx * rnd(),
        y: p.y + (q.y - p.y) * back + failure.noise * bodyPx * rnd(),
        visibility: inverted && chance(failure.drop) ? 0.1 : p.visibility,
      };
    });
    if (inverted && chance(failure.wild)) {
      counts.wild++;
      failed[i] = 1;
      pose = turnAbout(pose, hipsOf(pose), 180 * rnd());
    } else if (flipRun) {
      counts.flipped++;
      failed[i] = 1;
      pose = turnAbout(pose, hipsOf(pose), 180);
    }
    return pose;
  });
  return { track: { ...track, frames }, counts, failed };
}

export interface CompetitionRow {
  truth: CompetitionSkill;
  /** The flight was found (a jump of the analysis has its apex within 0.3 s of the true one). */
  found: boolean;
  /** Measured rotation of the flight, turns (absolute), null when not measured. */
  turns: number | null;
  trueTurns: number;
  somersaults: boolean;
  direction: boolean;
  position: boolean;
  /** Somersaults, direction, position and no twist: the element of the table. */
  element: boolean;
  confidence: number;
  /** Named, and not as a tentative guess. */
  firm: boolean;
}

export interface CompetitionSummary {
  failure: FastFailure;
  rows: CompetitionRow[];
  n: number;
  found: number;
  somersaults: number;
  direction: number;
  position: number;
  element: number;
  /** Wrong elements named firmly at 60% or more. */
  firmWrong: number;
  /** Mean of |measured − true| turns over the flights that were measured. */
  turnsError: number;
  /** Share of the upside-down frames the simulated model lost, turned over, or read at any angle. */
  failed: FailureCount;
  /** How far the analysis is from the true athlete, over the frames in the air. */
  pose: PoseError;
}

/** The analysis against the true athlete of the routine, over the frames in the air. Distances are shares of the athlete's height. */
export interface PoseError {
  /** Share of those frames in which the analysis has the athlete's joints. */
  coverage: number;
  /** Mean distance of a core joint (shoulders to ankles) from where it really is. */
  joint: number;
  /** Mean distance of the center of mass from where it really is, and the share of frames that have one. */
  com: number;
  comCoverage: number;
  /** Mean error of the body orientation, degrees (the turns it is off by are counted: a lost somersault is 360°). */
  orientationDeg: number;
  /** Mean error of the hip angle, degrees. */
  hipDeg: number;
  /** The same three over the frames the simulated model failed on (lost, turned over, read at any angle), and how many of them have joints. */
  failedCoverage: number;
  failedJoint: number;
  failedHipDeg: number;
}

interface PoseSum {
  frames: number;
  withJoints: number;
  joint: number;
  joints: number;
  com: number;
  coms: number;
  orientation: number;
  orientations: number;
  hip: number;
  hips: number;
  failedFrames: number;
  failedWithJoints: number;
  failedJoint: number;
  failedJoints: number;
  failedHip: number;
  failedHips: number;
}

const interiorAngle = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
};
const midOf = (f: { x: number; y: number }[], a: number, b: number) => ({
  x: (f[a].x + f[b].x) / 2,
  y: (f[a].y + f[b].y) / 2,
});
const hipAngleOf = (f: { x: number; y: number }[]) =>
  interiorAngle(midOf(f, LM.L_SHOULDER, LM.R_SHOULDER), midOf(f, LM.L_HIP, LM.R_HIP), midOf(f, LM.L_KNEE, LM.R_KNEE));

/** Adds one routine's frames in the air to the sums: the analysis against the track the failing model was given. */
function addPoseError(
  sum: PoseSum,
  result: AnalysisResult,
  truth: PoseTrack,
  angleDeg: ArrayLike<number>,
  flights: [number, number][],
  heightPx: number,
  failed: ArrayLike<number>,
): void {
  const fps = truth.fps;
  for (const [takeoff, landing] of flights) {
    const from = Math.ceil(takeoff * fps);
    const to = Math.floor(landing * fps);
    // The orientation of the analysis starts where it likes: it is compared after the two are set equal at the takeoff.
    let offset = NaN;
    for (let i = from; i <= to && !Number.isFinite(offset); i++)
      if (Number.isFinite(result.orientation[i])) {
        const d = result.orientation[i] - angleDeg[i];
        offset = 360 * Math.round(d / 360);
      }
    for (let i = from; i <= to; i++) {
      const real = truth.frames[i];
      if (!real) continue;
      sum.frames++;
      if (failed[i]) sum.failedFrames++;
      const pts = result.landmarks[i];
      if (pts) {
        let seen = 0;
        for (const k of CORE_LANDMARKS) {
          if (!Number.isFinite(pts[k].x)) continue;
          const off = Math.hypot(pts[k].x - real[k].x, pts[k].y - real[k].y) / heightPx;
          sum.joint += off;
          sum.joints++;
          if (failed[i]) {
            sum.failedJoint += off;
            sum.failedJoints++;
          }
          seen++;
        }
        if (seen >= CORE_LANDMARKS.length / 2) {
          sum.withJoints++;
          if (failed[i]) sum.failedWithJoints++;
        }
        const hip = hipAngleOf(pts);
        if (Number.isFinite(hip)) {
          const off = Math.abs(hip - hipAngleOf(real));
          sum.hip += off;
          sum.hips++;
          if (failed[i]) {
            sum.failedHip += off;
            sum.failedHips++;
          }
        }
      }
      const com = estimateCom(real);
      if (com && Number.isFinite(result.comX[i])) {
        sum.com += Math.hypot(result.comX[i] - com.x, result.comY[i] - com.y) / heightPx;
        sum.coms++;
      }
      if (Number.isFinite(result.orientation[i]) && Number.isFinite(offset)) {
        sum.orientation += Math.abs(result.orientation[i] - offset - angleDeg[i]);
        sum.orientations++;
      }
    }
  }
}

export interface CompetitionOptions {
  routines?: number;
  jumpsPerRoutine?: number;
  seed?: number;
  fps?: number;
  config?: DeepPartial<SkillConfig>;
  classifier?: SkillClassifier;
  analysis?: Partial<AnalysisOptions>;
  /** Only these skills are drawn. */
  skills?: readonly CompetitionSkill[];
  /** Called with each routine's analysis and truth (to look at one). */
  inspect?: (result: AnalysisResult, truth: { turns: number[]; takeoff: number[]; landing: number[] }) => void;
}

/** Random routines of competition skills through the failing model, the analysis and the classifier. */
export function evaluateCompetition(failure: FastFailure, options: CompetitionOptions = {}): CompetitionSummary {
  const rnd = makeRng(options.seed ?? 23);
  const routines = options.routines ?? 20;
  const perRoutine = options.jumpsPerRoutine ?? 5;
  const pool = options.skills ?? COMPETITION_SKILLS;
  const rows: CompetitionRow[] = [];
  const failed: FailureCount = { inverted: 0, lost: 0, flipped: 0, wild: 0 };
  const sum: PoseSum = {
    frames: 0,
    withJoints: 0,
    joint: 0,
    joints: 0,
    com: 0,
    coms: 0,
    orientation: 0,
    orientations: 0,
    hip: 0,
    hips: 0,
    failedFrames: 0,
    failedWithJoints: 0,
    failedJoint: 0,
    failedJoints: 0,
    failedHip: 0,
    failedHips: 0,
  };
  for (let r = 0; r < routines; r++) {
    const skills = Array.from({ length: perRoutine }, () => pick(rnd, pool));
    const heightM = range(rnd, 1.55, 1.85);
    const pxPerM = range(rnd, 60, 110);
    const { track, truth } = mannequinRoutine({
      jumps: skills.map((s) => competitionJump(rnd, s)),
      heightM,
      pxPerM,
      fps: options.fps ?? 30,
    });
    const { track: read, counts, failed: bad } = failFast(track, truth.angleDeg, failure, heightM * pxPerM, 500 + r);
    for (const k of Object.keys(failed) as (keyof FailureCount)[]) failed[k] += counts[k];
    const result = computeAnalysis(read, { athleteHeightM: heightM, ...options.analysis });
    options.inspect?.(result, truth);
    addPoseError(
      sum,
      result,
      track,
      truth.angleDeg,
      truth.takeoff.map((t, k) => [t, truth.landing[k]]),
      heightM * pxPerM,
      bad,
    );
    const analysis = analyzeSkills(result, { config: options.config, classifier: options.classifier });
    skills.forEach((skill, k) => {
      const jump = analysis.jumps.find((j) => Math.abs(j.cycle.apexTimeS - truth.apex[k]) < 0.3);
      const m = jump?.prediction.movement;
      const turns = jump?.cycle.turns ?? null;
      const somersaults = m?.somersaults === skill.somersaults;
      const direction = m?.direction === skill.direction;
      const position = m?.position === skill.position;
      rows.push({
        truth: skill,
        found: jump !== undefined,
        turns: turns === null ? null : Math.abs(turns),
        trueTurns: Math.abs(truth.turns[k]),
        somersaults,
        direction,
        position,
        element: somersaults && direction && position && m?.twists === 0,
        confidence: jump?.prediction.confidence ?? 0,
        firm:
          jump !== undefined &&
          jump.prediction.skill !== 'unclassified' &&
          jump.prediction.certainty !== 'tentative' &&
          !jump.prediction.guess?.closest,
      });
    });
  }
  const count = (f: (row: CompetitionRow) => boolean) => rows.filter(f).length;
  const measured = rows.filter((row) => row.turns !== null);
  return {
    failure,
    rows,
    n: rows.length,
    found: count((row) => row.found),
    somersaults: count((row) => row.somersaults),
    direction: count((row) => row.direction),
    position: count((row) => row.position),
    element: count((row) => row.element),
    firmWrong: count((row) => row.firm && !row.element && row.confidence >= 0.6),
    turnsError: measured.length
      ? measured.reduce((s, row) => s + Math.abs(row.turns! - row.trueTurns), 0) / measured.length
      : NaN,
    failed,
    pose: {
      coverage: sum.frames ? sum.withJoints / sum.frames : 0,
      joint: sum.joints ? sum.joint / sum.joints : NaN,
      com: sum.coms ? sum.com / sum.coms : NaN,
      comCoverage: sum.frames ? sum.coms / sum.frames : 0,
      orientationDeg: sum.orientations ? sum.orientation / sum.orientations : NaN,
      hipDeg: sum.hips ? sum.hip / sum.hips : NaN,
      failedCoverage: sum.failedFrames ? sum.failedWithJoints / sum.failedFrames : 0,
      failedJoint: sum.failedJoints ? sum.failedJoint / sum.failedJoints : NaN,
      failedHipDeg: sum.failedHips ? sum.failedHip / sum.failedHips : NaN,
    },
  };
}

const share = (k: number, n: number) => (n ? `${Math.round((100 * k) / n)}%` : '–');

/** One line of a summary, for the README and the test logs. */
export function formatCompetition(s: CompetitionSummary): string {
  const f = s.failed;
  return (
    `${s.failure.name}: n=${s.n}, flights found ${share(s.found, s.n)}, somersaults ${share(s.somersaults, s.n)}, ` +
    `direction ${share(s.direction, s.n)}, position ${share(s.position, s.n)}, element ${share(s.element, s.n)}, ` +
    `firm and wrong ${s.firmWrong}, rotation off by ${s.turnsError.toFixed(2)} turns; of the upside-down frames ` +
    `${share(f.lost, f.inverted)} lost, ${share(f.flipped, f.inverted)} turned over, ${share(f.wild, f.inverted)} at any angle`
  );
}

/** The pose of a summary: how far the analysis is from the true athlete in the air. */
export function formatPose(s: CompetitionSummary): string {
  const p = s.pose;
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  return (
    `joints in ${pct(p.coverage)} of the frames in the air, ${pct(p.joint)} of the height off; center of mass in ` +
    `${pct(p.comCoverage)}, ${pct(p.com)} off; orientation ${p.orientationDeg.toFixed(1)}° off; hip angle ${p.hipDeg.toFixed(1)}° off` +
    (Number.isFinite(p.failedJoint)
      ? `; on the frames the model failed: joints in ${pct(p.failedCoverage)}, ${pct(p.failedJoint)} off, hip angle ${p.failedHipDeg.toFixed(1)}° off`
      : '')
  );
}

/** The same per number of somersaults: where the count goes wrong. */
export function formatBySomersaults(s: CompetitionSummary): string {
  return ([1, 2, 3] as const)
    .map((k) => {
      const rows = s.rows.filter((row) => row.truth.somersaults === k);
      const right = rows.filter((row) => row.somersaults).length;
      const element = rows.filter((row) => row.element).length;
      return `${k}: count ${share(right, rows.length)}, element ${share(element, rows.length)} (${rows.length})`;
    })
    .join('; ');
}
