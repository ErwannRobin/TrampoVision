import type { CSSProperties, ReactNode } from 'react';
import type { ConfidenceTier } from '../insights';
import { cx } from './cx';

/**
 * How sure the classifier is. Solid = sure; dashed = not sure (the skeleton on the video and the timeline speak the same
 * way); nothing filled = it did not classify the jump. The words next to it carry the meaning, the bar only supports them.
 */
export function ConfidenceMeter({ value, tier, label }: { value: number; tier: ConfidenceTier; label: string }) {
  const v = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
  return (
    <div
      className={cx('meter', tier !== 'high' && 'meter--unsure', tier === 'none' && 'meter--none')}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={v}
    >
      <div className="meter__fill" style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** A circular progress: determinate with `value` in 0..1, spinning without. Children sit in the middle. */
export function ProgressRing({
  value,
  size = 72,
  stroke = 4,
  label,
  children,
}: {
  value?: number;
  size?: number;
  stroke?: number;
  label: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const v = value === undefined ? undefined : Math.min(Math.max(value, 0), 1);
  return (
    <span
      className={cx('ring', v === undefined && 'ring--indeterminate')}
      style={{ width: size, height: size } as CSSProperties}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v === undefined ? undefined : Math.round(v * 100)}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="ring__value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          pathLength={100}
          strokeDasharray={v === undefined ? undefined : 100}
          strokeDashoffset={v === undefined ? undefined : 100 * (1 - v)}
        />
      </svg>
      {children}
    </span>
  );
}
