import { describe, expect, it } from 'vitest';
import type { Movement } from '../skills/fig/elements';
import { SEQUENCE_COLUMNS } from '../skills/jumpFeatures';
import type { JumpFeatures, JumpSequence, TwistContext } from '../skills/types';
import { CLOCK } from './config';
import { clockHour, clockText, executionOf } from './execution';

const col = (name: string) => SEQUENCE_COLUMNS.indexOf(name);
const SAMPLES = 32;
const dir = (angleDeg: number) => ({
  x: Math.sin((angleDeg * Math.PI) / 180),
  y: -Math.cos((angleDeg * Math.PI) / 180),
});

interface Build {
  hip: (u: number) => number;
  knee?: (u: number) => number;
  /** Rotation in turns since takeoff, as a function of the flight. */
  turns?: (u: number) => number;
  /** Upper arm angle from hanging along the body, and elbow flexion, degrees. */
  arm?: number;
  elbow?: number;
  valid?: (k: number) => boolean;
}

/** A jump sequence with only the columns the execution check reads. */
function sequenceOf(b: Build): JumpSequence {
  const data: number[][] = [];
  const valid: number[] = [];
  for (let k = 0; k < SAMPLES; k++) {
    const u = k / (SAMPLES - 1);
    const row = Array.from({ length: SEQUENCE_COLUMNS.length }, () => NaN);
    row[col('u')] = u;
    row[col('orient_turns')] = (b.turns ?? (() => 0))(u);
    row[col('hip_angle_deg')] = b.hip(u);
    row[col('knee_angle_deg')] = (b.knee ?? (() => 176))(u);
    for (const side of ['left', 'right']) {
      const upper = dir(b.arm ?? 8);
      const fore = dir((b.arm ?? 8) + (180 - (b.elbow ?? 178)));
      const set = (name: string, x: number, y: number) => {
        row[col(`${side}_${name}_x`)] = x;
        row[col(`${side}_${name}_y`)] = y;
      };
      set('shoulder', 0, 0.29);
      set('elbow', 0.19 * upper.x, 0.29 + 0.19 * upper.y);
      set('wrist', 0.19 * upper.x + 0.17 * fore.x, 0.29 + 0.19 * upper.y + 0.17 * fore.y);
    }
    data.push(row);
    valid.push(b.valid ? (b.valid(k) ? 1 : 0) : 1);
  }
  return {
    jump: 0,
    samples: SAMPLES,
    takeoffTimeS: 0,
    landingTimeS: 1,
    durationS: 1,
    bodyLengthPx: 100,
    frame: '',
    columns: SEQUENCE_COLUMNS,
    data,
    valid,
  };
}

const features = (over: Partial<JumpFeatures> = {}): JumpFeatures =>
  ({
    complete: true,
    quality: { pose: 1, comCoverage: 1, trunkLengthVariation: 0.05 },
    rotation: { confidence: 0.9 },
    ...over,
  }) as JumpFeatures;

const move = (over: Partial<Movement>): Movement => ({
  direction: 'back',
  somersaults: 1,
  twists: 0,
  position: 'straight',
  ...over,
});

const smooth = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

/** A fold that closes around u = 0.15..0.3 and opens so that the hips cross 160° at `openU` (a 0.06 ramp up to 176°). */
const foldOpeningAt = (openU: number, closed = 65) => {
  const a = openU - 0.052;
  return (u: number) => 176 - (176 - closed) * smooth((u - 0.12) / 0.15) * (1 - smooth((u - a) / 0.06));
};

const one = (n: number) => (u: number) => n * u;

describe('the clock', () => {
  it('puts the body on the hours the judges use', () => {
    expect(clockHour(0.5)).toBe(12);
    expect(clockHour(CLOCK.one)).toBe(1);
    expect(clockHour(CLOCK.two)).toBe(2);
    expect(clockHour(CLOCK.three)).toBe(3);
    expect(clockHour(CLOCK.ten)).toBe(10);
    expect(clockHour(1)).toBe(6);
    expect(clockHour(-1)).toBe(6);
    expect(clockText(0.5)).toBe("12 o'clock");
  });
});

