import { describe, expect, it } from 'vitest';
import type { Signature } from '../pose/appearance';
import { LM, LANDMARK_COUNT } from '../pose/landmarks';
import type { PoseDetection } from '../pose/types';
import { JumperSelector, verticalTravel } from './jumperSelect';

/** A person whose hips are at (x, y) of the picture (0 to 1), with a torso this long: shoulders above the hips. */
function person(x: number, y: number, torso = 0.1): PoseDetection {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: y - torso / 2, visibility: 1 }));
  landmarks[LM.L_HIP] = { x: x - torso / 5, y, visibility: 1 };
  landmarks[LM.R_HIP] = { x: x + torso / 5, y, visibility: 1 };
  landmarks[LM.L_SHOULDER] = { x: x - torso / 5, y: y - torso, visibility: 1 };
  landmarks[LM.R_SHOULDER] = { x: x + torso / 5, y: y - torso, visibility: 1 };
  return { landmarks };
}

const FPS = 30;
/** The hip height of a jumper at `t`: on the bed at `bedY`, `high` of the picture above it at the top, `periodS` a jump. */
const jumpY = (t: number, bedY: number, high: number, periodS: number) =>
  bedY - high * Math.abs(Math.sin((Math.PI * t) / periodS));

/**
 * Runs a scene through a selector: `people(t)` says who the pose model finds at `t`. Returns, per frame, the x of the hips
 * of the people the selector chose, or null while it does not know (the caller would fall back on the motion box).
 */
function run(selector: JumperSelector, people: (t: number) => PoseDetection[], seconds: number): (number[] | null)[] {
  const out: (number[] | null)[] = [];
  for (let k = 0; k < seconds * FPS; k++) {
    const t = k / FPS;
    const chosen = selector.push(people(t), t);
    out.push(chosen === null ? null : chosen.map((p) => (p.landmarks[LM.L_HIP].x + p.landmarks[LM.R_HIP].x) / 2));
  }
  return out;
}

/** The frames after the warm-up (the first `fromS` seconds are the selector making up its mind). */
const after = <T>(rows: T[], fromS: number) => rows.slice(Math.round(fromS * FPS));

describe('the up-and-down travel of the hips', () => {
  it('is the height of a jump for a jumper, measured over a window', () => {
    const samples = Array.from({ length: 90 }, (_, k) => ({ t: k / FPS, y: jumpY(k / FPS, 0.6, 0.35, 1.6) }));
    const travel = verticalTravel(samples, 3);
    expect(travel).toBeGreaterThan(0.25);
    expect(travel).toBeLessThanOrEqual(0.36);
  });

  it('is nearly nothing for a person who stands, even with some jitter', () => {
    const samples = Array.from({ length: 90 }, (_, k) => ({ t: k / FPS, y: 0.75 + 0.01 * Math.sin(k) }));
    expect(verticalTravel(samples, 3)).toBeLessThan(0.03);
  });

  it('reads only the window, not the whole life of a track', () => {
    // Jumped long ago, stands since: the old travel must not keep the title alive.
    const samples = [
      ...Array.from({ length: 60 }, (_, k) => ({ t: k / FPS, y: jumpY(k / FPS, 0.6, 0.35, 1.6) })),
      ...Array.from({ length: 120 }, (_, k) => ({ t: 2 + k / FPS, y: 0.6 })),
    ];
    expect(verticalTravel(samples, 3)).toBeLessThan(0.03);
  });
});

