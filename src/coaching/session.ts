import { riseFromFlightTime } from '../analysis/jumpCycles';
import type { AnalysisResult } from '../analysis/types';
import { formatNumber, t } from '../i18n/core';
import type { JumpRecord } from '../dataset/types';
import type { TwistAnalysis } from '../pose3d/twist';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { difficultyOf, totalDifficulty, type Difficulty } from '../skills/fig/difficulty';
import { elementById, movementToElement, type FigElement } from '../skills/fig/elements';
import { twistTrajectory } from '../skills/twistTrajectory';
import type { Certainty, TwistContext } from '../skills/types';
import { callOf, type Alternative } from './guess';
import { executionOf, type Execution } from './execution';
import { focusOf, tipsForJump, type Focus, type Tip } from './tips';

/**
 * One practice set as the live view shows it: what each skill was (the coach's label, else the classifier's guess), how hard it is,
 * what execution the pose earns, what to fix, and the totals of the set. Pure: the same analysis and labels give the same session.
 */

/** What a person said about a jump. */
export interface JumpLabel {
  /** The element they say it was. */
  elementId: string | null;
  /** They say it is none of the elements of the list. */
  other: boolean;
  /** The deduction they give it, in points. */
  deduction: number | null;
}

/** The label a saved record carries, or null when a person said nothing about it. */
export function labelOf(r: JumpRecord | undefined | null): JumpLabel | null {
  if (!r) return null;
  const elementId = r.figure?.elementId ?? null;
  const other = !elementId && r.truth?.label === 'unknown';
  const deduction = r.execution?.deduction ?? null;
  return elementId || other || deduction !== null ? { elementId, other, deduction } : null;
}

export interface LiveJump {
  /** 0-based index in the clip, and the number people see. */
  index: number;
  number: number;
  /** Takeoff and landing were both seen. */
  complete: boolean;
  /** Who named it: a person, the classifier, or nobody (cut off, or nothing to go on). */
  source: 'coach' | 'auto' | 'none';
  element: FigElement | null;
  /** A person says it is none of the elements of the list. */
  other: boolean;
  certainty: Certainty | null;
  confidence: number;
  /** The classifier would not have named it firmly. */
  forced: boolean;
  /** Front or back could not be told apart. */
  directionAssumed: boolean;
  /** Why the guess is weak, in a sentence: what the classifier could not settle (null when it is not a forced guess). */
  why: string | null;
  alternatives: Alternative[];
  /** A skill has a difficulty above 0; a straight jump is a bounce. */
  isSkill: boolean;
  /** The guess is one the classifier would not have named: it stays out of the totals until a person checks it. */
  pending: boolean;
  difficulty: Difficulty | null;
  /** The difficulty that counts in the set: 0 for a repetition. */
  counted: number;
  repeated: boolean;
  /** The pose was easier than the position of the element, so a judge would score another element (null when the position holds). */
  easier: {
    measured: 'tuck' | 'pike' | 'straight';
    element: FigElement;
    hipDeg: number | null;
    kneeDeg: number | null;
  } | null;
  execution: Execution | null;
  /** What the app proposes, and what a person gave. `deduction` is the one that counts. */
  proposed: number | null;
  coachDeduction: number | null;
  deduction: number | null;
  flightS: number | null;
  heightM: number;
  /** How high the jump rose above its takeoff, estimated from the time in the air alone (no scale needed); null without a flight time. */
  airRiseM: number | null;
  tips: Tip[];
}

export interface SessionSummary {
  /** Skills of the set: complete jumps that are an element with a difficulty, without the guesses that wait for a check. */
  skills: number;
  /** Skills the classifier only guessed at: they wait for a check and are not in the totals. */
  pending: number;
  /** Straight jumps (bounces) and jumps cut off by the clip, kept out of the totals. */
  bounces: number;
  cutOff: number;
  /** Sum of the difficulty of the skills, a repetition counted once. */
  difficulty: number;
  /** Skills with a deduction, the sum of their deductions, and the execution score for ten skills like these (one judge, out of 10). */
  judged: number;
  deductionTotal: number;
  execution: number | null;
  /** Time in the air of the skills, seconds. */
  flightS: number;
  focus: Focus[];
  /** Things that make the numbers less sure: an oblique camera, a pose that was hard to see. */
  warnings: string[];
}

export interface Session {
  jumps: LiveJump[];
  tips: Tip[];
  summary: SessionSummary;
}

const tenths = (v: number) => Math.round(v * 10) / 10;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2) : NaN;
};
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** Height that is lost over a set: the last three skills against the first three, from this many skills on. */
const TREND_MIN_SKILLS = 6;
/** ... and the share of the flight time that has to be lost before it is worth saying. */
const TREND_DROP = 0.12;

