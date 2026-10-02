import { describe, expect, it } from 'vitest';
import { makeRng } from '../analysis/testTracks';
import type { TwistJumpSpec } from '../pose3d/testTwistMannequin';
import { syntheticTwist2d, type Degrade2d } from './testTwist2d';
import { analyzeTwist2d } from './twist2d';

interface Row {
  n: number;
  right: number;
  reliable: number;
  rightWhenReliable: number;
  reliableButWrong: number;
}

/**
 * Random jumps with 0 to 3 twists (halves included), 0 to 2 somersaults, both facings, a camera yaw and a lean, each read from the
 * 2D landmarks of the simulated athlete. `right` = the half-twist count is exactly right; `reliable` = the estimator did not decline.
 */
function evaluate(
  count: number,
  degrade: Degrade2d = {},
  extra: (rnd: () => number) => TwistJumpSpec = () => ({}),
  seed = 5,
): Row {
  const rnd = makeRng(seed);
  const pick = <T>(xs: T[]) => xs[Math.min(xs.length - 1, Math.floor(((rnd() + 1) / 2) * xs.length))];
  const row: Row = { n: 0, right: 0, reliable: 0, rightWhenReliable: 0, reliableButWrong: 0 };
  for (let i = 0; i < count; i++) {
    const spec: TwistJumpSpec = {
      twistTurns: pick([0, 0, 0.5, 1, 1.5, 2, 2.5, 3]),
      somersaultTurns: pick([0, 1, 2]),
      facing: pick([-1, 1] as const),
      yawDeg: pick([0, 10]),
      leanDeg: pick([0, 8, 15]),
      ...extra(rnd),
    };
    const s = syntheticTwist2d(spec, { ...degrade, seed: degrade.seed ?? i + 1 });
    const e = analyzeTwist2d(s.input).jumps[0];
    const right = e.halfTwists === s.truthHalfTwists;
    row.n++;
    if (right) row.right++;
    if (e.reliable) {
      row.reliable++;
      if (right) row.rightWhenReliable++;
      else row.reliableButWrong++;
    }
  }
  return row;
}

const pc = (v: number, n: number) => `${Math.round((100 * v) / n)}%`;
const fmt = (label: string, r: Row) =>
  `${label.padEnd(44)} right ${pc(r.right, r.n).padStart(4)}  reliable ${pc(r.reliable, r.n).padStart(4)}  right when reliable ${
    r.reliable ? pc(r.rightWhenReliable, r.reliable) : '–'
  }  reliable but wrong ${r.reliableButWrong}`;

