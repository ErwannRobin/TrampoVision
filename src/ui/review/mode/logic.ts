import { nextQuarter, stepTwists, tidyAnswers, type ReviewStatus } from '../../../dataset/stageLabel';
import type { StageAnswers } from '../../../dataset/types';
import type { Direction } from '../../../skills/fig/elements';
import type { SkillConfig } from '../../../skills/config';
import type { JumpFeatures, KnownPosition } from '../../../skills/types';

/** The review mode: which jumps it shows, what its keys do, and the data problems it points out. Nothing here draws anything. */

// --- which jumps -----------------------------------------------------------------------------------------------------------

/**
 *  all       every jump
 *  todo      jumps with no label yet, or only some of the questions answered
 *  disagree  jumps whose whole answers differ from what the classifier named
 *  unsure    jumps the classifier is not confident about
 */
export const REVIEW_FILTERS = ['all', 'todo', 'disagree', 'unsure'] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/** What the filters need to know about one jump. */
export interface ReviewItem {
  status: ReviewStatus;
  /** The whole answers differ from the classifier's guess. */
  disagrees: boolean;
  /** Confidence of the classifier's guess, 0..1. */
  confidence: number;
}

/** A jump that still needs the person: nothing said, or some questions open. */
export const needsLabel = (status: ReviewStatus): boolean => status === 'unlabeled' || status === 'partial';

export function matchesFilter(filter: ReviewFilter, item: ReviewItem, confidentAt: number): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'todo':
      return needsLabel(item.status);
    case 'disagree':
      return item.disagrees;
    case 'unsure':
      return item.confidence < confidentAt;
  }
}

export const filterMask = (filter: ReviewFilter, items: readonly ReviewItem[], confidentAt: number): boolean[] =>
  items.map((item) => matchesFilter(filter, item, confidentAt));

/** The next (or previous) jump of the mask after `from`, wrapping around the clip; null when no other jump is in it. */
export function stepInMask(mask: readonly boolean[], from: number, direction: 1 | -1 = 1): number | null {
  const n = mask.length;
  for (let step = 1; step < n; step++) {
    const j = (((from + direction * step) % n) + n) % n;
    if (mask[j]) return j;
  }
  return null;
}

/**
 * Where to go after a jump has been labelled: the next jump of the filter that still needs a label, wrapping around. Null when none
 * does (every jump of the filter is done), and the review stays where it is.
 */
export function nextToLabel(statuses: readonly ReviewStatus[], mask: readonly boolean[], from: number): number | null {
  const n = statuses.length;
  for (let step = 1; step < n; step++) {
    const j = (from + step) % n;
    if (mask[j] && needsLabel(statuses[j])) return j;
  }
  return null;
}

export interface ReviewCounts {
  total: number;
  /** Jumps with a whole label. */
  done: number;
  /** Jumps marked "cannot tell" or "bad segmentation". */
  flagged: number;
  /** Some questions answered, some open. */
  partial: number;
  /** Nothing said. */
  open: number;
  /** Done or flagged: nothing more to do for them. */
  settled: number;
}

export function reviewCounts(statuses: readonly ReviewStatus[]): ReviewCounts {
  const c = { total: statuses.length, done: 0, flagged: 0, partial: 0, open: 0, settled: 0 };
  for (const s of statuses) {
    if (s === 'done') c.done++;
    else if (s === 'cannot-tell' || s === 'bad-segmentation') c.flagged++;
    else if (s === 'partial') c.partial++;
    else c.open++;
  }
  c.settled = c.done + c.flagged;
  return c;
}

// --- answering -------------------------------------------------------------------------------------------------------------

/** Everything a person can do to a jump's label, from a button or a key. */
export type ReviewAction =
  | { kind: 'somersaults'; value: number }
  | { kind: 'quarter' }
  | { kind: 'direction'; value: Direction }
  | { kind: 'twists'; value: number }
  | { kind: 'twistsStep'; delta: 1 | -1 }
  | { kind: 'position'; value: KnownPosition }
  | { kind: 'accept' }
  | { kind: 'cannotTell' }
  | { kind: 'badSegmentation' }
  | { kind: 'clear' }
  | { kind: 'undo' }
  | { kind: 'next' }
  | { kind: 'replay' };

