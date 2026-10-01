import { parseDataset } from '../dataset/export';
import { referencesFromRecords } from '../dataset/references';
import type { JumpRecord } from '../dataset/types';
import { mergeSkillConfig, type SkillConfig } from '../skills/config';
import { elementById } from '../skills/fig/elements';
import type { ClassifierInput, SkillClassifier, SkillPrediction } from '../skills/types';
import { temporalClassifier } from '../skills/temporal/classifier';
import type { Reference } from '../skills/temporal/prototypes';

/**
 * Offline evaluation on real jumps. A record holds everything the classifier reads (features, sequence, twist curve), so the current
 * code can be run again on jumps analyzed weeks ago, without any video, and scored against what the reviewers said they were.
 */

/** Where the truth of a jump came from. `auto` and the two "no figure" verdicts have none. */
export type TruthSource = 'confirmed' | 'corrected' | 'local' | 'unknown' | 'bad-data' | 'auto';

export interface LabelledJump {
  id: string;
  videoId: string;
  record: JumpRecord;
  /** The element id the jump really was, or null when nobody said (or nobody could). */
  truth: string | null;
  source: TruthSource;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The review service's `/export` (one JSON row per line) or a dataset file saved by the app. */
export function parseLabelled(text: string): LabelledJump[] {
  const first = text.trimStart().split('\n', 1)[0];
  let head: unknown;
  try {
    head = JSON.parse(first);
  } catch {
    head = null;
  }
  if (isObj(head) && isObj(head.record)) {
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((line, k) => {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (!isObj(row.record)) throw new Error(`Line ${k + 1} has no record.`);
        const record = row.record as unknown as JumpRecord;
        const source = String(row.status ?? 'auto') as TruthSource;
        const figure = typeof row.review_element_id === 'string' ? row.review_element_id : null;
        const labelled = source === 'confirmed' || source === 'corrected';
        return {
          id: record.id,
          videoId: record.videoId,
          record,
          truth: labelled && figure && elementById(figure) ? figure : null,
          source,
        };
      });
  }
  return parseDataset(text).map((record) => {
    const figure = record.figure?.elementId ?? null;
    const known = figure !== null && elementById(figure) !== undefined;
    return {
      id: record.id,
      videoId: record.videoId,
      record,
      truth: known ? figure : null,
      source: known ? 'local' : 'auto',
    };
  });
}

/** What the classifier is given for a stored jump. It never reads the cycle, so the timestamps are all that is kept of it. */
export function inputOfRecord(r: JumpRecord, config: SkillConfig, references: readonly Reference[]): ClassifierInput {
  const curve = r.twist?.sequence?.data.map((row) => row[1]) ?? null;
  return {
    cycle: {
      takeoffTimeS: r.timestamps.takeoffS,
      apexTimeS: r.timestamps.apexS,
      landingTimeS: r.timestamps.landingS,
      flightTimeS: r.timestamps.flightTimeS,
    } as never,
    features: r.features,
    sequence: r.sequence,
    twist: r.twist ? { estimate: r.twist.estimate, trajectory: curve } : null,
    config,
    references: [...references],
  };
}

export function classifyRecord(
  r: JumpRecord,
  config: SkillConfig,
  references: readonly Reference[],
  classifier: SkillClassifier = temporalClassifier,
): SkillPrediction {
  return classifier.classify(inputOfRecord(r, config, references));
}

export type Cause = 'rotation' | 'twist' | 'direction' | 'position' | 'several' | 'unclassified';

/** Which part of the movement the classifier got wrong: the number of somersaults, the twists, the direction, or the position. */
export function causeOf(truthId: string, p: SkillPrediction): Cause {
  if (p.skill === 'unclassified') return 'unclassified';
  const t = elementById(truthId);
  if (!t) return 'several';
  if (p.skill === 'somersault-direction-unknown') return 'direction';
  const m = p.movement;
  if (!m) return 'several';
  const wrong: Cause[] = [];
  if (m.somersaults !== t.somersaults) wrong.push('rotation');
  if (m.twists !== t.twists) wrong.push('twist');
  if (t.somersaults > 0 && m.somersaults > 0 && m.direction !== t.direction) wrong.push('direction');
  if (m.position !== t.position) wrong.push('position');
  return wrong.length === 1 ? wrong[0] : 'several';
}

export interface Outcome {
  id: string;
  videoId: string;
  truth: string;
  predicted: string | null;
  skill: string;
  certainty: string | null;
  confidence: number;
  /** 1-based rank of the truth among the five candidates, or null when it is not there. */
  rank: number | null;
  correct: boolean;
  cause: Cause | null;
  failureKind: string | null;
  /** The closest reference of the answer was a reviewed jump, not the expected movement of the table. */
  usedExample: boolean;
}

export interface ElementStats {
  elementId: string;
  name: string;
  support: number;
  correct: number;
  top5: number;
}

export interface Bin {
  from: number;
  to: number;
  n: number;
  correct: number;
}

export interface Report {
  /** Jumps with a figure the reviewers gave. */
  n: number;
  skipped: { unlabelled: number; unknown: number; badData: number };
  answered: number;
  unclassified: number;
  correct: number;
  top1: number;
  /** Accuracy on the jumps the classifier named. */
  answeredAccuracy: number | null;
  top3: number;
  top5: number;
  /** Mean of the per-element accuracies: not dominated by the common figures. */
  balanced: number | null;
  /** Wrong although the classifier said "confident". */
  confidentWrong: number;
  firmWrong: number;
  perElement: ElementStats[];
  confusions: { truth: string; predicted: string; n: number }[];
  causes: Record<Cause, number>;
  failureKinds: Record<string, number>;
  calibration: Bin[];
  outcomes: Outcome[];
}

export interface RunOptions {
  /** `none`: only the expected movements of the table. `leave-one-video-out`: also the reviewed jumps of every OTHER video. */
  references: 'none' | 'leave-one-video-out';
  config?: SkillConfig;
  classifier?: SkillClassifier;
}

const BINS: [number, number][] = [
  [0, 0.3],
  [0.3, 0.6],
  [0.6, 0.8],
  [0.8, 1.0001],
];

export function runEval(jumps: readonly LabelledJump[], options: RunOptions): Report {
  const config = options.config ?? mergeSkillConfig();
  const skipped = { unlabelled: 0, unknown: 0, badData: 0 };
  const labelled: (LabelledJump & { truth: string })[] = [];
  for (const j of jumps) {
    if (j.truth) labelled.push({ ...j, truth: j.truth });
    else if (j.source === 'unknown') skipped.unknown++;
    else if (j.source === 'bad-data') skipped.badData++;
    else skipped.unlabelled++;
  }
  // Every labelled jump is a candidate example; a jump never sees the examples of its own video.
  const examples =
    options.references === 'leave-one-video-out'
      ? referencesFromRecords(labelled.map((j) => ({ ...j.record, figure: { elementId: j.truth, labeledAt: '' } })))
      : [];

  const outcomes = labelled.map<Outcome>((j) => {
    const refs = examples.filter((e) => e.source?.videoId !== j.videoId);
    const p = classifyRecord(j.record, config, refs, options.classifier);
    const rank = (p.candidates ?? []).slice(0, 5).findIndex((c) => c.elementId === j.truth);
    const named = p.skill !== 'unclassified';
    const correct = named && p.elementId === j.truth;
    return {
      id: j.id,
      videoId: j.videoId,
      truth: j.truth,
      predicted: p.elementId ?? null,
      skill: p.skill,
      certainty: p.certainty ?? null,
      confidence: p.confidence,
      rank: rank < 0 ? null : rank + 1,
      correct,
      cause: correct ? null : causeOf(j.truth, p),
      failureKind: p.failure?.kind ?? null,
      usedExample: p.comparison?.referenceKind === 'example',
    };
  });

  const byElement = new Map<string, ElementStats>();
  for (const o of outcomes) {
    const s = byElement.get(o.truth) ?? {
      elementId: o.truth,
      name: elementById(o.truth)?.name ?? o.truth,
      support: 0,
      correct: 0,
      top5: 0,
    };
    s.support++;
    if (o.correct) s.correct++;
    if (o.rank !== null) s.top5++;
    byElement.set(o.truth, s);
  }
  const perElement = [...byElement.values()].sort((a, b) => b.support - a.support);

  const pairs = new Map<string, number>();
  const causes: Record<Cause, number> = {
    rotation: 0,
    twist: 0,
    direction: 0,
    position: 0,
    several: 0,
    unclassified: 0,
  };
  const failureKinds: Record<string, number> = {};
  for (const o of outcomes) {
    if (o.correct) continue;
    causes[o.cause ?? 'several']++;
    if (o.failureKind) failureKinds[o.failureKind] = (failureKinds[o.failureKind] ?? 0) + 1;
    if (o.predicted) {
      const key = `${o.truth}\t${o.predicted}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  const confusions = [...pairs]
    .map(([k, n]) => ({ truth: k.split('\t')[0], predicted: k.split('\t')[1], n }))
    .sort((a, b) => b.n - a.n);

  const n = outcomes.length;
  const named = outcomes.filter((o) => o.skill !== 'unclassified');
  const correct = outcomes.filter((o) => o.correct).length;
  const within = (k: number) => outcomes.filter((o) => o.rank !== null && o.rank <= k).length;
  const namedOnes = named.filter((o) => o.predicted !== null);
  return {
    n,
    skipped,
    answered: named.length,
    unclassified: n - named.length,
    correct,
    top1: n ? correct / n : 0,
    answeredAccuracy: named.length ? named.filter((o) => o.correct).length / named.length : null,
    top3: n ? within(3) / n : 0,
    top5: n ? within(5) / n : 0,
    balanced: perElement.length ? perElement.reduce((s, e) => s + e.correct / e.support, 0) / perElement.length : null,
    confidentWrong: outcomes.filter((o) => o.certainty === 'confident' && !o.correct).length,
    firmWrong: outcomes.filter((o) => (o.certainty === 'confident' || o.certainty === 'probable') && !o.correct).length,
    perElement,
    confusions,
    causes,
    failureKinds,
    calibration: BINS.map(([from, to]) => {
      const inBin = namedOnes.filter((o) => o.confidence >= from && o.confidence < to);
      return { from, to: Math.min(to, 1), n: inBin.length, correct: inBin.filter((o) => o.correct).length };
    }),
    outcomes,
  };
}

const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)}%`);

export function formatReport(title: string, r: Report): string {
  const out: string[] = [`== ${title} ==`];
  out.push(
    `${r.n} reviewed jumps (skipped: ${r.skipped.unlabelled} not reviewed, ${r.skipped.unknown} cannot tell, ${r.skipped.badData} bad data)`,
  );
  if (r.n === 0) return out.join('\n');
  out.push(
    `top-1 ${pct(r.top1)} (${r.correct}/${r.n})   named ${r.answered}, unclassified ${r.unclassified}   accuracy when named ${pct(r.answeredAccuracy)}`,
    `top-3 ${pct(r.top3)}   top-5 ${pct(r.top5)}   balanced over elements ${pct(r.balanced)}`,
    `confident-wrong ${r.confidentWrong}   confident-or-probable wrong ${r.firmWrong}`,
  );
  const wrong = Object.entries(r.causes)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  out.push(
    '',
    wrong.length ? 'What went wrong (jumps not named correctly):' : 'Every reviewed jump was named correctly.',
  );
  for (const [c, n] of wrong) out.push(`  ${c.padEnd(13)} ${n}`);
  if (Object.keys(r.failureKinds).length) {
    out.push('Unclassified because:');
    for (const [k, n] of Object.entries(r.failureKinds).sort((a, b) => b[1] - a[1])) out.push(`  ${k.padEnd(24)} ${n}`);
  }
  out.push('', 'Per element:');
  for (const e of r.perElement) {
    out.push(
      `  ${e.name.padEnd(34)} ${String(e.correct).padStart(3)}/${String(e.support).padEnd(3)} ${pct(e.correct / e.support).padStart(6)}   in top 5: ${e.top5}`,
    );
  }
  if (r.confusions.length) {
    out.push('', 'Most common confusions (true → named):');
    for (const c of r.confusions.slice(0, 10)) {
      out.push(
        `  ${String(c.n).padStart(3)}  ${elementById(c.truth)?.name ?? c.truth} → ${elementById(c.predicted)?.name ?? c.predicted}`,
      );
    }
  }
  out.push('', 'Is the confidence honest? (share right among jumps the classifier named)');
  for (const b of r.calibration) {
    out.push(
      `  ${String(Math.round(b.from * 100)).padStart(3)}–${String(Math.round(b.to * 100)).padEnd(3)}%  n=${String(b.n).padEnd(4)} right ${pct(b.n ? b.correct / b.n : null)}`,
    );
  }
  return out.join('\n');
}

/** What a baseline file keeps: enough to tell that a change made things worse. */
export interface Baseline {
  n: number;
  top1: number;
  confidentWrong: number;
  firmWrong: number;
}
export const baselineOf = (r: Report): Baseline => ({
  n: r.n,
  top1: r.top1,
  confidentWrong: r.confidentWrong,
  firmWrong: r.firmWrong,
});

/** The ways a report is worse than its baseline. Empty when it is not. A different jump count makes the comparison meaningless, so it is said. */
export function regressions(r: Report, base: Baseline, tolerance = 0.005): string[] {
  const out: string[] = [];
  if (r.n !== base.n) out.push(`the set changed (${base.n} → ${r.n} jumps): save a new baseline`);
  else {
    if (r.top1 < base.top1 - tolerance) out.push(`top-1 fell from ${pct(base.top1)} to ${pct(r.top1)}`);
    if (r.confidentWrong > base.confidentWrong)
      out.push(`confident-wrong rose from ${base.confidentWrong} to ${r.confidentWrong}`);
    if (r.firmWrong > base.firmWrong)
      out.push(`confident-or-probable wrong rose from ${base.firmWrong} to ${r.firmWrong}`);
  }
  return out;
}
