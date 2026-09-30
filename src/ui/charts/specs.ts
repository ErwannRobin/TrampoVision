import type { AnalysisResult } from '../../analysis/types';
import { t } from '../../i18n/core';
import type { TwistFrames } from '../../pose3d/twist';
import { jumpTurnGuides, twistGuides, type Decorations, type SequenceColumns } from './decorations';
import type { ChartAxis, ChartMarker, ChartProps } from './types';

/**
 * The charts of the technical data, as data. Each spec is a `Chart` without its playhead. They are built once per
 * analysis (memoized by the caller), so a chart redraws only when its own inputs change.
 */
export interface ChartSpec extends Omit<ChartProps, 'playhead'> {
  id: string;
}

/** The one series of a chart. Two series always use the pair below, and their labels say which is which. */
const ONE = '--series-1';
const LIFT = '--lift';
const DROP = '--drop';

const clip = (result: AnalysisResult, deco: Decorations) => ({
  time: result.time,
  confidence: result.confidence,
  markers: deco.markers,
  bands: deco.bands,
});

export function motionSpecs(result: AnalysisResult, deco: Decorations): ChartSpec[] {
  return [
    {
      id: 'height',
      title: t('chart.height'),
      unit: t(result.meta.heightReference === 'bed' ? 'chart.heightUnitBed' : 'chart.heightUnitLowest'),
      ...clip(result, deco),
      decimals: 2,
      minSpan: 0.5,
      series: [{ label: t('chart.heightSeries'), values: result.height, color: ONE }],
    },
    {
      id: 'vy',
      title: t('chart.vy'),
      unit: t('chart.vyUnit'),
      ...clip(result, deco),
      decimals: 2,
      zeroLine: true,
      minSpan: 2,
      series: [{ label: 'Vy', values: result.vy, color: ONE }],
    },
    {
      id: 'x',
      title: t('chart.x'),
      unit: t(result.meta.calibrated ? 'chart.xUnitBed' : 'chart.xUnitStart'),
      ...clip(result, deco),
      decimals: 2,
      zeroLine: true,
      minSpan: 0.5,
      guides: deco.bedGuides,
      series: [{ label: 'x', values: result.x, color: ONE }],
    },
  ];
}

export function rotationSpecs(result: AnalysisResult, deco: Decorations): ChartSpec[] {
  return [
    {
      id: 'orientation',
      title: t('chart.orientation'),
      unit: t('chart.orientationUnit'),
      ...clip(result, deco),
      decimals: 0,
      minSpan: 40,
      guides: deco.turnGuides,
      series: [{ label: t('chart.orientationSeries'), values: result.orientation, color: ONE }],
    },
    {
      id: 'angle',
      title: t('chart.angle'),
      unit: t('chart.angleUnit'),
      ...clip(result, deco),
      zeroLine: true,
      minSpan: 20,
      breakOnJump: 180,
      note: t('chart.angleNote'),
      series: [
        { label: t('chart.trunk'), values: result.trunkAngle, color: LIFT },
        { label: t('chart.bodyLine'), values: result.lineAngle, color: DROP },
      ],
    },
    {
      id: 'angular-velocity',
      title: t('chart.omega'),
      unit: '°/s',
      ...clip(result, deco),
      decimals: 0,
      zeroLine: true,
      minSpan: 60,
      series: [{ label: 'ω', values: result.angularVelocity, color: ONE }],
    },
  ];
}

const JOINTS = [
  ['knee', 'chart.joint.knee', 'leftKnee', 'rightKnee'],
  ['hip', 'chart.joint.hip', 'leftHip', 'rightHip'],
  ['shoulder', 'chart.joint.shoulder', 'leftShoulder', 'rightShoulder'],
  ['elbow', 'chart.joint.elbow', 'leftElbow', 'rightElbow'],
] as const;

export function jointSpecs(result: AnalysisResult, deco: Decorations): ChartSpec[] {
  return JOINTS.map(([id, title, left, right]) => ({
    id,
    title: t(title),
    unit: t('chart.jointUnit'),
    ...clip(result, deco),
    minSpan: 30,
    series: [
      { label: t('coach.left'), values: result.joints[left], color: LIFT },
      { label: t('coach.right'), values: result.joints[right], color: DROP },
    ],
  }));
}

