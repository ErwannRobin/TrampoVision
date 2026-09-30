import type { AnalysisResult } from '../analysis/types';
import { formatPercent, lazyText, t } from '../i18n/core';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import type { BodyPosition, Limitation, RotationDirection, SkillId, SkillPrediction } from '../skills/types';

/**
 * Plain-language views of what the pipeline measured, for the athlete's side of the interface. Nothing here measures
 * anything: every value is read from the analysis, and comparisons stay inside the clip that was analyzed.
 */

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'none';

/** A prediction at or above this is shown as confident (the same line the video labels and the skill card always used). */
export const HIGH_CONFIDENCE = 0.6;

/** How sure the classifier is, in words of the language in use. */
export const TIER_TEXT: Record<ConfidenceTier, string> = lazyText({
  high: 'tier.high',
  medium: 'tier.medium',
  low: 'tier.low',
  none: 'tier.none',
});

/**
 * How sure the classifier is, in words. `none` = it never tried (the jump is cut off by the clip); `low` = it named a
 * best guess but stayed under its own minimum, so the skill is reported as unclassified.
 */
export function confidenceTier(
  p: Pick<SkillPrediction, 'skill' | 'confidence'>,
  minConfidence: number,
): ConfidenceTier {
  if (p.skill === 'unclassified') return p.confidence > 0 ? 'low' : 'none';
  if (p.confidence >= HIGH_CONFIDENCE) return 'high';
  return p.confidence >= minConfidence ? 'medium' : 'low';
}

/** What a skill is called to people: a jump the classifier could not name is "Not classified", not a class of its own. */
export const skillName = (p: Pick<SkillPrediction, 'skill' | 'label' | 'certainty'>): string =>
  p.skill === 'unclassified' ? TIER_TEXT.none : p.certainty === 'tentative' ? `${p.label}?` : p.label;

/** Distance from the bed center (1 = the edge) under which a position is called "in the center". */
export const BED_CENTER_BAND = 0.15;

/** Where on the bed a bed-normalized position is (+-1 = the edge, + = right in the image); null when unknown. */
export function describeBedPosition(x: number | null): string | null {
  if (x === null || !Number.isFinite(x)) return null;
  const right = x > 0;
  if (Math.abs(x) < BED_CENTER_BAND) return t('bed.inCenter');
  if (Math.abs(x) > 1) return t(right ? 'bed.pastRight' : 'bed.pastLeft');
  return t(right ? 'bed.towardRight' : 'bed.towardLeft', { share: formatPercent(Math.abs(x)) });
}

export interface JumpHeadline {
  /** 0-based index and 1-based number shown to people. */
  index: number;
  number: number;
  skill: SkillId;
  label: string;
  tier: ConfidenceTier;
  confidence: number;
  /** The classifier's one-sentence reason. */
  summary: string;
  /** Both takeoff and landing were seen. */
  complete: boolean;
  /** Highest point of the center of mass above `heightReference`. */
  heightM: number;
  heightReference: AnalysisResult['meta']['heightReference'];
  riseM: number | null;
  flightTimeS: number | null;
  rotation: { turns: number | null; totalDeg: number | null; direction: RotationDirection };
  bodyShape: BodyPosition;
  /** Position on the bed at takeoff, apex and landing (+-1 = the edge); null when the bed was not marked. */
  bed: { takeoff: number | null; apex: number | null; landing: number | null } | null;
  limitations: Limitation[];
}

/** The few numbers an athlete wants about one jump, with the classifier's answer. */
export function jumpHeadline(skills: SkillAnalysis, result: AnalysisResult, index: number): JumpHeadline | null {
  const j = skills.jumps[index];
  if (!j) return null;
  const { prediction: p, features: f } = j;
  const t = f.trajectory;
  const bed = result.meta.calibrated ? { takeoff: t.takeoffXBed, apex: t.apexXBed, landing: t.landingXBed } : null;
  return {
    index,
    number: index + 1,
    skill: p.skill,
    label: skillName(p),
    tier: confidenceTier(p, skills.config.minConfidence),
    confidence: p.confidence,
    summary: p.summary,
    complete: f.complete,
    heightM: t.maxHeightM,
    heightReference: result.meta.heightReference,
    riseM: t.riseM,
    flightTimeS: f.timing.flightTimeS,
    rotation: { turns: f.rotation.turns, totalDeg: f.rotation.totalDeg, direction: f.rotation.direction },
    bodyShape: f.position.label,
    bed: bed && (bed.takeoff !== null || bed.apex !== null || bed.landing !== null) ? bed : null,
    limitations: p.limitations,
  };
}

export interface JumpComparisonRow {
  index: number;
  number: number;
  label: string;
  tier: ConfidenceTier;
  heightM: number;
  flightTimeS: number | null;
  /** 0..1 against the highest jump / the longest flight of this clip. */
  heightShare: number;
  flightShare: number;
  complete: boolean;
}

/** Every jump of the clip next to the others: heights and flight times as shares of the best one in this clip. */
export function compareJumps(skills: SkillAnalysis): JumpComparisonRow[] {
  const heights = skills.jumps.map((j) => j.features.trajectory.maxHeightM);
  const flights = skills.jumps.map((j) => j.features.timing.flightTimeS);
  const maxHeight = Math.max(0, ...heights.filter(Number.isFinite));
  const maxFlight = Math.max(0, ...flights.filter((v): v is number => v !== null && Number.isFinite(v)));
  const share = (v: number | null, max: number) =>
    v !== null && Number.isFinite(v) && max > 0 ? Math.max(0, v) / max : 0;
  return skills.jumps.map((j, index) => ({
    index,
    number: index + 1,
    label: skillName(j.prediction),
    tier: confidenceTier(j.prediction, skills.config.minConfidence),
    heightM: heights[index],
    flightTimeS: flights[index],
    heightShare: share(heights[index], maxHeight),
    flightShare: share(flights[index], maxFlight),
    complete: j.features.complete,
  }));
}
