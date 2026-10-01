import { FIG_ELEMENTS, MAX_HALF_TWISTS, type FigElement } from '../fig/elements';
import { temporalClassifier } from '../temporal/classifier';
import {
  CHANNELS,
  buildSignature,
  measuredMovement,
  type Channel,
  type MeasuredMovement,
  type MovementSignature,
} from '../temporal/signature';
import type { ClassifierInput, JumpFeatures, SkillClassifier, SkillPrediction } from '../types';
import {
  jevSystemOne,
  type JevChoiceAnswer,
  type JevChoiceQuestion,
  type JevClientOptions,
  type JevResponse,
} from './client';

/**
 * Jev as a classification layer on top of the existing pipeline. Nothing upstream changes: pose, jumps, rotation, twist and the
 * features are what they were. Jev gets the movement signature and the features as text/numbers and answers four typed questions
 * (somersaults, twists, direction, position). The element is then found by table lookup, as everywhere else in the code, and the five
 * best come from the product of the four answers. The temporal (DTW + prototype) classifier is kept and run alongside, for comparison
 * and as the fallback when Jev cannot be reached.
 */

/** Points kept per trajectory when it is written into the state. */
const TRAJECTORY_POINTS = 9;
/** Channels that say something Jev can use; the sin/cos of the orientation only repeat the rotation. */
const SENT_CHANNELS: Channel[] = ['somersault', 'twist', 'hip', 'knee', 'shoulderHip', 'comHeight', 'angVel'];

const round = (v: number | null | undefined, digits = 2): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(digits);

const downsample = (v: number[], k = TRAJECTORY_POINTS) =>
  Array.from({ length: k }, (_, i) => round(v[Math.round((i / (k - 1)) * (v.length - 1))]));

/** What Jev is shown for one jump. Measurements only: no pixel, no image, no file name. */
export interface JevState {
  task: string;
  /** Counts read off the rotation and twist curves (continuous, not rounded) and the body position rule. */
  measured: { somersaultTurns: number; twistTurns: number | null; position: MeasuredMovement['position'] };
  rotation: {
    totalDeg: number | null;
    onScreen: string;
    residualFromWholeTurnDeg: number | null;
    confidence: number;
    reversalDeg: number | null;
  };
  facing: {
    facesRight: boolean | null;
    confidence: number;
    twistSuspected: boolean;
    cues: { face: number | null; knee: number | null; foot: number | null };
  };
  bodyShape: {
    ruleScores: Record<string, number>;
    hipAngleAtMostClosedDeg: number | null;
    kneeAngleAtMostClosedDeg: number | null;
    hipAngleMinDeg: number | null;
    kneeAngleMinDeg: number | null;
    legSeparationMax: number | null;
    kneeToTorsoMin: number | null;
    compactnessMax: number | null;
  };
  motion: {
    flightTimeS: number | null;
    riseBodyLengths: number | null;
    peakAngularVelocityDps: number | null;
    shoulderHipAxisMaxDeg: number | null;
  };
  quality: { pose: number; twistTrust: number; problems: string[] };
  /** Time series over the flight (takeoff to landing, equally spaced); null = not measured. Rotation and twist in turns, angles /180, height / peak. */
  trajectories: Partial<Record<Channel, (number | null)[]>>;
}

/** The lowest the height may fall below takeoff (in peak heights) and the most the rotation may run backwards (in turns) before the curves are doubted. */
const MAX_HEIGHT_BELOW_TAKEOFF = 0.75;
const MAX_ROTATION_BACKSTEP = 0.2;
/** Under this many measured somersault turns, a dip is wobble, not a broken curve. */
const MIN_TURNS_FOR_BACKSTEP = 0.75;

/**
 * Signs that the measured curves cannot be trusted: a panning or cutting camera moves the center of mass and the trunk angle in
 * ways no jump does. Jev cannot see this from the numbers alone, and it answers with the same confidence on broken input.
 */
export function signalProblems(sig: Pick<MovementSignature, 'channels' | 'trust'>): string[] {
  const out: string[] = [];
  const height = sig.channels.comHeight.filter(Number.isFinite);
  if (sig.trust.comHeight > 0 && height.length && Math.min(...height) < -MAX_HEIGHT_BELOW_TAKEOFF) {
    out.push(
      `center of mass falls ${Math.abs(Math.min(...height)).toFixed(1)} peak heights below takeoff (camera moved?)`,
    );
  }
  const rot = sig.channels.somersault.filter(Number.isFinite);
  if (sig.trust.somersault > 0 && rot.length && Math.max(...rot.map(Math.abs)) >= MIN_TURNS_FOR_BACKSTEP) {
    const sign = Math.sign(rot.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0));
    let peak = 0;
    let back = 0;
    for (const v of rot) {
      peak = Math.max(peak, v * sign);
      back = Math.max(back, peak - v * sign);
    }
    if (back > MAX_ROTATION_BACKSTEP)
      out.push(`rotation runs back ${back.toFixed(2)} turns (camera moved or rotation cut off?)`);
  }
  return out;
}

