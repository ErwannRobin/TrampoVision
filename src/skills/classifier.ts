import type { SkillConfig } from './config';
import {
  SKILL_LABELS,
  type ClassifierInput,
  type EvidenceItem,
  type Limitation,
  type SkillClassifier,
  type SkillId,
  type SkillPrediction,
} from './types';

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const pct = (v: number) => `${Math.round(clamp01(v) * 100)}%`;
const deg = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : `${Math.round(v)}°`;

/** Things this input (a single 2D skeleton from one camera) cannot tell, whatever the pose quality. */
export const KNOWN_LIMITS: Limitation[] = [
  {
    signal: 'Camera view',
    problem:
      'A somersault turns toward or away from a camera that is in front of or behind the athlete, so the 2D body angle barely changes.',
    needed: 'A side-on, roughly level camera.',
  },
  {
    signal: 'Twists',
    problem:
      'Rotation about the long axis is not measured: the shoulder and hip lines are almost points in a side view.',
    needed: '3D pose (or two cameras).',
  },
  {
    signal: 'Leg separation (straddle, scissor)',
    problem: 'The legs hide each other in a side view, so the ankle distance says little about a straddle.',
    needed: 'A front-view camera or 3D pose.',
  },
  {
    signal: 'Quarter turns (drops, 1¼, 1¾ rotations)',
    problem:
      'Rotation is rounded to half turns; landings on back, front or seat are not separated from a measurement error.',
    needed: 'A rule or a model for the landing position (torso angle at landing).',
  },
  {
    signal: 'Pose model failures',
    problem:
      'Pose models are trained mostly on upright people. When the athlete is inverted, blurred or overlapped, the skeleton can flip or jump, and the confidence here can only notice it if the orientation jumps.',
    needed:
      'Real trampoline footage to measure how often this happens; a model fine-tuned on trampoline poses if it is frequent.',
  },
];

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
  if (v === null) return 'unknown';
  if (v <= cfg.legSeparation.lowMax) return 'low';
  if (v >= cfg.legSeparation.highMin) return 'high';
  return 'medium';
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
        limitations: [
          {
            signal: 'Jump boundaries',
            problem:
              'The takeoff or the landing is not in the clip, so the rotation and the shape over the whole flight are unknown.',
            needed: 'A clip that starts before the takeoff and ends after the landing.',
          },
        ],
        summary: 'This jump is cut off at the start or the end of the clip.',
      };
    }

    // --- evidence -------------------------------------------------------------------------------
    const s = f.shape;
    add(
      'hip_angle',
      'Hip angle',
      deg(s.hipAngle.atPeak),
      s.hipAngle.atPeak,
      'shoulder–hip–knee at the most closed moment; 180° = open',
    );
    add(
      'knee_angle',
      'Knee angle',
      deg(s.kneeAngle.atPeak),
      s.kneeAngle.atPeak,
      'hip–knee–ankle at the same moment; 180° = straight legs',
    );
    add(
      'body_orientation',
      'Body orientation',
      deg(f.orientation.apexDeg),
      f.orientation.apexDeg,
      'trunk angle from vertical at the apex',
    );
    const sep = s.legSeparation.atPeak;
    add(
      'leg_separation',
      'Leg separation',
      `${levelOf(sep, cfg)}${sep === null ? '' : ` (${sep.toFixed(2)})`}`,
      sep,
      'ankle distance / leg length; barely visible from the side',
    );
    add(
      'rotation',
      'Rotation',
      `${r.turns === null ? '–' : r.turns.toFixed(1)} turns (≈${r.nearestDeg}°, confidence ${pct(r.confidence)})`,
      r.turns,
      `${r.direction}${r.residualDeg === null ? '' : `, ${Math.round(Math.abs(r.residualDeg))}° from the nearest half turn`}`,
    );
    const kt = s.kneeTorsoDistance.atPeak;
    add(
      'knee_torso',
      'Knees to torso',
      kt === null ? '–' : `${kt.toFixed(2)} trunk lengths`,
      kt,
      'small = knees drawn in',
    );
    add(
      'compactness',
      'Body compactness',
      s.compactness.atPeak === null ? '–' : s.compactness.atPeak.toFixed(2),
      s.compactness.atPeak,
      '0 = stretched, higher = folded',
    );
    add(
      'position',
      'Body position',
      `${p.label} (${pct(p.confidence)})`,
      p.ruleScore,
      `over the flight: ${(['straight', 'tuck', 'pike', 'unknown'] as const).map((k) => `${k} ${pct(p.timeShare[k])}`).join(', ')}`,
    );
    add(
      'facing',
      'Facing',
      face.sign === 0
        ? `undetermined (${pct(face.confidence)})`
        : `${face.sign > 0 ? 'right' : 'left'} of the image (${pct(face.confidence)})${face.source === 'manual' ? ', set manually' : ''}`,
      face.sign,
      face.source === 'manual'
        ? undefined
        : `face ${face.cues.face?.toFixed(2) ?? '–'}, knee ${face.cues.knee?.toFixed(2) ?? '–'}, foot ${face.cues.foot?.toFixed(2) ?? '–'} (each -1 = left … +1 = right)`,
    );
    add(
      'pose_quality',
      'Pose quality in flight',
      pct(f.quality.pose),
      f.quality.pose,
      'measured joints count 1, interpolated 0.6, corrected 0.4, missing 0',
    );

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
        summary = `No rotation (${deg(r.totalDeg)}), but the body position is between the definitions (hip ${deg(s.hipAngle.atPeak)}, knee ${deg(s.kneeAngle.atPeak)}).`;
        limitations.push({
          signal: 'Body position',
          problem: `Hip ${deg(s.hipAngle.atPeak)} and knee ${deg(s.kneeAngle.atPeak)} fit no definition well (transitional shape, or the pose is noisy).`,
          needed:
            'Adjust the thresholds if this athlete is more or less flexible than the defaults, or a cleaner pose.',
        });
      } else {
        skill = `${p.label}-jump` as SkillId;
        parts = [
          { name: 'rotation (none)', value: r.parts.rounding },
          { name: 'rotation quality', value: rotQuality },
          { name: 'body position rule', value: p.ruleScore },
          { name: 'shape held', value: p.stability },
          { name: 'pose quality', value: f.quality.pose },
        ];
        parts.push({ name: 'side-on view', value: viewFactor });
        confidence = r.parts.rounding * rotQuality * p.ruleScore * p.stability * f.quality.pose * viewFactor;
        summary =
          p.label === 'straight'
            ? `No rotation and the hips (${deg(s.hipAngle.atPeak)}) and knees (${deg(s.kneeAngle.atPeak)}) stay open.`
            : p.label === 'pike'
              ? `No rotation; the hips fold to ${deg(s.hipAngle.atPeak)} while the legs stay straight (knees ${deg(s.kneeAngle.atPeak)}).`
              : `No rotation; the hips fold to ${deg(s.hipAngle.atPeak)} and the knees bend to ${deg(s.kneeAngle.atPeak)}.`;
      }
    } else if (nHalf === 2) {
      if (face.sign === 0) {
        skill = 'somersault-direction-unknown';
        parts = [
          { name: 'rotation (360°)', value: r.parts.rounding },
          { name: 'rotation quality', value: rotQuality },
        ];
        parts.push({ name: 'side-on view', value: viewFactor });
        confidence = r.parts.rounding * rotQuality * viewFactor;
        summary = `A full rotation (${deg(r.totalDeg)}, ${r.direction}), but which way the athlete faces is unknown, so front and back cannot be told apart.`;
        limitations.push({
          signal: 'Facing direction',
          problem: `The face, knee and toe cues are too weak or disagree (${pct(face.confidence)} confidence): a clockwise turn is a front somersault for an athlete facing right and a back somersault for one facing left.`,
          needed: 'A clearer side view (larger athlete, face and feet visible), or set the facing side manually.',
        });
      } else {
        skill = forward > 0 ? 'front' : 'back';
        parts = [
          { name: 'rotation (360°)', value: r.parts.rounding },
          { name: 'rotation quality', value: rotQuality },
          { name: 'facing', value: face.confidence },
        ];
        parts.push({ name: 'side-on view', value: viewFactor });
        confidence = r.parts.rounding * rotQuality * face.confidence * viewFactor;
        summary = `A full rotation (${deg(r.totalDeg)}, ${r.direction}) with the athlete facing ${face.sign > 0 ? 'right' : 'left'}: the body turned ${forward > 0 ? 'toward' : 'away from'} the face, which is a ${forward > 0 ? 'front' : 'back'} somersault.`;
      }
    } else {
      summary = `Rotation ≈ ${r.nearestDeg}° (${r.turns?.toFixed(1)} turns) is outside the initial skill set (no rotation or one full somersault).`;
    }

    // --- limitations that come from this jump's data ---------------------------------------------
    if (f.quality.pose < 0.6) {
      limitations.push({
        signal: 'Pose quality',
        problem: `Only ${pct(f.quality.pose)} of the core joint samples in the flight were measured directly (the rest interpolated, corrected or missing).`,
        needed: 'Higher resolution or a closer athlete, better light, a faster shutter (less blur), fewer occlusions.',
      });
    }
    if (f.quality.trunkLengthVariation !== null && f.quality.trunkLengthVariation > cfg.maxTrunkVariation) {
      limitations.push({
        signal: 'Camera view',
        problem: `The 2D trunk length changes by ${pct(f.quality.trunkLengthVariation)} during the flight; from a side-on camera it should stay nearly constant.`,
        needed: 'A side-on camera (or 3D pose); otherwise angles and rotation are distorted.',
      });
    }
    if (r.maxStepDeg !== null && r.maxStepDeg > cfg.rotation.maxStepDeg) {
      limitations.push({
        signal: 'Orientation tracking',
        problem: `The body orientation changes by up to ${deg(r.maxStepDeg)} between two samples: the rotation may be miscounted, or the pose model flipped the body.`,
        needed: 'A higher frame rate (analyze every frame) and a check of the skeleton at the inverted moments.',
      });
    }
    if (r.reversalDeg !== null && r.reversalDeg > cfg.rotation.reversalOkDeg) {
      limitations.push({
        signal: 'Orientation tracking',
        problem: `The body orientation turned one way and then back by ${deg(r.reversalDeg)}. A real rotation keeps going one way, so the pose model probably flipped or lost the athlete when inverted, and the net rotation is not trustworthy.`,
        needed:
          'Check the skeleton on the inverted frames; a pose model that handles inverted athletes, or a manual correction.',
      });
    }
    if (r.crossCheckDiffDeg !== null && Math.abs(r.crossCheckDiffDeg) > 60) {
      limitations.push({
        signal: 'Rotation cross-check',
        problem: `The body line (ankles to head) rotated ${deg(Math.abs(r.crossCheckDiffDeg))} differently from the trunk (hips to shoulders).`,
        needed: 'A cleaner pose at the takeoff and landing frames.',
      });
    }
    if (r.residualDeg !== null && Math.abs(r.residualDeg) > 0.66 * tol) {
      limitations.push({
        signal: 'Rotation granularity',
        problem: `The rotation (${deg(r.totalDeg)}) is ${deg(Math.abs(r.residualDeg))} from the nearest half turn. It may be a quarter-turn skill (such as a drop) or a measurement error.`,
        needed: 'A landing-position rule (torso angle at landing) to recognize quarter turns.',
      });
    }
    if (face.twistSuspected) {
      limitations.push({
        signal: 'Twist',
        problem:
          'The facing before the takeoff differs from the facing at the landing: the athlete may have twisted, or the pose flipped.',
        needed: '3D pose or a second camera to measure the twist.',
      });
    }

    // --- final ---------------------------------------------------------------------------------------
    let label = SKILL_LABELS[skill];
    if (skill !== 'unclassified' && confidence < cfg.minConfidence) {
      summary = `Best guess ${SKILL_LABELS[skill]} at ${pct(confidence)}, below the minimum of ${pct(cfg.minConfidence)}. ${summary}`;
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
