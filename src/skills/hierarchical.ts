import { formatDecimal, formatNumber, formatPercent, lower, t, tp } from '../i18n/core';
import type { SkillConfig } from './config';
import {
  FIG_ELEMENTS,
  elementName,
  movementToElement,
  type Direction,
  type FigElement,
  type Movement,
} from './fig/elements';
import {
  SKILL_LABELS,
  type CandidateCheck,
  type CheckStatus,
  type ClassifierInput,
  type ElementCandidate,
  type EvidenceItem,
  type FailureDiagnosis,
  type JumpFeatures,
  type JumpSequence,
  type KnownPosition,
  type Limitation,
  type SkillClassifier,
  type SkillId,
  type SkillPrediction,
  type StageId,
  type StageReport,
  type TwistContext,
} from './types';
import { boundsLimit, knownLimits, positionWord, ruleBasedClassifier } from './classifier';

/**
 * Hierarchical classifier. It answers four questions in turn, each with a probability for every possible answer:
 *
 *   1. rotation   how many somersaults (0, 1, 2, 3, or a quarter/half rotation that is not a whole number)
 *   2. direction  front or back (only when the body somersaults)
 *   3. twists     how many half twists (0..8)
 *   4. position   tuck / pike / straight
 *
 * The answers are combined as independent factors into a probability for every movement. A movement is looked up in the
 * element table (`fig/elements.ts`) by `movementToElement`: the classifier never produces a code or a difficulty.
 * Whatever probability falls on movements outside the table (quarter rotations, four somersaults) is kept and reported.
 *
 * Every measurement is compared with a tolerance (a Gaussian whose width follows the measurement quality), never with an exact
 * value, and whole sequences are used: the rotation path (angular velocity over time) backs up the net rotation, the twist
 * trajectory tells whether the twist was finished at landing, and the share of the flight spent in each shape backs up the
 * position at the most closed moment.
 */

const ID = { id: 'hierarchical', version: '1' } as const;

/** Tolerance of a twist counted from 2D cues, degrees: the count can be a half twist off, so its neighbours keep some of the mass. */
const TWIST_2D_SIGMA_DEG = 80;
/** A reliable 3D twist keeps this share of its weight when the 2D count disagrees with it by a half twist or more. */
const SECOND_OPINION_DISAGREES = 0.8;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const gauss = (x: number, mean: number, sigma: number) => Math.exp(-0.5 * ((x - mean) / sigma) ** 2);
export const pct = (v: number) => formatPercent(clamp01(v));
const two = (v: number) => formatNumber(v, 2);
const dirWord = (d: Direction) => lower(t(`dir.${d}`));
const normalize = <T extends string | number>(m: Map<T, number>): Map<T, number> => {
  let sum = 0;
  for (const v of m.values()) sum += v;
  const out = new Map<T, number>();
  for (const [k, v] of m) out.set(k, sum > 0 ? v / sum : 1 / m.size);
  return out;
};

/** Rotation values the model considers, in quarter rotations: 0, 1/4, ... , 3 1/2 somersaults. */
const ROTATION_QUARTERS = Array.from({ length: 15 }, (_, i) => i);
const HALF_TWISTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const POSITIONS: KnownPosition[] = ['straight', 'tuck', 'pike'];
/** Prior over the number of half twists (each further half twist is rarer). */
const TWIST_PRIOR = (h: number) => 0.7 ** h;

export function somersaultText(quarters: number): string {
  const whole = Math.floor(quarters / 4);
  const frac = ['', '¼', '½', '¾'][quarters % 4];
  return `${whole || (frac ? '' : '0')}${frac}` || '0';
}
const rotationLabel = (q: number) => tp('label.somersaults', q / 4, { n: somersaultText(q) });
export const twistLabel = (h: number) =>
  h === 0
    ? t('label.noTwist')
    : h === 1
      ? t('name.twist.half')
      : tp('label.twists', h / 2, { n: formatDecimal(h / 2) });

/** Sequence columns used here (see SEQUENCE_COLUMNS). */
const COL = { turns: 8, hip: 12 } as const;

interface Temporal {
  /** Sum of |orientation steps| over the flight, in turns (independent of where the flight ends). */
  pathTurns: number | null;
  /** Share of valid samples where the hips are folded (hip angle at or below the folded limit). */
  closedShare: number | null;
  /** First and last normalized time (0..1) the hips are folded. */
  closedFromU: number | null;
  closedToU: number | null;
  /** Twist change over the last tenth of the flight, degrees (null without 3D). */
  twistEndDrift: number | null;
  /** Normalized time by which 90% of the final twist is done. */
  twistDoneU: number | null;
}

