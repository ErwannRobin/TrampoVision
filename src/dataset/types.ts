import { lazyText, t, type Locale } from '../i18n/core';
import type { MovementLabel } from './movementLabel';
import type { TwistEstimate, TwistSequence } from '../pose3d/twist';
import type { SkillConfig } from '../skills/config';
import type { JumpFeatures, JumpSequence, SkillPrediction } from '../skills/types';

/** What a person says the jump was. "Unknown" = cannot tell, or not one of the five. */
export const TRUTH_LABELS = ['straight', 'tuck', 'pike', 'back', 'front', 'unknown'] as const;
export type TruthLabel = (typeof TRUTH_LABELS)[number];
const TRUTH_KEYS = {
  straight: 'pos.straight',
  tuck: 'pos.tuck',
  pike: 'pos.pike',
  back: 'truth.back',
  front: 'truth.front',
  unknown: 'truth.unknown',
} as const;
/** What each label is called, in the language in use. */
export const TRUTH_TEXT: Record<TruthLabel, string> = lazyText(TRUTH_KEYS);
/** A label in a chosen language (English for a file). */
export const truthText = (label: TruthLabel, locale?: Locale): string => t(TRUTH_KEYS[label], undefined, locale);

/** The five skills the classifier can name, in the order they are listed everywhere. */
export const CLASS_LABELS = ['straight', 'tuck', 'pike', 'back', 'front'] as const;
export type ClassLabel = (typeof CLASS_LABELS)[number];

export const RECORD_SCHEMA = 'trampovision.jump-record';
export const RECORD_VERSION = 1;

export interface GroundTruth {
  label: TruthLabel;
  /** ISO time of the last change. */
  labeledAt: string;
  note?: string;
  /** The choices `label` was derived from (position, direction, somersaults, half twists); absent in files saved before them. */
  movement?: MovementLabel;
}

/** What the annotator counted, in half twists (0, 1, 2, ...). Separate from the skill label: it only serves to check the experimental twist estimate. */
export interface TwistTruth {
  halfTwists: number;
  annotatedAt: string;
}

/** The figure a person says the jump was: an element of the table. A record with a figure is a reference example for the temporal classifier. */
export interface FigureLabel {
  elementId: string;
  /** ISO time of the last change. */
  labeledAt: string;
}

/**
 * The execution deduction a person gives a skill, in points (0 to 0.5), kept with what the app proposed at that moment: the
 * difference between the two is what would tune the thresholds of the execution check.
 */
export interface ExecutionLabel {
  deduction: number;
  /** The deduction the app proposed, or null when it could not judge the skill. */
  proposed: number | null;
  /** ISO time of the last change. */
  labeledAt: string;
  /** The rules the proposal followed (see `coaching/config.ts`). */
  ruleset: string;
}

/**
 * One detected jump with everything the app measured, the prediction, and the person's label.
 * The video itself is never stored: only numbers, so the dataset stays small and stays in this browser.
 */
export interface JumpRecord {
  schema: typeof RECORD_SCHEMA;
  version: typeof RECORD_VERSION;
  /** `${videoId}:${jumpId}` */
  id: string;
  videoId: string;
  /** Number of the jump in its video (1 = first), fixed when the jump is first saved. */
  jumpId: number;
  /** ISO time of the last save. Used to keep the newer copy when two datasets are merged. */
  savedAt: string;
  source: { fileName: string; width: number; height: number; fps: number; sourceFps: number };
  timestamps: { takeoffS: number | null; apexS: number; landingS: number | null; flightTimeS: number | null };
  /** How the numbers below were produced, so a prediction can be reproduced or told apart from one made with other settings. */
  analysis: {
    classifier: { id: string; version: string };
    config: SkillConfig;
    athleteHeightM: number;
    scaleSource: string;
    calibrated: boolean;
  };
  /** Normalized sequence (32 x 58 by default): skeleton in the body frame, COM path, orientation, angular velocity, joint angles, shape measures. Null for a jump cut off by the clip. */
  sequence: JumpSequence | null;
  features: JumpFeatures;
  prediction: SkillPrediction;
  /** Experimental 3D twist: summary and its curve. Null when the pose data had no 3D. */
  twist: { estimate: TwistEstimate; sequence: TwistSequence | null } | null;
  truth: GroundTruth | null;
  twistTruth: TwistTruth | null;
  /** Full figure label; absent in files saved before it existed. */
  figure?: FigureLabel | null;
  /** The execution deduction a person gave; absent in files saved before it existed. */
  execution?: ExecutionLabel | null;
}