export function buildJevState(f: JumpFeatures, sig: MovementSignature, measured: MeasuredMovement): JevState {
  const trajectories: JevState['trajectories'] = {};
  for (const c of SENT_CHANNELS) {
    if (sig.trust[c] > 0 && sig.channels[c].some(Number.isFinite)) trajectories[c] = downsample(sig.channels[c]);
  }
  return {
    task: 'One trampoline jump described by motion measurements from a single side camera. No video is available.',
    measured: {
      somersaultTurns: measured.somersaults,
      twistTurns: measured.twists,
      position: measured.position,
    },
    rotation: {
      totalDeg: round(f.rotation.totalDeg, 0),
      onScreen: f.rotation.direction,
      residualFromWholeTurnDeg: round(f.rotation.residualDeg, 0),
      confidence: round(f.rotation.confidence) ?? 0,
      reversalDeg: round(f.rotation.reversalDeg, 0),
    },
    facing: {
      facesRight: f.facing.sign === 0 ? null : f.facing.sign > 0,
      confidence: round(f.facing.confidence) ?? 0,
      twistSuspected: f.facing.twistSuspected,
      cues: { face: round(f.facing.cues.face), knee: round(f.facing.cues.knee), foot: round(f.facing.cues.foot) },
    },
    bodyShape: {
      ruleScores: Object.fromEntries(Object.entries(f.position.scores).map(([k, v]) => [k, round(v) ?? 0])),
      hipAngleAtMostClosedDeg: round(f.shape.hipAngle.atPeak, 0),
      kneeAngleAtMostClosedDeg: round(f.shape.kneeAngle.atPeak, 0),
      hipAngleMinDeg: round(f.shape.hipAngle.min, 0),
      kneeAngleMinDeg: round(f.shape.kneeAngle.min, 0),
      legSeparationMax: round(f.shape.legSeparation.max),
      kneeToTorsoMin: round(f.shape.kneeTorsoDistance.min),
      compactnessMax: round(f.shape.compactness.max),
    },
    motion: {
      flightTimeS: round(f.timing.flightTimeS),
      riseBodyLengths: round(f.trajectory.riseBodyLengths),
      peakAngularVelocityDps: round(f.orientation.peakAngularVelocityDps, 0),
      shoulderHipAxisMaxDeg: round(f.shape.shoulderHipAxis.max, 0),
    },
    quality: {
      pose: round(f.quality.pose) ?? 0,
      twistTrust: round(sig.trust.twist) ?? 0,
      problems: signalProblems(sig),
    },
    trajectories,
  };
}

const MAX_TWISTS = Math.max(...MAX_HALF_TWISTS) / 2;
const TWIST_OPTIONS = Array.from({ length: MAX_TWISTS * 2 + 1 }, (_, h) => String(h / 2));

export const QUESTIONS: Record<'somersaults' | 'twists' | 'direction' | 'position', JevChoiceQuestion> = {
  somersaults: {
    type: 'choice',
    instructions:
      'How many full somersaults (whole-body rotations about the hip axis) did the athlete perform in this flight? ' +
      'Use measured.somersaultTurns, rotation and the somersault trajectory (turns since takeoff). A rotation under about a quarter turn is no somersault. ' +
      'A count just under a whole number (such as 1.4 or 1.9) can be a rotation the camera lost before landing: weigh it with motion.flightTimeS and the peak angular velocity, ' +
      'and distrust it when quality.problems is not empty.',
    criteria: {
      '0': 'No somersault: a plain or twisting jump',
      '1': 'Single somersault, about 1 turn',
      '2': 'Double somersault, about 2 turns',
      '3': 'Triple somersault, about 3 turns',
    },
  },
  twists: {
    type: 'choice',
    instructions:
      'How many full twists (rotation about the long axis of the body) did the athlete perform? Halves are possible. ' +
      'Use measured.twistTurns and the twist trajectory when twistTrust is above 0; with no twist measurement, facing.twistSuspected and the quality of the facing cues are the only evidence, so lean to 0.',
    criteria: Object.fromEntries(
      TWIST_OPTIONS.map((o) => [
        o,
        o === '0' ? 'No twist' : `${o} full twist${o === '1' ? '' : 's'} (${+o * 360}° about the long axis)`,
      ]),
    ),
  },
  direction: {
    type: 'choice',
    instructions:
      'In which direction did the athlete somersault? Ignore this when there is no somersault (then answer back). ' +
      'The camera sees the athlete from the side. rotation.onScreen is the direction the trunk turned on the screen. ' +
      'facing.facesRight says which way the athlete faces when upright. Clockwise on screen while facing right, or counterclockwise while facing left, is a front somersault; the opposite pairs are back somersaults.',
    criteria: {
      front: 'Forward rotation: the top of the body travels toward the side the athlete faces',
      back: 'Backward rotation: the top of the body travels away from the side the athlete faces',
    },
  },
  position: {
    type: 'choice',
    instructions:
      'What body position did the athlete hold during the flight? Read it at the most closed moment (bodyShape). ' +
      'Hip angle is shoulder-hip-knee, knee angle is hip-knee-ankle, 180° = fully straight.',
    criteria: {
      straight: 'Open hips (about 155° or more) and straight legs',
      tuck: 'Folded hips (about 125° or less) with bent knees (about 115° or less)',
      pike: 'Folded hips (about 125° or less) with straight legs',
    },
  },
};

