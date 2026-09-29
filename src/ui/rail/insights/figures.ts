import type { BodyPosition, RotationDirection } from '../../../skills/types';
import { DASH, fmt } from '../../format';
import type { JumpHeadline } from '../../insights';

export interface Figure {
  key: 'height' | 'air' | 'rotation' | 'shape';
  label: string;
  value: string;
  /** Only when there is a value to put it next to. */
  unit?: string;
  hint: string;
  /** The value is a word (a body shape): set smaller, so that a long one fits its column. */
  word?: boolean;
  /** No value: the dash is shown quiet. */
  missing: boolean;
}

const CUT_OFF = 'cut off by the clip';
const UNKNOWN = 'could not be measured';

export const SHAPE_WORD: Record<BodyPosition, string> = {
  straight: 'Straight',
  tuck: 'Tuck',
  pike: 'Pike',
  unknown: 'Between shapes',
};

const DIRECTION_HINT: Record<RotationDirection, string> = {
  clockwise: 'clockwise on screen',
  counterclockwise: 'counterclockwise on screen',
  none: 'no rotation',
};

/**
 * The four figures an athlete looks for, read from the jump headline (so the coach's numbers can never differ). A value
 * the analysis does not have is a dash, and a hint says why: the jump is cut off by the clip, or it was not measurable.
 */
export function jumpFigures(h: JumpHeadline): Figure[] {
  const missingWhy = h.complete ? UNKNOWN : CUT_OFF;
  const figure = (
    key: Figure['key'],
    label: string,
    value: string,
    hint: string,
    unit?: string,
    word?: boolean,
  ): Figure => ({ key, label, value, unit: value === DASH ? undefined : unit, hint, word, missing: value === DASH });

  const height = fmt(h.heightM, 2);
  const air = fmt(h.flightTimeS, 2);
  // The turns carry a sign (clockwise is positive); the direction is said in the hint.
  const turns = fmt(h.rotation.turns === null ? null : Math.abs(h.rotation.turns), 1);
  const noShape = h.bodyShape === 'unknown' && !h.complete;

  return [
    figure(
      'height',
      'Peak height',
      height,
      height === DASH ? UNKNOWN : h.heightReference === 'bed' ? 'above the bed' : 'above the lowest point',
      'm',
    ),
    figure('air', 'Time in the air', air, air === DASH ? missingWhy : 'takeoff to landing', 's'),
    figure('rotation', 'Rotation', turns, turns === DASH ? missingWhy : DIRECTION_HINT[h.rotation.direction], 'turns'),
    figure(
      'shape',
      'Body shape',
      noShape ? DASH : SHAPE_WORD[h.bodyShape],
      noShape ? CUT_OFF : h.bodyShape === 'unknown' ? 'fits no shape well' : 'at its most closed moment',
      undefined,
      !noShape,
    ),
  ];
}
