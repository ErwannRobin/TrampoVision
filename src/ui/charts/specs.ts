import type { AnalysisResult } from '../../analysis/types';
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
      title: 'Center of mass height',
      unit: `m above the ${result.meta.heightReference}`,
      ...clip(result, deco),
      decimals: 2,
      minSpan: 0.5,
      series: [{ label: 'Height', values: result.height, color: ONE }],
    },
    {
      id: 'vy',
      title: 'Center of mass vertical velocity',
      unit: 'm/s, up = +',
      ...clip(result, deco),
      decimals: 2,
      zeroLine: true,
      minSpan: 2,
      series: [{ label: 'Vy', values: result.vy, color: ONE }],
    },
    {
      id: 'x',
      title: 'Center of mass horizontal position',
      unit: `m from ${result.meta.calibrated ? 'bed center' : 'start'}, + = right`,
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
      title: 'Body orientation (continuous)',
      unit: '°, keeps counting past 360',
      ...clip(result, deco),
      decimals: 0,
      minSpan: 40,
      guides: deco.turnGuides,
      series: [{ label: 'Orientation', values: result.orientation, color: ONE }],
    },
    {
      id: 'angle',
      title: 'Body angle (wrapped)',
      unit: '° from vertical, + = clockwise',
      ...clip(result, deco),
      zeroLine: true,
      minSpan: 20,
      breakOnJump: 180,
      note: 'The trunk runs from the hips to the shoulders, the body line from the ankles to the head.',
      series: [
        { label: 'Trunk', values: result.trunkAngle, color: LIFT },
        { label: 'Body line', values: result.lineAngle, color: DROP },
      ],
    },
    {
      id: 'angular-velocity',
      title: 'Angular velocity',
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
  ['knee', 'Knee angle', 'leftKnee', 'rightKnee'],
  ['hip', 'Hip angle', 'leftHip', 'rightHip'],
  ['shoulder', 'Shoulder angle', 'leftShoulder', 'rightShoulder'],
  ['elbow', 'Elbow angle', 'leftElbow', 'rightElbow'],
] as const;

export function jointSpecs(result: AnalysisResult, deco: Decorations): ChartSpec[] {
  return JOINTS.map(([id, title, left, right]) => ({
    id,
    title,
    unit: '°, 180 = straight',
    ...clip(result, deco),
    minSpan: 30,
    series: [
      { label: 'Left', values: result.joints[left], color: LIFT },
      { label: 'Right', values: result.joints[right], color: DROP },
    ],
  }));
}

export function confidenceSpec(result: AnalysisResult, deco: Decorations): ChartSpec {
  return {
    id: 'confidence',
    title: 'Pose confidence',
    unit: '0–1, hatched below 0.5',
    ...clip(result, deco),
    decimals: 2,
    yDomain: [0, 1],
    guides: [{ value: 0.5, label: 'Unclear below' }],
    series: [{ label: 'Confidence', values: result.confidence, color: ONE }],
  };
}

/** The twist curves of the experimental 3D reading, over the whole clip. */
export function twistSpecs(result: AnalysisResult, frames: TwistFrames, deco: Decorations): ChartSpec[] {
  const base = { time: result.time, markers: deco.markers, bands: deco.bands };
  return [
    {
      id: 'twist-angle',
      title: 'Twist angle (accumulated)',
      unit: '°, + = counter-clockwise seen from above the head',
      ...base,
      confidence: frames.torso.visibility,
      decimals: 0,
      zeroLine: true,
      minSpan: 200,
      guides: twistGuides(frames.angle),
      series: [
        { label: 'Full 3D axis', values: frames.angle, color: LIFT },
        { label: 'Axis in the image plane', values: frames.anglePlane, color: DROP },
      ],
    },
    {
      id: 'twist-velocity',
      title: 'Twist angular velocity',
      unit: '°/s',
      ...base,
      confidence: frames.torso.visibility,
      decimals: 0,
      zeroLine: true,
      minSpan: 200,
      series: [{ label: 'ω twist', values: frames.angularVelocity, color: ONE }],
    },
    {
      id: 'twist-tilt',
      title: 'Trunk axis out of the image plane',
      unit: '°: 0 = in the plane, large = pointing at the camera',
      ...base,
      decimals: 0,
      minSpan: 30,
      series: [{ label: 'Tilt', values: frames.torso.axisTiltDeg, color: ONE }],
    },
    {
      id: 'twist-width',
      title: 'Shoulder width in 3D',
      unit: 'm: a rigid body keeps it constant; changes are depth error',
      ...base,
      decimals: 2,
      minSpan: 0.1,
      series: [
        { label: 'Shoulders', values: frames.torso.shoulderWidthM, color: LIFT },
        { label: 'Hips', values: frames.torso.hipWidthM, color: DROP },
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
      title: 'Center of mass height',
      unit: 'body lengths above the takeoff position',
      ...base,
      minSpan: 0.5,
      series: [{ label: 'Height', values: cols.height, color: ONE }],
    },
    {
      id: 'jump-x',
      title: 'Center of mass horizontal',
      unit: useBed ? 'bed coordinates: ±1 = bed edge' : 'body lengths from the takeoff position',
      ...base,
      zeroLine: true,
      minSpan: 0.4,
      series: [{ label: 'x', values: useBed ? cols.xBed : cols.xBody, color: ONE }],
    },
    {
      id: 'jump-turns',
      title: 'Body orientation',
      unit: 'turns since takeoff, + = clockwise',
      ...base,
      zeroLine: true,
      minSpan: 0.5,
      guides: jumpTurnGuides(cols.turns),
      series: [{ label: 'Turns', values: cols.turns, color: ONE }],
    },
    {
      id: 'jump-shape',
      title: 'Hip and knee angle',
      unit: '°, 180 = straight',
      ...base,
      decimals: 0,
      minSpan: 60,
      guides: [
        { value: position.hipFoldedMaxDeg, label: 'Hip folded' },
        { value: position.kneeStraightMinDeg, label: 'Legs straight' },
      ],
      series: [
        { label: 'Hip', values: cols.hip, color: LIFT },
        { label: 'Knee', values: cols.knee, color: DROP },
      ],
    },
  ];
}
