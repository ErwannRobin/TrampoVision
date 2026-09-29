import { describe, expect, it } from 'vitest';
import { barWidth, focusTarget, headlineSize, scrollTopToReveal } from './layout';

describe('headlineSize', () => {
  it('shrinks only the long skill names', () => {
    expect(headlineSize('Tuck Jump')).toBe('lg');
    expect(headlineSize('Straight Jump')).toBe('lg');
    expect(headlineSize('Unclassified')).toBe('lg');
    expect(headlineSize('Somersault (front or back undetermined)')).toBe('md');
  });
});

describe('barWidth', () => {
  it('turns a share into a percentage, never outside 0..100', () => {
    expect(barWidth(0.5)).toBe('50%');
    expect(barWidth(0.1234)).toBe('12.3%');
    expect(barWidth(1)).toBe('100%');
    expect(barWidth(1.4)).toBe('100%');
    expect(barWidth(-0.2)).toBe('0%');
    expect(barWidth(NaN)).toBe('0%');
  });
});

describe('scrollTopToReveal', () => {
  const view = { top: 100, bottom: 500 };

  it('does nothing for an item that is already in view', () => {
    expect(scrollTopToReveal(view, { top: 300, bottom: 350 }, 40, 8)).toBeNull();
  });

  it('scrolls up by what is missing above, and down by what is missing below', () => {
    expect(scrollTopToReveal(view, { top: 60, bottom: 110 }, 200, 8)).toBe(152);
    expect(scrollTopToReveal(view, { top: 480, bottom: 540 }, 200, 8)).toBe(248);
  });

  it('never asks for a negative scroll position', () => {
    expect(scrollTopToReveal(view, { top: -300, bottom: -250 }, 10, 8)).toBe(0);
  });

  it('aligns an item taller than the room to the top', () => {
    expect(scrollTopToReveal(view, { top: 150, bottom: 700 }, 20, 8)).toBe(62);
  });
});

describe('focusTarget', () => {
  it('moves one row with the arrows and stops at the ends', () => {
    expect(focusTarget('ArrowDown', 1, 4)).toBe(2);
    expect(focusTarget('ArrowDown', 3, 4)).toBe(3);
    expect(focusTarget('ArrowUp', 1, 4)).toBe(0);
    expect(focusTarget('ArrowUp', 0, 4)).toBe(0);
  });

  it('jumps to the first and last row, and ignores other keys', () => {
    expect(focusTarget('Home', 2, 4)).toBe(0);
    expect(focusTarget('End', 0, 4)).toBe(3);
    expect(focusTarget('Enter', 0, 4)).toBeNull();
    expect(focusTarget('ArrowDown', 0, 0)).toBeNull();
  });
});
