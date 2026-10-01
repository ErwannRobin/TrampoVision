import {
  APEX_TOLERANCE_S,
  LABEL_SCHEMA,
  LABEL_VERSION,
  elementOfLabel,
  hasStageLabel,
  type JumpLabel,
  type LabelFile,
} from '../eval/labels';
import { elementById, type FigElement } from '../skills/fig/elements';
import type { SkillPrediction } from '../skills/types';
import { legacyLabel, movementOfRecord, type MovementLabel } from './movementLabel';
import type { JumpRecord, ReviewFlag, StageAnswers, TruthLabel } from './types';

/**
 * What a person says about a jump in the review mode: the four questions of the classifier answered one by one (how many somersaults,
 * which way, how many half twists, which position), any of them left blank, or the jump marked as impossible to tell or badly cut.
 * The answers are kept on the record as they were given and, when they are whole, also as the movement label and the figure that
 * the rest of the app (the metrics, the reference examples) reads. The same answers are what a label file of `make eval` holds.
 */

export const EMPTY_ANSWERS: StageAnswers = { somersaults: null, direction: null, halfTwists: null, position: null };

/** The somersault counts the review offers, in quarters: 0, ¼, ½, ¾, 1, ... 3. */
export const SOMERSAULT_STEPS: readonly number[] = Array.from({ length: 13 }, (_, i) => i / 4);
/** The half twists the review offers. */
export const HALF_TWIST_STEPS: readonly number[] = Array.from({ length: 9 }, (_, i) => i);

/** Nothing has been answered. */
export const isBlank = (a: StageAnswers): boolean => !hasStageLabel(a);

/** Every question that applies has an answer: the direction only matters for a body that somersaults. */
export const isComplete = (a: StageAnswers): boolean =>
  a.somersaults !== null &&
  a.halfTwists !== null &&
  a.position !== null &&
  (a.somersaults === 0 || a.direction !== null);

/** Two sets of answers say the same thing: the direction of a body that does not somersault is not an answer. */
export function sameAnswers(a: StageAnswers, b: StageAnswers): boolean {
  const flat = a.somersaults === 0 && b.somersaults === 0;
  return (
    a.somersaults === b.somersaults &&
    a.halfTwists === b.halfTwists &&
    a.position === b.position &&
    (flat || a.direction === b.direction)
  );
}

/** Makes answers consistent: no direction without a somersault. */
export function tidyAnswers(a: StageAnswers): StageAnswers {
  return a.somersaults === 0 && a.direction !== null ? { ...a, direction: null } : a;
}

export function answersOfMovement(m: MovementLabel): StageAnswers {
  return {
    somersaults: m.somersaults,
    direction: m.somersaults > 0 ? m.direction : null,
    halfTwists: m.halfTwists,
    position: m.position === 'straddle' ? null : m.position,
  };
}

/** What the classifier named, as answers; null when it named no movement. */
export function answersOfPrediction(p: Pick<SkillPrediction, 'movement'>): StageAnswers | null {
  const m = p.movement;
  if (!m) return null;
  return {
    somersaults: m.somersaults,
    direction: m.somersaults > 0 ? m.direction : null,
    halfTwists: Math.round(m.twists * 2),
    position: m.position,
  };
}

/** What a record says the jump was, question by question: the answers as given, else what its movement label or figure says, else blank. */
export function answersOfRecord(r: JumpRecord): StageAnswers {
  if (r.truth?.stages) return r.truth.stages;
  const m = movementOfRecord(r);
  return m ? answersOfMovement(m) : EMPTY_ANSWERS;
}

/** The movement label that complete answers make; null while a question that applies is still open. */
export function movementOfAnswers(a: StageAnswers): MovementLabel | null {
  if (!isComplete(a)) return null;
  return {
    position: a.position,
    direction: a.somersaults! > 0 ? a.direction : null,
    somersaults: a.somersaults!,
    halfTwists: a.halfTwists!,
  };
}

/** The element of the table the answers name; null when they are not whole, have a quarter rotation, or are not in the table. */
export function figureOfAnswers(a: StageAnswers): FigElement | null {
  const id = elementOfLabel(a);
  return id ? (elementById(id) ?? null) : null;
}