function temporal(seq: JumpSequence | null, twist: TwistContext | null, cfg: SkillConfig): Temporal {
  const t: Temporal = {
    pathTurns: null,
    closedShare: null,
    closedFromU: null,
    closedToU: null,
    twistEndDrift: null,
    twistDoneU: null,
  };
  if (seq) {
    let path = 0;
    let pairs = 0;
    let closed = 0;
    let n = 0;
    for (let i = 0; i < seq.data.length; i++) {
      const row = seq.data[i];
      if (i > 0) {
        const d = Math.abs(row[COL.turns] - seq.data[i - 1][COL.turns]);
        if (Number.isFinite(d)) {
          path += d;
          pairs++;
        }
      }
      if (Number.isFinite(row[COL.hip])) {
        n++;
        if (row[COL.hip] <= cfg.position.hipFoldedMaxDeg) {
          closed++;
          t.closedFromU ??= row[0];
          t.closedToU = row[0];
        }
      }
    }
    if (pairs >= seq.data.length * 0.6) t.pathTurns = path;
    if (n) t.closedShare = closed / n;
  }
  const traj = twist?.trajectory;
  if (traj && traj.length >= 8) {
    const end = traj[traj.length - 1];
    const from = traj[Math.max(0, traj.length - 1 - Math.round(traj.length / 10))];
    if (Number.isFinite(end) && Number.isFinite(from)) t.twistEndDrift = Math.abs(end - from);
    if (Number.isFinite(end) && Math.abs(end) > 90) {
      const i = traj.findIndex((v) => Math.abs(v) >= 0.9 * Math.abs(end));
      if (i >= 0) t.twistDoneU = i / (traj.length - 1);
    }
  }
  return t;
}

// --- stages -------------------------------------------------------------------------------------------------------

interface RotationStage {
  dist: Map<number, number>;
  /** How well the measurement sits on a whole number of somersaults: 1 exactly on it, falling with the distance in tolerances. Absolute, unlike `dist`. */
  fit: (somersaults: number) => number;
  measured: boolean;
  observedTurns: number | null;
  quality: number;
  report: StageReport;
}

/** Quality the apex orientation can restore at most: an agreeing witness is good, not perfect. */
const CORROBORATED = 0.8;
/** Tolerance of the trunk angle at the apex, degrees. */
const APEX_SIGMA_DEG = 60;

/** 0..1: how well the trunk angle at the apex (relative to takeoff) fits the nearest whole number of somersaults of the net rotation. */
function apexAgreement(f: JumpFeatures, turns: number | null): number {
  const { apexDeg, takeoffDeg } = f.orientation;
  if (turns === null || apexDeg === null || takeoffDeg === null) return 0;
  const expected = Math.round(Math.abs(turns)) * 180;
  const rel = Math.abs(apexDeg - takeoffDeg);
  const off = Math.abs(((((rel - expected) % 360) + 540) % 360) - 180);
  return gauss(off, 0, APEX_SIGMA_DEG);
}

function rotationStage(f: JumpFeatures, tm: Temporal, cfg: SkillConfig): RotationStage {
  const r = f.rotation;
  const c = cfg.classification;
  const summed = clamp01(r.parts.coverage * r.parts.steps * r.parts.crossCheck * r.parts.monotonic);
  // A noisy orientation track (there-and-back swings, a pose flip) makes the sum of the rotation doubtful, not the count itself: the
  // trunk angle at the apex is an independent witness. Half-way through a flight with n whole somersaults the body is n half turns
  // from where it took off, so agreement there corroborates the count and restores part of the quality the noise took away.
  const quality = Math.max(summed, CORROBORATED * apexAgreement(f, r.turns));
  const dist = new Map<number, number>();
  const notes: string[] = [];
  if (r.totalDeg === null || r.turns === null) {
    for (const q of ROTATION_QUARTERS) dist.set(q, 1);
    return {
      dist: normalize(dist),
      fit: () => 1,
      measured: false,
      observedTurns: null,
      quality,
      report: {
        stage: 'rotation',
        title: t('stage.rotation.title'),
        measured: false,
        observed: t('label.notMeasured'),
        distribution: [],
        notes: [t('stage.rotation.cutOff')],
      },
    };
  }
  const obs = Math.abs(r.turns);
  // Noisier measurements widen the tolerance instead of failing a hard threshold.
  const sigmaTurns = c.rotationSigmaDeg / 360 / Math.sqrt(Math.max(quality, 0.15));
  // Whole somersaults are read a little short; the quarter rotations, which are not skills, keep their exact value.
  const readAt = (turns: number, whole: boolean) => (whole ? turns * (1 - c.underReadFraction) : turns);
  const sigmaAt = (turns: number, whole = true) =>
    obs < readAt(turns, whole) ? sigmaTurns * c.underRotationFactor : sigmaTurns;
  for (const q of ROTATION_QUARTERS) {
    const turns = q / 4;
    const whole = q % 4 === 0;
    let lik = gauss(obs, readAt(turns, whole), sigmaAt(turns, whole)) * (whole ? 1 : c.offGridPrior);
    if (tm.pathTurns !== null) lik *= gauss(tm.pathTurns, turns, c.pathSigmaTurns + 0.25 * turns) ** 0.5;
    dist.set(q, lik + 1e-9);
  }
  const d = normalize(dist);
  if (tm.pathTurns !== null) notes.push(t('stage.rotation.path', { path: two(tm.pathTurns), net: two(obs) }));
  notes.push(t('stage.rotation.tolerance', { deg: Math.round(sigmaTurns * 360), quality: pct(quality) }));
  return {
    dist: d,
    fit: (n) => gauss(obs, readAt(n, true), sigmaAt(n)),
    measured: true,
    observedTurns: obs,
    quality,
    report: {
      stage: 'rotation',
      title: t('stage.rotation.title'),
      measured: true,
      observed: t('stage.rotation.observed', { turns: two(obs), deg: Math.round(Math.abs(r.totalDeg)) }),
      distribution: labelled(d, rotationLabel),
      notes,
    },
  };
}

