import { t, upperFirst } from '../../../i18n/core';
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
    if (c > 0) parts.push({ text: t('list.separator') });
    // The language decides where the events go in the clause: "{events} in the center", "{events}は中央".
    const [before, after] = t(events.length === BED_EVENTS.length ? 'bed.clauseAll' : 'bed.clause', { where }).split(
      '{events}',
    );
    if (before) parts.push({ text: before });
    events.forEach((event, k) => {
      if (k > 0) parts.push({ text: k === events.length - 1 ? t('bed.and') : t('list.separator') });
      const word = t(`bed.event.${event}`);
      parts.push({ text: c === 0 && k === 0 ? upperFirst(word) : word, event });
    });
    if (after) parts.push({ text: after });
  });
  if (parts.length > 0) parts.push({ text: t('bed.end') });
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
    return { text: t(state.calibrationError ? 'bed.unusable' : 'bed.markIt'), setup: true };
  }
  return { text: t(state.complete ? 'bed.noPosition' : 'bed.cutOff'), setup: false };
}
