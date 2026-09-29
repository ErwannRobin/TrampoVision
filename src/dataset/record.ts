import type { AnalysisResult } from '../analysis/types';
import { twistSequence, type TwistAnalysis } from '../pose3d/twist';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { RECORD_SCHEMA, RECORD_VERSION, type JumpRecord, type TruthLabel } from './types';

/** Two jump records of the same video are the same jump when their apexes are closer than this (jumps are at least 0.3 s apart). */
export const MATCH_TOLERANCE_S = 0.2;

export interface RecordContext {
  videoId: string;
  fileName: string;
  result: AnalysisResult;
  skills: SkillAnalysis;
  /** Null when 3D was not analyzed. */
  twist: TwistAnalysis | null;
  now?: Date;
}

/** The record of the k-th detected jump of the current analysis. `prior` (the saved record of the same jump) keeps its id, number and label. */
export function buildJumpRecord(ctx: RecordContext, k: number, jumpId: number, prior?: JumpRecord): JumpRecord {
  const { result, skills, twist } = ctx;
  const j = skills.jumps[k];
  const m = result.meta;
  const c = j.cycle;
  const estimate = twist?.jumps[k] ?? null;
  const cycle = result.jumps.cycles[k];
  const seq =
    twist?.frames && estimate?.available
      ? twistSequence(twist.frames, result.time, cycle, j.sequence?.samples ?? skills.config.sequenceSamples)
      : null;
  return {
    schema: RECORD_SCHEMA,
    version: RECORD_VERSION,
    id: `${ctx.videoId}:${jumpId}`,
    videoId: ctx.videoId,
    jumpId,
    savedAt: (ctx.now ?? new Date()).toISOString(),
    source: { fileName: ctx.fileName, width: m.width, height: m.height, fps: m.fps, sourceFps: m.sourceFps },
    timestamps: { takeoffS: c.takeoffTimeS, apexS: c.apexTimeS, landingS: c.landingTimeS, flightTimeS: c.flightTimeS },
    analysis: {
      classifier: skills.classifier,
      config: skills.config,
      athleteHeightM: m.athleteHeightM,
      scaleSource: m.scaleSource,
      calibrated: m.calibrated,
    },
    sequence: j.sequence,
    features: j.features,
    prediction: j.prediction,
    twist: estimate ? { estimate, sequence: seq } : null,
    truth: prior?.truth ?? null,
    twistTruth: prior?.twistTruth ?? null,
    figure: prior?.figure ?? null,
  };
}

/** The saved record of the same jump: the closest apex within the tolerance that is not already taken. */
export function matchRecord(
  saved: JumpRecord[],
  apexS: number,
  taken: Set<string> = new Set(),
): JumpRecord | undefined {
  let best: JumpRecord | undefined;
  let bestD = MATCH_TOLERANCE_S;
  for (const r of saved) {
    if (taken.has(r.id)) continue;
    const d = Math.abs(r.timestamps.apexS - apexS);
    if (d <= bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

/**
 * Saves (or refreshes) the jumps of the current analysis. A jump that matches a saved record keeps its id, its number and its
 * label and gets the new measurements. Any other jump gets its number on screen (jump 4 = record 4) unless a saved record already
 * uses it, then the next free one. `only` limits the output to some jumps (0-based); the numbering does not depend on it.
 * `saved` = the records already stored for THIS video.
 */
export function syncRecords(saved: JumpRecord[], ctx: RecordContext, only?: number[]): JumpRecord[] {
  const taken = new Set<string>();
  const used = new Set(saved.map((r) => r.jumpId));
  const plan = ctx.skills.jumps.map((j) => {
    const prior = matchRecord(saved, j.cycle.apexTimeS, taken);
    if (prior) taken.add(prior.id);
    return { prior };
  });
  const jumpIds = plan.map(({ prior }, k) => {
    if (prior) return prior.jumpId;
    let id = k + 1;
    while (used.has(id)) id++;
    used.add(id);
    return id;
  });
  const indices = only ?? ctx.skills.jumps.map((_, k) => k);
  return indices.map((k) => buildJumpRecord(ctx, k, jumpIds[k], plan[k].prior));
}

/** The measurements and the prediction of a record as one string: two records with the same string are the same result. */
export function analysisFingerprint(r: JumpRecord): string {
  return JSON.stringify([r.timestamps, r.features, r.prediction, r.twist?.estimate ?? null]);
}

/** True when the saved record differs from what the current settings give for the same jump. */
export const isStale = (saved: JumpRecord, fresh: JumpRecord): boolean =>
  analysisFingerprint(saved) !== analysisFingerprint(fresh);

export function withTruth(
  r: JumpRecord,
  label: TruthLabel | null,
  options: { note?: string; now?: Date } = {},
): JumpRecord {
  const now = (options.now ?? new Date()).toISOString();
  if (label === null) return { ...r, truth: null, savedAt: now };
  const note = options.note ?? r.truth?.note;
  return { ...r, truth: { label, labeledAt: now, ...(note ? { note } : {}) }, savedAt: now };
}

/** The annotator's twist count in half twists, or null to remove it. */
export function withTwistTruth(r: JumpRecord, halfTwists: number | null, now = new Date()): JumpRecord {
  const iso = now.toISOString();
  return { ...r, twistTruth: halfTwists === null ? null : { halfTwists, annotatedAt: iso }, savedAt: iso };
}

/** The figure of the jump (an element id of the table), or null to remove it. A jump with a figure becomes a reference example. */
export function withFigure(r: JumpRecord, elementId: string | null, now = new Date()): JumpRecord {
  const iso = now.toISOString();
  return { ...r, figure: elementId === null ? null : { elementId, labeledAt: iso }, savedAt: iso };
}
