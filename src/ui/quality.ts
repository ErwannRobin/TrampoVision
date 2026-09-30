import { calibrationErrorText } from '../analysis/calibration';
import { GRAVITY } from '../analysis/jumpCycles';
import type { AnalysisResult } from '../analysis/types';
import { formatNumber, formatPercent, t } from '../i18n/core';

/** Things the user should double-check before trusting the numbers. */
export function analysisWarnings(result: AnalysisResult): string[] {
  const { meta, jumps, summary } = result;
  const out: string[] = [];
  if (meta.calibrationError)
    out.push(t('quality.calibrationIgnored', { error: calibrationErrorText(meta.calibrationError) }));
  if (meta.calibrated) {
    const ratio = meta.trampolinePixelsPerMeter / meta.athletePixelsPerMeter;
    if (Number.isFinite(ratio) && (ratio < 0.75 || ratio > 1.33)) {
      out.push(t('quality.scales', { gap: formatPercent(Math.abs(ratio - 1)) }));
    }
    if (meta.viewAngleDeg > 60) out.push(t('quality.viewAlong'));
  }
  const g = jumps.cycles.map((c) => c.impliedGravityMps2).filter((v): v is number => v !== null && Number.isFinite(v));
  if (g.length) {
    const mean = g.reduce((s, v) => s + v, 0) / g.length;
    if (Math.abs(mean / GRAVITY - 1) > 0.15)
      out.push(t('quality.freeFall', { g: formatNumber(mean, 1), gap: formatPercent(Math.abs(mean / GRAVITY - 1)) }));
  }
  if (meta.maxRotationStepDeg > 120) out.push(t('quality.rotationStep'));
  if (summary.validFraction < 0.8)
    out.push(t('quality.missingCom', { share: formatPercent(1 - summary.validFraction) }));
  if (jumps.cycles.some((c) => !c.complete)) out.push(t('quality.cutOff'));
  return out;
}
