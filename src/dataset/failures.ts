import { agrees, labelOf, predictionOf, PREDICTED_TEXT, type PredictedClass } from './metrics';
import { TRUTH_TEXT, type JumpRecord, type TruthLabel } from './types';

/** ok = agrees with what the label needs; off = does not (this is a candidate cause); unknown = the data has no value. */
export type CheckStatus = 'ok' | 'off' | 'unknown';

export interface Check {
  signal: string;
  /** What the person's label requires, in numbers. */
  expected: string;
  /** What was measured. */
  measured: string;
  status: CheckStatus;
}

export interface Failure {
  record: JumpRecord;
  truth: TruthLabel;
  predicted: PredictedClass;
  confidence: number;
  /** Confidence below 60%: shown like every other failure, only marked. */
  lowConfidence: boolean;
  checks: Check[];
}

const deg = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${v.toFixed(d)}°`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The label turned into measurable requirements (using the thresholds the prediction was made with), each compared with the
 * measurement stored in the record. It does not say which is right, the label or the measurement: it shows where they differ.
 */
export function checksFor(record: JumpRecord, truth: TruthLabel = record.truth?.label ?? 'unknown'): Check[] {
  const f = record.features;
  const cfg = record.analysis.config;
  const P = cfg.position;
  const checks: Check[] = [];
  const rot = f.rotation;
  if (truth === 'unknown') {
    // Nothing can be required of a jump you could not name, except that the classifier should not have claimed to know.
    const p = predictionOf(record);
    if (p !== 'none') {
      checks.push({
        signal: 'Classifier answer',
        expected: 'no answer (you could not tell what it was)',
        measured: `${PREDICTED_TEXT[p]} at ${pct(record.prediction.confidence)}`,
        status: 'off',
      });
    }
  }
  const somersault = truth === 'back' || truth === 'front';
  const flat = truth === 'straight' || truth === 'tuck' || truth === 'pike';

  if (flat || somersault) {
    const want = somersault ? 360 : 0;
    checks.push({
      signal: 'Rotation',
      expected: somersault ? 'one somersault, about 360°' : 'no somersault, about 0°',
      measured: rot.totalDeg === null ? 'not measured' : `${deg(rot.totalDeg)} (nearest ${deg(rot.nearestDeg)}), confidence ${pct(rot.confidence)}`,
      status: rot.nearestDeg === null ? 'unknown' : rot.nearestDeg === want ? 'ok' : 'off',
    });
  }

  if (flat) {
    const need = {
      straight: `hip at least ${P.hipOpenMinDeg}° and knees at least ${P.kneeStraightMinDeg}°`,
      tuck: `hip at most ${P.hipFoldedMaxDeg}° and knees at most ${P.kneeBentMaxDeg}°`,
      pike: `hip at most ${P.hipFoldedMaxDeg}° and knees at least ${P.kneeStraightMinDeg}°`,
    }[truth];
    const hip = f.shape.hipAngle.atPeak;
    const knee = f.shape.kneeAngle.atPeak;
    checks.push({
      signal: 'Body position',
      expected: `${TRUTH_TEXT[truth].toLowerCase()}: ${need}`,
      measured: hip === null ? 'not measured' : `${f.position.label} (hip ${deg(hip)}, knee ${deg(knee)} at the most closed moment)`,
      status: hip === null ? 'unknown' : f.position.label === truth ? 'ok' : 'off',
    });
  }

  if (somersault) {
    const dir = rot.direction;
    const facing = f.facing.sign;
    let measured = 'not determined';
    let status: CheckStatus = 'unknown';
    if (dir !== 'none' && facing !== 0) {
      const front = (dir === 'clockwise' ? 1 : -1) * facing > 0;
      measured = `${dir}, facing ${facing > 0 ? 'right' : 'left'}: ${front ? 'front' : 'back'}`;
      status = (front ? 'front' : 'back') === truth ? 'ok' : 'off';
    } else if (dir === 'none') measured = 'no rotation direction';
    else measured = `${dir}, facing undetermined`;
    checks.push({ signal: 'Somersault direction', expected: `${TRUTH_TEXT[truth].toLowerCase()}: turning ${truth === 'front' ? 'toward' : 'away from'} the face`, measured, status });
    checks.push({
      signal: 'Facing',
      expected: `sure enough (at least ${pct(cfg.facing.minConfidence)})`,
      measured: f.facing.sign === 0 ? `undetermined (${pct(f.facing.confidence)})` : `${f.facing.sign > 0 ? 'right' : 'left'} (${pct(f.facing.confidence)}, ${f.facing.source})`,
      status: f.facing.sign !== 0 && f.facing.confidence >= cfg.facing.minConfidence ? 'ok' : 'off',
    });
    if (f.facing.twistSuspected) {
      checks.push({ signal: 'Facing before and after', expected: 'the same side', measured: 'the athlete seems to face the other way after landing (a twist?)', status: 'off' });
    }
  }

  if (flat || somersault) {
    checks.push({ signal: 'Rotation confidence', expected: 'at least 50%', measured: pct(rot.confidence), status: rot.totalDeg === null ? 'unknown' : rot.confidence >= 0.5 ? 'ok' : 'off' });
  }
  checks.push({ signal: 'Pose quality in the flight', expected: 'at least 60%', measured: pct(f.quality.pose), status: f.quality.pose >= 0.6 ? 'ok' : 'off' });
  const tv = f.quality.trunkLengthVariation;
  checks.push({
    signal: 'Camera view',
    expected: `trunk length varies less than ${pct(cfg.maxTrunkVariation)} (side-on)`,
    measured: tv === null ? 'not measured' : `varies by ${pct(tv)}`,
    status: tv === null ? 'unknown' : tv <= cfg.maxTrunkVariation ? 'ok' : 'off',
  });
  return checks;
}

/** Labeled jumps whose prediction differs from the label, the confident wrong answers first. Nothing is filtered by confidence. */
export function findFailures(records: JumpRecord[]): Failure[] {
  const out: Failure[] = [];
  for (const record of records) {
    const truth = labelOf(record);
    if (!truth) continue;
    const predicted = predictionOf(record);
    if (agrees(truth, predicted)) continue;
    out.push({
      record,
      truth,
      predicted,
      confidence: record.prediction.confidence,
      lowConfidence: record.prediction.confidence < 0.6,
      checks: checksFor(record, truth),
    });
  }
  // Wrong answers before non-answers, then by confidence, high first: the most misleading failures lead.
  const answered = (f: Failure) => (f.predicted === 'none' || f.predicted === 'somersault' ? 1 : 0);
  return out.sort((a, b) => answered(a) - answered(b) || b.confidence - a.confidence);
}

export const describeFailure = (f: Failure): string => `Labeled ${TRUTH_TEXT[f.truth]}, predicted ${PREDICTED_TEXT[f.predicted]} at ${pct(f.confidence)}`;