/** The answers after a button on one question. With `toggle`, pressing the answer that is already given takes it back (a button); a key does not. */
export function answer(
  current: StageAnswers,
  action: ReviewAction,
  options: { toggle?: boolean } = {},
): StageAnswers | null {
  const toggle = options.toggle ?? false;
  switch (action.kind) {
    case 'somersaults':
      return tidyAnswers({
        ...current,
        somersaults: toggle && current.somersaults === action.value ? null : action.value,
      });
    case 'quarter':
      return tidyAnswers({ ...current, somersaults: nextQuarter(current.somersaults) });
    case 'direction':
      return { ...current, direction: toggle && current.direction === action.value ? null : action.value };
    case 'twists':
      return { ...current, halfTwists: toggle && current.halfTwists === action.value ? null : action.value };
    case 'twistsStep':
      return { ...current, halfTwists: stepTwists(current.halfTwists, action.delta) };
    case 'position':
      return { ...current, position: toggle && current.position === action.value ? null : action.value };
    default:
      return null;
  }
}

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * What a key does in the review mode; null when it is not one of ours. Space, the arrows and [ ] belong to the player and the
 * timeline and stay as they are.
 *   0 1 2 3  somersaults        Q  a further quarter       B F  back / front
 *   S T P    straight, tuck, pike      W  no twist         + -  more or fewer half twists
 *   Enter A  the classifier was right  U  cannot tell      X  bad segmentation
 *   C  clear      Z  undo      N  next jump of the filter      R  play the jump again
 */
export function reviewKey(e: KeyLike): ReviewAction | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.altKey) return { kind: 'undo' };
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (/^[0-3]$/.test(key)) return { kind: 'somersaults', value: Number(key) };
  switch (key) {
    case 'q':
      return { kind: 'quarter' };
    case 'b':
      return { kind: 'direction', value: 'back' };
    case 'f':
      return { kind: 'direction', value: 'front' };
    case 's':
      return { kind: 'position', value: 'straight' };
    case 't':
      return { kind: 'position', value: 'tuck' };
    case 'p':
      return { kind: 'position', value: 'pike' };
    case 'w':
      return { kind: 'twists', value: 0 };
    case '+':
    case '=':
      return { kind: 'twistsStep', delta: 1 };
    case '-':
    case '_':
      return { kind: 'twistsStep', delta: -1 };
    case 'Enter':
    case 'a':
      return { kind: 'accept' };
    case 'u':
      return { kind: 'cannotTell' };
    case 'x':
      return { kind: 'badSegmentation' };
    case 'c':
      return { kind: 'clear' };
    case 'z':
      return { kind: 'undo' };
    case 'n':
      return { kind: 'next' };
    case 'r':
      return { kind: 'replay' };
    default:
      return null;
  }
}

// --- what is wrong with the data -------------------------------------------------------------------------------------------

/**
 * A reason to look twice at what the classifier measured in this jump. `value` is the number the message quotes.
 *  cut-off        the clip ends or starts inside the flight
 *  flip           the body orientation jumped between two frames: the pose model most likely flipped the body
 *  reversal       the orientation went one way and came back
 *  cross-check    the body line (ankles to head) did not turn like the trunk
 *  pose           the joints were poorly measured during the flight
 *  view           the camera is not side-on: the trunk changes length
 *  facing         front or back cannot be told
 *  twist          the twist is not measured reliably
 */
export type DataFlagId = 'cut-off' | 'flip' | 'reversal' | 'cross-check' | 'pose' | 'view' | 'facing' | 'twist';

export interface DataFlag {
  id: DataFlagId;
  value: number | null;
}

export function dataFlags(
  f: JumpFeatures,
  cfg: SkillConfig,
  twist: { available: boolean; reliable: boolean } | null,
): DataFlag[] {
  const out: DataFlag[] = [];
  if (!f.complete) {
    out.push({ id: 'cut-off', value: null });
    return out;
  }
  const r = f.rotation;
  if (r.maxStepDeg !== null && r.maxStepDeg > cfg.rotation.maxStepDeg) out.push({ id: 'flip', value: r.maxStepDeg });
  if (r.reversalDeg !== null && r.reversalDeg > cfg.rotation.reversalOkDeg)
    out.push({ id: 'reversal', value: r.reversalDeg });
  if (r.crossCheckDiffDeg !== null && Math.abs(r.crossCheckDiffDeg) > 60)
    out.push({ id: 'cross-check', value: Math.abs(r.crossCheckDiffDeg) });
  if (f.quality.pose < 0.6) out.push({ id: 'pose', value: f.quality.pose });
  if (f.quality.trunkLengthVariation !== null && f.quality.trunkLengthVariation > cfg.maxTrunkVariation)
    out.push({ id: 'view', value: f.quality.trunkLengthVariation });
  if (f.facing.sign === 0) out.push({ id: 'facing', value: f.facing.confidence });
  if (!twist || !twist.available || !twist.reliable) out.push({ id: 'twist', value: null });
  return out;
}
