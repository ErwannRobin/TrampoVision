import { CHANNELS, type Channel, type MovementSignature } from './signature';

export interface DtwOptions {
  /** Sakoe-Chiba band: how far the two time axes may drift apart, as a share of the sequence length. */
  bandFraction: number;
  /** Cost added per step for each unit of normalized time the path is off the diagonal (timing counts, not only shape). */
  warpPenalty: number;
  /** Tolerance of the final somersault and twist (turns) and the weight of a miss in the distance. */
  endSigma: number;
  endWeight: number;
  /** Tolerance of each channel: a difference of this size costs 1. */
  sigma: Record<Channel, number>;
  /** Importance of each channel. */
  weights: Record<Channel, number>;
}

export interface DtwResult {
  /** Root of the mean weighted squared difference along the best path, in tolerances (0 = identical, about 1 = every channel off by one tolerance). */
  distance: number;
  /** Matched pairs [index in a, index in b]. */
  path: [number, number][];
  /** The same distance per channel, NaN when the channel is missing on either side. */
  perChannel: Record<Channel, number>;
}

/** Channels both signatures measured, with the weight each carries. */
function shared(a: MovementSignature, b: MovementSignature, o: DtwOptions): { c: Channel; w: number }[] {
  return CHANNELS.flatMap((c) => {
    const w = o.weights[c] * a.trust[c] * b.trust[c];
    return w > 0 && a.channels[c].some(Number.isFinite) && b.channels[c].some(Number.isFinite) ? [{ c, w }] : [];
  });
}

/**
 * Dynamic time warping between two movement signatures. The time axes may bend within a band (a slightly earlier tuck, a later
 * opening), while the amplitudes (how many somersaults, how many twists, how deep the fold) are compared as they are, so warping
 * cannot turn a single somersault into a double one. Both signatures come from the same normalized time axis.
 */
export function dtw(a: MovementSignature, b: MovementSignature, o: DtwOptions): DtwResult {
  const n = a.samples;
  const m = b.samples;
  const use = shared(a, b, o);
  const perChannel = Object.fromEntries(CHANNELS.map((c) => [c, NaN])) as Record<Channel, number>;
  if (!use.length) return { distance: Infinity, path: [], perChannel };
  const wSum = use.reduce((s, u) => s + u.w, 0);
  const band = Math.max(1, Math.round(o.bandFraction * Math.max(n, m)));

  const local = (i: number, j: number): number => {
    let s = 0;
    for (const { c, w } of use) {
      const x = a.channels[c][i];
      const y = b.channels[c][j];
      if (Number.isFinite(x) && Number.isFinite(y)) s += (w * ((x - y) / o.sigma[c]) ** 2) / wSum;
    }
    return s + o.warpPenalty * Math.abs(i / (n - 1) - j / (m - 1));
  };

  const cost = Array.from({ length: n }, () => new Float64Array(m).fill(Infinity));
  const len = Array.from({ length: n }, () => new Uint16Array(m));
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - band); j <= Math.min(m - 1, i + band); j++) {
      const c = local(i, j);
      if (i === 0 && j === 0) {
        cost[0][0] = c;
        len[0][0] = 1;
        continue;
      }
      const options: [number, number][] = [];
      if (i > 0) options.push([i - 1, j]);
      if (j > 0) options.push([i, j - 1]);
      if (i > 0 && j > 0) options.push([i - 1, j - 1]);
      let best = Infinity;
      let from: [number, number] = [0, 0];
      for (const [pi, pj] of options)
        if (cost[pi][pj] < best) {
          best = cost[pi][pj];
          from = [pi, pj];
        }
      if (best < Infinity) {
        cost[i][j] = best + c;
        len[i][j] = len[from[0]][from[1]] + 1;
      }
    }
  }
  if (!Number.isFinite(cost[n - 1][m - 1])) return { distance: Infinity, path: [], perChannel };

  // Walk back along the cheapest predecessors.
  const path: [number, number][] = [[n - 1, m - 1]];
  let [i, j] = [n - 1, m - 1];
  while (i > 0 || j > 0) {
    const cand: [number, number][] = [];
    if (i > 0 && j > 0) cand.push([i - 1, j - 1]);
    if (i > 0) cand.push([i - 1, j]);
    if (j > 0) cand.push([i, j - 1]);
    [i, j] = cand.reduce((best, p) => (cost[p[0]][p[1]] < cost[best[0]][best[1]] ? p : best));
    path.push([i, j]);
  }
  path.reverse();

  for (const { c } of use) {
    let s = 0;
    let k = 0;
    for (const [pi, pj] of path) {
      const x = a.channels[c][pi];
      const y = b.channels[c][pj];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        s += ((x - y) / o.sigma[c]) ** 2;
        k++;
      }
    }
    perChannel[c] = k ? Math.sqrt(s / k) : NaN;
  }
  // Where the rotation and the twist end is not a matter of timing: warping must not hide a quarter turn or a half twist.
  let end = 0;
  for (const c of ['somersault', 'twist'] as const) {
    const x = a.channels[c][n - 1];
    const y = b.channels[c][m - 1];
    if (o.weights[c] * a.trust[c] * b.trust[c] > 0 && Number.isFinite(x) && Number.isFinite(y))
      end += ((x - y) / o.endSigma) ** 2;
  }
  return { distance: Math.sqrt(cost[n - 1][m - 1] / len[n - 1][m - 1] + o.endWeight * end), path, perChannel };
}

/** The second signature's channel put on the first one's time axis along a DTW path (the mean of the samples matched to each). */
export function alignTo(path: [number, number][], b: number[], n: number): number[] {
  const sum = new Float64Array(n);
  const cnt = new Uint16Array(n);
  for (const [i, j] of path)
    if (Number.isFinite(b[j])) {
      sum[i] += b[j];
      cnt[i]++;
    }
  return Array.from(sum, (s, i) => (cnt[i] ? s / cnt[i] : NaN));
}

/** 1 for a perfect match, about 0.6 when every channel is off by `scale` tolerances. */
export const similarity = (distance: number, scale: number): number =>
  Number.isFinite(distance) ? Math.exp(-0.5 * (distance / scale) ** 2) : 0;