describe('a clean skill', () => {
  it('has no deduction in a straight single somersault with straight legs and arms at the sides', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1) }),
      features: features(),
      movement: move({ position: 'straight' }),
    });
    expect(e.checked).toBe(true);
    expect(e.items).toEqual([]);
    expect(e.deduction).toBe(0);
    expect(e.quality).toBeGreaterThan(0.9);
  });

  it('has no deduction in a pike that opens by 1 o’clock and stays open', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: foldOpeningAt(0.5), turns: one(1) }),
      features: features(),
      movement: move({ position: 'pike' }),
    });
    expect(e.items).toEqual([]);
  });

  it('never deducts for feet, knees and toes: it says it did not look', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1) }),
      features: features(),
      movement: move({}),
    });
    expect(e.unchecked.map((u) => u.id)).toContain('feet-knees-toes');
  });
});

describe('knees', () => {
  const at = (kneeDeg: number, position: Movement['position']) =>
    executionOf({
      sequence: sequenceOf({
        hip: position === 'pike' ? foldOpeningAt(0.5) : () => 174,
        knee: () => kneeDeg,
        turns: one(1),
      }),
      features: features(),
      movement: move({ position }),
    });

  it('takes 0.1 for a slight bend and 0.2 for a clear one in a layout or a pike', () => {
    expect(at(176, 'straight').items).toEqual([]);
    expect(at(158, 'straight').items.map((d) => [d.id, d.value])).toEqual([['knees', 0.1]]);
    expect(at(140, 'straight').items.map((d) => [d.id, d.value])).toEqual([['knees', 0.2]]);
    expect(at(150, 'pike').items.some((d) => d.id === 'knees')).toBe(true);
  });

  it('does not look at the knees of a tuck', () => {
    expect(at(60, 'tuck').items.some((d) => d.id === 'knees')).toBe(false);
  });

  it('says what was measured and the limit', () => {
    const d = at(158, 'straight').items[0];
    expect(d.detail).toMatch(/Knees at 158°/);
    expect(d.measure).toMatchObject({ name: 'knee angle', limit: 165, unit: 'deg' });
    expect(d.rule).toBe('20.2.1.2');
  });
});

describe('opening', () => {
  const opening = (openU: number, position: 'tuck' | 'pike' = 'pike', turnsScale = 1) =>
    executionOf({
      sequence: sequenceOf({ hip: foldOpeningAt(openU, position === 'tuck' ? 55 : 65), turns: (u) => turnsScale * u }),
      features: features(),
      movement: move({ position }),
    }).items.find((d) => d.id === 'opening');

  it('is free until 1 o’clock, 0.1 until 2, 0.2 until 3 and 0.3 when the body never straightens', () => {
    expect(opening(0.5)).toBeUndefined();
    expect(opening(0.57)).toBeUndefined();
    expect(opening(0.62)?.value).toBe(0.1);
    expect(opening(0.7)?.value).toBe(0.2);
    expect(opening(0.9)?.value).toBe(0.3);
    expect(opening(0.9)?.measure.value).toBeNull();
  });

  it('places the opening on the clock and says so', () => {
    expect(opening(0.62)?.detail).toBe("Straight between 1 and 2 o'clock (on time is by 1 o'clock).");
    expect(opening(0.7)?.detail).toMatch(/between 2 and 3 o'clock/);
    expect(opening(0.62)?.label).toBe('Late opening');
    expect(opening(0.9)?.label).toBe('No opening');
  });

  it('reads the same for a tuck as for a pike', () => {
    expect(opening(0.62, 'tuck')?.value).toBe(0.1);
  });

  it('is not thrown off by a somersault that reads a little short', () => {
    expect(opening(0.62, 'pike', 0.9)?.value).toBe(0.1);
    expect(opening(0.5, 'pike', 0.9)).toBeUndefined();
  });

  it('counts from the last somersault of a double', () => {
    // A double somersault turns twice: the last one starts at u = 0.5, so u = 0.86 is 0.72 of it.
    const late = executionOf({
      sequence: sequenceOf({ hip: foldOpeningAt(0.87), turns: one(2) }),
      features: features(),
      movement: move({ somersaults: 2, position: 'pike' }),
    });
    expect(late.items.find((d) => d.id === 'opening')?.value).toBe(0.2);
    const onTime = executionOf({
      sequence: sequenceOf({ hip: foldOpeningAt(0.75), turns: one(2) }),
      features: features(),
      movement: move({ somersaults: 2, position: 'pike' }),
    });
    expect(onTime.items.find((d) => d.id === 'opening')).toBeUndefined();
  });

  it('is not judged for a layout', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1) }),
      features: features(),
      movement: move({ position: 'straight' }),
    });
    expect(e.items.some((d) => d.id === 'opening' || d.id === 'pike-down')).toBe(false);
  });

  it('says when it cannot place the body on the clock', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: foldOpeningAt(0.6), turns: one(0.3) }),
      features: features(),
      movement: move({ position: 'pike' }),
    });
    expect(e.items.some((d) => d.id === 'opening')).toBe(false);
    expect(e.unchecked.map((u) => u.id)).toContain('opening');
  });
});