export type QuestionId = keyof typeof QUESTIONS;

export interface JevCandidate {
  elementId: string;
  name: string;
  /** Share of the table's probability mass, from the four answers multiplied. */
  probability: number;
  /** The four answers multiplied, before normalizing: low when no element fits what Jev said, whatever the share. */
  mass: number;
  /** The probability each answer gave to this element's value. */
  parts: Record<QuestionId, number>;
}

/** The five best elements: each is scored by the product of the four answers, and the scores are normalized over the table. */
export function rankElements(
  answers: Record<QuestionId, JevChoiceAnswer>,
  top = 5,
  elements: readonly FigElement[] = FIG_ELEMENTS,
): JevCandidate[] {
  const p = (q: QuestionId, option: string) => answers[q].probabilities[option] ?? 0;
  const scored = elements.map((e) => {
    const parts: Record<QuestionId, number> = {
      somersaults: p('somersaults', String(e.somersaults)),
      twists: p('twists', String(e.twists)),
      // A jump without somersault has no direction: the question does not weigh on it.
      direction: e.somersaults === 0 ? 1 : p('direction', e.direction ?? 'back'),
      position: p('position', e.position),
    };
    return { e, parts, mass: parts.somersaults * parts.twists * parts.direction * parts.position };
  });
  const total = scored.reduce((s, r) => s + r.mass, 0);
  return scored
    .sort((a, b) => b.mass - a.mass)
    .slice(0, top)
    .map((r) => ({
      elementId: r.e.id,
      name: r.e.name,
      probability: total > 0 ? r.mass / total : 0,
      mass: r.mass,
      parts: r.parts,
    }));
}

/** What Jev answered when the best option of each question together is not a FIG element (null when it is one). */
export function outOfTable(answers: Record<QuestionId, JevChoiceAnswer>): string | null {
  const som = Number(answers.somersaults.choice);
  const tw = Number(answers.twists.choice);
  const { position, direction } = { position: answers.position.choice, direction: answers.direction.choice };
  const exists = FIG_ELEMENTS.some(
    (e) =>
      e.somersaults === som && e.twists === tw && e.position === position && (som === 0 || e.direction === direction),
  );
  if (exists) return null;
  return `${som ? `${direction} ` : ''}${som} somersault${som === 1 ? '' : 's'}, ${tw} twist${tw === 1 ? '' : 's'}, ${position}`;
}

