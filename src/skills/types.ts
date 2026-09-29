import type { JumpCycle } from '../analysis/jumpCycles';
import type { TwistEstimate } from '../pose3d/twist';
import type { SkillConfig } from './config';
import type { Movement } from './fig/elements';

/** Body positions the rule set can tell apart. "unknown" = between the definitions or not enough data. */
export const POSITIONS = ['straight', 'tuck', 'pike', 'unknown'] as const;
export type BodyPosition = (typeof POSITIONS)[number];
export type KnownPosition = Exclude<BodyPosition, 'unknown'>;
export const POSITION_CODE: Record<BodyPosition, number> = { straight: 0, tuck: 1, pike: 2, unknown: 3 };

/** Rule scores 0..1: how well the measurements match each definition. */
export type PositionScores = Record<KnownPosition, number>;

export interface PositionEstimate {
  label: BodyPosition;
  scores: PositionScores;
  /** Score of the winner, 0 when unknown. */
  ruleScore: number;
}

/** A summary of one measurement over the flight. `atPeak` = median over the most closed moment. */
export interface ShapeStat {
  atPeak: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
}

export interface JumpPosition extends PositionEstimate {
  /** Share of the window's frames that fit each position (frame by frame). */
  timeShare: Record<BodyPosition, number>;
  /** Normalized flight time (0 = takeoff, 1 = landing) of the most closed moment. */
  peakTimeU: number | null;
  /** Share of the analysed flight spent near the most closed shape, relative to `minHoldShare`: 1 = held, 0 = a fleeting fold. */
  stability: number;
  /** ruleScore x stability x pose quality. */
  confidence: number;
}

export type RotationDirection = 'clockwise' | 'counterclockwise' | 'none';

export interface RotationEstimate {
  /** Net trunk rotation between takeoff and landing, degrees (+ = clockwise on screen). */
  totalDeg: number | null;
  turns: number | null;
  direction: RotationDirection;
  /** |rotation| rounded to the nearest multiple of the step (0, 180, 360, ...). */
  nearestDeg: number | null;
  halfTurns: number | null;
  /** |rotation| minus the nearest multiple, degrees. */
  residualDeg: number | null;
  confidence: number;
  parts: { rounding: number; coverage: number; steps: number; crossCheck: number; monotonic: number };
  /** Largest orientation change between two samples inside the flight, degrees. */
  maxStepDeg: number | null;
  /** Rotation of the body line (ankles to head) minus rotation of the trunk, degrees: an independent check. */
  crossCheckDiffDeg: number | null;
  /** Largest move of the orientation against the direction of the net rotation, degrees. Near 0 for a clean rotation; large when the orientation went one way and came back (a pose flip). */
  reversalDeg: number | null;
}

export interface FacingEstimate {
  /** +1: the athlete's forward is toward the right of the image when upright; -1: left; 0: unknown. */
  sign: 1 | -1 | 0;
  confidence: number;
  source: 'auto' | 'manual';
  /** Mean vote of each cue in [-1, 1] (+ = facing right when upright); null = no usable samples. */
  cues: { face: number | null; knee: number | null; foot: number | null };
  /** Share of the cue strength that agrees with the winning sign. */
  agreement: number;
  /** The facing before the takeoff and near the landing disagree: the athlete may have twisted. */
  twistSuspected: boolean;
}

