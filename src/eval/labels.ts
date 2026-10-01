import { referencesFromRecords } from '../dataset/references';
import type { JumpRecord } from '../dataset/types';
import { mergeSkillConfig } from '../skills/config';
import { movementToElement, type Direction } from '../skills/fig/elements';
import type { KnownPosition } from '../skills/types';
import { classifyRecord, type LabelledJump, type RunOptions } from './replay';

/**
 * Ground truth on real jumps, stage by stage. A person who watches a jump can often say how many somersaults it had and which way
 * without being sure of the twists; a label file lets each of the four questions of the classifier (rotation, direction, twists,
 * position) be answered, or left blank, on its own. A jump is matched to its label by video id and apex time.
 */

export const LABEL_SCHEMA = 'trampovision.jump-labels';
export const LABEL_VERSION = 1;
/** A label belongs to the jump of its video whose apex is this close (seconds); the same tolerance the dataset uses to keep ids. */
export const APEX_TOLERANCE_S = 0.2;

const DIRECTIONS: readonly Direction[] = ['front', 'back'];
const POSITIONS: readonly KnownPosition[] = ['straight', 'tuck', 'pike'];

/** The movement as a person counted it. null = not said. */
export interface StageLabel {
  /** Somersaults, quarters allowed (0, 0.25, 0.75, 1, 2, ...). */
  somersaults: number | null;
  /** Only meaningful when the body somersaults. */
  direction: Direction | null;
  /** Half twists (0, 1, 2, ...). */
  halfTwists: number | null;
  position: KnownPosition | null;
}

export interface JumpLabel extends StageLabel {
  /** Apex time in the video, seconds: how the label finds its jump. */
  apexS: number;
  /** Number of the jump when the sheet was made; for the human, not used to match. */
  jumpId?: number;
  /** The person cannot tell what it was. */
  cannotTell: boolean;
  /** The jump was cut at the wrong place (not one flight, two jumps in one, a camera cut). */
  badSegmentation: boolean;
  note?: string;
}

