import { useState } from 'react';
import { t } from '../../i18n';
import {
  POSITION_TEXT,
  SOMERSAULT_CHOICES,
  figureOf,
  maxHalfTwists,
  movementOfElement,
  normalizeMovement,
  type MovementLabel,
} from '../../dataset/movementLabel';
import type { FigElement } from '../../skills/fig/elements';

const POSITIONS = ['straight', 'tuck', 'pike'] as const;
const START: MovementLabel = { position: 'tuck', direction: 'back', somersaults: 1, halfTwists: 0 };

/** Half twists as they are said: ½, 1, 1½, 2. */
export const twistName = (halfTwists: number): string =>
  halfTwists === 0
    ? '0'
    : halfTwists % 2 === 0
      ? String(halfTwists / 2)
      : halfTwists === 1
        ? '½'
        : `${(halfTwists - 1) / 2}½`;

function Facet({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="live-facet" role="group" aria-label={name}>
      <span className="live-facet__name">{name}</span>
      <div className="live-chips">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="live-chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The label after one choice: a somersault without a direction is a back, a jump with a twist is a straight one, and nothing more than the
 * table models. The result is what the picker shows and, when it names an element of the table, what is saved.
 */
export function nextMovement(draft: MovementLabel, patch: Partial<MovementLabel>): MovementLabel {
  let next: MovementLabel = { ...draft, ...patch };
  if (next.somersaults > 0 && !next.direction) next = { ...next, direction: 'back' };
  next = normalizeMovement(next);
  if (next.somersaults === 0 && next.halfTwists > 0) next = { ...next, position: 'straight' };
  return next;
}

/**
 * What the skill was, chosen a part at a time: the somersaults, their direction, the half twists and the position. Every choice is one
 * of the elements of the table, and it is applied as soon as it is chosen.
 */
export function ElementPicker({
  element,
  onPick,
}: {
  element: FigElement | null;
  onPick: (elementId: string) => void;
}) {
  const [draft, setDraft] = useState<MovementLabel>(() => (element ? movementOfElement(element) : START));
  const apply = (patch: Partial<MovementLabel>) => {
    const next = nextMovement(draft, patch);
    setDraft(next);
    const id = figureOf(next);
    if (id) onPick(id);
  };

  return (
    <div className="live-picker">
      <Facet name={t('picker.somersaults')}>
        {SOMERSAULT_CHOICES.map((n) => (
          <Chip key={n} on={draft.somersaults === n} onClick={() => apply({ somersaults: n })}>
            {n}
          </Chip>
        ))}
      </Facet>
      {draft.somersaults > 0 && (
        <Facet name={t('picker.direction')}>
          {(['back', 'front'] as const).map((d) => (
            <Chip key={d} on={draft.direction === d} onClick={() => apply({ direction: d })}>
              {t(`dir.${d}`)}
            </Chip>
          ))}
        </Facet>
      )}
      <Facet name={t('picker.twists')}>
        {Array.from({ length: maxHalfTwists(draft.somersaults) + 1 }, (_, h) => (
          <Chip key={h} on={draft.halfTwists === h} onClick={() => apply({ halfTwists: h })}>
            {twistName(h)}
          </Chip>
        ))}
      </Facet>
      <Facet name={t('picker.position')}>
        {POSITIONS.map((p) => (
          <Chip key={p} on={draft.position === p} onClick={() => apply({ position: p })}>
            {POSITION_TEXT[p]}
          </Chip>
        ))}
      </Facet>
    </div>
  );
}
