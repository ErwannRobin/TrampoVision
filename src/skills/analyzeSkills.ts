import type { AnalysisResult } from '../analysis/types';
import type { TwistAnalysis } from '../pose3d/twist';
import { temporalClassifier } from './temporal/classifier';
import { excludeSelf, validExamples, type Reference } from './temporal/prototypes';
import { mergeSkillConfig, type DeepPartial, type SkillConfig } from './config';
import { computeFrameShape, type FrameShape } from './frameShape';
import { extractJump } from './jumpFeatures';
import { twistTrajectory } from './twistTrajectory';
import type { JumpSkillResult, SkillClassifier } from './types';

export interface SkillAnalysis {
  config: SkillConfig;
  classifier: { id: string; version: string };
  /** Per-sample measurements over the whole clip (angles, distances, body position, facing cues). */
  frames: FrameShape;
  /** One entry per detected jump, in order. */
  jumps: JumpSkillResult[];
}

/**
 * Stage 3: from the analysis (skeleton, center of mass, jump cycles, orientation) to one normalized
 * sequence, one feature object and one prediction per jump.
 *
 *   AnalysisResult -> per-sample shape measurements -> per-jump features + normalized sequence -> classifier
 *
 * The classifier is a parameter: the rule set is the default, and a learned temporal model can implement the
 * same `SkillClassifier` interface (it receives the features and the normalized sequence).
 */
export function analyzeSkills(
  result: AnalysisResult,
  options: {
    config?: DeepPartial<SkillConfig>;
    classifier?: SkillClassifier;
    twist?: TwistAnalysis | null;
    /** Labelled examples to compare with (see `dataset/references.ts`). */
    references?: Reference[];
    /** The video being analysed: its own labelled jumps are not compared with themselves. */
    videoId?: string | null;
  } = {},
): SkillAnalysis {
  const config = mergeSkillConfig(options.config);
  const classifier = options.classifier ?? temporalClassifier;
  const frames = computeFrameShape(result, config);
  const jumps = result.jumps.cycles.map<JumpSkillResult>((cycle, i) => {
    const { features, sequence } = extractJump(result, frames, cycle, config);
    const estimate = options.twist?.jumps[i];
    const twist = estimate
      ? {
          estimate,
          trajectory: twistTrajectory(options.twist?.frames ?? null, result.time, cycle, config.sequenceSamples),
        }
      : null;
    const examples = validExamples(options.references ?? []);
    const references = options.videoId
      ? excludeSelf(examples, { videoId: options.videoId, apexS: cycle.apexTimeS })
      : examples;
    const prediction = classifier.classify({ cycle, features, sequence, twist, config, references });
    return { cycle, features, sequence, prediction };
  });
  return { config, classifier: { id: classifier.id, version: classifier.version }, frames, jumps };
}
