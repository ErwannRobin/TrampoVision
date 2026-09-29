import type { AnalysisResult } from '../analysis/types';
import { ruleBasedClassifier } from './classifier';
import { mergeSkillConfig, type DeepPartial, type SkillConfig } from './config';
import { computeFrameShape, type FrameShape } from './frameShape';
import { extractJump } from './jumpFeatures';
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
  options: { config?: DeepPartial<SkillConfig>; classifier?: SkillClassifier } = {},
): SkillAnalysis {
  const config = mergeSkillConfig(options.config);
  const classifier = options.classifier ?? ruleBasedClassifier;
  const frames = computeFrameShape(result, config);
  const jumps = result.jumps.cycles.map<JumpSkillResult>((cycle) => {
    const { features, sequence } = extractJump(result, frames, cycle, config);
    const prediction = classifier.classify({ cycle, features, sequence, config });
    return { cycle, features, sequence, prediction };
  });
  return { config, classifier: { id: classifier.id, version: classifier.version }, frames, jumps };
}
