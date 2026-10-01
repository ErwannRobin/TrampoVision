import type { JumpRecord } from '../dataset/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { mergeSkillConfig, type SkillConfig } from '../skills/config';
import type { JumpFeatures, JumpSequence } from '../skills/types';

/**
 * Label-free quality of the rotation measurement. Nobody has to say what a jump was: a rotation that is measured well has a clean
 * signature (the trunk keeps turning one way, no jump of the angle between two frames, the body line agrees with the trunk, the net
 * rotation sits near a half turn), and the facing and the twist are known. The shares of the rotating flights that pass each check are
 * a number to push up when the pose input or the orientation tracking improves, before there are labels to score a name on.
 * It says nothing about whether the name is right.
 */

/** What the checks read about one flight, whatever it came from (a saved record, or a fresh analysis of a pose series). */
export interface ConsistencyInput {
  id: string;
  videoId: string | null;
  complete: boolean;
  flightS: number | null;
  /** Net rotation in turns (signed). */
  turns: number | null;
  /** Sum of |orientation steps| over the flight, in turns; null when the sequence is missing. */
  pathTurns: number | null;
  rotationConfidence: number;
  reversalDeg: number | null;
  maxStepDeg: number | null;
  crossCheckDiffDeg: number | null;
  residualDeg: number | null;
  facingConfidence: number;
  /** The 3D twist exists and passed its own reliability limit. */
  twistReliable: boolean;
}

export const CHECKS = ['monotonic', 'noFlip', 'crossCheck', 'onGrid', 'facing', 'twist'] as const;
export type Check = (typeof CHECKS)[number];

/** What each check means, for the report. */
export const CHECK_TEXT: Record<Check, string> = {
  monotonic: 'orientation keeps turning one way (reversal within the limit)',
  noFlip: 'no step between two samples above the limit (no pose flip)',
  crossCheck: 'ankle-to-head line turned like the trunk',
  onGrid: 'net rotation within tolerance of a half-turn multiple',
  facing: 'facing known (front vs back can be told)',
  twist: 'twist measured reliably',
};

export interface ConsistencyOptions {
  /** A flight is rotating when its net rotation is above this many turns... */
  minTurns: number;
  /** ...or when it lasts at least `minFlightS` and the orientation path adds up to more than `minPathTurns` (a rotation lost to flips, not the jitter of a straight jump). */
  minFlightS: number;
  minPathTurns: number;
  config: SkillConfig;
  /** Net rotation farther than this (degrees) from a half-turn multiple fails `onGrid`; default: the rotation tolerance of the config. */
  gridToleranceDeg?: number;
  /** The body line may differ from the trunk by this much (degrees). */
  crossCheckDeg: number;
}

export const defaultConsistencyOptions = (config: SkillConfig = mergeSkillConfig()): ConsistencyOptions => ({
  minTurns: 0.5,
  minFlightS: 1.0,
  minPathTurns: 0.75,
  config,
  crossCheckDeg: 60,
});

export interface JumpConsistency {
  id: string;
  videoId: string | null;
  flightS: number | null;
  turns: number | null;
  pathTurns: number | null;
  rotationConfidence: number;
  /** Pass / fail per check; null when the check cannot be told (nothing measured). */
  checks: Record<Check, boolean | null>;
  failing: Check[];
}

export interface Share {
  pass: number;
  n: number;
  share: number | null;
}

export interface ConsistencyReport {
  /** Complete flights looked at, and how many of them rotate. */
  flights: number;
  rotating: number;
  options: {
    minTurns: number;
    minFlightS: number;
    minPathTurns: number;
    gridToleranceDeg: number;
    crossCheckDeg: number;
  };
  checks: Record<Check, Share>;
  /** Rotating flights that pass the four rotation checks (monotonic, noFlip, crossCheck, onGrid). */
  clean: Share;
  meanRotationConfidence: number | null;
  /** The rotating flights, worst first. */
  jumps: JumpConsistency[];
}