export function confidenceSpec(result: AnalysisResult, deco: Decorations): ChartSpec {
  return {
    id: 'confidence',
    title: t('chart.confidenceTitle'),
    unit: t('chart.confidenceUnit'),
    ...clip(result, deco),
    decimals: 2,
    yDomain: [0, 1],
    guides: [{ value: 0.5, label: t('chart.unclearBelow') }],
    series: [{ label: t('chart.confidenceSeries'), values: result.confidence, color: ONE }],
  };
}

/** The twist curves of the experimental 3D reading, over the whole clip. */
export function twistSpecs(result: AnalysisResult, frames: TwistFrames, deco: Decorations): ChartSpec[] {
  const base = { time: result.time, markers: deco.markers, bands: deco.bands };
  return [
    {
      id: 'twist-angle',
      title: t('chart.twistAngle'),
      unit: t('chart.twistAngleUnit'),
      ...base,
      confidence: frames.torso.visibility,
      decimals: 0,
      zeroLine: true,
      minSpan: 200,
      guides: twistGuides(frames.angle),
      series: [
        { label: t('chart.axis3d'), values: frames.angle, color: LIFT },
        { label: t('chart.axisPlane'), values: frames.anglePlane, color: DROP },
      ],
    },
    {
      id: 'twist-velocity',
      title: t('chart.twistVelocity'),
      unit: '°/s',
      ...base,
      confidence: frames.torso.visibility,
      decimals: 0,
      zeroLine: true,
      minSpan: 200,
      series: [{ label: t('chart.twistOmega'), values: frames.angularVelocity, color: ONE }],
    },
    {
      id: 'twist-tilt',
      title: t('chart.tilt'),
      unit: t('chart.tiltUnit'),
      ...base,
      decimals: 0,
      minSpan: 30,
      series: [{ label: t('chart.tiltSeries'), values: frames.torso.axisTiltDeg, color: ONE }],
    },
    {
      id: 'twist-width',
      title: t('chart.width'),
      unit: t('chart.widthUnit'),
      ...base,
      decimals: 2,
      minSpan: 0.1,
      series: [
        { label: t('chart.shoulders'), values: frames.torso.shoulderWidthM, color: LIFT },
        { label: t('chart.hips'), values: frames.torso.hipWidthM, color: DROP },
      ],
    },
  ];
}

/** The four normalized curves of one jump: the same axes for every jump, so jumps can be compared by eye. */
export function jumpSpecs(
  cols: SequenceColumns,
  axis: ChartAxis,
  markers: ChartMarker[],
  position: { hipFoldedMaxDeg: number; kneeStraightMinDeg: number },
): ChartSpec[] {
  const useBed = cols.xBed.some(Number.isFinite);
  const base = { time: cols.u, axis, markers, confidence: cols.quality, decimals: 2, height: 140 };
  return [
    {
      id: 'jump-height',
      title: t('jump.height'),
      unit: t('jump.heightUnit'),
      ...base,
      minSpan: 0.5,
      series: [{ label: t('chart.heightSeries'), values: cols.height, color: ONE }],
    },
    {
      id: 'jump-x',
      title: t('jump.x'),
      unit: t(useBed ? 'jump.xUnitBed' : 'jump.xUnitBody'),
      ...base,
      zeroLine: true,
      minSpan: 0.4,
      series: [{ label: 'x', values: useBed ? cols.xBed : cols.xBody, color: ONE }],
    },
    {
      id: 'jump-turns',
      title: t('jump.turns'),
      unit: t('jump.turnsUnit'),
      ...base,
      zeroLine: true,
      minSpan: 0.5,
      guides: jumpTurnGuides(cols.turns),
      series: [{ label: t('jump.turnsSeries'), values: cols.turns, color: ONE }],
    },
    {
      id: 'jump-shape',
      title: t('jump.shape'),
      unit: t('chart.jointUnit'),
      ...base,
      decimals: 0,
      minSpan: 60,
      guides: [
        { value: position.hipFoldedMaxDeg, label: t('jump.hipFolded') },
        { value: position.kneeStraightMinDeg, label: t('jump.legsStraight') },
      ],
      series: [
        { label: t('jump.hip'), values: cols.hip, color: LIFT },
        { label: t('jump.knee'), values: cols.knee, color: DROP },
      ],
    },
  ];
}