interface DirectionStage {
  dist: Map<Direction, number>;
  measured: boolean;
  report: StageReport;
}

/** Share of front somersaults when the direction cannot be measured: back somersaults are the commoner ones, so a tie goes to back. */
const UNMEASURED_FRONT = 0.4;

function directionStage(f: JumpFeatures): DirectionStage {
  const r = f.rotation;
  const face = f.facing;
  const dirSign = r.direction === 'clockwise' ? 1 : r.direction === 'counterclockwise' ? -1 : 0;
  const forward = dirSign * face.sign; // +1 front, -1 back
  const measured = forward !== 0;
  const pFront = measured ? 0.5 + 0.5 * face.confidence * forward : UNMEASURED_FRONT;
  const dist = new Map<Direction, number>([
    ['front', pFront],
    ['back', 1 - pFront],
  ]);
  const notes: string[] = [];
  const turn = t(`turn.${r.direction}`);
  if (!measured)
    notes.push(
      dirSign === 0 ? t('stage.direction.noTurn') : t('stage.direction.noFacing', { conf: pct(face.confidence), turn }),
    );
  else
    notes.push(
      t(forward > 0 ? 'stage.direction.towardFace' : 'stage.direction.awayFromFace', {
        turn,
        side: face.sign > 0 ? t('side.right') : t('side.left'),
        conf: pct(face.confidence),
      }),
    );
  return {
    dist,
    measured,
    report: {
      stage: 'direction',
      title: t('stage.direction.title'),
      measured,
      observed: measured ? (forward > 0 ? t('facing.forward') : t('facing.backward')) : t('facing.undetermined'),
      distribution: labelled(dist, dirWord),
      notes,
    },
  };
}

interface TwistStage {
  dist: Map<number, number>;
  /** Same as the rotation fit, for a number of half twists; 1 when the twist is not measured. */
  fit: (halfTwists: number) => number;
  measured: boolean;
  observedTwists: number | null;
  report: StageReport;
}