describe('piking down', () => {
  const opened = (lowest: number) =>
    executionOf({
      sequence: sequenceOf({
        hip: (u) =>
          u < 0.55
            ? foldOpeningAt(0.45)(u)
            : 176 - (176 - lowest) * Math.sin(((u - 0.55) / 0.2) * Math.PI) ** 2 * (u < 0.75 ? 1 : 0),
        turns: one(1),
      }),
      features: features(),
      movement: move({ position: 'pike' }),
    }).items.find((d) => d.id === 'pike-down');

  it('takes 0.1 when the hips fold again a little and 0.2 when they fold a lot', () => {
    expect(opened(170)).toBeUndefined();
    expect(opened(150)).toBeUndefined();
    expect(opened(132)?.value).toBe(0.1);
    expect(opened(115)?.value).toBe(0.2);
    expect(opened(115)?.detail).toMatch(/folded again/);
  });
});

describe('body line of a layout', () => {
  const line = (hipDeg: number) =>
    executionOf({
      sequence: sequenceOf({ hip: () => hipDeg, turns: one(1) }),
      features: features(),
      movement: move({}),
    }).items.find((d) => d.id === 'body-line');

  it('takes 0.1 for a slightly bent body and 0.2 for a clearly piked one', () => {
    expect(line(170)).toBeUndefined();
    expect(line(152)?.value).toBe(0.1);
    expect(line(140)?.value).toBe(0.2);
  });
});

describe('arms', () => {
  const arms = (arm: number, elbow: number, m: Partial<Movement> = {}) =>
    executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1), arm, elbow }),
      features: features(),
      movement: move(m),
    }).items.find((d) => d.id === 'arms');

  it('takes 0.1 when the arms are away from the body', () => {
    expect(arms(10, 178)).toBeUndefined();
    expect(arms(80, 178)?.value).toBe(0.1);
  });

  it('allows a wider arm in a skill with more than a full twist', () => {
    expect(arms(80, 178, { twists: 2.5 })).toBeUndefined();
    expect(arms(120, 178, { twists: 2.5 })?.value).toBe(0.1);
  });

  it('takes 0.1 for bent elbows in a skill of 540° of twist or less, but not in a more twisting one', () => {
    expect(arms(10, 110)?.detail).toMatch(/Elbows bent/);
    expect(arms(10, 110, { twists: 2.5 })).toBeUndefined();
  });
});

describe('end of the twist', () => {
  const twisting = (finishU: number, reliable: boolean) => {
    const trajectory = Array.from(
      { length: SAMPLES },
      (_, k) => 720 * smooth((k / (SAMPLES - 1) - 0.1) / (finishU - 0.1)),
    );
    const twist = { estimate: { available: true, reliable, totalDeg: 720 }, trajectory } as unknown as TwistContext;
    return executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1) }),
      features: features(),
      movement: move({ twists: 2 }),
      twist,
    });
  };

  it('takes 0.3 when the last 90° of a twist of more than a full twist come at 3 o’clock or later', () => {
    expect(twisting(0.6, true).items.some((d) => d.id === 'twist-end')).toBe(false);
    expect(twisting(1, true).items.find((d) => d.id === 'twist-end')?.value).toBe(0.3);
  });

  it('does not judge it from a twist that is not reliable', () => {
    const e = twisting(1, false);
    expect(e.items.some((d) => d.id === 'twist-end')).toBe(false);
    expect(e.unchecked.map((u) => u.id)).toContain('twist-end');
  });
});