export interface LabelFile {
  schema: typeof LABEL_SCHEMA;
  version: typeof LABEL_VERSION;
  videoId: string;
  fileName?: string;
  jumps: JumpLabel[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const hasStageLabel = (l: StageLabel): boolean =>
  l.somersaults !== null || l.direction !== null || l.halfTwists !== null || l.position !== null;

/** An empty label for a jump: everything blank, to be filled in by hand. */
export function blankLabel(apexS: number, jumpId?: number): JumpLabel {
  return {
    apexS,
    ...(jumpId === undefined ? {} : { jumpId }),
    somersaults: null,
    direction: null,
    halfTwists: null,
    position: null,
    cannotTell: false,
    badSegmentation: false,
    note: '',
  };
}

export function blankLabelFile(
  videoId: string,
  fileName: string | undefined,
  jumps: { apexS: number; jumpId?: number }[],
): LabelFile {
  return {
    schema: LABEL_SCHEMA,
    version: LABEL_VERSION,
    videoId,
    ...(fileName ? { fileName } : {}),
    jumps: jumps.map((j) => blankLabel(j.apexS, j.jumpId)),
  };
}

/** Reads and checks a label file; every problem is named with the jump it is in. Blank fields (null or absent) mean "not said". */
export function parseLabelFile(text: string): LabelFile {
  const raw: unknown = JSON.parse(text);
  if (!isObj(raw) || raw.schema !== LABEL_SCHEMA) throw new Error(`Not a ${LABEL_SCHEMA} file.`);
  if (raw.version !== LABEL_VERSION) throw new Error(`Unknown label file version ${String(raw.version)}.`);
  if (typeof raw.videoId !== 'string' || !raw.videoId) throw new Error('The label file has no videoId.');
  if (!Array.isArray(raw.jumps)) throw new Error('The label file has no jumps list.');
  const jumps = raw.jumps.map((item: unknown, k): JumpLabel => {
    const where = `jump ${k + 1}`;
    if (!isObj(item)) throw new Error(`${where}: not an object.`);
    const apexS = item.apexS;
    if (typeof apexS !== 'number' || !Number.isFinite(apexS)) throw new Error(`${where}: apexS must be a number.`);
    const num = (key: string, ok: (v: number) => boolean, what: string): number | null => {
      const v = item[key];
      if (v === null || v === undefined || v === '') return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || !ok(v)) throw new Error(`${where}: ${key} must be ${what}.`);
      return v;
    };
    const word = <T extends string>(key: string, allowed: readonly T[]): T | null => {
      const v = item[key];
      if (v === null || v === undefined || v === '') return null;
      if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
        throw new Error(`${where}: ${key} must be one of ${allowed.join(', ')}.`);
      return v as T;
    };
    const flag = (key: string) => {
      const v = item[key];
      if (v === undefined || v === null) return false;
      if (typeof v !== 'boolean') throw new Error(`${where}: ${key} must be true or false.`);
      return v;
    };
    return {
      apexS,
      ...(typeof item.jumpId === 'number' ? { jumpId: item.jumpId } : {}),
      somersaults: num(
        'somersaults',
        (v) => v >= 0 && Number.isInteger(v * 4),
        'a multiple of 0.25 (0, 0.75, 1, 2, ...)',
      ),
      direction: word('direction', DIRECTIONS),
      halfTwists: num('halfTwists', (v) => v >= 0 && Number.isInteger(v), 'a whole number of half twists'),
      position: word('position', POSITIONS),
      cannotTell: flag('cannotTell'),
      badSegmentation: flag('badSegmentation'),
      ...(typeof item.note === 'string' && item.note ? { note: item.note } : {}),
    };
  });
  return {
    schema: LABEL_SCHEMA,
    version: LABEL_VERSION,
    videoId: raw.videoId,
    ...(typeof raw.fileName === 'string' ? { fileName: raw.fileName } : {}),
    jumps,
  };
}

/** The element of the table a complete label names, or null when it is incomplete, has quarter rotations, or is not in the table. */
export function elementOfLabel(l: StageLabel): string | null {
  if (l.somersaults === null || !Number.isInteger(l.somersaults) || l.halfTwists === null || l.position === null)
    return null;
  if (l.somersaults > 0 && l.direction === null) return null;
  const e = movementToElement({
    direction: l.somersaults === 0 ? null : l.direction,
    somersaults: l.somersaults,
    twists: l.halfTwists / 2,
    position: l.position,
  });
  return e?.id ?? null;
}

export interface AppliedLabels {
  jumps: LabelledJump[];
  /** Labels that found a jump, labels that found none (the video was analyzed differently, or the id is not that of this dataset). */
  matched: number;
  unmatched: { videoId: string; label: JumpLabel }[];
  /** Labels with nothing filled in. */
  blank: number;
}

/**
 * Puts the labels on the jumps. A label takes the jump of its video with the nearest apex (within `APEX_TOLERANCE_S`); a jump
 * takes one label. A complete label gives the element as the truth (so the figure-level scores and the examples see it), a partial one
 * only the stage labels. "Cannot tell" and "bad segmentation" mark the jump so it is counted and not scored.
 */
export function applyLabels(jumps: readonly LabelledJump[], files: readonly LabelFile[]): AppliedLabels {
  const entries = files.flatMap((f) => f.jumps.map((label) => ({ videoId: f.videoId, label })));
  const claimed = new Map<number, { index: number; distance: number }>();
  entries.forEach((e, index) => {
    let best = -1;
    let bestDistance = Infinity;
    jumps.forEach((j, k) => {
      if (j.videoId !== e.videoId) return;
      const distance = Math.abs(j.record.timestamps.apexS - e.label.apexS);
      if (distance <= APEX_TOLERANCE_S && distance < bestDistance) {
        best = k;
        bestDistance = distance;
      }
    });
    if (best < 0) return;
    const have = claimed.get(best);
    if (!have || bestDistance < have.distance) claimed.set(best, { index, distance: bestDistance });
  });
  const used = new Set([...claimed.values()].map((c) => c.index));

  let blank = 0;
  const out = jumps.map((j, k): LabelledJump => {
    const hit = claimed.get(k);
    if (!hit) return j;
    const l = entries[hit.index].label;
    if (l.badSegmentation) return { ...j, truth: null, source: 'bad-data', stages: undefined };
    if (l.cannotTell) return { ...j, truth: null, source: 'unknown', stages: undefined };
    if (!hasStageLabel(l)) {
      blank++;
      return j;
    }
    const element = elementOfLabel(l);
    const stages: StageLabel = {
      somersaults: l.somersaults,
      direction: l.direction,
      halfTwists: l.halfTwists,
      position: l.position,
    };
    return element ? { ...j, truth: element, source: 'local', stages } : { ...j, stages };
  });
  return {
    jumps: out,
    matched: claimed.size,
    unmatched: entries.flatMap((e, index) => (used.has(index) ? [] : [{ videoId: e.videoId, label: e.label }])),
    blank,
  };
}

// --- scoring one stage at a time ---------------------------------------------------------------------------------------

export type StageName = 'rotation' | 'direction' | 'twist' | 'position';
export const STAGE_NAMES: readonly StageName[] = ['rotation', 'direction', 'twist', 'position'];

export interface StageScore {
  /** Jumps with a label for this stage (for rotation: a whole number of somersaults). */
  n: number;
  correct: number;
  /** The classifier gave no answer for it (counted as wrong). */
  unanswered: number;
  accuracy: number | null;
}

export interface StageOutcome {
  id: string;
  videoId: string;
  /** Per stage: what was labelled, what the classifier said, and whether they agree. Absent when the stage was not labelled. */
  stages: Partial<Record<StageName, { label: string | number; predicted: string | number | null; ok: boolean }>>;
  /** Measured net rotation in turns (absolute) next to the labelled somersaults, when both exist. */
  measuredTurns: number | null;
  labelledTurns: number | null;
}

export interface StageReport {
  /** Jumps scored on at least one stage. */
  n: number;
  skipped: { unlabelled: number; unknown: number; badData: number };
  stages: Record<StageName, StageScore>;
  /** The direction was an assumption (the facing could not be told): how many of the scored directions. */
  directionAssumed: number;
  /** Labelled with a quarter or half rotation, which no element of the table has: scored by the measurement only. */
  rotationOffGrid: number;
  /** Measured net rotation minus labelled somersaults, over every jump with both (turns). Negative = read short. */
  rotationError: { n: number; meanAbs: number | null; bias: number | null };
  outcomes: StageOutcome[];
}

const ratio = (c: number, n: number) => (n ? c / n : null);

/**
 * Scores each question of the classifier on its own against the stage labels: a jump with only the somersault count labelled counts
 * for rotation and for nothing else. The movement the classifier named is what is compared (the closest element when it was not sure).
 */
export function runStageEval(jumps: readonly LabelledJump[], options: RunOptions): StageReport {
  const config = options.config ?? mergeSkillConfig();
  const skipped = { unlabelled: 0, unknown: 0, badData: 0 };
  const scored: (LabelledJump & { stages: StageLabel })[] = [];
  for (const j of jumps) {
    if (j.stages && hasStageLabel(j.stages)) scored.push({ ...j, stages: j.stages });
    else if (j.source === 'unknown') skipped.unknown++;
    else if (j.source === 'bad-data') skipped.badData++;
    else skipped.unlabelled++;
  }
  const examples =
    options.references === 'leave-one-video-out'
      ? referencesFromRecords(
          jumps.flatMap((j) =>
            j.truth ? [{ ...j.record, figure: { elementId: j.truth, labeledAt: '' } } as JumpRecord] : [],
          ),
        )
      : [];

  const tally = Object.fromEntries(STAGE_NAMES.map((s) => [s, { n: 0, correct: 0, unanswered: 0 }])) as Record<
    StageName,
    { n: number; correct: number; unanswered: number }
  >;
  let directionAssumed = 0;
  let rotationOffGrid = 0;
  const errors: number[] = [];

  const outcomes = scored.map<StageOutcome>((j) => {
    const refs = examples.filter((e) => e.source?.videoId !== j.videoId);
    const p = classifyRecord(j.record, config, refs, options.classifier);
    const m = p.movement;
    const l = j.stages;
    const o: StageOutcome['stages'] = {};
    const score = (stage: StageName, label: string | number, predicted: string | number | null) => {
      const ok = predicted !== null && predicted === label;
      tally[stage].n++;
      if (ok) tally[stage].correct++;
      if (predicted === null) tally[stage].unanswered++;
      o[stage] = { label, predicted, ok };
    };

    if (l.somersaults !== null) {
      if (Number.isInteger(l.somersaults)) score('rotation', l.somersaults, m ? m.somersaults : null);
      else rotationOffGrid++;
    }
    // The direction of a body that does not somersault is not a question.
    if (l.direction !== null && l.somersaults !== 0) {
      score('direction', l.direction, m && m.somersaults > 0 ? m.direction : null);
      if (p.guess?.direction) directionAssumed++;
    }
    if (l.halfTwists !== null) score('twist', l.halfTwists, m ? Math.round(m.twists * 2) : null);
    if (l.position !== null) score('position', l.position, m ? m.position : null);

    const turns = j.record.features.rotation.turns;
    const measuredTurns = turns === null ? null : Math.abs(turns);
    if (measuredTurns !== null && l.somersaults !== null) errors.push(measuredTurns - l.somersaults);
    return {
      id: j.id,
      videoId: j.videoId,
      stages: o,
      measuredTurns,
      labelledTurns: l.somersaults,
    };
  });

  const stages = Object.fromEntries(
    STAGE_NAMES.map((s) => [s, { ...tally[s], accuracy: ratio(tally[s].correct, tally[s].n) }]),
  ) as Record<StageName, StageScore>;
  return {
    n: scored.length,
    skipped,
    stages,
    directionAssumed,
    rotationOffGrid,
    rotationError: {
      n: errors.length,
      meanAbs: errors.length ? errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length : null,
      bias: errors.length ? errors.reduce((s, e) => s + e, 0) / errors.length : null,
    },
    outcomes,
  };
}

const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)}%`);

export function formatStageReport(title: string, r: StageReport): string {
  const out = [`== ${title} ==`];
  out.push(
    `${r.n} jumps with stage labels (skipped: ${r.skipped.unlabelled} without, ${r.skipped.unknown} cannot tell, ${r.skipped.badData} bad segmentation)`,
  );
  if (r.n === 0) return out.join('\n');
  const names: Record<StageName, string> = {
    rotation: 'rotation (somersaults)',
    direction: 'direction',
    twist: 'twists (half twists)',
    position: 'position',
  };
  for (const s of STAGE_NAMES) {
    const v = r.stages[s];
    const extra =
      s === 'direction' && v.n
        ? `, ${r.directionAssumed} assumed from the likelier`
        : s === 'rotation' && r.rotationOffGrid
          ? `, ${r.rotationOffGrid} quarter/half rotations not scored`
          : '';
    out.push(
      `  ${names[s].padEnd(24)} ${String(v.correct).padStart(3)}/${String(v.n).padEnd(3)} ${pct(v.accuracy).padStart(6)}   no answer ${v.unanswered}${extra}`,
    );
  }
  const e = r.rotationError;
  if (e.n)
    out.push(
      `  measured rotation vs label: mean error ${e.meanAbs?.toFixed(2)} turns, bias ${e.bias! >= 0 ? '+' : ''}${e.bias?.toFixed(2)} (negative = read short), ${e.n} jumps`,
    );
  return out.join('\n');
}