const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Sum of |orientation steps| of a normalized sequence, in turns. Null when too few samples are measured. */
export function pathTurnsOf(seq: JumpSequence | null): number | null {
  if (!seq) return null;
  const col = seq.columns.indexOf('orient_turns');
  if (col < 0) return null;
  let path = 0;
  let pairs = 0;
  for (let i = 1; i < seq.data.length; i++) {
    const d = Math.abs(seq.data[i][col] - seq.data[i - 1][col]);
    if (Number.isFinite(d)) {
      path += d;
      pairs++;
    }
  }
  return pairs >= seq.data.length * 0.6 ? path : null;
}

function inputOf(
  id: string,
  videoId: string | null,
  f: JumpFeatures,
  seq: JumpSequence | null,
  twistReliable: boolean,
): ConsistencyInput {
  const r = f.rotation;
  return {
    id,
    videoId,
    complete: f.complete,
    flightS: f.timing.flightTimeS,
    turns: r.turns,
    pathTurns: pathTurnsOf(seq),
    rotationConfidence: r.confidence,
    reversalDeg: r.reversalDeg,
    maxStepDeg: r.maxStepDeg,
    crossCheckDiffDeg: r.crossCheckDiffDeg,
    residualDeg: r.residualDeg,
    facingConfidence: f.facing.confidence,
    twistReliable,
  };
}

/** From jumps saved by the app (a dataset file, or the review service's export). */
export const inputsFromRecords = (records: readonly JumpRecord[]): ConsistencyInput[] =>
  records.map((r) => inputOf(r.id, r.videoId, r.features, r.sequence, r.twist?.estimate.reliable === true));

/** From a fresh analysis, so the same numbers compare two versions of the pipeline on the same video. */
export function inputsFromAnalysis(
  skills: SkillAnalysis,
  twist: { jumps: { reliable: boolean }[] } | null,
  videoId: string | null = null,
): ConsistencyInput[] {
  return skills.jumps.map((j, i) =>
    inputOf(`${videoId ?? 'v'}:${i + 1}`, videoId, j.features, j.sequence, twist?.jumps[i]?.reliable === true),
  );
}

export function isRotating(i: ConsistencyInput, o: ConsistencyOptions): boolean {
  if (!i.complete) return false;
  if (finite(i.turns) && Math.abs(i.turns) > o.minTurns) return true;
  return finite(i.flightS) && i.flightS >= o.minFlightS && finite(i.pathTurns) && i.pathTurns > o.minPathTurns;
}

export function judge(i: ConsistencyInput, o: ConsistencyOptions): JumpConsistency {
  const rot = o.config.rotation;
  const grid = o.gridToleranceDeg ?? rot.toleranceDeg;
  const measured = finite(i.turns);
  const checks: Record<Check, boolean | null> = {
    monotonic: finite(i.reversalDeg) ? i.reversalDeg <= rot.reversalOkDeg : null,
    noFlip: finite(i.maxStepDeg) ? i.maxStepDeg <= rot.maxStepDeg : null,
    // No body-line reading to compare with is not a failure.
    crossCheck: measured ? !finite(i.crossCheckDiffDeg) || Math.abs(i.crossCheckDiffDeg) <= o.crossCheckDeg : null,
    onGrid: finite(i.residualDeg) ? Math.abs(i.residualDeg) <= grid : null,
    facing: i.facingConfidence >= o.config.facing.minConfidence,
    twist: i.twistReliable,
  };
  return {
    id: i.id,
    videoId: i.videoId,
    flightS: i.flightS,
    turns: i.turns,
    pathTurns: i.pathTurns,
    rotationConfidence: i.rotationConfidence,
    checks,
    // A check that cannot be told counts against the jump: nothing was measured.
    failing: CHECKS.filter((c) => checks[c] !== true),
  };
}

const share = (pass: number, n: number): Share => ({ pass, n, share: n ? pass / n : null });
const ROTATION_CHECKS: Check[] = ['monotonic', 'noFlip', 'crossCheck', 'onGrid'];