function twistStage(f: JumpFeatures, tw: TwistContext | null, tm: Temporal, cfg: SkillConfig): TwistStage {
  const c = cfg.classification;
  const est = tw?.estimate;
  const notes: string[] = [];

  // Prior when twist is not measured: an athlete without evidence of twisting most likely did not twist. The 2D facing
  // check still says something: facing before the takeoff and at the landing disagree => an odd number of half twists.
  const unmeasured = new Map<number, number>();
  const suspected = f.facing.twistSuspected;
  for (const h of HALF_TWISTS) {
    let w = h === 0 ? 1 : c.unmeasuredTwistWeight * TWIST_PRIOR(h - 1);
    if (h > 0 && suspected) w *= h % 2 === 1 ? 3 : 0.4;
    unmeasured.set(h, w);
  }
  const prior = normalize(unmeasured);

  if (!est || !est.available || est.totalDeg === null) {
    notes.push(t(suspected ? 'stage.twists.noMeasureSuspected' : 'stage.twists.noMeasure'));
    return {
      dist: prior,
      fit: () => 1,
      measured: false,
      observedTwists: null,
      report: {
        stage: 'twists',
        title: t('stage.twists.title'),
        measured: false,
        observed: t('label.notMeasured'),
        distribution: labelled(prior, twistLabel),
        notes,
      },
    };
  }

  const obsDeg = Math.abs(est.totalDeg);
  const from2d = tw?.source === 'pose2d';
  // Trust: the twist estimate's own confidence, and whether the trajectory has settled by landing.
  let sigma = from2d ? TWIST_2D_SIGMA_DEG : c.twistSigmaDeg / Math.sqrt(Math.max(est.confidence, 0.25));
  if (tm.twistEndDrift !== null && tm.twistEndDrift > c.twistSettleDeg) {
    sigma *= 1.5;
    notes.push(t('stage.twists.stillTwisting', { deg: Math.round(tm.twistEndDrift) }));
  }
  const measuredDist = new Map<number, number>();
  for (const h of HALF_TWISTS) measuredDist.set(h, gauss(obsDeg, 180 * h, sigma) * TWIST_PRIOR(h) + 1e-9);
  const meas = normalize(measuredDist);
  // A twist estimate below its own reliability limit only counts for part: it is mixed with the no-measurement prior. A count from 2D
  // cues is mixed with it in proportion to its own confidence.
  let trust = from2d ? clamp01(est.confidence) : est.reliable ? 1 : 0.5 * clamp01(est.confidence);
  const second = tw?.second;
  if (!from2d && est.reliable && second?.available && second.reliable && second.halfTwists !== null) {
    // The 2D count is a second opinion: it never replaces a reliable 3D twist, but a disagreement lowers the weight given to it.
    const agrees = second.halfTwists === Math.round(obsDeg / 180);
    if (!agrees) trust *= SECOND_OPINION_DISAGREES;
    notes.push(
      t(agrees ? 'stage.twists.secondAgrees' : 'stage.twists.secondDisagrees', {
        n: second.halfTwists,
        conf: pct(second.confidence),
      }),
    );
  }
  const dist = new Map<number, number>();
  for (const h of HALF_TWISTS) dist.set(h, trust * (meas.get(h) ?? 0) + (1 - trust) * (prior.get(h) ?? 0));
  notes.push(
    from2d
      ? t('stage.twists.source2d', { n: est.halfTwists ?? 0, conf: pct(est.confidence), deg: Math.round(sigma) })
      : t(est.reliable ? 'stage.twists.tolerance' : 'stage.twists.toleranceDiscounted', {
          deg: Math.round(sigma),
          conf: pct(est.confidence),
        }),
  );
  if (tm.twistDoneU !== null) notes.push(t('stage.twists.done', { at: pct(tm.twistDoneU) }));
  return {
    dist,
    fit: (h) => trust * gauss(obsDeg, 180 * h, sigma) + (1 - trust),
    measured: true,
    observedTwists: obsDeg / 360,
    report: {
      stage: 'twists',
      title: t('stage.twists.title'),
      measured: true,
      observed: t('stage.twists.observed', { turns: two(obsDeg / 360), deg: Math.round(obsDeg) }),
      distribution: labelled(dist, twistLabel),
      notes,
    },
  };
}

interface PositionStage {
  dist: Map<KnownPosition, number>;
  measured: boolean;
  report: StageReport;
}

const MIN_VIEW_FACTOR = 0.2;

/** 1 for a side-on view, falling as the trunk length changes during the flight (an oblique camera foreshortens it). */
export function viewFactorOf(f: JumpFeatures, cfg: SkillConfig): number {
  const variation = f.quality.trunkLengthVariation;
  return variation === null || variation <= cfg.maxTrunkVariation
    ? 1
    : Math.max(MIN_VIEW_FACTOR, 1 - 0.8 * ((variation - cfg.maxTrunkVariation) / 0.35));
}

const viewNote = (f: JumpFeatures) =>
  f.quality.trunkLengthVariation === null ? '' : t('diag.viewNote', { change: pct(f.quality.trunkLengthVariation) });

/** Folds that begin at this point of the flight (0..1) start to count as landing preparation, fully so `LATE_FOLD_SPAN` later. */
const LATE_FOLD_FROM = 0.6;
const LATE_FOLD_SPAN = 0.2;
/** Share of the fold's score that a fully late fold gives up. */
const LATE_FOLD_DISCOUNT = 0.75;

