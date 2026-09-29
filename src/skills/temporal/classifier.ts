import {
  analyzeStages,
  candidateOf,
  cutOff,
  diagnose,
  hierarchicalClassifier,
  legacyId,
  movementOf,
  pct,
  twistLabel,
} from '../hierarchical';
import {
  SKILL_LABELS,
  type Certainty,
  type ClassifierInput,
  type EvidenceItem,
  type SkillClassifier,
  type SkillId,
  type SkillPrediction,
  type TemporalComparison,
} from '../types';
import { alignTo, dtw, similarity, type DtwOptions, type DtwResult } from './dtw';
import { modelReferences, type Reference } from './prototypes';
import { CHANNELS, CHANNEL_LABELS, buildSignature, measuredMovement, type MovementSignature } from './signature';

const ID = { id: 'temporal', version: '1' } as const;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** The best match of one element among its references. */
interface Match {
  reference: Reference;
  result: DtwResult;
  similarity: number;
}

function bestMatches(sig: MovementSignature, refs: readonly Reference[], o: DtwOptions, scale: number) {
  const byElement = new Map<string, Match>();
  for (const reference of refs) {
    const result = dtw(sig, reference.signature, o);
    const sim = similarity(result.distance, scale);
    const have = byElement.get(reference.elementId);
    if (!have || sim > have.similarity) byElement.set(reference.elementId, { reference, result, similarity: sim });
  }
  return byElement;
}

function comparisonOf(sig: MovementSignature, elementId: string, m: Match): TemporalComparison {
  const n = sig.samples;
  return {
    elementId,
    referenceKind: m.reference.kind,
    referenceId: m.reference.id,
    distance: m.result.distance,
    similarity: m.similarity,
    channels: CHANNELS.filter(
      (c) => sig.trust[c] > 0 && sig.channels[c].some(Number.isFinite) && Number.isFinite(m.result.perChannel[c]),
    ).map((c) => ({
      channel: c,
      label: CHANNEL_LABELS[c],
      detected: sig.channels[c],
      reference: alignTo(m.result.path, m.reference.signature.channels[c], n),
      distance: m.result.perChannel[c],
    })),
  };
}

const certaintyWord: Record<Certainty, string> = {
  confident: 'confident',
  probable: 'probable',
  tentative: 'tentative guess',
};

/**
 * Classifies a jump by its movement signature. The four structural questions (somersaults, direction, twists, position) give each
 * element of the table a probability; the trajectories of the jump (rotation, twist, hip and knee angles, height, angular velocity
 * over normalized time) are compared with the expected trajectory of every element, and with the labelled examples, by dynamic time
 * warping. The two are blended, so an element needs both the right counts and the right shape.
 *
 * The result is a movement first (`measured`: continuous counts and trajectories), then an element found by table lookup. A jump is
 * left unclassified only when it is cut off, the data is too poor, or no candidate is plausible; a weakly supported best candidate
 * is returned as a tentative guess, with its confidence and its alternatives, instead of being hidden.
 */