/** The next quarter on the somersault count: 0 -> ¼ -> ½ -> ¾ -> 0 above the whole number it has (nothing answered starts at ¼). */
export function nextQuarter(somersaults: number | null): number {
  const s = somersaults ?? 0;
  const whole = Math.floor(s);
  const quarters = Math.round((s - whole) * 4);
  return whole + ((quarters + 1) % 4) / 4;
}

/** Moves the half twists up or down, within what the review offers (nothing answered counts as none). */
export function stepTwists(halfTwists: number | null, delta: 1 | -1): number {
  const max = HALF_TWIST_STEPS[HALF_TWIST_STEPS.length - 1];
  return Math.min(max, Math.max(0, (halfTwists ?? 0) + delta));
}

// --- on the record --------------------------------------------------------------------------------------------------------

/**
 * Where a jump stands in the review.
 *  unlabeled        nothing said
 *  partial          some questions answered, some not
 *  done             every question that applies is answered
 *  cannot-tell      the person cannot tell what it was
 *  bad-segmentation the jump was cut at the wrong place
 */
export type ReviewStatus = 'unlabeled' | 'partial' | 'done' | 'cannot-tell' | 'bad-segmentation';

export function reviewStatusOf(r: Pick<JumpRecord, 'truth' | 'figure'>): ReviewStatus {
  const truth = r.truth;
  if (!truth) return 'unlabeled';
  if (truth.flag === 'bad-segmentation') return 'bad-segmentation';
  if (truth.flag === 'cannot-tell') return 'cannot-tell';
  if (truth.stages) return isComplete(truth.stages) ? 'done' : isBlank(truth.stages) ? 'unlabeled' : 'partial';
  // Labels from before the review mode: a bare "unknown" is "cannot tell"; a movement label is done when it is whole.
  if (truth.label === 'unknown' && !truth.movement && !r.figure) return 'cannot-tell';
  if (truth.movement) {
    const m = truth.movement;
    return m.position !== null && (m.somersaults === 0 || m.direction !== null) ? 'done' : 'partial';
  }
  return 'done';
}

/** The five-way label of the metrics: only whole answers with a whole number of somersaults have one. */
const labelOfAnswers = (a: StageAnswers): TruthLabel =>
  isComplete(a) && Number.isInteger(a.somersaults) ? legacyLabel(movementOfAnswers(a)!) : 'unknown';

/**
 * Saves the answers on the record. Whole answers also make the movement label, the figure (when the table has it: then the jump is a
 * reference example for the classifier) and the half-twist count; partial answers are kept as they are and nothing is derived from
 * them, so a jump labelled "tuck" before the somersaults are counted is not scored as a tuck jump. Blank answers remove the label.
 */
export function withStageAnswers(r: JumpRecord, answers: StageAnswers, now = new Date()): JumpRecord {
  const iso = now.toISOString();
  const a = tidyAnswers(answers);
  if (isBlank(a)) return { ...r, truth: null, figure: null, twistTruth: null, savedAt: iso };
  const note = r.truth?.note;
  const movement = movementOfAnswers(a);
  const figure = figureOfAnswers(a);
  return {
    ...r,
    truth: {
      label: labelOfAnswers(a),
      labeledAt: iso,
      stages: a,
      ...(movement ? { movement } : {}),
      ...(note ? { note } : {}),
    },
    figure: figure ? { elementId: figure.id, labeledAt: iso } : null,
    twistTruth: a.halfTwists === null ? null : { halfTwists: a.halfTwists, annotatedAt: iso },
    savedAt: iso,
  };
}

/** The jump cannot be told, or was cut at the wrong place: no figure, no answers, and the metrics leave it out. A null flag removes the label. */
export function withReviewFlag(r: JumpRecord, flag: ReviewFlag | null, now = new Date()): JumpRecord {
  const iso = now.toISOString();
  if (flag === null) return { ...r, truth: null, figure: null, twistTruth: null, savedAt: iso };
  const note = r.truth?.note;
  return {
    ...r,
    truth: { label: 'unknown', labeledAt: iso, flag, ...(note ? { note } : {}) },
    figure: null,
    twistTruth: null,
    savedAt: iso,
  };
}