describe('the person who jumps, chosen by the travel of their hips', () => {
  const jumper = (t: number) => person(0.5, jumpY(t, 0.55, 0.3, 1.6), 0.08);
  /** Nearer the camera and several times bigger, right under the jumper's path, like the spotter of the real clip. */
  const spotter = () => person(0.52, 0.8, 0.2);

  it('does not know at first: the first jump is the warm-up', () => {
    const rows = run(new JumperSelector(), (t) => [spotter(), jumper(t)], 8);
    expect(rows[0]).toBeNull();
  });

  it('chooses the jumper over a bigger spotter in their columns, in every frame after the warm-up', () => {
    const rows = run(new JumperSelector(), (t) => [spotter(), jumper(t)], 8);
    const settled = after(rows, 3);
    expect(settled.every((xs) => xs !== null && xs.length === 1 && Math.abs(xs[0] - 0.5) < 0.01)).toBe(true);
  });

  it('keeps the choice while the jumper is hidden behind the spotter at a landing, and takes them back after', () => {
    // The jumper disappears for 0.4 s around every landing (the spotter is in front of them).
    const occluded = (t: number) => {
      const sinceLanding = t % 1.6;
      const hidden = sinceLanding < 0.2 || sinceLanding > 1.4;
      return hidden ? [spotter()] : [spotter(), jumper(t)];
    };
    const rows = run(new JumperSelector(), occluded, 10);
    for (const xs of after(rows, 3)) {
      // Either the jumper, or nobody (a frame left empty is better than a frame that follows the spotter).
      expect(xs === null || xs.length === 0 || (xs.length === 1 && Math.abs(xs[0] - 0.5) < 0.01)).toBe(true);
    }
    const found = after(rows, 3).filter((xs) => xs !== null && xs.length === 1);
    expect(found.length).toBeGreaterThan(5 * FPS);
  });

  it('does not flip to a second person whose travel is nearly as large', () => {
    const other = (t: number) => person(0.2, jumpY(t + 0.8, 0.55, 0.24, 1.6), 0.08);
    const rows = run(new JumperSelector(), (t) => [jumper(t), other(t)], 10);
    const settled = after(rows, 3).filter((xs): xs is number[] => xs !== null && xs.length === 1);
    expect(settled.length).toBeGreaterThan(0);
    const choices = new Set(settled.map((xs) => Math.round(xs[0] * 10)));
    expect(choices.size).toBe(1);
  });

  it('is not fooled by a spotter who bobs at every landing and bends down fast now and then', () => {
    // The spotter of the competition clip: hips that bob a little in time with the jumps, and every few jumps a deep, fast
    // bend (about 0.5 picture heights a second — the travel and the speed of half a jump). What tells them apart is that it
    // all happens at the spotter's own height, never above their station. The jumper is hidden behind them around every
    // landing, so her tracks are fragments.
    const bending = (t: number) => {
      const bob = 0.03 * Math.abs(Math.sin((Math.PI * t) / 1.6));
      const phase = t % 4.8;
      const dip = phase < 0.5 ? 0.14 * Math.sin((Math.PI * phase) / 0.5) : 0;
      return person(0.62, 0.78 + bob + dip, 0.2);
    };
    const fragmented = (t: number) => {
      const sinceLanding = t % 1.6;
      const hidden = sinceLanding < 0.25 || sinceLanding > 1.35;
      return hidden ? [bending(t)] : [bending(t), jumper(t)];
    };
    const rows = run(new JumperSelector(), fragmented, 10);
    for (const xs of after(rows, 4)) {
      expect(xs === null || xs.every((x) => Math.abs(x - 0.5) < 0.01)).toBe(true);
    }
    const found = after(rows, 4).filter((xs) => xs !== null && xs.length === 1);
    expect(found.length).toBeGreaterThan(3 * FPS);
  });

  it('is not fooled by somebody who walks fast across the picture: sideways travel is not jumping', () => {
    const walker = (t: number) => person((0.1 + 0.1 * t) % 1, 0.7, 0.12);
    const rows = run(new JumperSelector(), (t) => [walker(t), jumper(t)], 8);
    const settled = after(rows, 3);
    expect(settled.every((xs) => xs !== null && xs.length === 1 && Math.abs(xs[0] - 0.5) < 0.01)).toBe(true);
  });

  it('keeps both jumpers of a synchro, and not the spotter', () => {
    const left = (t: number) => person(0.3, jumpY(t, 0.55, 0.3, 1.6), 0.08);
    const right = (t: number) => person(0.7, jumpY(t + 0.3, 0.55, 0.28, 1.6), 0.08);
    const rows = run(new JumperSelector(2), (t) => [spotter(), left(t), right(t)], 8);
    const settled = after(rows, 3);
    expect(
      settled.every((xs) => xs !== null && xs.length === 2 && xs.some((x) => x < 0.4) && xs.some((x) => x > 0.6)),
    ).toBe(true);
  });

  it('does not give the same person twice when the model found them twice', () => {
    const rows = run(new JumperSelector(2), (t) => [jumper(t), jumper(t), spotter()], 8);
    for (const xs of after(rows, 3)) {
      expect(xs === null || xs.filter((x) => Math.abs(x - 0.5) < 0.01).length <= 1).toBe(true);
    }
  });

  it('never answers while nobody travels: a camera that follows the athlete leaves the choice to the motion box', () => {
    // Everybody nearly still in the picture: the camera follows the jumper, so their hips stay put.
    const rows = run(new JumperSelector(), () => [person(0.5, 0.5, 0.1), person(0.8, 0.7, 0.15)], 8);
    expect(rows.every((xs) => xs === null)).toBe(true);
  });
});