describe('the total and the limits of what is judged', () => {
  it('adds the deductions and stops at 0.5 for one skill', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: () => 140, knee: () => 130, turns: one(1), arm: 90 }),
      features: features(),
      movement: move({ position: 'straight' }),
    });
    expect(e.items.map((d) => d.id).sort()).toEqual(['arms', 'body-line', 'knees']);
    expect(e.items.reduce((s, d) => s + d.value, 0)).toBeCloseTo(0.5, 5);
    const worse = executionOf({
      sequence: sequenceOf({ hip: foldOpeningAt(0.95), knee: () => 120, turns: one(1) }),
      features: features(),
      movement: move({ position: 'pike' }),
    });
    expect(worse.items.reduce((s, d) => s + d.value, 0)).toBeGreaterThan(0.4);
    expect(worse.deduction).toBeLessThanOrEqual(0.5);
  });

  it('judges nothing after 3 o’clock: a fold that only starts for the landing is no fault', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: (u) => (u < 0.8 ? 176 : 90), knee: (u) => (u < 0.8 ? 176 : 100), turns: one(1) }),
      features: features(),
      movement: move({ position: 'straight' }),
    });
    expect(e.items).toEqual([]);
  });

  it('does not judge a skill that is cut off or has too little pose data', () => {
    const cut = executionOf({
      sequence: null,
      features: features({ complete: false }),
      movement: move({}),
    });
    expect(cut.checked).toBe(false);
    expect(cut.reason).toMatch(/cut off/);
    const untracked = executionOf({ sequence: null, features: features(), movement: move({}) });
    expect(untracked.reason).toMatch(/not tracked/);
    const blind = executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1), valid: () => false }),
      features: features(),
      movement: move({}),
    });
    expect(blind.checked).toBe(false);
    expect(blind.reason).toMatch(/Too little/);
  });

  it('judges a plain jump over the first part of its flight, and only its legs', () => {
    const e = executionOf({
      sequence: sequenceOf({ hip: () => 176, knee: () => 150 }),
      features: features(),
      movement: { direction: null, somersaults: 0, twists: 0, position: 'pike' },
    });
    expect(e.items.map((d) => d.id)).toContain('knees');
    expect(e.items.some((d) => d.id === 'opening')).toBe(false);
  });

  it('does not judge a pose that was mostly filled in, or place a body on the clock when the rotation was not tracked', () => {
    const blind = executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1) }),
      features: features({ quality: { pose: 0.3, comCoverage: 1, trunkLengthVariation: 0.05 } }),
      movement: move({}),
    });
    expect(blind.checked).toBe(false);
    expect(blind.reason).toMatch(/hard to see/);
    const flipped = executionOf({
      sequence: sequenceOf({ hip: foldOpeningAt(0.9), turns: one(1) }),
      features: features({ rotation: { confidence: 0.1 } as JumpFeatures['rotation'] }),
      movement: move({ position: 'pike' }),
    });
    expect(flipped.items.some((d) => d.id === 'opening')).toBe(false);
    expect(flipped.unchecked.find((u) => u.id === 'opening')?.why).toMatch(/not tracked reliably/);
  });

  it('is less sure of a pose it saw badly', () => {
    const good = executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1) }),
      features: features(),
      movement: move({}),
    });
    const poor = executionOf({
      sequence: sequenceOf({ hip: () => 174, turns: one(1) }),
      features: features({ quality: { pose: 0.4, comCoverage: 1, trunkLengthVariation: 0.05 } }),
      movement: move({}),
    });
    expect(poor.quality).toBeLessThan(good.quality);
  });
});
