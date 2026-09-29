import { describe, expect, it } from 'vitest';
import { bedMarker, bedMarkers, bedSentence, bedUnavailable } from './bed';

describe('bedMarker', () => {
  it('maps the bed from its left edge to its right edge onto 0..1', () => {
    expect(bedMarker('apex', -1)).toEqual({ event: 'apex', t: 0, beyond: null });
    expect(bedMarker('apex', 0)).toEqual({ event: 'apex', t: 0.5, beyond: null });
    expect(bedMarker('apex', 1)).toEqual({ event: 'apex', t: 1, beyond: null });
    expect(bedMarker('takeoff', 0.5)?.t).toBe(0.75);
  });

  it('clamps a position past an edge onto that edge and flags it', () => {
    expect(bedMarker('landing', 1.4)).toEqual({ event: 'landing', t: 1, beyond: 'right' });
    expect(bedMarker('landing', -3)).toEqual({ event: 'landing', t: 0, beyond: 'left' });
  });

  it('draws nothing for a position that is not known', () => {
    expect(bedMarker('apex', null)).toBeNull();
    expect(bedMarker('apex', NaN)).toBeNull();
    expect(bedMarker('apex', Infinity)).toBeNull();
  });
});

describe('bedMarkers', () => {
  it('keeps takeoff, apex and landing in order and skips the unknown ones', () => {
    const markers = bedMarkers({ takeoff: -0.2, apex: null, landing: 2 });
    expect(markers.map((m) => m.event)).toEqual(['takeoff', 'landing']);
    expect(markers.map((m) => m.beyond)).toEqual([null, 'right']);
    expect(markers.every((m) => m.t >= 0 && m.t <= 1)).toBe(true);
  });
});

describe('bedSentence', () => {
  it('names each event with describeBedPosition', () => {
    expect(bedSentence({ takeoff: 0, apex: -0.3, landing: 1.2 })).toBe(
      'Takeoff in the center, apex 30% of the way to the left edge, landing past the right edge.',
    );
  });

  it('joins events that sit in the same place', () => {
    expect(bedSentence({ takeoff: 0.05, apex: 0.02, landing: -0.05 })).toBe(
      'Takeoff, apex and landing all in the center.',
    );
    expect(bedSentence({ takeoff: 0.05, apex: 0.02, landing: 0.5 })).toBe(
      'Takeoff and apex in the center, landing 50% of the way to the right edge.',
    );
  });

  it('leaves out what is unknown', () => {
    expect(bedSentence({ takeoff: null, apex: 0.5, landing: null })).toBe('Apex 50% of the way to the right edge.');
    expect(bedSentence({ takeoff: 0, apex: null, landing: 0 })).toBe('Takeoff and landing in the center.');
    expect(bedSentence({ takeoff: null, apex: NaN, landing: null })).toBe('');
  });
});

describe('bedUnavailable', () => {
  it('asks for the trampoline to be marked, or fixed when the marking was rejected', () => {
    expect(bedUnavailable({ calibrated: false, calibrationError: null, complete: true })).toEqual({
      text: 'Mark the trampoline to see where each jump lands.',
      setup: true,
    });
    const rejected = bedUnavailable({ calibrated: false, calibrationError: 'Corners are collinear', complete: true });
    expect(rejected.setup).toBe(true);
    expect(rejected.text).toContain('could not be used');
  });

  it('does not send anyone to the settings when the bed is marked but this jump has no position', () => {
    const cut = bedUnavailable({ calibrated: true, calibrationError: null, complete: false });
    expect(cut.setup).toBe(false);
    expect(cut.text).toContain('cut off by the clip');
    expect(bedUnavailable({ calibrated: true, calibrationError: null, complete: true }).setup).toBe(false);
  });
});
