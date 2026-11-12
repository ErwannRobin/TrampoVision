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
  const hard = framesLostInFlight(result);
  if (hard.air >= MIN_AIR_FRAMES && hard.lost / hard.air >= LOST_IN_FLIGHT)
    out.push(t('quality.lostInFlight', { share: formatPercent(hard.lost / hard.air) }));
  if (jumps.cycles.some((c) => !c.complete)) out.push(t('quality.cutOff'));
  return out;
}

/** From this share of the frames in the air on, the clip is said to be hard for the pose model, and how to film is suggested. */
const LOST_IN_FLIGHT = 0.15;
/** ... once the clip has this many frames in the air (a jump or so): one lost frame of five is not a share. */
const MIN_AIR_FRAMES = 20;

/**
 * The frames between a takeoff and a landing, and those among them the pose model did not read as the analysis uses them: nobody
 * found, the athlete read with the head where the feet are, or at an angle that has nothing to do with the body. They are bridged
 * or put right (see `computeAnalysis`), which is why the clip still reads: the share says how much of the flight is made up.
 */
export function framesLostInFlight(result: AnalysisResult): { air: number; lost: number } {
  let air = 0;
  let lost = 0;
  for (const c of result.jumps.cycles) {
    if (c.takeoff === null || c.landing === null) continue;
    for (let i = c.takeoff; i <= c.landing; i++) {
      air++;
      if (result.confidence[i] === 0 || result.orientationFlipped[i] || result.orientationRejected[i]) lost++;
    }
  }
  return { air, lost };
}