function positionStage(f: JumpFeatures, tm: Temporal): PositionStage {
  const p = f.position;
  const raw = new Map<KnownPosition, number>();
  const notes: string[] = [];
  const informed = p.scores.straight + p.scores.tuck + p.scores.pike > 0;
  // The most closed moment (rule scores) backed up by the share of the flight in each shape. A shape held only briefly counts less.
  // A tuck or pike is held through the rotation. Hips that fold only in the last part of the flight are a landing preparation at the
  // end of a straight jump, not a position: what the fold loses goes to the straight position.
  const late =
    tm.closedFromU === null ? 0 : Math.min(1, Math.max(0, (tm.closedFromU - LATE_FOLD_FROM) / LATE_FOLD_SPAN));
  const kept = 1 - LATE_FOLD_DISCOUNT * late;
  let lost = 0;
  for (const k of POSITIONS) {
    const closed = k === 'straight' ? 0 : 0.6 * p.scores[k] * (0.4 + 0.6 * p.stability);
    lost += closed * (1 - kept);
    raw.set(k, (k === 'straight' ? 0.6 * p.scores[k] : closed * kept) + 0.4 * p.timeShare[k] + 0.03);
  }
  raw.set('straight', (raw.get('straight') ?? 0) + lost);
  const dist = normalize(raw);
  notes.push(
    t('stage.position.mostClosed', {
      position: positionWord(p.label),
      score: pct(p.ruleScore),
      held: pct(p.stability),
    }),
    t('stage.position.share', {
      shares: POSITIONS.map((k) => t('ev.share', { position: positionWord(k), share: pct(p.timeShare[k]) })).join(
        t('list.separator'),
      ),
    }),
  );
  if (p.peakTimeU !== null) notes.push(t('stage.position.peakAt', { at: pct(p.peakTimeU) }));
  if (tm.closedFromU !== null && tm.closedToU !== null)
    notes.push(t('stage.position.folded', { from: pct(tm.closedFromU), to: pct(tm.closedToU) }));
  return {
    dist,
    measured: informed,
    report: {
      stage: 'position',
      title: t('stage.position.title'),
      measured: informed,
      observed: p.label === 'unknown' ? t('label.betweenDefinitions') : positionWord(p.label),
      distribution: labelled(dist, (k) => positionWord(k)),
      notes,
    },
  };
}

