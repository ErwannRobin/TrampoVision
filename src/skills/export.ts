import type { SkillAnalysis } from './analyzeSkills';
import { KNOWN_LIMITS } from './classifier';
import type { JumpSkillResult } from './types';

export const SKILLS_SCHEMA = 'trampovision.jump-skills';
export const SKILLS_VERSION = 1;

/**
 * Everything the skill stage produced, as one JSON document: per jump the feature object, the prediction with its
 * evidence and limitations, and the normalized sequence (column names + rows), plus the thresholds that were used.
 * NaN becomes null. A temporal model can be trained from `jumps[].sequence` and `jumps[].features`.
 */
export interface SkillReport {
  schema: typeof SKILLS_SCHEMA;
  version: number;
  source: { fileName: string; fps: number; width: number; height: number };
  classifier: { id: string; version: string };
  config: SkillAnalysis['config'];
  knownLimits: typeof KNOWN_LIMITS;
  jumps: {
    index: number;
    features: JumpSkillResult['features'];
    prediction: JumpSkillResult['prediction'];
    sequence: JumpSkillResult['sequence'];
  }[];
}

const round = (v: number) => Number(v.toFixed(5));

export function buildSkillReport(analysis: SkillAnalysis, source: SkillReport['source']): SkillReport {
  return {
    schema: SKILLS_SCHEMA,
    version: SKILLS_VERSION,
    source,
    classifier: analysis.classifier,
    config: analysis.config,
    knownLimits: KNOWN_LIMITS,
    jumps: analysis.jumps.map((j) => ({
      index: j.cycle.index,
      features: j.features,
      prediction: j.prediction,
      sequence: j.sequence && { ...j.sequence, data: j.sequence.data.map((row) => row.map((v) => (Number.isFinite(v) ? round(v) : NaN))) },
    })),
  };
}

/** JSON text; NaN is written as null. */
export function toSkillReportJson(report: SkillReport): string {
  return JSON.stringify(report, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
}

const cell = (v: number | string | boolean | null | undefined) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'string') return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return Number.isFinite(v) ? String(Number(v.toFixed(4))) : '';
};

type Getter = [string, (j: JumpSkillResult) => number | string | boolean | null];

const FEATURE_COLUMNS: Getter[] = [
  ['jump', (j) => j.cycle.index + 1],
  ['complete', (j) => j.features.complete],
  ['takeoff_s', (j) => j.features.timing.takeoffTimeS],
  ['apex_s', (j) => j.features.timing.apexTimeS],
  ['landing_s', (j) => j.features.timing.landingTimeS],
  ['flight_time_s', (j) => j.features.timing.flightTimeS],
  ['time_to_apex_s', (j) => j.features.timing.timeToApexS],
  ['max_height_m', (j) => j.features.trajectory.maxHeightM],
  ['rise_m', (j) => j.features.trajectory.riseM],
  ['rise_body_lengths', (j) => j.features.trajectory.riseBodyLengths],
  ['takeoff_vy_mps', (j) => j.features.trajectory.takeoffVyMps],
  ['horizontal_displacement_m', (j) => j.features.trajectory.horizontalDisplacementM],
  ['takeoff_x_bed', (j) => j.features.trajectory.takeoffXBed],
  ['landing_x_bed', (j) => j.features.trajectory.landingXBed],
  ['orientation_takeoff_deg', (j) => j.features.orientation.takeoffDeg],
  ['orientation_apex_deg', (j) => j.features.orientation.apexDeg],
  ['orientation_landing_deg', (j) => j.features.orientation.landingDeg],
  ['orientation_max_deviation_deg', (j) => j.features.orientation.maxDeviationDeg],
  ['peak_angular_velocity_dps', (j) => j.features.orientation.peakAngularVelocityDps],
  ['mean_abs_angular_velocity_dps', (j) => j.features.orientation.meanAbsAngularVelocityDps],
  ['rotation_deg', (j) => j.features.rotation.totalDeg],
  ['rotation_turns', (j) => j.features.rotation.turns],
  ['rotation_nearest_deg', (j) => j.features.rotation.nearestDeg],
  ['rotation_direction', (j) => j.features.rotation.direction],
  ['rotation_confidence', (j) => j.features.rotation.confidence],
  ['rotation_reversal_deg', (j) => j.features.rotation.reversalDeg],
  ['hip_angle_at_peak_deg', (j) => j.features.shape.hipAngle.atPeak],
  ['hip_angle_min_deg', (j) => j.features.shape.hipAngle.min],
  ['knee_angle_at_peak_deg', (j) => j.features.shape.kneeAngle.atPeak],
  ['knee_angle_min_deg', (j) => j.features.shape.kneeAngle.min],
  ['shoulder_hip_axis_at_peak_deg', (j) => j.features.shape.shoulderHipAxis.atPeak],
  ['leg_separation_at_peak', (j) => j.features.shape.legSeparation.atPeak],
  ['knee_torso_at_peak', (j) => j.features.shape.kneeTorsoDistance.atPeak],
  ['compactness_at_peak', (j) => j.features.shape.compactness.atPeak],
  ['position', (j) => j.features.position.label],
  ['position_confidence', (j) => j.features.position.confidence],
  ['position_share_straight', (j) => j.features.position.timeShare.straight],
  ['position_share_tuck', (j) => j.features.position.timeShare.tuck],
  ['position_share_pike', (j) => j.features.position.timeShare.pike],
  ['facing', (j) => (j.features.facing.sign > 0 ? 'right' : j.features.facing.sign < 0 ? 'left' : 'undetermined')],
  ['facing_confidence', (j) => j.features.facing.confidence],
  ['pose_quality', (j) => j.features.quality.pose],
  ['com_coverage', (j) => j.features.quality.comCoverage],
  ['trunk_length_variation', (j) => j.features.quality.trunkLengthVariation],
  ['skill', (j) => j.prediction.skill],
  ['skill_label', (j) => j.prediction.label],
  ['skill_confidence', (j) => j.prediction.confidence],
  ['limitations', (j) => j.prediction.limitations.map((l) => l.signal).join('; ')],
  ['summary', (j) => j.prediction.summary],
];

/** One row per jump: the feature object flattened, plus the prediction. */
export function toSkillsCsv(analysis: SkillAnalysis): string {
  const rows = [FEATURE_COLUMNS.map(([name]) => name).join(',')];
  for (const j of analysis.jumps) rows.push(FEATURE_COLUMNS.map(([, get]) => cell(get(j))).join(','));
  return rows.join('\n');
}

/** Long format: one row per jump and normalized sample (jump, sample, then every sequence column). */
export function toSequencesCsv(analysis: SkillAnalysis): string {
  const first = analysis.jumps.find((j) => j.sequence)?.sequence;
  if (!first) return 'jump,sample';
  const rows = [['jump', 'sample', ...first.columns].join(',')];
  for (const j of analysis.jumps) {
    if (!j.sequence) continue;
    j.sequence.data.forEach((row, k) => rows.push([j.cycle.index + 1, k, ...row.map((v) => cell(v))].join(',')));
  }
  return rows.join('\n');
}