describe('the clothes of the athlete', () => {
  const colored = (rgb: [number, number, number]): Signature => ({ torso: rgb, legs: rgb });
  const black = colored([0.05, 0.05, 0.05]);
  const maroon = colored([0.45, 0.1, 0.12]);

  /** Like `run`, with the colors of each person's clothes given along. */
  function runWithLooks(
    selector: JumperSelector,
    scene: (t: number) => { people: PoseDetection[]; looks: (Signature | null)[] },
    seconds: number,
  ): (number[] | null)[] {
    const out: (number[] | null)[] = [];
    for (let k = 0; k < seconds * FPS; k++) {
      const t = k / FPS;
      const { people, looks } = scene(t);
      const chosen = selector.push(people, t, looks);
      out.push(chosen === null ? null : chosen.map((p) => (p.landmarks[LM.L_HIP].x + p.landmarks[LM.R_HIP].x) / 2));
    }
    return out;
  }

  /** The jumper in black jumps, is lost for longer than a track survives, and reappears without travelling yet. */
  const scene =
    (reappearsAs: Signature) =>
    (t: number): { people: PoseDetection[]; looks: (Signature | null)[] } => {
      const spotter = person(0.52, 0.8, 0.2);
      if (t < 4) {
        return { people: [spotter, person(0.5, jumpY(t, 0.55, 0.3, 1.6), 0.08)], looks: [maroon, black] };
      }
      if (t < 5.5) return { people: [spotter], looks: [maroon] };
      // Back in the middle of her flight band, hips still (the model just found her again): no travel to speak yet.
      return { people: [spotter, person(0.45, 0.4, 0.08)], looks: [maroon, reappearsAs] };
    };

  it('are how she is known again after a gap no track survives, before she has travelled anew', () => {
    const rows = runWithLooks(new JumperSelector(), scene(black), 7);
    const back = after(rows, 5.6).filter((xs) => xs !== null && xs.length === 1);
    expect(back.length).toBeGreaterThan(FPS);
    expect(back.every((xs) => Math.abs(xs![0] - 0.45) < 0.01)).toBe(true);
  });

  it('keep a stranger in other clothes out: the frame stays empty', () => {
    const rows = runWithLooks(new JumperSelector(), scene(maroon), 7);
    expect(after(rows, 5.6).every((xs) => xs !== null && xs.length === 0)).toBe(true);
  });
});

describe('a cut of the broadcast', () => {
  it('makes the selector forget the shot before: it does not know who jumps until somebody travels again', () => {
    const selector = new JumperSelector();
    const rows = run(selector, (t) => [person(0.5, jumpY(t, 0.7, 0.25, 1)), person(0.2, 0.7)], 6);
    expect(after(rows, 5).every((r) => r !== null && r.length === 1)).toBe(true);
    selector.cut();
    // The next shot has only a person who stands where the jumper stood.
    expect(selector.push([person(0.5, 0.7)], 6)).toBeNull();
  });
});
