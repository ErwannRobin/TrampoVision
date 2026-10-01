import type { ReactNode } from 'react';
import { describeMovement } from '../../../dataset/movementLabel';
import {
  HALF_TWIST_STEPS,
  SOMERSAULT_STEPS,
  figureOfAnswers,
  isBlank,
  isComplete,
  movementOfAnswers,
  sameAnswers,
} from '../../../dataset/stageLabel';
import type { StageAnswers } from '../../../dataset/types';
import { t } from '../../../i18n';
import { elementName } from '../../../skills/fig/elements';
import { somersaultText } from '../../../skills/hierarchical';
import type { KnownPosition } from '../../../skills/types';
import { fmt } from '../../format';
import { Button, Icon } from '../../kit';
import { twistsText } from '../Detected';
import { Keycap } from '../Keycap';
import type { ReviewAction } from './logic';

const POSITIONS: readonly KnownPosition[] = ['straight', 'tuck', 'pike'];
const DIRECTIONS = ['back', 'front'] as const;

function Facet({ label, keys, children }: { label: string; keys?: ReactNode; children: ReactNode }) {
  return (
    <div className="rm-facet" role="group" aria-label={label}>
      <span className="rm-facet__name">
        {label}
        {keys && <span className="rm-facet__keys">{keys}</span>}
      </span>
      <div className="rm-chips">{children}</div>
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  title,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className="rm-chip" aria-pressed={on} disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/** What the answers name, in one line: the figure of the table with its difficulty, or why there is none yet. */
export function figureLine(a: StageAnswers): { text: string; tone: 'ok' | 'info' | 'none' } {
  if (isBlank(a)) return { text: t('rm.figure.blank'), tone: 'none' };
  if (!isComplete(a)) return { text: t('rm.figure.incomplete'), tone: 'none' };
  const e = figureOfAnswers(a);
  if (e) return { text: t('rm.figure.value', { name: elementName(e), d: fmt(e.difficulty, 1) }), tone: 'ok' };
  const m = movementOfAnswers(a);
  const named = m ? describeMovement(m) : '';
  return {
    text: Number.isInteger(a.somersaults)
      ? t('rm.figure.notInTable', { name: named })
      : t('rm.figure.quarter', { name: named }),
    tone: 'info',
  };
}

export interface AnswerPanelProps {
  answers: StageAnswers;
  /** What the classifier named; null when it named nothing. */
  guess: StageAnswers | null;
  guessName: string;
  guessDifficulty: number | null;
  flagged: 'cannot-tell' | 'bad-segmentation' | null;
  /** A label cannot be saved yet (the video id is still being read). */
  disabled: boolean;
  canUndo: boolean;
  /** One press on a button: the review turns it into an answer. */
  onAction: (action: ReviewAction) => void;
}

/**
 * The buttons for one jump: one press to say the classifier was right, or one row of buttons for each of the four questions, and the way
 * out for a jump that cannot be told. The figure the answers name is under them as they are given.
 */
export function AnswerPanel({
  answers,
  guess,
  guessName,
  guessDifficulty,
  flagged,
  disabled,
  canUndo,
  onAction,
}: AnswerPanelProps) {
  const figure = figureLine(answers);
  const accepted = !!guess && !flagged && isComplete(answers) && sameAnswers(answers, guess);
  const flat = answers.somersaults === 0;

  return (
    <div className="rm-answer">
      <Button
        variant="primary"
        size="lg"
        block
        icon={accepted ? 'check' : undefined}
        disabled={disabled || !guess || accepted}
        aria-keyshortcuts="Enter"
        onClick={() => onAction({ kind: 'accept' })}
      >
        {accepted
          ? t('rm.accepted')
          : guess
            ? t('rm.accept', {
                name: guessName,
                d: guessDifficulty === null ? '–' : fmt(guessDifficulty, 1),
              })
            : t('rm.acceptNone')}
        {!accepted && guess && <Keycap>Enter</Keycap>}
      </Button>

      <Facet
        label={t('picker.somersaults')}
        keys={
          <>
            <Keycap>0</Keycap>–<Keycap>3</Keycap> <Keycap>Q</Keycap>
          </>
        }
      >
        {SOMERSAULT_STEPS.map((n) => (
          <Chip
            key={n}
            on={answers.somersaults === n && !flagged}
            disabled={disabled}
            onClick={() => onAction({ kind: 'somersaults', value: n })}
            title={t('rm.somersaultsHint', { n: somersaultText(Math.round(n * 4)) })}
          >
            {somersaultText(Math.round(n * 4))}
          </Chip>
        ))}
      </Facet>

      <Facet
        label={t('picker.direction')}
        keys={
          <>
            <Keycap>B</Keycap> <Keycap>F</Keycap>
          </>
        }
      >
        {DIRECTIONS.map((d) => (
          <Chip
            key={d}
            on={answers.direction === d && !flat && !flagged}
            disabled={disabled || flat}
            onClick={() => onAction({ kind: 'direction', value: d })}
          >
            {t(`dir.${d}`)}
          </Chip>
        ))}
        {flat && <span className="rm-facet__note">{t('rm.noDirection')}</span>}
      </Facet>

      <Facet
        label={t('picker.halfTwists')}
        keys={
          <>
            <Keycap>W</Keycap> <Keycap>+</Keycap> <Keycap>−</Keycap>
          </>
        }
      >
        {HALF_TWIST_STEPS.map((n) => (
          <Chip
            key={n}
            on={answers.halfTwists === n && !flagged}
            disabled={disabled}
            onClick={() => onAction({ kind: 'twists', value: n })}
            title={t('rm.twistsHint', { n: twistsText(n) })}
          >
            {n}
          </Chip>
        ))}
      </Facet>

      <Facet
        label={t('picker.position')}
        keys={
          <>
            <Keycap>S</Keycap> <Keycap>T</Keycap> <Keycap>P</Keycap>
          </>
        }
      >
        {POSITIONS.map((p) => (
          <Chip
            key={p}
            on={answers.position === p && !flagged}
            disabled={disabled}
            onClick={() => onAction({ kind: 'position', value: p })}
          >
            {t(`pos.${p}`)}
          </Chip>
        ))}
      </Facet>

      <p className="rm-figure" data-tone={flagged ? 'none' : figure.tone} role="status">
        {flagged ? (
          <>
            <Icon name="flag" size={15} />
            {t(flagged === 'cannot-tell' ? 'rm.flag.cannotTell' : 'rm.flag.badCut')}
          </>
        ) : (
          <>
            {figure.tone === 'ok' && <Icon name="check" size={15} strokeWidth={2.2} />}
            {figure.text}
          </>
        )}
      </p>

      <div className="rm-actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-pressed={flagged === 'cannot-tell'}
          onClick={() => onAction({ kind: 'cannotTell' })}
        >
          {t('picker.cannotTell')}
          <Keycap>U</Keycap>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-pressed={flagged === 'bad-segmentation'}
          onClick={() => onAction({ kind: 'badSegmentation' })}
        >
          {t('rm.badCut')}
          <Keycap>X</Keycap>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || (isBlank(answers) && !flagged)}
          onClick={() => onAction({ kind: 'clear' })}
        >
          {t('common.clear')}
          <Keycap>C</Keycap>
        </Button>
        <Button variant="ghost" size="sm" disabled={!canUndo} onClick={() => onAction({ kind: 'undo' })}>
          {t('common.undo')}
          <Keycap>Z</Keycap>
        </Button>
      </div>
    </div>
  );
}
