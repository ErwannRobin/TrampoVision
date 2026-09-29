import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef<T extends string> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: TabDef<T>[];
  ariaLabel: string;
  /** Prefix for the ids that tie each tab to the panel: the panel needs `id={panelId(idPrefix)}` and `aria-labelledby={tabId(idPrefix, value)}`. */
  idPrefix: string;
}

export const tabId = (prefix: string, value: string) => `${prefix}-tab-${value}`;
export const panelId = (prefix: string) => `${prefix}-panel`;

/** Sections of one panel, as text with an underline. Arrow keys move between the tabs. */
export function Tabs<T extends string>({ value, onChange, tabs, ariaLabel, idPrefix }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[j].value);
    refs.current[j]?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={tabId(idPrefix, t.value)}
          className="tab"
          aria-selected={t.value === value}
          aria-controls={panelId(idPrefix)}
          tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
