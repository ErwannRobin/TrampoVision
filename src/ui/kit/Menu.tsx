import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useDismiss } from '../hooks';
import { Button, IconButton, type ButtonVariant } from './Button';
import { Icon, type IconName } from './icons';

export interface MenuItemDef {
  id: string;
  label: string;
  /** One line under the label saying what it does. */
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuGroupDef {
  id: string;
  title?: string;
  items: MenuItemDef[];
}

interface Props {
  /** Text of the trigger, and its accessible name. */
  label: string;
  icon?: IconName;
  /** Show only the icon (the label still names it). */
  iconOnly?: boolean;
  groups: MenuGroupDef[];
  align?: 'start' | 'end';
  /** Open above the trigger, for a trigger at the bottom of a scrolling area that would clip the list. */
  up?: boolean;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}

/** A button that opens a list of actions. Escape and an outside press close it; arrows move through the items. */
export function Menu({ label, icon, iconOnly, groups, align = 'end', up, variant = 'secondary', size = 'md' }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
      return;
    } else if (e.key === 'Tab') {
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
  };

  const triggerProps = {
    ref: trigger,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onClick: () => setOpen((o) => !o),
  };

  return (
    <div className="menu" ref={root}>
      {iconOnly && icon ? (
        <IconButton
          icon={icon}
          label={label}
          variant="solid"
          size={size}
          tip={open ? false : 'bottom'}
          {...triggerProps}
        />
      ) : (
        <Button variant={variant} size={size} icon={icon} {...triggerProps}>
          {label}
          <Icon name="chevron-down" size={15} />
        </Button>
      )}
      {open && (
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label={label}
          className={`menu__panel menu__panel--${align}${up ? ' menu__panel--up' : ''}`}
          onKeyDown={onKeyDown}
        >
          {groups.map((g, gi) => (
            <Fragment key={g.id}>
              {gi > 0 && <div className="menu__sep" role="separator" />}
              {g.title && <div className="menu__title">{g.title}</div>}
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                    item.onSelect();
                  }}
                >
                  {item.icon && <Icon name={item.icon} size={17} />}
                  <span className="menu__text">
                    <span>{item.label}</span>
                    {item.hint && <span className="menu__hint">{item.hint}</span>}
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
