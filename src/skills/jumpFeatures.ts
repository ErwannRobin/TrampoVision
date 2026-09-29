import type { JumpCycle } from '../analysis/jumpCycles';
import { median, wrapDegrees } from '../analysis/signal';
import type { AnalysisResult } from '../analysis/types';
import { classifyPosition } from './bodyPosition';
import type { SkillConfig } from './config';
import { estimateFacing } from './facing';
import { SEQUENCE_JOINTS, type FrameShape } from './frameShape';
import { estimateRotation, flightRange, valueAt } from './rotation';
import {
  POSITIONS,
  type BodyPosition,
  type JumpFeatures,
  type JumpPosition,
  type JumpSequence,
  type ShapeStat,
} from './types';

const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** Coordinate frame of the sequence's joint columns. */
export const SEQUENCE_FRAME =
  'origin: hip center; y: along the trunk (hips to shoulders); x: to the right of the trunk when the athlete is upright; unit: body length';

const BASE_COLUMNS = [
  'u',
  'time_s',
  'com_h_body',
  'com_x_body',
  'com_x_bed',
  'com_h_m',
  'com_x_m',
  'com_vy_mps',
  'orient_turns',
  'orient_sin',
  'orient_cos',
  'angvel_turns_per_s',
  'hip_angle_deg',
  'knee_angle_deg',
  'knee_torso',
  'leg_separation',
  'compactness',
  'shoulder_hip_axis_deg',
  'position',
  'quality',
];
export const SEQUENCE_COLUMNS = [...BASE_COLUMNS, ...SEQUENCE_JOINTS.flatMap((j) => [`${j.name}_x`, `${j.name}_y`])];

function stat(values: Float64Array, window: number[], peak: number[]): ShapeStat {
  const w = window.map((i) => values[i]).filter(Number.isFinite);
  if (!w.length) return { atPeak: null, min: null, max: null, mean: null };
  return {
    atPeak: finite(median(peak.map((i) => values[i]))),
    min: Math.min(...w),
    max: Math.max(...w),
    mean: w.reduce((s, v) => s + v, 0) / w.length,
  };
}

/**
 * Body position of one flight. The position is read at the most closed moment: the frames whose hip
 * angle is within `peakBandDeg` of the smallest one (at least three frames), inside the middle of the
 * flight, where the ends are transitions from and to the open takeoff and landing shapes.
 */
function jumpPosition(
  fs: FrameShape,
  from: number,
  to: number,
  time: Float64Array,
  takeoffT: number,
  duration: number,
  cfg: SkillConfig,
): { position: JumpPosition; window: number[]; peak: number[] } {
  const [a, b] = cfg.positionWindow;
  const window: number[] = [];
  for (let i = from; i <= to; i++) {
    const u = (time[i] - takeoffT) / duration;
    if (u >= a && u <= b && Number.isFinite(fs.hipAngle[i]) && Number.isFinite(fs.kneeAngle[i])) window.push(i);
  }
  let poseQuality = 0;
  for (let i = from; i <= to; i++) poseQuality += fs.quality[i];
  poseQuality = to >= from ? poseQuality / (to - from + 1) : 0;

  const timeShare = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<BodyPosition, number>;
  if (window.length < 3) {
    timeShare.unknown = 1;
    return {
      position: {
        label: 'unknown',
        scores: { straight: 0, tuck: 0, pike: 0 },
        ruleScore: 0,
        timeShare,
        peakTimeU: null,
        stability: 0,
        confidence: 0,
      },
      window,
      peak: [],
    };
  }
  for (const i of window) timeShare[POSITIONS[fs.position[i]]] += 1 / window.length;

  const hipMin = Math.min(...window.map((i) => fs.hipAngle[i]));
  let peak = window.filter((i) => fs.hipAngle[i] <= hipMin + cfg.peakBandDeg);
  if (peak.length < 3) peak = [...window].sort((p, q) => fs.hipAngle[p] - fs.hipAngle[q]).slice(0, 3);
  const at = (arr: Float64Array) => median(peak.map((i) => arr[i]));
  const estimate = classifyPosition(
    { hipAngle: at(fs.hipAngle), kneeAngle: at(fs.kneeAngle), kneeTorso: at(fs.kneeTorso) },
    cfg.position,
  );

  // A shape counts when it is held: the frames near the most closed one must cover a fair share of the window.
  const stability = clamp01(peak.length / window.length / cfg.minHoldShare);
  const peakU = median(peak.map((i) => (time[i] - takeoffT) / duration));

  return {
    position: {
      ...estimate,
      timeShare,
      peakTimeU: finite(peakU),
      stability,
      confidence: estimate.ruleScore * stability * poseQuality,
    },
    window,
    peak,
  };
}

