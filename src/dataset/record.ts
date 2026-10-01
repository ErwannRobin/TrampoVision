import type { AnalysisResult } from '../analysis/types';
import type { WorldPoint } from '../pose/types';
import { pose3dSequence } from '../pose3d/poseSequence';
import { twistSequence, type TwistAnalysis } from '../pose3d/twist';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import type { SkillPrediction } from '../skills/types';
import { figureOf, legacyLabel, normalizeMovement, type MovementLabel } from './movementLabel';
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
  /** The 3D landmarks of the clip (one entry per analysis sample); saved with each jump so it can be turned around in the review. */
  world?: (WorldPoint[] | null)[];
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
  const pose3d = pose3dSequence(ctx.world, result.time, cycle, j.sequence?.samples ?? skills.config.sequenceSamples);
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
    pose3d,
    truth: prior?.truth ?? null,
    twistTruth: prior?.twistTruth ?? null,
    figure: prior?.figure ?? null,
    execution: prior?.execution ?? null,
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

/**
 * A prediction without its words. The words (the name, the summary, the labels of the evidence, the limits) follow the language of the
 * moment; the numbers, the ids and the answers do not. Two records of the same jump made in two languages must not look different.
 */
function withoutWords(p: SkillPrediction) {
  const {
    label: _label,
    summary: _summary,
    evidence,
    limitations,
    confidenceParts,
    candidates,
    stages,
    failure,
    comparison,
    ...rest
  } = p;
  return {
    ...rest,
    evidence: evidence.map((e) => [e.key, e.value]),
    limitations: limitations.map((l) => l.id ?? null),
    confidenceParts: confidenceParts.map((c) => c.value),
    candidates: candidates?.map(({ name: _name, checks, ...c }) => ({
      ...c,
      checks: checks.map((k) => [k.stage, k.status, k.match]),
    })),
    stages: stages?.map((s) => [s.stage, s.measured, s.distribution.map((d) => d.p)]),
    failure: failure && {
      kind: failure.kind,
      criterion: failure.criterion,
      ifResolved: failure.ifResolved,
      closest: failure.closest?.elementId ?? null,
      distances: failure.distances.map((d) => [d.stage, d.match]),
    },
    comparison: comparison && { ...comparison, channels: comparison.channels.map(({ label: _l, ...c }) => c) },
  };
}

/** The measurements and the prediction of a record as one string: two records with the same string are the same result. */
export function analysisFingerprint(r: JumpRecord): string {
  const estimate = r.twist?.estimate;
  return JSON.stringify([
    r.timestamps,
    r.features,
    withoutWords(r.prediction),
    estimate ? { ...estimate, limitations: estimate.limitations.map((l) => l.id ?? null) } : null,
  ]);
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

/** The deduction a person gives the skill (0 to 0.5, in tenths), with the one the app proposed; null removes it. */
export function withExecution(
  r: JumpRecord,
  deduction: number | null,
  proposed: number | null,
  ruleset: string,
  now = new Date(),
): JumpRecord {
  const iso = now.toISOString();
  if (deduction === null) return { ...r, execution: null, savedAt: iso };
  const value = Math.min(Math.max(Math.round(deduction * 10) / 10, 0), 0.5);
  return { ...r, execution: { deduction: value, proposed, labeledAt: iso, ruleset }, savedAt: iso };
}

/**
 * Says what the jump was as independent choices. Everything else that describes the jump is derived from them: the five-way label
 * the metrics use, the figure that makes the jump a reference example (only when the choices name one element of the table), and
 * the half-twist count that checks the 3D twist. A null movement removes all three.
 */
export function withMovement(r: JumpRecord, movement: MovementLabel | null, now = new Date()): JumpRecord {
  const iso = now.toISOString();
  if (movement === null) return { ...r, truth: null, figure: null, twistTruth: null, savedAt: iso };
  const m = normalizeMovement(movement);
  const figure = figureOf(m);
  const note = r.truth?.note;
  return {
    ...r,
    truth: { label: legacyLabel(m), labeledAt: iso, movement: m, ...(note ? { note } : {}) },
    figure: figure ? { elementId: figure, labeledAt: iso } : null,
    twistTruth: { halfTwists: m.halfTwists, annotatedAt: iso },
    savedAt: iso,
  };
}
