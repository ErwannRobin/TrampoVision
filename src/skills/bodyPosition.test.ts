import { describe, expect, it } from 'vitest';
import { classifyPosition } from './bodyPosition';
import { DEFAULT_SKILL_CONFIG, mergeSkillConfig } from './config';

const T = DEFAULT_SKILL_CONFIG.position;

describe('classifyPosition', () => {
  it('open hips and straight legs are straight', () => {
    const p = classifyPosition({ hipAngle: 176, kneeAngle: 178, kneeTorso: 0.9 }, T);
    expect(p.label).toBe('straight');
    expect(p.ruleScore).toBeGreaterThan(0.95);
  });

  it('folded hips with straight legs are a pike', () => {
    const p = classifyPosition({ hipAngle: 62, kneeAngle: 168, kneeTorso: 0.8 }, T);
    expect(p.label).toBe('pike');
    expect(p.ruleScore).toBeGreaterThan(0.95);
  });

  it('folded hips with bent knees are a tuck; knees near the torso add to the score', () => {
    const near = classifyPosition({ hipAngle: 55, kneeAngle: 60, kneeTorso: 0.4 }, T);
    const far = classifyPosition({ hipAngle: 55, kneeAngle: 60, kneeTorso: 0.95 }, T);
    expect(near.label).toBe('tuck');
    expect(far.label).toBe('tuck');
    expect(near.ruleScore).toBeGreaterThan(far.ruleScore);
    expect(far.ruleScore).toBeGreaterThan(0.6);
  });

  it('a shape between two definitions is reported as unknown, not forced', () => {
    // hips halfway between open and folded, legs straight: straight and pike tie
    const p = classifyPosition({ hipAngle: 140, kneeAngle: 175, kneeTorso: 0.8 }, T);
    expect(p.label).toBe('unknown');
    expect(p.scores.straight).toBeGreaterThan(0.3);
    expect(p.scores.pike).toBeGreaterThan(0.3);
    // open hips with bent knees is none of the three
    expect(classifyPosition({ hipAngle: 170, kneeAngle: 100, kneeTorso: 0.8 }, T).label).toBe('unknown');
  });

  it('missing angles give unknown', () => {
    expect(classifyPosition({ hipAngle: NaN, kneeAngle: 170, kneeTorso: 0.8 }, T).label).toBe('unknown');
  });

  it('thresholds are configurable', () => {
    const shape = { hipAngle: 145, kneeAngle: 170, kneeTorso: 0.8 };
    expect(classifyPosition(shape, T).label).toBe('straight');
    const strict = mergeSkillConfig({ position: { hipFoldedMaxDeg: 150, hipOpenMinDeg: 165 } }).position;
    expect(classifyPosition(shape, strict).label).toBe('pike');
  });
});
