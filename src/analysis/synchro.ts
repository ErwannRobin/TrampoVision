import type { SkillId } from '../skills/types';
import type { JumpCycle } from './jumpCycles';

/**
 * A synchronization estimate for athletes who jump together. It is this app's own simple measure, not the FIG synchro
 * judging: a jump starts at the full mark and loses points for what a judge would see first, the athletes leaving and
 * landing at different times, reaching different heights, and doing different skills.
 */

/** One jump of one athlete, as far as synchronization is concerned. */
export interface SynchroJumpInput {
  cycle: JumpCycle;
  skill: SkillId;
}

export const SYNCHRO_FULL_MARK = 10;
/** Points lost per second the athletes are apart at takeoff and landing (0.1 s = 1 point), at most `MAX_TIMING_LOSS`. */
const TIMING_LOSS_PER_S = 10;
const MAX_TIMING_LOSS = 4;
/** Points lost per unit of height difference as a share of the higher jump (5% = 0.5 point), at most `MAX_HEIGHT_LOSS`. */
const HEIGHT_LOSS_PER_SHARE = 10;
const MAX_HEIGHT_LOSS = 3;
/** Points lost when the athletes did different skills. */
const SKILL_LOSS = 3;
/** Jumps whose apexes are further apart than this are not the same jump. */
export const MAX_MATCH_S = 0.75;

export interface SynchroJump {
  /** 1-based number of the jump in the first athlete's clip. */
  number: number;
  /** Time between the first and the last athlete leaving the bed / landing on it, seconds. */
  takeoffSpreadS: number;
  landingSpreadS: number;
  /** Height gained in the air: highest minus lowest, as a share of the highest. */
  heightSpread: number;
  /** Every athlete did the same skill; null when one of them was not classified, so it cannot be told. */
  sameSkill: boolean | null;
  loss: { timing: number; height: number; skill: number };
  /** 0 to `SYNCHRO_FULL_MARK`. */
  score: number;
}

export interface SynchroScore {
  jumps: SynchroJump[];
  /** Mean of the jumps, or null when no jump could be matched across all the athletes. */
  score: number | null;
  /** Means over the matched jumps: the timing offset (takeoff and landing together), seconds, and the height difference, share. */
  meanTimingS: number | null;
  meanHeightSpread: number | null;
  /** Complete jumps that no other athlete matched: they are not scored. */
  unmatched: number;
}

const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Pairs each complete jump of the first athlete with the nearest unused complete jump of every other athlete. */
function matchJumps(athletes: SynchroJumpInput[][]): SynchroJumpInput[][] {
  const complete = athletes.map((jumps) => jumps.filter((j) => j.cycle.complete));
  const used = complete.map(() => new Set<number>());
  const groups: SynchroJumpInput[][] = [];
  for (const lead of complete[0]) {
    const group = [lead];
    const picked: number[] = [];
    for (let a = 1; a < complete.length; a++) {
      let best = -1;
      let gap = MAX_MATCH_S;
      complete[a].forEach((j, i) => {
        const d = Math.abs(j.cycle.apexTimeS - lead.cycle.apexTimeS);
        if (!used[a].has(i) && d <= gap) {
          gap = d;
          best = i;
        }
      });
      if (best < 0) break;
      picked.push(best);
      group.push(complete[a][best]);
    }
    if (group.length === athletes.length) {
      picked.forEach((i, k) => used[k + 1].add(i));
      groups.push(group);
    }
  }
  return groups;
}

/** How well the athletes jump together: one score per jump they share, and the mean. Needs two athletes or more. */
export function synchroScore(athletes: SynchroJumpInput[][]): SynchroScore {
  if (athletes.length < 2) return { jumps: [], score: null, meanTimingS: null, meanHeightSpread: null, unmatched: 0 };
  const groups = matchJumps(athletes);
  const jumps = groups.map((group): SynchroJump => {
    const cycles = group.map((g) => g.cycle);
    const takeoffSpreadS = spread(cycles.map((c) => c.takeoffTimeS ?? c.apexTimeS));
    const landingSpreadS = spread(cycles.map((c) => c.landingTimeS ?? c.apexTimeS));
    const rises = cycles.map((c) => c.riseM ?? c.apexHeightM);
    const top = Math.max(...rises);
    const heightSpread = top > 0 ? spread(rises) / top : 0;
    const known = group.every((g) => g.skill !== 'unclassified');
    const sameSkill = known ? group.every((g) => g.skill === group[0].skill) : null;
    const loss = {
      timing: Math.min(MAX_TIMING_LOSS, ((takeoffSpreadS + landingSpreadS) / 2) * TIMING_LOSS_PER_S),
      height: Math.min(MAX_HEIGHT_LOSS, heightSpread * HEIGHT_LOSS_PER_SHARE),
      skill: sameSkill === false ? SKILL_LOSS : 0,
    };
    const score = round1(Math.max(0, SYNCHRO_FULL_MARK - loss.timing - loss.height - loss.skill));
    return { number: group[0].cycle.index + 1, takeoffSpreadS, landingSpreadS, heightSpread, sameSkill, loss, score };
  });
  const mean = (f: (j: SynchroJump) => number) =>
    jumps.length ? jumps.reduce((sum, j) => sum + f(j), 0) / jumps.length : null;
  const meanScore = mean((j) => j.score);
  const total = athletes.reduce((n, jumps) => n + jumps.filter((j) => j.cycle.complete).length, 0);
  return {
    jumps,
    score: meanScore === null ? null : round1(meanScore),
    meanTimingS: mean((j) => (j.takeoffSpreadS + j.landingSpreadS) / 2),
    meanHeightSpread: mean((j) => j.heightSpread),
    unmatched: total - jumps.length * athletes.length,
  };
}