/**
 * Turns one detected jump into a structured feature object and one fixed-length, normalized sequence.
 * Nothing here depends on the video resolution, on where the athlete is in the frame, or on the athlete's
 * size: joints are expressed in the athlete's own frame in body lengths, the center of mass relative to its
 * takeoff position (and in bed coordinates when a calibration exists), orientation as turns since takeoff.
 */
export function extractJump(
  result: AnalysisResult,
  fs: FrameShape,
  cycle: JumpCycle,
  cfg: SkillConfig,
): { features: JumpFeatures; sequence: JumpSequence | null } {
  const { meta, time } = result;
  const body = meta.bodyLengthPx;
  const range = flightRange(result, cycle);
  const complete = cycle.complete && range !== null;
  const t0 = cycle.takeoffTimeS;
  const t1 = cycle.landingTimeS;
  const pxPerM = meta.pixelsPerMeter;
  const inBodies = (m: number | null) =>
    m !== null && Number.isFinite(pxPerM) && Number.isFinite(body) ? (m * pxPerM) / body : null;
  const at = (series: Float64Array, t: number | null) => (t === null ? null : valueAt(time, series, t));
  const wrapped = (t: number | null) => {
    const v = at(result.orientation, t);
    return v === null ? null : wrapDegrees(v);
  };

  const [from, to] = range ?? [0, -1];
  const duration = t0 !== null && t1 !== null ? t1 - t0 : NaN;
  const { position, window, peak } = complete
    ? jumpPosition(fs, from, to, time, t0!, duration, cfg)
    : {
        position: {
          label: 'unknown' as const,
          scores: { straight: 0, tuck: 0, pike: 0 },
          ruleScore: 0,
          timeShare: { straight: 0, tuck: 0, pike: 0, unknown: 1 },
          peakTimeU: null,
          stability: 0,
          confidence: 0,
        },
        window: [] as number[],
        peak: [] as number[],
      };

  // Orientation over the flight.
  const oT = at(result.orientation, t0);
  let maxDeviation: number | null = null;
  let peakAngVel: number | null = null;
  let meanAbsAngVel: number | null = null;
  let comCount = 0;
  let poseQ = 0;
  const trunkLens: number[] = [];
  if (complete && oT !== null) {
    let dev = 0;
    let sumAbs = 0;
    let nAv = 0;
    let maxAv = 0;
    for (let i = from; i <= to; i++) {
      if (Number.isFinite(result.orientation[i])) dev = Math.max(dev, Math.abs(result.orientation[i] - oT));
      const w = result.angularVelocity[i];
      if (Number.isFinite(w)) {
        sumAbs += Math.abs(w);
        nAv++;
        maxAv = Math.max(maxAv, Math.abs(w));
      }
      if (Number.isFinite(result.comX[i])) comCount++;
      poseQ += fs.quality[i];
      if (Number.isFinite(fs.trunkLengthPx[i])) trunkLens.push(fs.trunkLengthPx[i]);
    }
    maxDeviation = dev;
    peakAngVel = nAv ? maxAv : null;
    meanAbsAngVel = nAv ? sumAbs / nAv : null;
  }
  const nFlight = complete ? to - from + 1 : 0;
  let trunkVariation: number | null = null;
  if (trunkLens.length >= 5) {
    const mean = trunkLens.reduce((s, v) => s + v, 0) / trunkLens.length;
    trunkVariation = (Math.max(...trunkLens) - Math.min(...trunkLens)) / mean;
  }

  const features: JumpFeatures = {
    version: 1,
    jump: cycle.index,
    complete,
    timing: {
      takeoffTimeS: t0,
      apexTimeS: cycle.apexTimeS,
      landingTimeS: t1,
      flightTimeS: cycle.flightTimeS,
      timeToApexS: cycle.timeToApexS,
      apexToLandingS: t1 !== null ? t1 - cycle.apexTimeS : null,
    },
    trajectory: {
      maxHeightM: cycle.apexHeightM,
      riseM: cycle.riseM,
      riseBodyLengths: inBodies(cycle.riseM),
      takeoffVyMps: cycle.takeoffVyMps,
      horizontalDisplacementM: cycle.horizontalDisplacementM,
      horizontalDisplacementBodyLengths: inBodies(cycle.horizontalDisplacementM),
      takeoffXBed: at(result.xNorm, t0),
      apexXBed: at(result.xNorm, cycle.apexTimeS),
      landingXBed: at(result.xNorm, t1),
    },
    orientation: {
      takeoffDeg: wrapped(t0),
      apexDeg: wrapped(cycle.apexTimeS),
      landingDeg: wrapped(t1),
      maxDeviationDeg: maxDeviation,
      peakAngularVelocityDps: peakAngVel,
      meanAbsAngularVelocityDps: meanAbsAngVel,
    },
    shape: {
      hipAngle: stat(fs.hipAngle, window, peak),
      kneeAngle: stat(fs.kneeAngle, window, peak),
      shoulderHipAxis: stat(fs.shoulderHipAxis, window, peak),
      legSeparation: stat(fs.legSeparation, window, peak),
      kneeTorsoDistance: stat(fs.kneeTorso, window, peak),
      compactness: stat(fs.compactness, window, peak),
    },
    position,
    rotation: estimateRotation(result, fs, cycle, cfg.rotation),
    facing: estimateFacing(result, fs, cycle, cfg.facing),
    quality: {
      pose: nFlight ? poseQ / nFlight : 0,
      comCoverage: nFlight ? comCount / nFlight : 0,
      trunkLengthVariation: trunkVariation,
    },
  };

  if (!complete || t0 === null || t1 === null || oT === null) return { features, sequence: null };

  // Normalized sequence: fixed number of samples between takeoff (u = 0) and landing (u = 1).
  const comYT = at(result.comY, t0);
  const comXT = at(result.comX, t0);
  const N = Math.max(4, Math.round(cfg.sequenceSamples));
  const data: number[][] = [];
  const valid: number[] = [];
  for (let k = 0; k < N; k++) {
    const u = k / (N - 1);
    const t = t0 + u * duration;
    const v = (series: Float64Array): number => at(series, t) ?? NaN;
    const comY = v(result.comY);
    const comX = v(result.comX);
    const turns = (v(result.orientation) - oT) / 360;
    const rad = turns * 2 * Math.PI;
    const nearest = Math.min(
      Math.max(Math.round(((t - time[0]) / (time[time.length - 1] - time[0])) * (time.length - 1)), 0),
      time.length - 1,
    );
    const row = [
      u,
      t - t0,
      comYT !== null ? (comYT - comY) / body : NaN,
      comXT !== null ? (comX - comXT) / body : NaN,
      v(result.xNorm),
      v(result.height),
      v(result.x),
      v(result.vy),
      turns,
      Math.sin(rad),
      Math.cos(rad),
      v(result.angularVelocity) / 360,
      v(fs.hipAngle),
      v(fs.kneeAngle),
      v(fs.kneeTorso),
      v(fs.legSeparation),
      v(fs.compactness),
      v(fs.shoulderHipAxis),
      fs.position[nearest],
      v(fs.quality),
    ];
    SEQUENCE_JOINTS.forEach((_, s) => row.push(v(fs.bodyX[s]), v(fs.bodyY[s])));
    data.push(row);
    valid.push(Number.isFinite(row[2]) && Number.isFinite(row[8]) && row[19] >= 0.5 ? 1 : 0);
  }
  return {
    features,
    sequence: {
      jump: cycle.index,
      samples: N,
      takeoffTimeS: t0,
      landingTimeS: t1,
      durationS: duration,
      bodyLengthPx: body,
      frame: SEQUENCE_FRAME,
      columns: SEQUENCE_COLUMNS,
      data,
      valid,
    },
  };
}
