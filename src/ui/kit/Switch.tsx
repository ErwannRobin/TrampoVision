import type { ReactNode } from 'react';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

/** An on/off setting that takes effect at once. */
export function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
