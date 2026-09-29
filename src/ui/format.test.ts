import { describe, expect, it } from 'vitest';
import { DASH, fmt, pct, plural, signed, timecode } from './format';

describe('fmt', () => {
  it('uses fixed decimals and never prints a negative zero', () => {
    expect(fmt(1.2345, 2)).toBe('1.23');
    expect(fmt(-0.001, 2)).toBe('0.00');
    expect(fmt(-1.5, 0)).toBe('−2');
  });
  it('shows a dash for anything that is not a number', () => {
    expect(fmt(NaN)).toBe(DASH);
    expect(fmt(Infinity)).toBe(DASH);
    expect(fmt(null)).toBe(DASH);
    expect(fmt(undefined)).toBe(DASH);
  });
});

describe('signed', () => {
  it('prefixes a sign, with a real minus', () => {
    expect(signed(0.5)).toBe('+0.50');
    expect(signed(-0.5)).toBe('−0.50');
  });
  it('leaves zero unsigned, even when it is a rounded small value', () => {
    expect(signed(0)).toBe('0.00');
    expect(signed(-0.0004)).toBe('0.00');
    expect(signed(NaN)).toBe(DASH);
  });
});

describe('pct', () => {
  it('formats a 0..1 share and clamps it', () => {
    expect(pct(0.824)).toBe('82%');
    expect(pct(0.824, 1)).toBe('82.4%');
    expect(pct(1.3)).toBe('100%');
    expect(pct(-0.2)).toBe('0%');
    expect(pct(null)).toBe(DASH);
  });
});

describe('timecode', () => {
  it('shows minutes, seconds and milliseconds', () => {
    expect(timecode(0)).toBe('0:00.000');
    expect(timecode(3.412)).toBe('0:03.412');
    expect(timecode(75.5)).toBe('1:15.500');
  });
  it('treats garbage as zero', () => {
    expect(timecode(-1)).toBe('0:00.000');
    expect(timecode(NaN)).toBe('0:00.000');
  });
});

describe('plural', () => {
  it('picks the form by count', () => {
    expect(plural(1, 'jump')).toBe('jump');
    expect(plural(0, 'jump')).toBe('jumps');
    expect(plural(2, 'somersault', 'somersaults')).toBe('somersaults');
  });
});
