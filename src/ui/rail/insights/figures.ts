import { t } from '../../../i18n/core';
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

const cutOff = () => t('fig.cutOff');
const unknown = () => t('fig.unknown');

/** The body shape as a word of the language in use. */
export const shapeWord = (p: BodyPosition): string => (p === 'unknown' ? t('fig.between') : t(`pos.${p}`));

const directionHint = (d: RotationDirection): string =>
  t(d === 'clockwise' ? 'fig.clockwise' : d === 'counterclockwise' ? 'fig.counterclockwise' : 'fig.noRotation');

/**
 * The four figures an athlete looks for, read from the jump headline (so the coach's numbers can never differ). A value
 * the analysis does not have is a dash, and a hint says why: the jump is cut off by the clip, or it was not measurable.
 */
export function jumpFigures(h: JumpHeadline): Figure[] {
  const missingWhy = h.complete ? unknown() : cutOff();
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
      t('fig.height'),
      height,
      height === DASH ? unknown() : t(h.heightReference === 'bed' ? 'fig.aboveBed' : 'fig.aboveLowest'),
      'm',
    ),
    figure('air', t('fig.air'), air, air === DASH ? missingWhy : t('fig.takeoffToLanding'), 's'),
    figure(
      'rotation',
      t('fig.rotation'),
      turns,
      turns === DASH ? missingWhy : directionHint(h.rotation.direction),
      t('unit.turns'),
    ),
    figure(
      'shape',
      t('fig.shape'),
      noShape ? DASH : shapeWord(h.bodyShape),
      noShape ? cutOff() : h.bodyShape === 'unknown' ? t('fig.noShape') : t('fig.mostClosed'),
      undefined,
      !noShape,
    ),
  ];
}