export function consistencyOf(
  inputs: readonly ConsistencyInput[],
  options?: Partial<ConsistencyOptions>,
): ConsistencyReport {
  const o = { ...defaultConsistencyOptions(options?.config), ...options };
  const complete = inputs.filter((i) => i.complete);
  const jumps = complete.filter((i) => isRotating(i, o)).map((i) => judge(i, o));
  const n = jumps.length;
  const checks = Object.fromEntries(
    CHECKS.map((c) => [c, share(jumps.filter((j) => j.checks[c] === true).length, n)]),
  ) as Record<Check, Share>;
  const clean = share(jumps.filter((j) => ROTATION_CHECKS.every((c) => j.checks[c] === true)).length, n);
  return {
    flights: complete.length,
    rotating: n,
    options: {
      minTurns: o.minTurns,
      minFlightS: o.minFlightS,
      minPathTurns: o.minPathTurns,
      gridToleranceDeg: o.gridToleranceDeg ?? o.config.rotation.toleranceDeg,
      crossCheckDeg: o.crossCheckDeg,
    },
    checks,
    clean,
    meanRotationConfidence: n ? jumps.reduce((s, j) => s + j.rotationConfidence, 0) / n : null,
    jumps: jumps.sort((a, b) => b.failing.length - a.failing.length || a.rotationConfidence - b.rotationConfidence),
  };
}

const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null, d = 2) => (v === null ? '–' : v.toFixed(d));

export function formatConsistency(title: string, r: ConsistencyReport): string {
  const out = [`== ${title} ==`];
  out.push(
    `${r.flights} complete flights, ${r.rotating} rotating (net rotation above ${r.options.minTurns} turns, or at least ${r.options.minFlightS} s with an orientation path above ${r.options.minPathTurns} turns)`,
  );
  if (r.rotating === 0) return out.join('\n');
  out.push(
    `clean rotation (first four checks) ${pct(r.clean.share)} (${r.clean.pass}/${r.clean.n})   mean rotation confidence ${num(r.meanRotationConfidence)}`,
    '',
    'Share of the rotating flights that pass:',
  );
  for (const c of CHECKS) {
    const s = r.checks[c];
    out.push(
      `  ${c.padEnd(11)} ${pct(s.share).padStart(6)}  ${String(s.pass).padStart(3)}/${String(s.n).padEnd(3)} ${CHECK_TEXT[c]}`,
    );
  }
  out.push('', 'Rotating flights, worst first (failing checks):');
  for (const j of r.jumps) {
    out.push(
      `  ${j.id.padEnd(10)} flight ${num(j.flightS)} s  turns ${num(j.turns)}  path ${num(j.pathTurns)}  conf ${num(j.rotationConfidence)}  ${j.failing.length ? j.failing.join(', ') : 'all pass'}`,
    );
  }
  return out.join('\n');
}

/** What a baseline file keeps. */
export interface ConsistencyBaseline {
  rotating: number;
  clean: number | null;
  checks: Record<Check, number | null>;
  meanRotationConfidence: number | null;
}

export const consistencyBaselineOf = (r: ConsistencyReport): ConsistencyBaseline => ({
  rotating: r.rotating,
  clean: r.clean.share,
  checks: Object.fromEntries(CHECKS.map((c) => [c, r.checks[c].share])) as Record<Check, number | null>,
  meanRotationConfidence: r.meanRotationConfidence,
});

/** The ways a report is worse than its baseline: a share that fell, or the mean confidence. A different count of rotating flights is noted, not failed. */
export function consistencyRegressions(
  r: ConsistencyReport,
  base: ConsistencyBaseline,
  tolerance = 0.005,
): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  if (r.rotating !== base.rotating)
    notes.push(`rotating flights changed (${base.rotating} → ${r.rotating}): shares compare different sets`);
  const worse = (name: string, now: number | null, was: number | null) => {
    if (now !== null && was !== null && now < was - tolerance)
      problems.push(`${name} fell from ${pct(was)} to ${pct(now)}`);
  };
  worse('clean rotation', r.clean.share, base.clean);
  for (const c of CHECKS) worse(c, r.checks[c].share, base.checks[c]);
  if (
    r.meanRotationConfidence !== null &&
    base.meanRotationConfidence !== null &&
    r.meanRotationConfidence < base.meanRotationConfidence - 0.01
  )
    problems.push(
      `mean rotation confidence fell from ${num(base.meanRotationConfidence)} to ${num(r.meanRotationConfidence)}`,
    );
  return { problems, notes };
}
