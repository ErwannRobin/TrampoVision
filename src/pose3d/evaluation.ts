import { makeRng } from '../analysis/testTracks';
import { degradeWorld, syntheticTwistJump, type TwistJumpSpec, type WorldDegrade } from './testTwistMannequin';
import { analyzeTwist } from './twist';

/**
 * Synthetic evaluation of the twist estimator (test support, not used by the app): random twisting jumps with known twists,
 * degraded the way a single-camera 3D model may fail. It answers: when the estimator calls a twist reliable, is it right?
 * It says nothing about how a real model behaves on real twisting athletes.
 */
export interface TwistCondition {
  name: string;
  degrade?: WorldDegrade;
  fps?: number;
  /** Only jumps with a somersault (where the depth-bias failure shows). */
  somersaultOnly?: boolean;
}

export interface TwistEval {
  condition: TwistCondition;
  n: number;
  /** Half twists exactly right, over all jumps. */
  exact: number;
  /** Share of jumps the estimator called reliable. */
  reliableShare: number;
  /** Half twists exactly right, over the jumps called reliable. */
  reliableExact: number;
  /** Jumps called reliable whose half-twist count is wrong. */
  reliableWrong: number;
  /** Mean absolute error of the net twist in degrees, over all jumps. */
  meanAbsErrDeg: number;
}

const pick = <T>(rnd: () => number, items: readonly T[]): T =>
  items[Math.min(items.length - 1, Math.floor(((rnd() + 1) / 2) * items.length))];

export function evaluateTwist(condition: TwistCondition, options: { jumps?: number; seed?: number } = {}): TwistEval {
  const rnd = makeRng(options.seed ?? 5);
  const total = options.jumps ?? 60;
  let exact = 0;
  let reliable = 0;
  let reliableExact = 0;
  let errSum = 0;
  for (let k = 0; k < total; k++) {
    const twistTurns = pick(rnd, [0, 0.5, 1, 1.5, 2, 3]) * (rnd() < 0 ? -1 : 1);
    const spec: TwistJumpSpec = {
      twistTurns,
      somersaultTurns: condition.somersaultOnly ? pick(rnd, [1, -1]) : pick(rnd, [0, 1, -1]),
      facing: rnd() < 0 ? -1 : 1,
      yawDeg: pick(rnd, [0, 0, 20, 40]),
      flightS: 0.9 + ((rnd() + 1) / 2) * 0.4,
      fps: condition.fps ?? 30,
    };
    const s = syntheticTwistJump(spec);
    const world = condition.degrade ? degradeWorld(s.world, { ...condition.degrade, seed: 100 + k }) : s.world;
    const e = analyzeTwist({ ...s.input, world }).jumps[0];
    const right = e.available && e.halfTwists === Math.round(Math.abs(twistTurns) * 2);
    if (right) exact++;
    if (e.available && e.totalDeg !== null) errSum += Math.abs(Math.abs(e.totalDeg) - Math.abs(s.truthTwistDeg));
    else errSum += Math.abs(s.truthTwistDeg);
    if (e.reliable) {
      reliable++;
      if (right) reliableExact++;
    }
  }
  return {
    condition,
    n: total,
    exact: exact / total,
    reliableShare: reliable / total,
    reliableExact: reliable ? reliableExact / reliable : NaN,
    reliableWrong: reliable - reliableExact,
    meanAbsErrDeg: errSum / total,
  };
}

export function formatTwistEval(rows: TwistEval[]): string {
  const p = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–');
  return [
    'condition'.padEnd(38) +
      'right'.padEnd(8) +
      'called reliable'.padEnd(17) +
      'right when reliable'.padEnd(21) +
      'reliable but wrong'.padEnd(20) +
      'mean error',
    ...rows.map(
      (r) =>
        r.condition.name.padEnd(38) +
        p(r.exact).padEnd(8) +
        p(r.reliableShare).padEnd(17) +
        p(r.reliableExact).padEnd(21) +
        String(r.reliableWrong).padEnd(20) +
        `${r.meanAbsErrDeg.toFixed(0)}°`,
    ),
  ].join('\n');
}
