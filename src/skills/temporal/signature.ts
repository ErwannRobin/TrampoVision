import { lazyText } from '../../i18n/core';
import type { TwistContext, JumpSequence } from '../types';

/** The channels a movement signature is made of, in a fixed order. Every one is a function of normalized time (0 = takeoff, 1 = landing). */
export const CHANNELS = [
  'somersault',
  'twist',
  'hip',
  'knee',
  'shoulderHip',
  'comHeight',
  'angVel',
  'orientSin',
  'orientCos',
] as const;
export type Channel = (typeof CHANNELS)[number];

/** What each channel is called, in the language in use. */
export const CHANNEL_LABELS: Record<Channel, string> = lazyText({
  somersault: 'channel.somersault',
  twist: 'channel.twist',
  hip: 'channel.hip',
  knee: 'channel.knee',
  shoulderHip: 'channel.shoulderHip',
  comHeight: 'channel.comHeight',
  angVel: 'channel.angVel',
  orientSin: 'channel.orientSin',
  orientCos: 'channel.orientCos',
});

export type Channels = Record<Channel, number[]>;

/** Columns of the jump sequence that the signature reads (see SEQUENCE_COLUMNS). */
const COL = { comH: 2, turns: 8, hip: 12, knee: 13, shoulderHip: 17, quality: 19 } as const;

/** One jump (or one prototype) as normalized time series. NaN = not measured. */
export interface MovementSignature {
  samples: number;
  channels: Channels;
  /** How much each channel can be trusted, 0..1 (a twist from an unreliable 3D estimate weighs little). */
  trust: Record<Channel, number>;
}

/** What was measured, before any naming: continuous counts, not rounded ones. */
export interface MeasuredMovement {
  direction: 'front' | 'back' | null;
  /** Continuous, e.g. 1.02. */
  somersaults: number;
  /** Continuous, e.g. 0.98; null when the twist is not measured. */
  twists: number | null;
  position: 'straight' | 'tuck' | 'pike' | 'unknown';
  trajectories: Partial<Record<Channel, number[]>>;
}

const nans = (n: number) => Array.from({ length: n }, () => NaN);
const finite = (v: number) => Number.isFinite(v);

/** Smooth 0 -> 1 ramp between two normalized times. */
export const ramp = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

/** Fills gaps by linear interpolation and holds the ends; returns null when too little was measured. */
export function fillGaps(v: number[], minShare = 0.6): number[] | null {
  const idx = v.flatMap((x, i) => (finite(x) ? [i] : []));
  if (idx.length < Math.max(2, v.length * minShare)) return null;
  const out = v.slice();
  for (let i = 0; i < v.length; i++) {
    if (finite(v[i])) continue;
    const next = idx.find((j) => j > i);
    const prev = [...idx].reverse().find((j) => j < i);
    if (prev === undefined) out[i] = v[next!];
    else if (next === undefined) out[i] = v[prev];
    else out[i] = v[prev] + ((v[next] - v[prev]) * (i - prev)) / (next - prev);
  }
  return out;
}

/** Derivative with respect to normalized time, lightly smoothed. */
export function gradient(v: number[]): number[] {
  const n = v.length;
  const d = v.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    return ((v[b] - v[a]) / (b - a)) * (n - 1);
  });
  return d.map((_, i) => (d[Math.max(0, i - 1)] + 2 * d[i] + d[Math.min(n - 1, i + 1)]) / 4);
}

/** Channels that follow from the rotation channel alone, shared by measured jumps and prototypes so both are built identically. */
export function derivedFromRotation(somersault: number[]): Pick<Channels, 'angVel' | 'orientSin' | 'orientCos'> {
  return {
    angVel: gradient(somersault),
    orientSin: somersault.map((s) => Math.sin(2 * Math.PI * s)),
    orientCos: somersault.map((s) => Math.cos(2 * Math.PI * s)),
  };
}

/**
 * The movement signature of one jump: rotation and twist since takeoff (turns, made positive in the direction they went, so front and
 * back are compared by shape and the direction is decided by its own question), body angles, center-of-mass height (as a shape) and
 * the angular velocity. Null when the rotation was not measured over enough of the flight.
 */
export function buildSignature(seq: JumpSequence | null, twist: TwistContext | null): MovementSignature | null {
  if (!seq || seq.data.length < 8) return null;
  const n = seq.data.length;
  const col = (c: number) => seq.data.map((r) => r[c]);
  const turnsRaw = fillGaps(col(COL.turns));
  if (!turnsRaw) return null;
  const net = turnsRaw[n - 1] - turnsRaw[0];
  const sign = net < 0 ? -1 : 1;
  const somersault = turnsRaw.map((t) => (t - turnsRaw[0]) * sign);

  const scaled = (c: number, k: number) => {
    const f = fillGaps(col(c), 0.5);
    return f ? f.map((v) => v / k) : nans(n);
  };

  let comHeight = nans(n);
  const com = fillGaps(col(COL.comH), 0.5);
  if (com) {
    const rel = com.map((v) => v - com[0]);
    const top = Math.max(...rel);
    if (top > 0.05) comHeight = rel.map((v) => v / top);
  }

  let twistTurns = nans(n);
  let twistTrust = 0;
  const traj = twist?.trajectory;
  if (traj && traj.length >= 8) {
    const t = fillGaps(traj, 0.5);
    if (t) {
      const end = t[t.length - 1];
      const s = end < 0 ? -1 : 1;
      // The trajectory has its own sample count: bring it onto the sequence's time axis.
      twistTurns = Array.from({ length: n }, (_, k) => {
        const x = (k / (n - 1)) * (t.length - 1);
        const i = Math.floor(x);
        const j = Math.min(t.length - 1, i + 1);
        return ((t[i] + (t[j] - t[i]) * (x - i)) * s) / 360;
      });
      twistTrust = twist?.estimate.available ? Math.min(1, 0.5 + 0.5 * (twist.estimate.confidence ?? 0)) : 0;
    }
  }

  const channels: Channels = {
    somersault,
    twist: twistTurns,
    hip: scaled(COL.hip, 180),
    knee: scaled(COL.knee, 180),
    shoulderHip: scaled(COL.shoulderHip, 90),
    comHeight,
    ...derivedFromRotation(somersault),
  };
  const trust = Object.fromEntries(CHANNELS.map((c) => [c, 1])) as Record<Channel, number>;
  trust.twist = twistTrust;
  return { samples: n, channels, trust };
}

/** The measured movement: the signature's numbers as counts and the trajectories it came from. */
export function measuredMovement(
  sig: MovementSignature,
  direction: MeasuredMovement['direction'],
  position: MeasuredMovement['position'],
): MeasuredMovement {
  const end = (c: number[]) => c.filter(finite).at(-1);
  const twistEnd = sig.trust.twist > 0 ? end(sig.channels.twist) : undefined;
  const trajectories: MeasuredMovement['trajectories'] = {};
  for (const c of CHANNELS)
    if (sig.channels[c].some(finite)) trajectories[c] = sig.channels[c].map((v) => +v.toFixed(4));
  return {
    direction,
    somersaults: +Math.abs(end(sig.channels.somersault) ?? 0).toFixed(3),
    twists: twistEnd === undefined ? null : +Math.abs(twistEnd).toFixed(3),
    position,
    trajectories,
  };
}
