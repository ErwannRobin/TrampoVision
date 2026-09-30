import type { ReactNode } from 'react';
import { t } from '../../i18n';
import {
  EMPTY_MOVEMENT,
  LABEL_POSITIONS,
  POSITION_TEXT,
  SOMERSAULT_CHOICES,
  describeMovement,
  maxHalfTwists,
  normalizeMovement,
  type MovementLabel,
} from '../../dataset/movementLabel';
import { Button, Icon } from '../kit';

interface Props {
  /** What is chosen now; null when the jump has no label. */
  movement: MovementLabel | null;
  /** What the classifier said, as a label; null when it named no movement. */
  predicted: MovementLabel | null;
  /** The person said they cannot tell. */
  cannotTell: boolean;
  /** A label cannot be saved yet. */
  disabled: boolean;
  onChange: (movement: MovementLabel) => void;
  onUnknown: () => void;
  onClear: () => void;
}

const sameMovement = (a: MovementLabel, b: MovementLabel) =>
  a.position === b.position &&
  a.direction === b.direction &&
  a.somersaults === b.somersaults &&
  a.halfTwists === b.halfTwists;

function Facet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="review-facet" role="group" aria-label={label}>
      <span className="review-facet__name">{label}</span>
      <div className="review-chips">{children}</div>
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="review-label" disabled={disabled} aria-pressed={on} onClick={onClick}>
      <span className="review-label__text">{children}</span>
    </button>
  );
}

/**
 * What the jump really was, chosen a part at a time: the position (straight, tuck, pike or straddle), the number of somersaults
 * and their direction, and the number of half twists. The big button says the classifier was right in one press.
 */
export function MovementPicker({ movement, predicted, cannotTell, disabled, onChange, onUnknown, onClear }: Props) {
  const current = movement ?? EMPTY_MOVEMENT;
  const set = (patch: Partial<MovementLabel>) => onChange(normalizeMovement({ ...current, ...patch }));
  const confirmed = !!movement && !!predicted && sameMovement(movement, predicted);
  const predictedText = predicted ? describeMovement(predicted) : '';

  return (
    <div className="review-picker">
      <Button
        variant="primary"
        size="lg"
        block
        icon={confirmed ? 'check' : undefined}
        disabled={disabled || !predicted || confirmed}
        onClick={() => predicted && onChange(predicted)}
      >
        {confirmed ? t('picker.confirmed') : t('picker.confirm')}
      </Button>
      <p className="review-note">
        {predicted ? (confirmed ? predictedText : t('picker.says', { text: predictedText })) : t('picker.none')}
      </p>

      <Facet label={t('picker.position')}>
        {LABEL_POSITIONS.map((p) => (
          <Chip
            key={p}
            on={current.position === p && !cannotTell}
            disabled={disabled}
            onClick={() => set({ position: current.position === p ? null : p })}
          >
            {POSITION_TEXT[p]}
          </Chip>
        ))}
      </Facet>
      <Facet label={t('picker.somersaults')}>
        {SOMERSAULT_CHOICES.map((n) => (
          <Chip
            key={n}
            on={!!movement && current.somersaults === n && !cannotTell}
            disabled={disabled}
            onClick={() => set({ somersaults: n })}
          >
            {n}
          </Chip>
        ))}
      </Facet>
      {current.somersaults > 0 && (
        <Facet label={t('picker.direction')}>
          {(['back', 'front'] as const).map((d) => (
            <Chip
              key={d}
              on={current.direction === d}
              disabled={disabled}
              onClick={() => set({ direction: current.direction === d ? null : d })}
            >
              {t(`dir.${d}`)}
            </Chip>
          ))}
        </Facet>
      )}
      <Facet label={t('picker.halfTwists')}>
        {Array.from({ length: maxHalfTwists(current.somersaults) + 1 }, (_, n) => (
          <Chip
            key={n}
            on={!!movement && current.halfTwists === n && !cannotTell}
            disabled={disabled}
            onClick={() => set({ halfTwists: n })}
          >
            {n}
          </Chip>
        ))}
      </Facet>

      <div className="review-label-foot">
        <p className="review-hint" role="status">
          {movement && !cannotTell ? (
            <>
              <Icon name="check" size={14} strokeWidth={2.2} className="review-hint__ok" />
              {describeMovement(movement) || t('picker.choosePosition')}
            </>
          ) : cannotTell ? (
            t('picker.impossible')
          ) : (
            t('review.status.choose')
          )}
        </p>
        <div className="review-actions">
          <Button variant="ghost" size="sm" disabled={disabled || cannotTell} onClick={onUnknown}>
            {t('picker.cannotTell')}
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled || (!movement && !cannotTell)} onClick={onClear}>
            {t('common.clear')}
          </Button>
        </div>
      </div>
    </div>
  );
}