export interface JumpFeatures {
  version: 1;
  jump: number;
  /** Both takeoff and landing were seen. Incomplete jumps get no sequence and no classification. */
  complete: boolean;
  timing: {
    takeoffTimeS: number | null;
    apexTimeS: number;
    landingTimeS: number | null;
    flightTimeS: number | null;
    timeToApexS: number | null;
    apexToLandingS: number | null;
  };
  trajectory: {
    /** Highest point of the center of mass above the height reference (the bed when calibrated), meters. */
    maxHeightM: number;
    /** Height gained between takeoff and apex, meters and in body lengths. */
    riseM: number | null;
    riseBodyLengths: number | null;
    takeoffVyMps: number | null;
    horizontalDisplacementM: number | null;
    horizontalDisplacementBodyLengths: number | null;
    /** Positions in bed-normalized coordinates (+-1 = bed edge along the on-screen horizontal); null when uncalibrated. */
    takeoffXBed: number | null;
    apexXBed: number | null;
    landingXBed: number | null;
  };
  orientation: {
    /** Trunk angle from vertical-up, wrapped to +-180, at the three events. */
    takeoffDeg: number | null;
    apexDeg: number | null;
    landingDeg: number | null;
    /** Largest departure from the takeoff orientation during the flight, degrees. */
    maxDeviationDeg: number | null;
    peakAngularVelocityDps: number | null;
    meanAbsAngularVelocityDps: number | null;
  };
  shape: {
    hipAngle: ShapeStat;
    kneeAngle: ShapeStat;
    /** Angle between the shoulder line and the hip line, 0..90. Unreliable in a side view. */
    shoulderHipAxis: ShapeStat;
    /** Ankle distance / leg length. */
    legSeparation: ShapeStat;
    /** Distance from the knees to the trunk, in trunk lengths. */
    kneeTorsoDistance: ShapeStat;
    /** 1 - (largest distance between head, shoulders, hips, knees, ankles) / (path length through them): 0 = straight line, larger = more folded. */
    compactness: ShapeStat;
  };
  position: JumpPosition;
  rotation: RotationEstimate;
  facing: FacingEstimate;
  quality: {
    /** Mean trust in the core joints during the flight: measured 1, interpolated 0.6, glitch-corrected 0.4, missing 0. */
    pose: number;
    /** Share of the flight's samples with a center of mass. */
    comCoverage: number;
    /** (max - min) / mean of the 2D trunk length during the flight: large = the camera is not side-on, or the pose is wrong. */
    trunkLengthVariation: number | null;
  };
}

/** One normalized sequence per jump: fixed length, independent of resolution, position, size and pixel coordinates. */
export interface JumpSequence {
  jump: number;
  samples: number;
  takeoffTimeS: number;
  landingTimeS: number;
  durationS: number;
  /** Body length in pixels used for the normalization (recorded for reference; the numbers below do not depend on it). */
  bodyLengthPx: number;
  /**
   * Coordinate frame of the joint columns: origin at the hip center, y along the trunk (hips to shoulders),
   * x to the right of the trunk when the athlete is upright; units of body length.
   */
  frame: string;
  columns: string[];
  /** Rows = samples in normalized time (0 = takeoff, 1 = landing), columns as named. NaN = no data (null in JSON). */
  data: number[][];
  /** 1 when the sample has a usable pose and center of mass. */
  valid: number[];
}

export type SkillId =
  | 'straight-jump'
  | 'tuck-jump'
  | 'pike-jump'
  | 'back'
  | 'front'
  | 'fig-element'
  | 'somersault-direction-unknown'
  | 'unclassified';

export const SKILL_LABELS: Record<SkillId, string> = {
  'straight-jump': 'Straight Jump',
  'tuck-jump': 'Tuck Jump',
  'pike-jump': 'Pike Jump',
  back: 'Back',
  front: 'Front',
  'fig-element': 'Element',
  'somersault-direction-unknown': 'Somersault (front or back undetermined)',
  unclassified: 'Unclassified',
};

export interface EvidenceItem {
  /** Stable key for scripts, e.g. "hip_angle". */
  key: string;
  label: string;
  /** Text as shown: "62°", "low", "0.1 turns". */
  text: string;
  value: number | null;
  /** How this measurement relates to the decision. */
  note?: string;
}

export interface Limitation {
  /** The signal that is unreliable or missing. */
  signal: string;
  problem: string;
  /** What would fix it. */
  needed: string;
}

/** The four questions the hierarchical classifier answers, in the order it asks them. */
export type StageId = 'rotation' | 'direction' | 'twists' | 'position';

