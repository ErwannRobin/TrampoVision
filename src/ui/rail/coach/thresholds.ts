import { t } from '../../../i18n/core';
import type { SkillConfig } from '../../../skills/config';

/** A numeric threshold of the skill logic as the editor shows it: read from and written back into a SkillConfig. */
export interface ThresholdField {
  /** The label in the language in use (read when the field is drawn). */
  readonly label: string;
  unit: string;
  get: (config: SkillConfig) => number;
  set: (config: SkillConfig, value: number) => SkillConfig;
}

export const THRESHOLD_FIELDS: ThresholdField[] = [
  {
    get label() {
      return t('thr.hipFolded');
    },
    get: (c) => c.position.hipFoldedMaxDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, hipFoldedMaxDeg: v } }),
    unit: '°',
  },
  {
    get label() {
      return t('thr.hipOpen');
    },
    get: (c) => c.position.hipOpenMinDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, hipOpenMinDeg: v } }),
    unit: '°',
  },
  {
    get label() {
      return t('thr.kneeBent');
    },
    get: (c) => c.position.kneeBentMaxDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, kneeBentMaxDeg: v } }),
    unit: '°',
  },
  {
    get label() {
      return t('thr.kneeStraight');
    },
    get: (c) => c.position.kneeStraightMinDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, kneeStraightMinDeg: v } }),
    unit: '°',
  },
  {
    get label() {
      return t('thr.rotationTol');
    },
    get: (c) => c.rotation.toleranceDeg,
    set: (c, v) => ({ ...c, rotation: { ...c.rotation, toleranceDeg: v } }),
    unit: '°',
  },
  {
    get label() {
      return t('thr.minConfidence');
    },
    get: (c) => Math.round(c.minConfidence * 100),
    set: (c, v) => ({ ...c, minConfidence: v / 100 }),
    unit: '%',
  },
];

export const facingOptions = (): { value: SkillConfig['facing']['override']; label: string }[] => [
  { value: 'auto', label: t('thr.facingAuto') },
  { value: 'left', label: t('thr.facingLeft') },
  { value: 'right', label: t('thr.facingRight') },
];
