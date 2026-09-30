import { lazyText } from '../i18n/core';
import type { SkillId } from '../skills/types';
import { CLASS_LABELS, TRUTH_LABELS, type ClassLabel, type JumpRecord, type TruthLabel } from './types';

/** The classifier's answer in the label space of the annotator, plus two ways of not answering. */
export const PREDICTED_COLUMNS = [...CLASS_LABELS, 'somersault', 'none'] as const;
export type PredictedClass = (typeof PREDICTED_COLUMNS)[number];
/** What each answer is called, in the language in use. */
export const PREDICTED_TEXT: Record<PredictedClass, string> = lazyText({
  straight: 'pos.straight',
  tuck: 'pos.tuck',
  pike: 'pos.pike',
  back: 'truth.back',
  front: 'truth.front',
  somersault: 'pred.somersault',
  none: 'tier.none',
});

export function predictedClass(skill: SkillId): PredictedClass {
  switch (skill) {
    case 'straight-jump':
      return 'straight';
    case 'tuck-jump':
      return 'tuck';
    case 'pike-jump':
      return 'pike';
    case 'back':
      return 'back';
    case 'front':
      return 'front';
    case 'somersault-direction-unknown':
      return 'somersault';
    default:
      return 'none';
  }
}

/** The classifier answered with one of the five skills. */
export const isAnswer = (p: PredictedClass): p is ClassLabel => p !== 'none' && p !== 'somersault';

/** Truth and prediction agree. "Unknown" agrees with "Not classified": both say the jump cannot be told. */
export const agrees = (truth: TruthLabel, predicted: PredictedClass): boolean =>
  truth === 'unknown' ? predicted === 'none' : truth === predicted;

export const labelOf = (r: JumpRecord): TruthLabel | null => r.truth?.label ?? null;
export const predictionOf = (r: JumpRecord): PredictedClass => predictedClass(r.prediction.skill);

/** Wilson score interval: honest about small samples (unlike "3 of 3 = 100%"). */
export function wilson(successes: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export interface ClassStats {
  label: ClassLabel;
  /** Jumps whose true label is this class. */
  support: number;
  /** Jumps the classifier called this class (among all jumps with a known label). */
  predicted: number;
  /** Called this class and truly this class. */
  correct: number;
  /** correct / predicted; null when it never predicted the class. */
  precision: number | null;
  /** correct / support (the class's own accuracy); null when there is no example. */
  recall: number | null;
  /** One-vs-rest accuracy: how often "is it this class?" was answered right, over all labeled jumps with a known class. */
  accuracyOneVsRest: number | null;
  recallCi95: { lo: number; hi: number } | null;
}

export interface Metrics {
  counts: {
    /** All records in scope. */
    records: number;
    /** With any label. */
    labeled: number;
    /** With one of the five classes: the jumps the accuracy is computed on. */
    known: number;
    /** Labeled "Unknown". Shown in the matrix, not in accuracy, precision or recall. */
    unknown: number;
    unlabeled: number;
  };
  overall: {
    n: number;
    correct: number;
    /** correct / n. Not classified and undetermined somersaults count as wrong. */
    accuracy: number | null;
    ci95: { lo: number; hi: number } | null;
    /** Mean of the per-class recall over the classes that have examples: not fooled by unequal class sizes. */
    balancedAccuracy: number | null;
    /** Jumps the classifier answered with one of the five skills. */
    answered: number;
    /** answered / n. */
    coverage: number | null;
    /** Correct / answered. */
    accuracyWhenAnswered: number | null;
    /** Wrong answers given with a confidence at or above `confidentAt`. */
    confidentWrong: number;
    confidentAt: number;
    meanConfidenceCorrect: number | null;
    meanConfidenceWrong: number | null;
  };
  perClass: ClassStats[];
  /** counts[i][j]: jumps of true label rows[i] that were predicted columns[j]. */
  matrix: { rows: readonly TruthLabel[]; columns: readonly PredictedClass[]; counts: number[][] };
  samplesPerClass: Record<TruthLabel, number>;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export function computeMetrics(records: JumpRecord[], options: { confidentAt?: number } = {}): Metrics {
  const confidentAt = options.confidentAt ?? 0.6;
  const rows = TRUTH_LABELS;
  const counts = rows.map(() => PREDICTED_COLUMNS.map(() => 0));
  const samples = Object.fromEntries(TRUTH_LABELS.map((l) => [l, 0])) as Record<TruthLabel, number>;
  let labeled = 0;
  const known: { truth: ClassLabel; pred: PredictedClass; conf: number }[] = [];
  for (const r of records) {
    const truth = labelOf(r);
    if (!truth) continue;
    labeled++;
    samples[truth]++;
    const pred = predictionOf(r);
    counts[rows.indexOf(truth)][PREDICTED_COLUMNS.indexOf(pred)]++;
    if (truth !== 'unknown') known.push({ truth, pred, conf: r.prediction.confidence });
  }

  const n = known.length;
  const correct = known.filter((k) => k.truth === k.pred);
  const wrongAnswers = known.filter((k) => k.truth !== k.pred && isAnswer(k.pred));
  const answered = known.filter((k) => isAnswer(k.pred));

  const perClass = CLASS_LABELS.map<ClassStats>((label) => {
    const support = known.filter((k) => k.truth === label).length;
    const predicted = known.filter((k) => k.pred === label).length;
    const tp = known.filter((k) => k.truth === label && k.pred === label).length;
    const tn = known.filter((k) => k.truth !== label && k.pred !== label).length;
    return {
      label,
      support,
      predicted,
      correct: tp,
      precision: ratio(tp, predicted),
      recall: ratio(tp, support),
      accuracyOneVsRest: ratio(tp + tn, n),
      recallCi95: wilson(tp, support),
    };
  });
  const recalls = perClass.filter((c) => c.recall !== null).map((c) => c.recall as number);

  return {
    counts: {
      records: records.length,
      labeled,
      known: n,
      unknown: samples.unknown,
      unlabeled: records.length - labeled,
    },
    overall: {
      n,
      correct: correct.length,
      accuracy: ratio(correct.length, n),
      ci95: wilson(correct.length, n),
      balancedAccuracy: mean(recalls),
      answered: answered.length,
      coverage: ratio(answered.length, n),
      accuracyWhenAnswered: ratio(answered.filter((k) => k.truth === k.pred).length, answered.length),
      confidentWrong: wrongAnswers.filter((k) => k.conf >= confidentAt).length,
      confidentAt,
      meanConfidenceCorrect: mean(correct.map((k) => k.conf)),
      meanConfidenceWrong: mean(wrongAnswers.map((k) => k.conf)),
    },
    perClass,
    matrix: { rows, columns: PREDICTED_COLUMNS, counts },
    samplesPerClass: samples,
  };
}
