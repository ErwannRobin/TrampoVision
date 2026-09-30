import { formatNumber, formatPercent, lower, t } from '../i18n/core';
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

const deg = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : `${formatNumber(v, d)}°`;
const pct = (v: number) => formatPercent(v);
const side = (sign: number) => t(sign > 0 ? 'side.right' : 'side.left');

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
        signal: t('rc.classifierAnswer'),
        expected: t('rc.noAnswer'),
        measured: t('rc.answerAt', { predicted: PREDICTED_TEXT[p], conf: pct(record.prediction.confidence) }),
        status: 'off',
      });
    }
  }
  const somersault = truth === 'back' || truth === 'front';
  const flat = truth === 'straight' || truth === 'tuck' || truth === 'pike';

  if (flat || somersault) {
    const want = somersault ? 360 : 0;
    checks.push({
      signal: t('rc.rotation'),
      expected: t(somersault ? 'rc.oneSomersault' : 'rc.noSomersault'),
      measured:
        rot.totalDeg === null
          ? t('rc.notMeasured')
          : t('rc.rotationMeasured', {
              total: deg(rot.totalDeg),
              nearest: deg(rot.nearestDeg),
              conf: pct(rot.confidence),
            }),
      status: rot.nearestDeg === null ? 'unknown' : rot.nearestDeg === want ? 'ok' : 'off',
    });
  }

  if (flat) {
    const need = {
      straight: t('rc.needStraight', { hip: P.hipOpenMinDeg, knee: P.kneeStraightMinDeg }),
      tuck: t('rc.needTuck', { hip: P.hipFoldedMaxDeg, knee: P.kneeBentMaxDeg }),
      pike: t('rc.needPike', { hip: P.hipFoldedMaxDeg, knee: P.kneeStraightMinDeg }),
    }[truth];
    const hip = f.shape.hipAngle.atPeak;
    const knee = f.shape.kneeAngle.atPeak;
    checks.push({
      signal: t('rc.bodyPosition'),
      expected: t('rc.expectedPosition', { truth: lower(TRUTH_TEXT[truth]), need }),
      measured:
        hip === null
          ? t('rc.notMeasured')
          : t('rc.positionMeasured', {
              position: lower(t(`pos.${f.position.label}`)),
              hip: deg(hip),
              knee: deg(knee),
            }),
      status: hip === null ? 'unknown' : f.position.label === truth ? 'ok' : 'off',
    });
  }

  if (somersault) {
    const dir = rot.direction;
    const facing = f.facing.sign;
    let measured = t('rc.notDetermined');
    let status: CheckStatus = 'unknown';
    if (dir !== 'none' && facing !== 0) {
      const front = (dir === 'clockwise' ? 1 : -1) * facing > 0;
      measured = t('rc.directionMeasured', {
        turn: t(`turn.${dir}`),
        side: side(facing),
        kind: t(front ? 'rc.kindFront' : 'rc.kindBack'),
      });
      status = (front ? 'front' : 'back') === truth ? 'ok' : 'off';
    } else if (dir === 'none') measured = t('rc.noDirection');
    else measured = t('rc.facingUndetermined', { turn: t(`turn.${dir}`) });
    checks.push({
      signal: t('rc.direction'),
      expected: t(truth === 'front' ? 'rc.turnToward' : 'rc.turnAway', { truth: lower(TRUTH_TEXT[truth]) }),
      measured,
      status,
    });
    checks.push({
      signal: t('rc.facing'),
      expected: t('rc.sureEnough', { min: pct(cfg.facing.minConfidence) }),
      measured:
        f.facing.sign === 0
          ? t('rc.facingUnknown', { conf: pct(f.facing.confidence) })
          : t('rc.facingSide', {
              side: side(f.facing.sign),
              conf: pct(f.facing.confidence),
              source: t(f.facing.source === 'manual' ? 'rc.source.manual' : 'rc.source.auto'),
            }),
      status: f.facing.sign !== 0 && f.facing.confidence >= cfg.facing.minConfidence ? 'ok' : 'off',
    });
    if (f.facing.twistSuspected) {
      checks.push({
        signal: t('rc.facingChange'),
        expected: t('rc.sameSide'),
        measured: t('rc.otherWay'),
        status: 'off',
      });
    }
  }

  if (flat || somersault) {
    checks.push({
      signal: t('rc.rotationConfidence'),
      expected: t('rc.atLeast50'),
      measured: pct(rot.confidence),
      status: rot.totalDeg === null ? 'unknown' : rot.confidence >= 0.5 ? 'ok' : 'off',
    });
  }
  checks.push({
    signal: t('rc.poseQuality'),
    expected: t('rc.atLeast60'),
    measured: pct(f.quality.pose),
    status: f.quality.pose >= 0.6 ? 'ok' : 'off',
  });
  const tv = f.quality.trunkLengthVariation;
  checks.push({
    signal: t('rc.camera'),
    expected: t('rc.trunkVaries', { max: pct(cfg.maxTrunkVariation) }),
    measured: tv === null ? t('rc.notMeasured') : t('rc.variesBy', { v: pct(tv) }),
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

export const describeFailure = (f: Failure): string =>
  t('fail.labeledPredicted', {
    truth: TRUTH_TEXT[f.truth],
    predicted: PREDICTED_TEXT[f.predicted],
    conf: pct(f.confidence),
  });