export function buildSession(input: {
  skills: SkillAnalysis;
  result: AnalysisResult;
  twist: TwistAnalysis | null;
  labels?: readonly (JumpLabel | null | undefined)[];
}): Session {
  const { skills, result, twist } = input;

  const jumps = skills.jumps.map<LiveJump>((j, index) => {
    const label = input.labels?.[index] ?? null;
    const f = j.features;
    const call = f.complete ? callOf(j.prediction) : null;
    const coachElement = label?.elementId ? (elementById(label.elementId) ?? null) : null;
    const other = !!label?.other && !coachElement;
    const element = f.complete && !other ? (coachElement ?? call?.element ?? null) : null;
    const source: LiveJump['source'] = coachElement ? 'coach' : element ? 'auto' : 'none';
    const isSkill = !!element && element.difficulty > 0;
    const pending = isSkill && source === 'auto' && !!call?.forced;

    const est = twist?.jumps[index];
    const ctx: TwistContext | null = est
      ? {
          estimate: est,
          trajectory: twistTrajectory(twist?.frames ?? null, result.time, j.cycle, skills.config.sequenceSamples),
        }
      : null;
    const execution =
      element && isSkill ? executionOf({ sequence: j.sequence, features: f, movement: element, twist: ctx }) : null;
    const proposed = execution?.checked ? execution.deduction : null;
    const coachDeduction = label?.deduction ?? null;
    const deduction = isSkill ? (coachDeduction ?? proposed) : null;
    const usingCall = source === 'auto' && call ? call : null;
    const easier = element ? easierShape(element, f) : null;

    return {
      index,
      number: index + 1,
      complete: f.complete,
      source,
      element,
      other,
      certainty: coachElement ? 'confident' : (usingCall?.certainty ?? null),
      confidence: coachElement ? 1 : (usingCall?.confidence ?? 0),
      forced: usingCall?.forced ?? false,
      directionAssumed: usingCall?.directionAssumed ?? false,
      why: usingCall?.forced ? (j.prediction.failure?.message ?? null) : null,
      alternatives:
        (coachElement ? callOf(j.prediction)?.alternatives : usingCall?.alternatives)?.filter(
          (a) => a.elementId !== element?.id,
        ) ?? [],
      isSkill,
      pending,
      easier,
      difficulty: element ? difficultyOf(element) : null,
      counted: 0,
      repeated: false,
      execution,
      proposed,
      coachDeduction,
      deduction,
      flightS: f.timing.flightTimeS,
      heightM: f.trajectory.maxHeightM,
      airRiseM: riseFromFlightTime(f.timing.flightTimeS),
      tips: isSkill ? tipsForJump(index, execution, f) : [],
    };
  });

  // The difficulty counts each element once, in the order performed (§14.1).
  const total = totalDifficulty(jumps.map((j) => (j.isSkill && !j.pending && j.element ? j.element : null)));
  jumps.forEach((j, k) => {
    j.counted = total.counted[k];
    j.repeated = total.repeated[k];
  });

  const skillJumps = jumps.filter((j) => j.isSkill && !j.pending);
  const deductions = skillJumps.flatMap((j) => (j.deduction === null ? [] : [j.deduction]));
  const deductionTotal = tenths(deductions.reduce((s, v) => s + v, 0));
  const flights = skillJumps.flatMap((j) => (j.flightS === null ? [] : [j.flightS]));

  const tips = jumps.flatMap((j) => (j.pending ? [] : j.tips));
  const trend = heightTrend(flights);
  if (trend) tips.push({ id: 'height', jump: -1, gain: 0, ...trend });

  return {
    jumps,
    tips,
    summary: {
      skills: skillJumps.length,
      pending: jumps.filter((j) => j.pending).length,
      bounces: jumps.filter((j) => j.complete && !j.isSkill && !j.other && j.element !== null).length,
      cutOff: jumps.filter((j) => !j.complete).length,
      difficulty: total.value,
      judged: deductions.length,
      deductionTotal,
      execution: deductions.length ? tenths(10 - 10 * mean(deductions)) : null,
      flightS: Math.round(flights.reduce((s, v) => s + v, 0) * 100) / 100,
      focus: focusOf(tips, skillJumps.length),
      warnings: warningsOf(skills),
    },
  };
}

const RANK = { tuck: 0, pike: 1, straight: 2 } as const;
/** The measured shape must be this sure before it is said to be easier than the position of the element. */
const SHAPE_SURE = 0.5;

/**
 * Judges give the least difficult shape adopted (§13.2.4), so a skill named as a pike or a layout whose body was clearly a tuck (or a layout
 * that was clearly piked) is worth the difficulty of the easier element. Null when the shape is as hard as the name says, or not clear.
 */
function easierShape(element: FigElement, f: SkillAnalysis['jumps'][number]['features']): LiveJump['easier'] {
  const p = f.position;
  if (!f.complete || p.label === 'unknown' || p.ruleScore < SHAPE_SURE) return null;
  if (RANK[p.label] >= RANK[element.position]) return null;
  const other = movementToElement({ ...element, position: p.label });
  if (!other || other.difficulty >= element.difficulty) return null;
  return { measured: p.label, element: other, hipDeg: f.shape.hipAngle.atPeak, kneeDeg: f.shape.kneeAngle.atPeak };
}

/** A note when the last skills of a long set fly clearly lower than the first ones: the height was not kept. */
function heightTrend(flights: number[]): { title: string; text: string; detail: string } | null {
  if (flights.length < TREND_MIN_SKILLS) return null;
  const first = mean(flights.slice(0, 3));
  const last = mean(flights.slice(-3));
  if (!(first > 0) || last > first * (1 - TREND_DROP)) return null;
  return {
    title: t('tip.height.title'),
    text: t('tip.height.text'),
    detail: t('tip.height.detail', { first: formatNumber(first, 2), last: formatNumber(last, 2) }),
  };
}

function warningsOf(skills: SkillAnalysis): string[] {
  const complete = skills.jumps.filter((j) => j.features.complete);
  if (complete.length === 0) return [];
  const out: string[] = [];
  const oblique = complete.filter(
    (j) => (j.features.quality.trunkLengthVariation ?? 0) > skills.config.maxTrunkVariation,
  );
  if (oblique.length >= Math.max(1, complete.length / 2)) out.push(t('warn.oblique'));
  const poor = complete.filter((j) => j.features.quality.pose < 0.5);
  if (poor.length >= Math.max(1, complete.length * 0.3)) out.push(t('warn.poor'));
  const medianPose = median(complete.map((j) => j.features.quality.pose));
  if (Number.isFinite(medianPose) && medianPose < 0.35 && out.length === 0) out.push(t('warn.poseOverall'));
  return out;
}
