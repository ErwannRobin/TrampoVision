import { formatNumber, formatPercent, lower, t, type Locale } from '../i18n/core';
import type { SkillConfig } from './config';
import {
  SKILL_LABELS,
  type BodyPosition,
  type ClassifierInput,
  type EvidenceItem,
  type Limitation,
  type SkillClassifier,
  type SkillId,
  type SkillPrediction,
} from './types';

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const pct = (v: number) => formatPercent(clamp01(v));
const deg = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : `${Math.round(v)}°`;
/** A measurement with two decimals, or a dash when there is none. */
const two = (v: number | null | undefined) => (v === null || v === undefined ? '–' : formatNumber(v, 2));
/** A body position as a word inside a sentence ("tuck"). */
export const positionWord = (p: BodyPosition, locale?: Locale) => lower(t(`pos.${p}`, undefined, locale), locale);

/** Things this input (a single 2D skeleton from one camera) cannot tell, whatever the pose quality. In the language in use unless another is asked for. */
export function knownLimits(locale?: Locale): Limitation[] {
  return [
    {
      id: 'camera',
      signal: t('limit.camera.signal', undefined, locale),
      problem: t('limit.camera.problem', undefined, locale),
      needed: t('limit.camera.needed', undefined, locale),
    },
    {
      id: 'twists',
      signal: t('limit.twists.signal', undefined, locale),
      problem: t('limit.twists.problem', undefined, locale),
      needed: t('limit.twists.needed', undefined, locale),
    },
    {
      id: 'straddle',
      signal: t('limit.straddle.signal', undefined, locale),
      problem: t('limit.straddle.problem', undefined, locale),
      needed: t('limit.straddle.needed', undefined, locale),
    },
    {
      id: 'quarter-turns',
      signal: t('limit.quarter.signal', undefined, locale),
      problem: t('limit.quarter.problem', undefined, locale),
      needed: t('limit.quarter.needed', undefined, locale),
    },
    {
      id: 'pose-model',
      signal: t('limit.poseModel.signal', undefined, locale),
      problem: t('limit.poseModel.problem', undefined, locale),
      needed: t('limit.poseModel.needed', undefined, locale),
    },
  ];
}

/** The limit of a jump that is cut off by the clip. */
export const boundsLimit = (): Limitation => ({
  id: 'bounds',
  signal: t('limit.bounds.signal'),
  problem: t('limit.bounds.problem'),
  needed: t('limit.bounds.needed'),
});

interface Candidate {
  skill: SkillId;
  score: number;
}

/**
 * Membership 0..1 of "the rotation is `halfTurns` half turns": 1 exactly on it, 0 at `tolerance` away.
 * Same curve as the rounding term of the rotation confidence.
 */
function rotationMembership(totalDeg: number, halfTurns: number, tolerance: number): number {
  return clamp01(1 - ((Math.abs(totalDeg) - 180 * halfTurns) / tolerance) ** 2);
}

function levelOf(v: number | null, cfg: SkillConfig): string {
  if (v === null) return t('level.unknown');
  if (v <= cfg.legSeparation.lowMax) return t('level.low');
  if (v >= cfg.legSeparation.highMin) return t('level.high');
  return t('level.medium');
}

/**
 * The first classifier: transparent rules over the measured features.
 *
 *   rotation ~ 0 turns    + straight / tuck / pike position   -> Straight / Tuck / Pike Jump
 *   rotation ~ 1 turn (360°) + facing known                   -> Back (turning away from the face) / Front
 *   rotation ~ 1 turn (360°) + facing unknown                 -> Somersault, front or back undetermined
 *   anything else                                             -> Unclassified (not in the initial set)
 *
 * Confidence = product of the confidences of the facts the decision rests on (rotation, body position,
 * facing). It is a heuristic score between 0 and 1, not a calibrated probability.
 */
