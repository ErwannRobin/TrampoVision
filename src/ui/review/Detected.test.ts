import { describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import type { MovementLabel } from '../../dataset/movementLabel';
import { detectedRows, twistsText } from './Detected';

const label = (m: Partial<MovementLabel>): MovementLabel => ({
  position: null,
  direction: null,
  somersaults: 0,
  halfTwists: 0,
  ...m,
});

describe('twistsText', () => {
  it('writes half twists as twists', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(twistsText)).toEqual(['0', '½', '1', '1½', '2', '2½', '3']);
  });
});

describe('detectedRows', () => {
  setLocale('en', false);

  it('says the somersaults, the direction, the twists and the position of a somersault', () => {
    const rows = detectedRows(label({ somersaults: 2, direction: 'back', halfTwists: 3, position: 'tuck' }));
    expect(rows.map((r) => [r.id, r.value])).toEqual([
      ['somersaults', '2'],
      ['direction', 'Back'],
      ['twists', '1½'],
      ['position', 'Tuck'],
    ]);
  });

  it('has no direction for a jump without a somersault', () => {
    const rows = detectedRows(label({ position: 'straight', direction: 'back' }));
    expect(rows.map((r) => r.id)).toEqual(['somersaults', 'twists', 'position']);
    expect(rows[0].value).toBe('0');
    expect(rows[1].value).toBe('0');
    expect(rows[2].value).toBe('Straight');
  });

  it('shows a dash where the position was not named', () => {
    expect(detectedRows(label({})).at(-1)?.value).toBe('–');
  });
});