/** True when the person's whole answers differ from what the classifier named (a classifier that named nothing differs). */
export function disagreesWithGuess(r: JumpRecord, guess: StageAnswers | null): boolean {
  if (reviewStatusOf(r) !== 'done') return false;
  return !guess || !sameAnswers(answersOfRecord(r), guess);
}

// --- label files ---------------------------------------------------------------------------------------------------------

/** The line of a label file for a jump: what the person said, or blanks when nothing was said yet. */
export function labelOfRecord(r: JumpRecord): JumpLabel {
  const status = reviewStatusOf(r);
  const flagged = status === 'cannot-tell' || status === 'bad-segmentation';
  const a = flagged ? EMPTY_ANSWERS : answersOfRecord(r);
  return {
    apexS: r.timestamps.apexS,
    jumpId: r.jumpId,
    somersaults: a.somersaults,
    direction: a.somersaults === 0 ? null : a.direction,
    halfTwists: a.halfTwists,
    position: a.position,
    cannotTell: status === 'cannot-tell',
    badSegmentation: status === 'bad-segmentation',
    note: r.truth?.note ?? '',
  };
}

/** A label file (`trampovision.jump-labels` v1, the one `make eval` reads) with a line for each jump of one video, in time order. */
export function labelFileOfRecords(records: readonly JumpRecord[], videoId: string, fileName?: string): LabelFile {
  const jumps = records
    .filter((r) => r.videoId === videoId)
    .sort((a, b) => a.timestamps.apexS - b.timestamps.apexS)
    .map(labelOfRecord);
  return { schema: LABEL_SCHEMA, version: LABEL_VERSION, videoId, ...(fileName ? { fileName } : {}), jumps };
}

export const labelFileText = (file: LabelFile): string => `${JSON.stringify(file, null, 1)}\n`;

export interface AppliedLabelFile {
  /** The records with the labels put on them: only the ones that changed. */
  records: JumpRecord[];
  matched: number;
  /** Labels whose apex found no jump of this video. */
  unmatched: JumpLabel[];
  /** Matched lines with nothing said: the label already on the jump stays. */
  blank: number;
}

/**
 * Puts the lines of a label file on the jumps of a video, each on the jump whose apex is the closest (within `APEX_TOLERANCE_S`;
 * a jump takes one line). A line with nothing in it leaves the jump as it is.
 */
export function applyLabelFile(file: LabelFile, records: readonly JumpRecord[], now = new Date()): AppliedLabelFile {
  const taken = new Set<string>();
  const changed: JumpRecord[] = [];
  const unmatched: JumpLabel[] = [];
  let blank = 0;
  for (const label of file.jumps) {
    let best: JumpRecord | undefined;
    let bestDistance = APEX_TOLERANCE_S;
    for (const r of records) {
      if (taken.has(r.id)) continue;
      const d = Math.abs(r.timestamps.apexS - label.apexS);
      if (d <= bestDistance) {
        best = r;
        bestDistance = d;
      }
    }
    if (!best) {
      unmatched.push(label);
      continue;
    }
    taken.add(best.id);
    let next: JumpRecord | null = null;
    if (label.badSegmentation) next = withReviewFlag(best, 'bad-segmentation', now);
    else if (label.cannotTell) next = withReviewFlag(best, 'cannot-tell', now);
    else if (hasStageLabel(label))
      next = withStageAnswers(
        best,
        {
          somersaults: label.somersaults,
          direction: label.direction,
          halfTwists: label.halfTwists,
          position: label.position,
        },
        now,
      );
    else blank++;
    if (next && label.note && next.truth) next = { ...next, truth: { ...next.truth, note: label.note } };
    if (next) changed.push(next);
  }
  return { records: changed, matched: taken.size, unmatched, blank };
}

/** The note on a labelled jump (an empty text removes it). A jump without a label has nowhere to keep one. */
export function withNote(r: JumpRecord, note: string, now = new Date()): JumpRecord {
  if (!r.truth) return r;
  const { note: _old, ...rest } = r.truth;
  const text = note.trim();
  return { ...r, truth: text ? { ...rest, note: text } : rest, savedAt: now.toISOString() };
}