export const ruleBasedClassifier: SkillClassifier = {
  id: 'rules',
  version: '1',
  description: 'Threshold rules on joint angles, rotation and facing (no learning).',
  classify({ features: f, config: cfg }: ClassifierInput): SkillPrediction {
    const meta = { id: 'rules', version: '1' };
    const r = f.rotation;
    const p = f.position;
    const face = f.facing;
    const tol = cfg.rotation.toleranceDeg;
    const evidence: EvidenceItem[] = [];
    const limitations: Limitation[] = [];
    const add = (key: string, label: string, text: string, value: number | null, note?: string) =>
      evidence.push({ key, label, text, value, note });

    if (!f.complete || r.totalDeg === null) {
      return {
        classifier: meta,
        skill: 'unclassified',
        label: SKILL_LABELS.unclassified,
        confidence: 0,
        scores: {},
        confidenceParts: [],
        evidence,
        limitations: [boundsLimit()],
        summary: t('sum.cutOff'),
      };
    }

    // --- evidence -------------------------------------------------------------------------------
    const s = f.shape;
    add('hip_angle', t('ev.hip.label'), deg(s.hipAngle.atPeak), s.hipAngle.atPeak, t('ev.hip.note'));
    add('knee_angle', t('ev.knee.label'), deg(s.kneeAngle.atPeak), s.kneeAngle.atPeak, t('ev.knee.note'));
    add(
      'body_orientation',
      t('ev.orientation.label'),
      deg(f.orientation.apexDeg),
      f.orientation.apexDeg,
      t('ev.orientation.note'),
    );
    const sep = s.legSeparation.atPeak;
    add(
      'leg_separation',
      t('ev.legSep.label'),
      sep === null ? levelOf(sep, cfg) : t('ev.legSep.text', { level: levelOf(sep, cfg), value: two(sep) }),
      sep,
      t('ev.legSep.note'),
    );
    const turnWord = t(`turn.${r.direction}`);
    add(
      'rotation',
      t('ev.rotation.label'),
      t('ev.rotation.text', {
        turns: r.turns === null ? '–' : formatNumber(r.turns, 1),
        deg: r.nearestDeg ?? '–',
        conf: pct(r.confidence),
      }),
      r.turns,
      r.residualDeg === null
        ? t('ev.rotation.note', { direction: turnWord })
        : t('ev.rotation.noteResidual', { direction: turnWord, residual: Math.round(Math.abs(r.residualDeg)) }),
    );
    const kt = s.kneeTorsoDistance.atPeak;
    add(
      'knee_torso',
      t('ev.kneeTorso.label'),
      kt === null ? '–' : t('ev.kneeTorso.text', { value: two(kt) }),
      kt,
      t('ev.kneeTorso.note'),
    );
    add(
      'compactness',
      t('ev.compactness.label'),
      two(s.compactness.atPeak),
      s.compactness.atPeak,
      t('ev.compactness.note'),
    );
    add(
      'position',
      t('ev.position.label'),
      t('ev.position.text', { position: positionWord(p.label), conf: pct(p.confidence) }),
      p.ruleScore,
      t('ev.position.note', {
        shares: (['straight', 'tuck', 'pike', 'unknown'] as const)
          .map((k) => t('ev.share', { position: positionWord(k), share: pct(p.timeShare[k]) }))
          .join(t('list.separator')),
      }),
    );
    const side = face.sign > 0 ? t('side.right') : t('side.left');
    add(
      'facing',
      t('ev.facing.label'),
      face.sign === 0
        ? t('ev.facing.undetermined', { conf: pct(face.confidence) })
        : t(face.source === 'manual' ? 'ev.facing.sideManual' : 'ev.facing.side', {
            side,
            conf: pct(face.confidence),
          }),
      face.sign,
      face.source === 'manual'
        ? undefined
        : t('ev.facing.note', { face: two(face.cues.face), knee: two(face.cues.knee), foot: two(face.cues.foot) }),
    );
    add('pose_quality', t('ev.poseQuality.label'), pct(f.quality.pose), f.quality.pose, t('ev.poseQuality.note'));

    // --- candidates -----------------------------------------------------------------------------
    const none = rotationMembership(r.totalDeg, 0, tol);
    const full = rotationMembership(r.totalDeg, 2, tol);
    const rotQuality = r.parts.coverage * r.parts.steps * r.parts.crossCheck * r.parts.monotonic; // everything but the rounding term
    const scores: Partial<Record<SkillId, number>> = {
      'straight-jump': none * rotQuality * p.scores.straight * p.stability,
      'tuck-jump': none * rotQuality * p.scores.tuck * p.stability,
      'pike-jump': none * rotQuality * p.scores.pike * p.stability,
    };
    const dirSign = r.direction === 'clockwise' ? 1 : r.direction === 'counterclockwise' ? -1 : 0;
    const forward = dirSign * face.sign; // +1: the top of the body moved toward the face (front), -1: away from it (back)
    scores.front = full * rotQuality * (forward > 0 ? face.confidence : 0);
    scores.back = full * rotQuality * (forward < 0 ? face.confidence : 0);
    scores['somersault-direction-unknown'] = full * rotQuality * (face.sign === 0 ? 1 : 0);

    // A camera that is not side-on shrinks the horizontal extent of the body: the 2D trunk length then changes with the rotation.
    const variation = f.quality.trunkLengthVariation;
    const viewFactor =
      variation === null || variation <= cfg.maxTrunkVariation
        ? 1
        : Math.max(0.2, 1 - 0.8 * ((variation - cfg.maxTrunkVariation) / 0.35));

    // --- decision -------------------------------------------------------------------------------
    let skill: SkillId = 'unclassified';
    let confidence = 0;
    let parts: { name: string; value: number }[] = [];
    let summary = '';
    const nHalf = r.halfTurns ?? -1;

    if (nHalf === 0) {
      if (p.label === 'unknown') {
        summary = t('sum.noRotationUnknownPosition', {
          rot: deg(r.totalDeg),
          hip: deg(s.hipAngle.atPeak),
          knee: deg(s.kneeAngle.atPeak),
        });
        limitations.push({
          id: 'body-position',
          signal: t('limit.position.signal'),
          problem: t('limit.position.problem', { hip: deg(s.hipAngle.atPeak), knee: deg(s.kneeAngle.atPeak) }),
          needed: t('limit.position.needed'),
        });
      } else {
        skill = `${p.label}-jump` as SkillId;
        parts = [
          { name: t('part.rotationNone'), value: r.parts.rounding },
          { name: t('part.rotationQuality'), value: rotQuality },
          { name: t('part.positionRule'), value: p.ruleScore },
          { name: t('part.shapeHeld'), value: p.stability },
          { name: t('part.poseQuality'), value: f.quality.pose },
        ];
        parts.push({ name: t('part.sideOn'), value: viewFactor });
        confidence = r.parts.rounding * rotQuality * p.ruleScore * p.stability * f.quality.pose * viewFactor;
        summary = t(p.label === 'straight' ? 'sum.straight' : p.label === 'pike' ? 'sum.pike' : 'sum.tuck', {
          hip: deg(s.hipAngle.atPeak),
          knee: deg(s.kneeAngle.atPeak),
        });
      }
    } else if (nHalf === 2) {
      if (face.sign === 0) {
        skill = 'somersault-direction-unknown';
        parts = [
          { name: t('part.rotationFull'), value: r.parts.rounding },
          { name: t('part.rotationQuality'), value: rotQuality },
        ];
        parts.push({ name: t('part.sideOn'), value: viewFactor });
        confidence = r.parts.rounding * rotQuality * viewFactor;
        summary = t('sum.directionUnknownFull', { rot: deg(r.totalDeg), turn: turnWord });
        limitations.push({
          id: 'facing',
          signal: t('limit.facing.signal'),
          problem: t('limit.facing.problem', { conf: pct(face.confidence) }),
          needed: t('limit.facing.needed'),
        });
      } else {
        skill = forward > 0 ? 'front' : 'back';
        parts = [
          { name: t('part.rotationFull'), value: r.parts.rounding },
          { name: t('part.rotationQuality'), value: rotQuality },
          { name: t('part.facing'), value: face.confidence },
        ];
        parts.push({ name: t('part.sideOn'), value: viewFactor });
        confidence = r.parts.rounding * rotQuality * face.confidence * viewFactor;
        summary = t(forward > 0 ? 'sum.front' : 'sum.back', { rot: deg(r.totalDeg), turn: turnWord, side });
      }
    } else {
      summary = t('sum.outOfSet', { deg: r.nearestDeg ?? '–', turns: two(r.turns) });
    }

    // --- limitations that come from this jump's data ---------------------------------------------
    if (f.quality.pose < 0.6) {
      limitations.push({
        id: 'pose-quality',
        signal: t('limit.pose.signal'),
        problem: t('limit.pose.problem', { share: pct(f.quality.pose) }),
        needed: t('limit.pose.needed'),
      });
    }
    if (f.quality.trunkLengthVariation !== null && f.quality.trunkLengthVariation > cfg.maxTrunkVariation) {
      limitations.push({
        id: 'camera-view',
        signal: t('limit.camera.signal'),
        problem: t('limit.view.problem', { change: pct(f.quality.trunkLengthVariation) }),
        needed: t('limit.view.needed'),
      });
    }
    if (r.maxStepDeg !== null && r.maxStepDeg > cfg.rotation.maxStepDeg) {
      limitations.push({
        id: 'orientation-step',
        signal: t('limit.tracking.signal'),
        problem: t('limit.tracking.step.problem', { deg: deg(r.maxStepDeg) }),
        needed: t('limit.tracking.step.needed'),
      });
    }
    if (r.reversalDeg !== null && r.reversalDeg > cfg.rotation.reversalOkDeg) {
      limitations.push({
        id: 'orientation-reversal',
        signal: t('limit.tracking.signal'),
        problem: t('limit.tracking.reversal.problem', { deg: deg(r.reversalDeg) }),
        needed: t('limit.tracking.reversal.needed'),
      });
    }
    if (r.crossCheckDiffDeg !== null && Math.abs(r.crossCheckDiffDeg) > 60) {
      limitations.push({
        id: 'cross-check',
        signal: t('limit.cross.signal'),
        problem: t('limit.cross.problem', { deg: deg(Math.abs(r.crossCheckDiffDeg)) }),
        needed: t('limit.cross.needed'),
      });
    }
    if (r.residualDeg !== null && Math.abs(r.residualDeg) > 0.66 * tol) {
      limitations.push({
        id: 'granularity',
        signal: t('limit.granularity.signal'),
        problem: t('limit.granularity.problem', { total: deg(r.totalDeg), off: deg(Math.abs(r.residualDeg)) }),
        needed: t('limit.granularity.needed'),
      });
    }
    if (face.twistSuspected) {
      limitations.push({
        id: 'twist-suspected',
        signal: t('limit.twist.signal'),
        problem: t('limit.twist.problem'),
        needed: t('limit.twist.needed'),
      });
    }

    // --- final ---------------------------------------------------------------------------------------
    let label = SKILL_LABELS[skill];
    if (skill !== 'unclassified' && confidence < cfg.minConfidence) {
      summary = t('sum.bestGuess', {
        name: SKILL_LABELS[skill],
        conf: pct(confidence),
        min: pct(cfg.minConfidence),
        reason: summary,
      });
      skill = 'unclassified';
      label = SKILL_LABELS[skill];
    }
    return {
      classifier: meta,
      skill,
      label,
      confidence: clamp01(confidence),
      scores,
      confidenceParts: parts,
      evidence,
      limitations,
      summary,
    };
  },
};

/** Ranked candidate list of a prediction, best first. */
export function rankedCandidates(prediction: SkillPrediction): Candidate[] {
  return (Object.entries(prediction.scores) as [SkillId, number][])
    .map(([skill, score]) => ({ skill, score }))
    .sort((a, b) => b.score - a.score);
}
