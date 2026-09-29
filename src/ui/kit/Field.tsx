import type { ReactNode } from 'react';
import { cx } from './cx';

/** A label above a control, with an optional hint under it. The label wraps the control, so a click on it focuses it. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('field', className)}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

interface NumberFieldProps {
  label: ReactNode;
  value: number;
  /** Called only with finite numbers; an emptied field goes back to the last value on blur. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  hint,
  disabled,
  className,
}: NumberFieldProps) {
  return (
    <Field label={label} hint={hint} className={className}>
      <span className="input-unit">
        <input
          className="input input--num"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) onChange(v);
          }}
          onBlur={(e) => {
            if (!Number.isFinite(e.target.valueAsNumber)) e.target.value = String(value);
          }}
        />
        {unit && <span className="input-unit__unit">{unit}</span>}
      </span>
    </Field>
  );
}

interface SelectFieldProps<T extends string | number> {
  label: ReactNode;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SelectField<T extends string | number>({
  label,
  value,
  onChange,
  options,
  hint,
  disabled,
  className,
}: SelectFieldProps<T>) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select
        className="select"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
