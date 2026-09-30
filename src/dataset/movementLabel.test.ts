import { describe, expect, it } from 'vitest';
import {
  EMPTY_MOVEMENT,
  describeMovement,
  figureOf,
  isComplete,
  legacyLabel,
  maxHalfTwists,
  movementFromPrediction,
  movementOfElement,
  movementOfRecord,
  normalizeMovement,
  type MovementLabel,
} from './movementLabel';
import { elementById } from '../skills/fig/elements';
import { withMovement } from './record';
import type { JumpRecord } from './types';

const label = (m: Partial<MovementLabel>): MovementLabel => ({ ...EMPTY_MOVEMENT, ...m });
const record = (extra: Partial<JumpRecord> = {}) =>
  ({ truth: null, figure: null, twistTruth: null, ...extra }) as JumpRecord;

describe('movement label', () => {
  it('derives the five-way label: the position for a plain jump, the direction for a somersault, unknown for the rest', () => {
    expect(legacyLabel(label({ position: 'tuck' }))).toBe('tuck');
    expect(legacyLabel(label({ position: 'pike', somersaults: 1, direction: 'back' }))).toBe('back');
    expect(legacyLabel(label({ position: 'tuck', somersaults: 1, direction: 'front' }))).toBe('front');
    expect(legacyLabel(label({ position: 'straddle' }))).toBe('unknown');
    expect(legacyLabel(label({ somersaults: 2 }))).toBe('unknown');
    expect(legacyLabel(EMPTY_MOVEMENT)).toBe('unknown');
  });

  it('names an element of the table only when the choices are finished and the table has it', () => {
    expect(figureOf(label({ position: 'tuck', somersaults: 1, direction: 'back' }))).toBe('back-1s-0t-tuck');
    expect(figureOf(label({ position: 'straight', halfTwists: 2 }))).toBe('none-0s-1t-straight');
    expect(figureOf(label({ position: 'straight', somersaults: 1, direction: 'front', halfTwists: 4 }))).toBe(
      'front-1s-2t-straight',
    );
    expect(figureOf(label({ position: 'straddle' }))).toBeNull();
    expect(figureOf(label({ position: 'tuck', somersaults: 1 }))).toBeNull();
    expect(figureOf(label({ halfTwists: 2 }))).toBeNull();
    // A tucked jump with a twist is not in the table.
    expect(figureOf(label({ position: 'tuck', halfTwists: 2 }))).toBeNull();
  });

  it('is finished with a position, and a direction when there is a somersault', () => {
    expect(isComplete(label({ position: 'tuck' }))).toBe(true);
    expect(isComplete(label({ position: 'tuck', somersaults: 1 }))).toBe(false);
    expect(isComplete(label({ position: 'tuck', somersaults: 1, direction: 'back' }))).toBe(true);
  });

  it('drops the direction of a jump without somersault and limits the half twists to what the table models', () => {
    expect(normalizeMovement(label({ direction: 'back', somersaults: 0 })).direction).toBeNull();
    expect(normalizeMovement(label({ somersaults: 3, halfTwists: 9 })).halfTwists).toBe(maxHalfTwists(3));
  });

  it('turns the prediction into a label, and nothing when the classifier named no movement', () => {
    expect(
      movementFromPrediction({ movement: { direction: 'back', somersaults: 1, twists: 1.5, position: 'pike' } }),
    ).toEqual({ position: 'pike', direction: 'back', somersaults: 1, halfTwists: 3 });
    expect(movementFromPrediction({ movement: undefined })).toBeNull();
  });

  it('reads an older record from its figure, then from its five-way label', () => {
    expect(movementOfRecord(record({ figure: { elementId: 'back-1s-0t-tuck', labeledAt: '' } }))).toEqual({
      position: 'tuck',
      direction: 'back',
      somersaults: 1,
      halfTwists: 0,
    });
    expect(movementOfRecord(record({ truth: { label: 'pike', labeledAt: '' } }))?.position).toBe('pike');
    expect(movementOfRecord(record({ truth: { label: 'unknown', labeledAt: '' } }))).toBeNull();
    expect(movementOfRecord(record())).toBeNull();
  });

  it('describes a label in one line', () => {
    expect(describeMovement(label({ position: 'tuck', somersaults: 2, direction: 'back', halfTwists: 2 }))).toBe(
      'Back double somersault, full twist, tuck',
    );
    expect(describeMovement(label({ position: 'straddle' }))).toBe('Straddle jump');
  });
});

describe('saving a movement', () => {
  it('sets the label, the figure and the half twists together, and clears them together', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const saved = withMovement(record(), label({ position: 'tuck', somersaults: 1, direction: 'back' }), now);
    expect(saved.truth?.label).toBe('back');
    expect(saved.figure?.elementId).toBe('back-1s-0t-tuck');
    expect(saved.twistTruth?.halfTwists).toBe(0);
    const straddle = withMovement(saved, label({ position: 'straddle' }), now);
    expect(straddle.truth?.label).toBe('unknown');
    expect(straddle.truth?.movement?.position).toBe('straddle');
    expect(straddle.figure).toBeNull();
    const cleared = withMovement(straddle, null, now);
    expect([cleared.truth, cleared.figure, cleared.twistTruth]).toEqual([null, null, null]);
  });

  it('keeps the note', () => {
    const r = record({ truth: { label: 'tuck', labeledAt: '', note: 'camera moved' } });
    expect(withMovement(r, label({ position: 'pike' })).truth?.note).toBe('camera moved');
  });
});

describe('the label of an element of the table', () => {
  it('says the same thing as the element, and names it back', () => {
    for (const id of ['back-1s-0t-tuck', 'front-2s-1t-pike', 'none-0s-0t-pike', 'none-0s-1.5t-straight']) {
      const e = elementById(id)!;
      const m = movementOfElement(e);
      expect(figureOf(m)).toBe(id);
    }
    expect(movementOfElement(elementById('front-2s-1t-pike')!)).toEqual({
      position: 'pike',
      direction: 'front',
      somersaults: 2,
      halfTwists: 2,
    });
    expect(movementOfElement(elementById('none-0s-0t-tuck')!).direction).toBeNull();
  });
});