describe('2D twist estimator (simulated athlete, orthographic camera)', () => {
  it('reads 0 to 3 twists from a clean skeleton', () => {
    for (const tw of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
      for (const som of [0, 1, 2]) {
        const s = syntheticTwist2d({ twistTurns: tw, somersaultTurns: som, facing: 1, yawDeg: 8 }, { noisePx: 1 });
        const e = analyzeTwist2d(s.input).jumps[0];
        expect(e.halfTwists, `${tw} twists, ${som} somersaults`).toBe(s.truthHalfTwists);
        expect(e.reliable).toBe(true);
        expect(e.totalDeg).toBe(180 * s.truthHalfTwists);
        expect(e.twists).toBe(s.truthHalfTwists / 2);
      }
    }
  });

  it('says so when the flight is cut off or has no skeleton', () => {
    const s = syntheticTwist2d({ twistTurns: 1 });
    const cut = analyzeTwist2d({ ...s.input, cycles: [{ takeoffTimeS: null, landingTimeS: 1, complete: false }] })
      .jumps[0];
    expect(cut.available).toBe(false);
    expect(cut.reliable).toBe(false);
    expect(cut.halfTwists).toBeNull();
    const empty = analyzeTwist2d({ ...s.input, frames: s.input.frames.map(() => null) }).jumps[0];
    expect(empty.available).toBe(false);
    const dropped = syntheticTwist2d({ twistTurns: 1 }, { dropout: 0.8 });
    expect(analyzeTwist2d(dropped.input).jumps[0].reliable).toBe(false);
  });

  it('declines a twist that goes by faster than the frame rate can follow', () => {
    // Three twists in one second at 12 fps: less than two frames per half twist.
    const s = syntheticTwist2d({ twistTurns: 3, flightS: 1, fps: 12 });
    const e = analyzeTwist2d(s.input).jumps[0];
    expect(e.reliable).toBe(false);
    expect(e.parts.rate).toBeLessThan(0.5);
  });

  it('does not lean on the chirality when the face contradicts it (swapped left and right)', () => {
    const s = syntheticTwist2d({ twistTurns: 1.5 }, { swapLeftRight: [10, 40], noisePx: 1 });
    const e = analyzeTwist2d(s.input).jumps[0];
    // Whatever it says must not be a confident wrong answer.
    if (e.reliable) expect(e.halfTwists).toBe(3);
  });

  it('is independent of the camera yaw (a circle projected on a line keeps its amplitude)', () => {
    for (const yaw of [0, 30, 60, 85]) {
      const s = syntheticTwist2d({ twistTurns: 2, somersaultTurns: 1, yawDeg: yaw }, { noisePx: 1 });
      expect(analyzeTwist2d(s.input).jumps[0].halfTwists, `yaw ${yaw}`).toBe(4);
    }
  });

  it('prints and checks the table of conditions', () => {
    const N = 80;
    const rows: [string, Row][] = [
      ['clean', evaluate(N)],
      [
        'oblique camera, yaw 25 to 50 degrees',
        evaluate(N, { noisePx: 1.5 }, (r) => ({ yawDeg: 25 + 25 * ((r() + 1) / 2) })),
      ],
      ['landmark noise 1.5 px (1.7% of the trunk)', evaluate(N, { noisePx: 1.5 })],
      ['landmark noise 3 px (3.3%)', evaluate(N, { noisePx: 3 })],
      ['landmark noise 6 px (6.7%)', evaluate(N, { noisePx: 6 })],
      ['landmark noise 10 px (11%)', evaluate(N, { noisePx: 10 })],
      ['noise 1.5 px + 10% of the frames missing', evaluate(N, { noisePx: 1.5, dropout: 0.1 })],
      ['noise 1.5 px + 30% of the frames missing', evaluate(N, { noisePx: 1.5, dropout: 0.3 })],
      ['left/right swapped for 8 frames', evaluate(N, { noisePx: 1.5, swapLeftRight: [18, 25] })],
      ['no face information in the visibility', evaluate(N, { noisePx: 1.5, noFaceVisibility: true })],
      ['shoulders and hips 25% wider than the prior', evaluate(N, { noisePx: 1.5, widthScale: 1.25 })],
      ['shoulders and hips 20% narrower than the prior', evaluate(N, { noisePx: 1.5, widthScale: 0.8 })],
      ['twist runs over the whole flight [0, 1]', evaluate(N, { noisePx: 1.5 }, () => ({ twistWindow: [0, 1] }))],
      ['late twist [0.35, 0.95]', evaluate(N, { noisePx: 1.5 }, () => ({ twistWindow: [0.35, 0.95] }))],
      ['20 fps', evaluate(N, { noisePx: 1.5 }, () => ({ fps: 20 }))],
      ['15 fps', evaluate(N, { noisePx: 1.5 }, () => ({ fps: 15 }))],
    ];
    console.log(`\n2D twist, ${N} random jumps per row\n${rows.map(([l, r]) => fmt(l, r)).join('\n')}`);
    const byLabel = Object.fromEntries(rows);
    expect(byLabel.clean.right / N).toBeGreaterThan(0.95);
    // The point of the confidence: what it calls reliable is nearly always right, on every row.
    for (const [label, r] of rows) {
      expect(r.reliableButWrong, label).toBeLessThanOrEqual(Math.ceil(0.05 * r.n));
    }
  }, 60_000); // 16 rows of 80 simulated jumps: slower than the 5 s default, most of all on a busy CI runner.
});