function labelled<T extends string | number>(m: Map<T, number>, name: (k: T) => string) {
  return [...m.entries()]
    .map(([k, p]) => ({ label: name(k), p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 6);
}

// --- candidates ---------------------------------------------------------------------------------------------------

export interface Stages {
  rot: RotationStage;
  dir: DirectionStage;
  tw: TwistStage;
  pos: PositionStage;
}

export interface Scored {
  element: FigElement;
  /** [rotation, direction, twist, position] probability of the element's value at each stage, times the fit for rotation and twists. */
  factors: [number, number, number, number];
  /** The same without the fit (a share of the stage's own distribution). */
  shares: [number, number, number, number];
  posterior: number;
}

export const STAGE_ORDER: StageId[] = ['rotation', 'direction', 'twists', 'position'];

function scoreElements(s: Stages): { scored: Scored[]; outOfTable: number } {
  const scored: Scored[] = [];
  let inTable = 0;
  for (const e of FIG_ELEMENTS) {
    const fr = s.rot.dist.get(e.somersaults * 4) ?? 0;
    const fd = e.direction === null ? 1 : (s.dir.dist.get(e.direction) ?? 0);
    const ft = s.tw.dist.get(Math.round(e.twists * 2)) ?? 0;
    const fp = s.pos.dist.get(e.position) ?? 0;
    const fitR = s.rot.fit(e.somersaults);
    const fitT = s.tw.fit(Math.round(e.twists * 2));
    const factors: Scored['factors'] = [fr * fitR, fd, ft * fitT, fp];
    const posterior = factors[0] * fd * factors[2] * fp;
    inTable += posterior;
    scored.push({ element: e, factors, shares: [fr, fd, ft, fp], posterior });
  }
  scored.sort((a, b) => b.posterior - a.posterior);
  // Total mass of the movement space is 1 (each stage is normalized; direction only counts when the body somersaults). What the
  // elements do not take, because the measurement sits far from every whole count or the movement is not in the table, stays here.
  return { scored, outOfTable: clamp01(1 - inTable) };
}

const statusOf = (match: number, measured: boolean): CheckStatus =>
  !measured ? 'unmeasured' : match >= 0.6 ? 'match' : match >= 0.25 ? 'weak' : 'mismatch';

export function checksFor(sc: Scored, s: Stages): CandidateCheck[] {
  const e = sc.element;
  const maxOf = (m: Map<unknown, number>) => Math.max(...m.values());
  const ratio = (v: number, m: Map<unknown, number>) => (maxOf(m) > 0 ? clamp01(v / maxOf(m)) : 0);
  const fits = [s.rot.fit(e.somersaults), 1, s.tw.fit(Math.round(e.twists * 2)), 1];
  const out: CandidateCheck[] = [];
  out.push({
    stage: 'rotation',
    criterion: t('check.somersaults'),
    expected:
      e.somersaults === 0
        ? t('label.noSomersault')
        : tp('label.somersaults', e.somersaults, { n: formatDecimal(e.somersaults) }),
    observed: s.rot.report.observed,
    status: statusOf(ratio(sc.shares[0], s.rot.dist) * fits[0], s.rot.measured),
    match: ratio(sc.shares[0], s.rot.dist) * fits[0],
  });
  if (e.direction !== null)
    out.push({
      stage: 'direction',
      criterion: t('check.direction'),
      expected: dirWord(e.direction),
      observed: s.dir.report.observed,
      status: statusOf(ratio(sc.shares[1], s.dir.dist), s.dir.measured),
      match: ratio(sc.shares[1], s.dir.dist),
    });
  out.push({
    stage: 'twists',
    criterion: t('check.twists'),
    expected: e.twists === 0 ? t('label.noTwist') : tp('label.twists', e.twists, { n: formatDecimal(e.twists) }),
    observed: s.tw.report.observed,
    status: statusOf(ratio(sc.shares[2], s.tw.dist) * fits[2], s.tw.measured),
    match: ratio(sc.shares[2], s.tw.dist) * fits[2],
  });
  out.push({
    stage: 'position',
    criterion: t('check.position'),
    expected: positionWord(e.position),
    observed: s.pos.report.observed,
    status: statusOf(ratio(sc.shares[3], s.pos.dist), s.pos.measured),
    match: ratio(sc.shares[3], s.pos.dist),
  });
  return out;
}

export const candidateOf = (sc: Scored, s: Stages): ElementCandidate => ({
  elementId: sc.element.id,
  name: elementName(sc.element),
  movement: movementOf(sc.element),
  posterior: sc.posterior,
  checks: checksFor(sc, s),
});

export const movementOf = (e: Movement): Movement => ({
  direction: e.direction,
  somersaults: e.somersaults,
  twists: e.twists,
  position: e.position,
});

// --- failure diagnosis --------------------------------------------------------------------------------------------

export function diagnose(
  f: JumpFeatures,
  s: Stages,
  best: Scored,
  outOfTable: number,
  quality: number,
  view: number,
): FailureDiagnosis {
  const e = best.element;
  const checks = checksFor(best, s);
  const distances = checks.map((c) => ({
    stage: c.stage,
    text: t('check.distance', { criterion: c.criterion, expected: c.expected, observed: c.observed }),
    match: c.match,
  }));
  // The failing criterion is where the closest element fits worst; an unmeasured signal counts as a failure only when a value
  // was needed from it (its distribution is flat).
  const weakest = checks
    .map((c, i) => ({ c, factor: best.factors[STAGE_ORDER.indexOf(c.stage)] ?? best.factors[i], stage: c.stage }))
    .sort((a, b) => a.factor - b.factor)[0];
  const bestWholeFit = Math.max(...[0, 1, 2, 3].map((n) => s.rot.fit(n)));
  const rotationOffGrid = (() => {
    let off = 0;
    for (const [q, p] of s.rot.dist) if (q % 4 !== 0) off += p;
    return off;
  })();

  let kind: FailureKind;
  let criterion: FailureDiagnosis['criterion'] = weakest.stage;
  let message: string;
  const r = f.rotation;
  if (quality < 0.5) {
    kind = 'low-data-quality';
    criterion = 'data';
    message = t('diag.lowQuality', {
      quality: pct(quality),
      pose: pct(f.quality.pose),
      orientation: pct(s.rot.quality),
      view: pct(view),
      viewNote: viewNote(f),
    });
  } else if (rotationOffGrid > 0.4 || bestWholeFit < 0.4) {
    kind = 'rotation-off-grid';
    criterion = 'rotation';
    const turns = Math.abs(r.turns ?? 0);
    const off = Math.abs(turns - Math.round(turns)) * 360;
    message = t('diag.offGrid', { turns: two(turns), deg: Math.round(turns * 360), off: Math.round(off) });
  } else if (outOfTable > 0.5) {
    kind = 'not-in-table';
    criterion = 'table';
    message = t('diag.notInTable', { share: pct(outOfTable) });
  } else if (weakest.stage === 'rotation') {
    kind = 'rotation-ambiguous';
    message = t('diag.rotationAmbiguous', {
      measured: r.turns === null ? '–' : two(Math.abs(r.turns)),
      needs: e.somersaults,
    });
  } else if (weakest.stage === 'direction') {
    kind = 'direction-unknown';
    message = t('diag.directionUnknown', { reason: s.dir.report.notes[0] });
  } else if (weakest.stage === 'twists') {
    kind = s.tw.measured ? 'twist-ambiguous' : 'twist-unmeasured';
    message = s.tw.measured
      ? t('diag.twistAmbiguous', { observed: s.tw.report.observed, needs: formatDecimal(e.twists) })
      : t(e.twists === 0 ? 'diag.twistUnmeasuredNone' : 'diag.twistUnmeasuredOther');
  } else {
    kind = 'position-ambiguous';
    message = t('diag.positionAmbiguous', { reason: s.pos.report.notes[0] });
  }

  // What confidence would the closest element have if the failing stage were certain?
  let ifResolved: number | null = null;
  const idx = criterion === 'data' || criterion === 'table' ? -1 : STAGE_ORDER.indexOf(criterion);
  if (idx >= 0 && best.factors[idx] > 0) {
    const prod = best.factors.reduce((a, b, i) => (i === idx ? a : a * b), 1);
    ifResolved = clamp01(prod * quality);
  }
  return { kind, criterion, message, closest: { elementId: e.id, name: elementName(e) }, distances, ifResolved };
}
type FailureKind = FailureDiagnosis['kind'];

// --- the classifier -----------------------------------------------------------------------------------------------

export function legacyId(e: FigElement): SkillId {
  if (e.somersaults === 0 && e.twists === 0) return `${e.position}-jump` as SkillId;
  if (e.somersaults === 1 && e.twists === 0) return e.direction === 'front' ? 'front' : 'back';
  return 'fig-element';
}

export function cutOff(): SkillPrediction {
  return {
    classifier: ID,
    skill: 'unclassified',
    label: SKILL_LABELS.unclassified,
    confidence: 0,
    scores: {},
    confidenceParts: [],
    evidence: [],
    limitations: [boundsLimit()],
    summary: t('sum.cutOff'),
    failure: {
      kind: 'cut-off',
      criterion: 'data',
      message: t('diag.cutOff'),
      closest: null,
      distances: [],
      ifResolved: null,
    },
  };
}

/** What the four stages say about one jump, before any element is named. Shared with the temporal classifier. */
export interface StageAnalysis {
  stages: Stages;
  scored: Scored[];
  outOfTable: number;
  /** Data quality outside the four questions: pose reliability, camera view, orientation track. */
  quality: number;
}

export function analyzeStages(input: ClassifierInput): StageAnalysis {
  const { features: f, sequence, twist, config: cfg } = input;
  const tm = temporal(sequence, twist ?? null, cfg);
  const stages: Stages = {
    rot: rotationStage(f, tm, cfg),
    dir: directionStage(f),
    tw: twistStage(f, twist ?? null, tm, cfg),
    pos: positionStage(f, tm),
  };
  const { scored, outOfTable } = scoreElements(stages);

  // Data quality outside the four questions: pose reliability and camera view.
  const viewFactor = viewFactorOf(f, cfg);
  // Rotation quality is a factor too, not only a wider tolerance: normalizing the stages would otherwise hide a bad orientation track.
  const quality = clamp01(Math.sqrt(f.quality.pose) * viewFactor * stages.rot.quality);
  return { stages, scored, outOfTable, quality };
}

export const hierarchicalClassifier: SkillClassifier = {
  ...ID,
  description:
    'Rotation, direction, twists and position as separate probabilistic stages; element chosen from a table.',
  classify(input: ClassifierInput): SkillPrediction {
    const { features: f, config: cfg } = input;
    if (!f.complete || f.rotation.totalDeg === null) return cutOff();

    const { stages, scored, outOfTable, quality } = analyzeStages(input);
    const best = scored[0];
    const confidence = clamp01(best.posterior * quality);
    const candidates = scored.slice(0, 5).map((sc) => candidateOf(sc, stages));
    const stageReports = [stages.rot.report, stages.dir.report, stages.tw.report, stages.pos.report];

    // Front/back undetermined: the same movement in both directions carries most of the mass.
    const twin = scored.find(
      (s) =>
        s.element.somersaults === best.element.somersaults &&
        s.element.twists === best.element.twists &&
        s.element.position === best.element.position &&
        s.element.direction !== best.element.direction,
    );
    const directionOnly =
      best.element.somersaults > 0 &&
      !stages.dir.measured &&
      twin !== undefined &&
      best.posterior + twin.posterior >= 0.5;

    let skill: SkillId = 'unclassified';
    let label: string = SKILL_LABELS.unclassified;
    let movement: Movement | undefined;
    let elementId: string | undefined;
    let failure: FailureDiagnosis | undefined;
    let outConfidence = confidence;
    let summary: string;
    let guess: SkillPrediction['guess'];

    if (directionOnly && twin && !cfg.forceGuess) {
      const merged = clamp01((best.posterior + twin.posterior) * quality);
      if (merged >= cfg.minConfidence) {
        skill = 'somersault-direction-unknown';
        label = SKILL_LABELS[skill];
        outConfidence = merged;
        movement = { ...movementOf(best.element), direction: null };
        summary = t('sum.directionUnknown', {
          n: best.element.somersaults,
          twist: twistLabel(Math.round(best.element.twists * 2)),
          position: positionWord(best.element.position),
          reason: stages.dir.report.notes[0],
        });
      } else summary = '';
    } else summary = '';

    const namedSummary = (e: FigElement) =>
      t('sum.elementObserved', {
        name: elementName(e),
        parts: [
          stages.rot.report.observed,
          e.somersaults > 0 ? stages.dir.report.observed : null,
          stages.tw.report.observed,
          t('sum.positionDetail', {
            position: stages.pos.report.observed,
            hip: `${Math.round(f.shape.hipAngle.atPeak ?? NaN)}°`,
            knee: `${Math.round(f.shape.kneeAngle.atPeak ?? NaN)}°`,
          }),
        ]
          .filter(Boolean)
          .join(t('list.separator')),
      });

    if (skill === 'unclassified' && confidence >= cfg.minConfidence) {
      const e = best.element;
      skill = legacyId(e);
      label = elementName(e);
      movement = movementOf(e);
      elementId = e.id;
      summary = namedSummary(e);
      if (directionOnly && twin) {
        // The direction was not measured: the likelier one is named and the other stays among the candidates.
        outConfidence = clamp01((best.posterior + twin.posterior) * quality);
        guess = { closest: false, direction: true };
        summary = t('sum.assumedDirection', { summary: namedSummary(e), reason: stages.dir.report.notes[0] });
      }
    }
    if (skill === 'unclassified') {
      failure = diagnose(f, stages, best, outOfTable, quality, viewFactorOf(f, cfg));
      if (cfg.forceGuess) {
        // Not sure enough to name it, but a guess is more useful than nothing: the closest element, with the reason it is weak.
        const e = best.element;
        skill = legacyId(e);
        label = elementName(e);
        movement = movementOf(e);
        elementId = e.id;
        guess = { closest: true, direction: directionOnly && !!twin };
      }
      summary = t('sum.bestGuess', {
        name: elementName(best.element),
        conf: pct(confidence),
        min: pct(cfg.minConfidence),
        reason: failure.message,
      });
    }

    // The measurements and the data problems of this jump come from the rule set (same numbers, same wording); the stages add theirs.
    const rules = ruleBasedClassifier.classify(input);
    const limitations: Limitation[] = [...rules.limitations];
    if (!stages.tw.measured && !limitations.some((l) => l.id === 'twist-suspected'))
      limitations.push(
        knownLimits().find((l) => l.id === 'twists') ?? {
          id: 'twists',
          signal: t('limit.twists.signal'),
          problem: t('limit.unmeasured.problem'),
          needed: t('limit.unmeasured.needed'),
        },
      );
    if (input.twist?.source === 'pose2d' && stages.tw.measured)
      limitations.push({
        id: 'twist-2d',
        signal: t('limit.twist2d.signal'),
        problem: t('limit.twist2d.problem'),
        needed: t('limit.twist2d.needed'),
      });
    const evidence: EvidenceItem[] = [...rules.evidence];
    if (stages.tw.measured)
      evidence.push({
        key: 'twist_source',
        label: t('ev.twistSource.label'),
        text: t(input.twist?.source === 'pose2d' ? 'ev.twistSource.pose2d' : 'ev.twistSource.pose3d'),
        value: null,
      });
    for (const st of stageReports)
      evidence.push({
        key: `stage_${st.stage}`,
        label: st.title,
        text: st.observed,
        value: null,
        note: st.notes.join('; '),
      });

    const scoresById: Partial<Record<SkillId, number>> = {};
    for (const sc of scored.slice(0, 8)) {
      const id = legacyId(sc.element);
      scoresById[id] = Math.max(scoresById[id] ?? 0, sc.posterior * quality);
    }

    return {
      classifier: ID,
      skill,
      label,
      confidence: outConfidence,
      scores: scoresById,
      confidenceParts: [
        ...STAGE_ORDER.map((st, i) => ({ name: stages[stageKey(st)].report.title, value: best.factors[i] })),
        { name: t('part.dataQuality'), value: quality },
      ],
      evidence,
      limitations,
      summary,
      movement,
      elementId,
      candidates,
      stages: stageReports,
      outOfTable,
      dataQuality: quality,
      failure,
      guess,
    };
  },
};

const stageKey = (s: StageId): keyof Stages =>
  s === 'rotation' ? 'rot' : s === 'direction' ? 'dir' : s === 'twists' ? 'tw' : 'pos';

/** Movement -> element for callers outside the classifier (kept here so the mapping has one obvious entry point). */
export { movementToElement };
