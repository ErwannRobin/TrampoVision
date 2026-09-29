import { describeBedPosition, type JumpHeadline } from '../../insights';

/** Where a jump takes off, peaks and lands on the bed (+-1 = the edge along the on-screen horizontal). */
export type BedPositions = NonNullable<JumpHeadline['bed']>;
export type BedEvent = keyof BedPositions;

export const BED_EVENTS: readonly BedEvent[] = ['takeoff', 'apex', 'landing'];

export interface BedMarker {
  event: BedEvent;
  /** Along the bar: 0 = the left edge, 1 = the right edge. Never outside that range. */
  t: number;
  /** The real position lies past this edge. The marker sits on the edge and is flagged instead of drawn outside the bar. */
  beyond: 'left' | 'right' | null;
}

/** One marker from a bed-normalized position; null when the position is unknown. */
export function bedMarker(event: BedEvent, x: number | null): BedMarker | null {
  if (x === null || !Number.isFinite(x)) return null;
  const clamped = Math.min(Math.max(x, -1), 1);
  return { event, t: (clamped + 1) / 2, beyond: x < -1 ? 'left' : x > 1 ? 'right' : null };
}

export function bedMarkers(bed: BedPositions): BedMarker[] {
  return BED_EVENTS.flatMap((event) => {
    const marker = bedMarker(event, bed[event]);
    return marker ? [marker] : [];
  });
}

export interface SentencePart {
  text: string;
  /** Set on the word that names an event, so the view can put that event's glyph in front of it. */
  event?: BedEvent;
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Takeoff in the center, apex 30% of the way to the left edge, landing past the right edge." in pieces. Events that
 * are described the same way share a clause ("Takeoff and apex in the center"); unknown positions are left out.
 */
export function bedSentenceParts(bed: BedPositions): SentencePart[] {
  const clauses: { events: BedEvent[]; where: string }[] = [];
  for (const event of BED_EVENTS) {
    const where = describeBedPosition(bed[event]);
    if (where === null) continue;
    const last = clauses.at(-1);
    if (last?.where === where) last.events.push(event);
    else clauses.push({ events: [event], where });
  }
  const parts: SentencePart[] = [];
  clauses.forEach(({ events, where }, c) => {
    events.forEach((event, k) => {
      if (k > 0) parts.push({ text: k === events.length - 1 ? ' and ' : ', ' });
      else if (c > 0) parts.push({ text: ', ' });
      parts.push({ text: c === 0 && k === 0 ? upperFirst(event) : event, event });
    });
    parts.push({ text: `${events.length === BED_EVENTS.length ? ' all ' : ' '}${where}` });
  });
  if (parts.length > 0) parts.push({ text: '.' });
  return parts;
}

export const bedSentence = (bed: BedPositions) =>
  bedSentenceParts(bed)
    .map((p) => p.text)
    .join('');

/** Why there is no diagram, as one quiet line. `setup` = the fix is in the settings (mark or fix the trampoline). */
export function bedUnavailable(state: { calibrated: boolean; calibrationError: string | null; complete: boolean }): {
  text: string;
  setup: boolean;
} {
  if (!state.calibrated) {
    return {
      text: state.calibrationError
        ? 'The marked trampoline could not be used, so landing positions are not available.'
        : 'Mark the trampoline to see where each jump lands.',
      setup: true,
    };
  }
  return {
    text: state.complete
      ? 'The position on the bed could not be measured for this jump.'
      : 'This jump is cut off by the clip, so its position on the bed is unknown.',
    setup: false,
  };
}
