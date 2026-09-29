import type { SkillConfig } from '../../../skills/config';

/** A numeric threshold of the skill logic as the editor shows it: read from and written back into a SkillConfig. */
export interface ThresholdField {
  label: string;
  unit: string;
  get: (config: SkillConfig) => number;
  set: (config: SkillConfig, value: number) => SkillConfig;
}

export const THRESHOLD_FIELDS: ThresholdField[] = [
  {
    label: 'Hip folded at or below',
    get: (c) => c.position.hipFoldedMaxDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, hipFoldedMaxDeg: v } }),
    unit: '°',
  },
  {
    label: 'Hip open at or above',
    get: (c) => c.position.hipOpenMinDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, hipOpenMinDeg: v } }),
    unit: '°',
  },
  {
    label: 'Knees bent at or below',
    get: (c) => c.position.kneeBentMaxDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, kneeBentMaxDeg: v } }),
    unit: '°',
  },
  {
    label: 'Legs straight at or above',
    get: (c) => c.position.kneeStraightMinDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, kneeStraightMinDeg: v } }),
    unit: '°',
  },
  {
    label: 'Rotation tolerance',
    get: (c) => c.rotation.toleranceDeg,
    set: (c, v) => ({ ...c, rotation: { ...c.rotation, toleranceDeg: v } }),
    unit: '°',
  },
  {
    label: 'Minimum confidence',
    get: (c) => Math.round(c.minConfidence * 100),
    set: (c, v) => ({ ...c, minConfidence: v / 100 }),
    unit: '%',
  },
];

export const FACING_OPTIONS: { value: SkillConfig['facing']['override']; label: string }[] = [
  { value: 'auto', label: 'Auto (from the pose)' },
  { value: 'left', label: 'Left of the image' },
  { value: 'right', label: 'Right of the image' },
];
