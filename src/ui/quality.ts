import { GRAVITY } from '../analysis/jumpCycles';
import type { AnalysisResult } from '../analysis/types';

/** Things the user should double-check before trusting the numbers. */
export function analysisWarnings(result: AnalysisResult): string[] {
  const { meta, jumps, summary } = result;
  const out: string[] = [];
  if (meta.calibrationError) out.push(`Calibration ignored: ${meta.calibrationError}`);
  if (meta.calibrated) {
    const ratio = meta.trampolinePixelsPerMeter / meta.athletePixelsPerMeter;
    if (Number.isFinite(ratio) && (ratio < 0.75 || ratio > 1.33)) {
      out.push(
        `The bed and the athlete give scales ${Math.round(Math.abs(ratio - 1) * 100)}% apart. Check the corners, the bed size, the athlete height, and that the athlete stays over the bed.`,
      );
    }
    if (meta.viewAngleDeg > 60)
      out.push(
        'The camera looks along the long side of the bed: horizontal displacement is measured across the bed only.',
      );
  }
  const g = jumps.cycles.map((c) => c.impliedGravityMps2).filter((v): v is number => v !== null && Number.isFinite(v));
  if (g.length) {
    const mean = g.reduce((s, v) => s + v, 0) / g.length;
    if (Math.abs(mean / GRAVITY - 1) > 0.15)
      out.push(
        `Free-fall check: ${mean.toFixed(1)} m/s² instead of 9.81, so meters and m/s may be about ${Math.round(Math.abs(mean / GRAVITY - 1) * 100)}% off.`,
      );
  }
  if (meta.maxRotationStepDeg > 120)
    out.push(
      'Body orientation changes by more than 120° between two samples: rotations may be undercounted. Analyze every frame.',
    );
  if (summary.validFraction < 0.8)
    out.push(`The center of mass is missing in ${Math.round((1 - summary.validFraction) * 100)}% of the frames.`);
  if (jumps.cycles.some((c) => !c.complete))
    out.push('A jump is cut off at the start or end of the clip: its takeoff or landing is unknown.');
  return out;
}