export interface JevResult {
  /** `ok`: Jev answered. `unavailable`: no key, no signature or the call failed; the local answer stands. */
  status: 'ok' | 'unavailable';
  error?: string;
  /** What was shown to Jev (null when no signature could be built). */
  state: JevState | null;
  signature: MovementSignature | null;
  measured: MeasuredMovement | null;
  answers?: Record<QuestionId, JevChoiceAnswer>;
  /** Top 5 by Jev (empty when unavailable). */
  candidates: JevCandidate[];
  /** Jev's best element, or null. */
  jevElementId: string | null;
  /** Why the curves were doubted (empty when they look like a jump). */
  problems: string[];
  /** Jev's own best answers, when together they are no FIG element: the element named is then only the closest one. */
  outOfTable: string | null;
  /** The existing classifier on the same jump, untouched. */
  local: SkillPrediction;
  /** The answer to use: Jev's when it answered, else the local one. */
  final: { elementId: string | null; source: 'jev' | 'local'; confidence: number };
  /** Why the final element was chosen. */
  reason: string;
  usage?: JevResponse['usage'];
  latencyMs: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export interface JevClassifyOptions {
  /** Null runs the local classifier only (the fallback path). */
  client: JevClientOptions | null;
  local?: SkillClassifier;
}

/** The classification of one jump with Jev, with the local classifier run on the same input. Never throws on a Jev failure. */
export async function classifyWithJev(input: ClassifierInput, o: JevClassifyOptions): Promise<JevResult> {
  const local = (o.local ?? temporalClassifier).classify(input);
  const sig = buildSignature(input.sequence, input.twist ?? null);
  const measured = sig ? measuredMovement(sig, null, input.features.position.label) : null;
  const state = sig && measured ? buildJevState(input.features, sig, measured) : null;
  const fallback = (error: string, latencyMs = 0): JevResult => ({
    status: 'unavailable',
    error,
    state,
    signature: sig,
    measured,
    candidates: [],
    jevElementId: null,
    problems: state?.quality.problems ?? [],
    outOfTable: null,
    local,
    final: { elementId: local.elementId ?? null, source: 'local', confidence: local.confidence },
    reason: `Jev unavailable (${error}); local ${local.classifier.id} classifier used.`,
    latencyMs,
  });
  if (!o.client) return fallback('no client');
  if (!state) return fallback('no movement signature (jump cut off or rotation not measured)');

  const t0 = Date.now();
  let response: JevResponse;
  try {
    response = await jevSystemOne({ state, questions: QUESTIONS }, o.client);
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e), Date.now() - t0);
  }
  const latencyMs = Date.now() - t0;
  const answers = response.answers as Record<QuestionId, JevChoiceAnswer>;
  if (!(Object.keys(QUESTIONS) as QuestionId[]).every((q) => answers?.[q]?.probabilities)) {
    return fallback('incomplete response', latencyMs);
  }
  const candidates = rankElements(answers);
  const best = candidates[0];
  const problems = state.quality.problems;
  const off = outOfTable(answers);
  // Jev answers as confidently on a broken signal as on a clean one, so on a doubtful signal the existing classifier stands.
  const useLocal = problems.length > 0;
  const a = (q: QuestionId) => `${q} ${answers[q].choice} (${pct(answers[q].probabilities[answers[q].choice] ?? 0)})`;
  return {
    status: 'ok',
    state,
    signature: sig,
    measured,
    answers,
    candidates,
    jevElementId: best?.elementId ?? null,
    local,
    problems,
    outOfTable: off,
    final: useLocal
      ? { elementId: local.elementId ?? null, source: 'local', confidence: local.confidence }
      : { elementId: best?.elementId ?? null, source: 'jev', confidence: best?.mass ?? 0 },
    reason:
      `${(Object.keys(QUESTIONS) as QuestionId[]).map(a).join(', ')}; the four answers together give ${best ? `${best.name} ${pct(best.mass)}` : 'no element'}.` +
      (off ? ` Jev's own answers (${off}) are no FIG element, so this is only the closest one.` : '') +
      (useLocal
        ? ` The signal is doubtful (${problems.join('; ')}): local ${local.classifier.id} classifier used.`
        : ''),
    usage: response.usage,
    latencyMs,
  };
}

/** Debug text: the signature, Jev's answers, the top 5 against the local top 5, the reason and the final element. */
export function formatJevDebug(r: JevResult): string {
  const out: string[] = [];
  out.push('MovementSignature');
  if (r.measured) {
    out.push(
      `  measured: somersaults ${r.measured.somersaults}, twists ${r.measured.twists ?? 'not measured'}, position ${r.measured.position}`,
    );
    for (const c of CHANNELS) {
      const t = r.state?.trajectories[c];
      if (t) out.push(`  ${c.padEnd(12)} ${t.map((v) => (v === null ? '  –  ' : v.toFixed(2).padStart(5))).join(' ')}`);
    }
  } else out.push('  none');
  out.push(
    '',
    ...(r.problems.length ? [`Signal doubtful: ${r.problems.join('; ')}`] : []),
    `Jev: ${r.status}${r.error ? ` (${r.error})` : ''}   ${r.latencyMs} ms${r.usage ? `   ${r.usage.input_tokens} tokens in` : ''}`,
  );
  if (r.answers) {
    for (const q of Object.keys(QUESTIONS) as QuestionId[]) {
      const a = r.answers[q];
      const probs = Object.entries(a.probabilities)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 3)
        .map(([k, v]) => `${k} ${pct(v)}`)
        .join('  ');
      out.push(`  ${q.padEnd(11)} ${probs}   confidence ${pct(a.confidence)}`);
    }
  }
  out.push('', 'Top 5 (Jev)');
  r.candidates.forEach((c, i) =>
    out.push(`  ${i + 1}. ${c.name.padEnd(36)} ${pct(c.mass)}  (share ${pct(c.probability)})`),
  );
  out.push('Top 5 (local)');
  (r.local.candidates ?? [])
    .slice(0, 5)
    .forEach((c, i) => out.push(`  ${i + 1}. ${c.name.padEnd(36)} ${pct(c.score ?? c.posterior)}`));
  out.push(
    '',
    `Reason: ${r.reason}`,
    `Final: ${r.final.elementId ?? 'unclassified'} (${r.final.source}, ${pct(r.final.confidence)})`,
  );
  return out.join('\n');
}