export const temporalClassifier: SkillClassifier = {
  ...ID,
  description:
    'Movement signature compared with every element by dynamic time warping, blended with the four structural stages.',
  classify(input: ClassifierInput): SkillPrediction {
    const { features: f, config: cfg } = input;
    if (!f.complete || f.rotation.totalDeg === null) return { ...cutOff(), classifier: ID };
    const sig = buildSignature(input.sequence, input.twist ?? null);
    if (!sig) return hierarchicalClassifier.classify(input);

    const t = cfg.temporal;
    const options: DtwOptions = {
      bandFraction: t.bandFraction,
      warpPenalty: t.warpPenalty,
      endSigma: t.endSigma,
      endWeight: t.endWeight,
      sigma: t.sigma,
      weights: t.weights,
    };
    const { stages, scored, outOfTable, quality } = analyzeStages(input);
    const refs = [...modelReferences(sig.samples), ...(input.references ?? [])];
    const matches = bestMatches(sig, refs, options, t.similarityScale);
    // The trajectories act as a likelihood on the structural probability of each element, and what the table does not contain gets a
    // neutral one, so a jump far from every element is not made to look certain by the normalization.
    const gamma = Math.max(0, t.similarityExponent);
    const neutral = 0.5 ** gamma;
    const weighted = scored.map((sc) => {
      const m = matches.get(sc.element.id);
      const sim = m?.similarity ?? 0;
      return { sc, m, sim, mass: sc.posterior * sim ** gamma };
    });
    const total = weighted.reduce((s, r) => s + r.mass, 0) + outOfTable * neutral;
    const ranked = weighted
      .map((r) => ({ ...r, blend: total > 0 ? r.mass / total : 0 }))
      .sort((a, b) => b.blend - a.blend);
    const best = ranked[0];
    const confidence = clamp01(best.blend * quality);
    const e = best.sc.element;

    // Front and back that the data cannot tell apart: the same movement in both directions is nearly as good.
    const twin = ranked.find(
      (r) =>
        r.sc.element.somersaults === e.somersaults &&
        r.sc.element.twists === e.twists &&
        r.sc.element.position === e.position &&
        r.sc.element.direction !== e.direction,
    );
    const directionOnly =
      e.somersaults > 0 && !stages.dir.measured && twin !== undefined && best.blend + twin.blend >= 0.5;

    const turns = Math.abs(f.rotation.turns ?? 0);
    const offGridDeg = Math.abs(turns - Math.round(turns)) * 360;
    const plausible =
      best.sim >= t.plausibleSimilarity &&
      best.sc.posterior >= t.plausibleStructure &&
      offGridDeg <= t.maxOffGridDeg &&
      quality >= 0.25;
    const certainty: Certainty | null =
      confidence >= t.confidentAt
        ? 'confident'
        : confidence >= cfg.minConfidence
          ? 'probable'
          : plausible
            ? 'tentative'
            : null;

    const base = hierarchicalClassifier.classify(input);
    const dirDist = stages.dir.dist;
    const direction = !stages.dir.measured
      ? null
      : (dirDist.get('front') ?? 0) >= (dirDist.get('back') ?? 0)
        ? 'front'
        : 'back';
    const measured = measuredMovement(sig, e.somersaults > 0 ? direction : null, f.position.label);
    const comparison = best.m ? comparisonOf(sig, e.id, best.m) : undefined;

    const candidates = ranked.slice(0, 5).map((r) => ({
      ...candidateOf(r.sc, stages),
      similarity: r.sim,
      structure: r.sc.posterior,
      score: clamp01(r.blend * quality),
      reference: r.m ? { kind: r.m.reference.kind, id: r.m.reference.id } : undefined,
    }));

    const evidence: EvidenceItem[] = [
      ...base.evidence,
      {
        key: 'temporal_similarity',
        label: 'Trajectory match',
        text: pct(best.sim),
        value: best.sim,
        note: best.m
          ? `closest reference: ${best.m.reference.kind === 'example' ? 'a labelled example' : 'the expected movement'} of ${e.name}`
          : undefined,
      },
      ...(offGridDeg > 25
        ? [
            {
              key: 'rotation_offset',
              label: 'Rotation from the nearest whole somersault',
              text: `${Math.round(offGridDeg)}°`,
              value: offGridDeg,
              note: 'an under- or over-rotated somersault, or a quarter-turn skill that is not in the table',
            },
          ]
        : []),
      ...(comparison?.channels ?? []).map((c) => ({
        key: `trajectory_${c.channel}`,
        label: c.label,
        text: c.distance === null ? '–' : `${c.distance.toFixed(1)} tolerances off`,
        value: c.distance,
      })),
    ];

    let skill: SkillId = 'unclassified';
    let label: string = SKILL_LABELS.unclassified;
    let outConfidence = confidence;
    let outCertainty: Certainty | undefined;
    let movement = undefined as SkillPrediction['movement'];
    let elementId: string | undefined;
    let failure: SkillPrediction['failure'];
    let summary: string;

    const measuredText = [
      `${measured.somersaults.toFixed(2)} somersault${measured.somersaults === 1 ? '' : 's'}`,
      measured.twists === null
        ? 'twist not measured'
        : `${measured.twists.toFixed(2)} twist${measured.twists === 1 ? '' : 's'}`,
      f.position.label === 'unknown'
        ? 'position unclear'
        : `${f.position.label} (hips ${Math.round(f.shape.hipAngle.atPeak ?? NaN)}°, knees ${Math.round(f.shape.kneeAngle.atPeak ?? NaN)}°)`,
    ].join(', ');

    if (certainty && directionOnly && twin) {
      skill = 'somersault-direction-unknown';
      label = SKILL_LABELS[skill];
      outConfidence = clamp01((best.blend + twin.blend) * quality);
      outCertainty = outConfidence >= cfg.minConfidence ? 'probable' : 'tentative';
      movement = { ...movementOf(e), direction: null };
      summary = `${e.somersaults} somersault(s), ${twistLabel(Math.round(e.twists * 2))}, ${e.position}: the direction (front or back) cannot be told (${stages.dir.report.notes[0]}).`;
    } else if (certainty) {
      skill = legacyId(e);
      label = e.name;
      outCertainty = certainty;
      movement = movementOf(e);
      elementId = e.id;
      summary = `${e.name} (${certaintyWord[certainty]}, ${pct(confidence)}): measured ${measuredText}; ${pct(best.sim)} match to the expected trajectory.`;
    } else {
      failure = diagnose(f, stages, best.sc, outOfTable, quality);
      summary = `No plausible candidate: the closest is ${e.name} (${pct(best.sim)} trajectory match, ${pct(best.sc.posterior)} structural). ${failure.message}`;
    }

    const scores: Partial<Record<SkillId, number>> = {};
    for (const r of ranked.slice(0, 8)) {
      const id = legacyId(r.sc.element);
      scores[id] = Math.max(scores[id] ?? 0, r.blend * quality);
    }

    return {
      classifier: ID,
      skill,
      label,
      confidence: outConfidence,
      scores,
      confidenceParts: [
        { name: 'structure', value: best.sc.posterior },
        { name: 'trajectory match', value: best.sim },
        { name: 'data quality', value: quality },
      ],
      evidence,
      limitations: base.limitations,
      summary,
      movement,
      elementId,
      candidates,
      stages: base.stages,
      outOfTable,
      dataQuality: quality,
      failure,
      certainty: outCertainty,
      measured,
      comparison,
    };
  },
};
