import { FIG_ELEMENTS, elementById, type FigElement, type Movement } from '../fig/elements';
import { CHANNELS, derivedFromRotation, ramp, type Channels, type MovementSignature } from './signature';

/** Joint angles of the three positions at their most closed and fully open, degrees (from the test mannequin's tuck, pike and layout). */
const OPEN = { hip: 172, knee: 175 };
const CLOSED = { tuck: { hip: 60, knee: 70 }, pike: { hip: 75, knee: 172 } } as const;

/** One reference signature of one element: either the expected trajectory of the movement, or a jump a person labelled. */
export interface Reference {
  /** Stable key: `model:<element id>` or `example:<record id>`. */
  id: string;
  elementId: string;
  kind: 'model' | 'example';
  /** Where an example came from, so a jump is never compared with itself. */
  source?: { videoId: string; apexS: number };
  signature: MovementSignature;
}

const line = (n: number, f: (u: number) => number): number[] => Array.from({ length: n }, (_, k) => f(k / (n - 1)));

/**
 * The expected trajectories of a movement, from its definition alone: rotation and twist as smooth ramps inside the flight, the
 * hips and knees folding shortly after takeoff and opening before the landing for a tuck or a pike, the center of mass on a parabola.
 * They are models of what a clean execution looks like, not measurements: labelled examples (below) replace them where they exist.
 */
export function modelSignature(m: Movement, samples: number): MovementSignature {
  const n = samples;
  const somersault = line(n, (u) => m.somersaults * ramp((u - 0.05) / 0.9));
  const twist = line(n, (u) => m.twists * ramp((u - 0.1) / 0.75));
  // A tuck or a pike is held through the middle of the rotation; a plain jump folds for a shorter time.
  const [a, b] = m.somersaults > 0 ? [0.18, 0.82] : [0.3, 0.7];
  const fold = m.position === 'straight' ? () => 0 : (u: number) => ramp((u - a) / 0.1) * (1 - ramp((u - b) / 0.1));
  const closed = m.position === 'straight' ? OPEN : CLOSED[m.position];
  const channels: Channels = {
    somersault,
    twist,
    hip: line(n, (u) => (OPEN.hip - fold(u) * (OPEN.hip - closed.hip)) / 180),
    knee: line(n, (u) => (OPEN.knee - fold(u) * (OPEN.knee - closed.knee)) / 180),
    shoulderHip: Array.from({ length: n }, () => NaN),
    comHeight: line(n, (u) => 4 * u * (1 - u)),
    ...derivedFromRotation(somersault),
  };
  const trust = Object.fromEntries(CHANNELS.map((c) => [c, 1])) as MovementSignature['trust'];
  return { samples: n, channels, trust };
}

export function modelReference(e: FigElement, samples: number): Reference {
  return { id: `model:${e.id}`, elementId: e.id, kind: 'model', signature: modelSignature(e, samples) };
}

const modelCache = new Map<number, Reference[]>();

/** The model reference of every element of the table. */
export function modelReferences(samples: number): Reference[] {
  let refs = modelCache.get(samples);
  if (!refs) {
    refs = FIG_ELEMENTS.map((e) => modelReference(e, samples));
    modelCache.set(samples, refs);
  }
  return refs;
}

/** The examples without the ones that are the jump itself (same video, same apex): a labelled jump is never judged against itself. */
export function excludeSelf(examples: readonly Reference[], self: { videoId: string; apexS: number }): Reference[] {
  return examples.filter(
    (r) => !(r.source && r.source.videoId === self.videoId && Math.abs(r.source.apexS - self.apexS) <= 0.2),
  );
}

/** Examples whose element exists in the table. */
export const validExamples = (examples: readonly Reference[]): Reference[] =>
  examples.filter((r) => elementById(r.elementId));