/** How one measurement stands against what an element needs. `unmeasured` = the signal is missing, so it neither confirms nor rejects. */
export type CheckStatus = 'match' | 'weak' | 'mismatch' | 'unmeasured';

export interface CandidateCheck {
  stage: StageId;
  criterion: string;
  expected: string;
  observed: string;
  status: CheckStatus;
  /** Likelihood of this element's value at this stage relative to the stage's best value, 0..1. */
  match: number;
}

export interface ElementCandidate {
  elementId: string;
  name: string;
  movement: Movement;
  /** Share of the probability mass of the whole movement space, 0..1. */
  posterior: number;
  checks: CandidateCheck[];
}

export interface StageReport {
  stage: StageId;
  title: string;
  /** False when the signal for this question was missing and a prior stood in. */
  measured: boolean;
  observed: string;
  /** Probability of each answer, best first. */
  distribution: { label: string; p: number }[];
  notes: string[];
}

export type FailureKind =
  | 'cut-off'
  | 'rotation-off-grid'
  | 'rotation-ambiguous'
  | 'direction-unknown'
  | 'twist-ambiguous'
  | 'twist-unmeasured'
  | 'position-ambiguous'
  | 'not-in-table'
  | 'low-data-quality';

/** Why a jump was not named: which criterion fell short, by how much, and what would fix it. */
export interface FailureDiagnosis {
  kind: FailureKind;
  criterion: StageId | 'data' | 'table';
  message: string;
  /** The closest element in the table. */
  closest: { elementId: string; name: string } | null;
  /** Per criterion, how far the measurement is from that element (text with units). */
  distances: { stage: StageId; text: string; match: number }[];
  /** Confidence of the closest element if the failing criterion were certain. */
  ifResolved: number | null;
}

export interface SkillPrediction {
  classifier: { id: string; version: string };
  skill: SkillId;
  label: string;
  /** Heuristic 0..1 score (not a calibrated probability). */
  confidence: number;
  /** Score of every candidate skill; the winner is `skill` unless the confidence is too low. */
  scores: Partial<Record<SkillId, number>>;
  /** What the confidence is made of, e.g. rule score x pose quality. */
  confidenceParts: { name: string; value: number }[];
  evidence: EvidenceItem[];
  limitations: Limitation[];
  /** One sentence saying why the skill was chosen or why it could not be. */
  summary: string;
  /** What the classifier recognized, before any naming. Absent for classifiers that do not work in stages. */
  movement?: Movement;
  /** The element of the table this movement maps to (see `fig/elements.ts`). */
  elementId?: string;
  /** Best candidates with their checks, best first (at most 5). */
  candidates?: ElementCandidate[];
  /** The four stages with the probability of each answer. */
  stages?: StageReport[];
  /** Probability mass outside the element table (quarter turns, four somersaults, ...). */
  outOfTable?: number;
  /** Factor from the data quality (pose, camera view) applied to the confidence. */
  dataQuality?: number;
  /** Present when the jump was not named. */
  failure?: FailureDiagnosis;
}

/** The 3D twist of one jump: the estimate and its trajectory (degrees since takeoff, 32 samples from takeoff to landing). */
export interface TwistContext {
  estimate: TwistEstimate;
  trajectory: number[] | null;
}

export interface ClassifierInput {
  cycle: JumpCycle;
  /** Twist about the long axis, when 3D landmarks exist. */
  twist?: TwistContext | null;
  features: JumpFeatures;
  sequence: JumpSequence | null;
  config: SkillConfig;
}

/** Anything that turns one jump's features/sequence into a prediction: the rule set now, a temporal model later. */
export interface SkillClassifier {
  id: string;
  version: string;
  description: string;
  classify(input: ClassifierInput): SkillPrediction;
}

export interface JumpSkillResult {
  cycle: JumpCycle;
  features: JumpFeatures;
  sequence: JumpSequence | null;
  prediction: SkillPrediction;
}
