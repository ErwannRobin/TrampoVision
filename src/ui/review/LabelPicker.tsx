import type { ReactNode } from 'react';
import { TRUTH_LABELS, TRUTH_TEXT, type TruthLabel } from '../../dataset/types';

/** A key of the keyboard, shown on the control it presses. Hidden on touch screens, where there is no keyboard. */
export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="review-keycap num" aria-hidden="true">
      {children}
    </kbd>
  );
}

interface LabelPickerProps {
  truth: TruthLabel | null;
  /** A label cannot be saved yet. */
  disabled: boolean;
  onPick: (label: TruthLabel) => void;
}

/** What the jump really was: six choices, the chosen one filled. Keys 1 to 6 press them (EvaluatePanel listens). */
export function LabelPicker({ truth, disabled, onPick }: LabelPickerProps) {
  return (
    <div className="review-labels" role="group" aria-label="Ground-truth label">
      {TRUTH_LABELS.map((label, i) => (
        <button
          key={label}
          type="button"
          className="review-label"
          disabled={disabled}
          aria-pressed={truth === label}
          aria-keyshortcuts={String(i + 1)}
          onClick={() => onPick(label)}
        >
          <span className="review-label__text">{TRUTH_TEXT[label]}</span>
          <Keycap>{i + 1}</Keycap>
        </button>
      ))}
    </div>
  );
}
