import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** One primary action per screen region; secondary is the default. */
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Fill the width of the container. */
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 20 : size === 'sm' ? 15 : 17} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: IconName;
  /** Accessible name; also the tooltip. */
  label: string;
  variant?: 'ghost' | 'solid' | 'primary';
  size?: 'sm' | 'md' | 'lg';
  /** For toggles: aria-pressed. */
  pressed?: boolean;
  iconSize?: number;
  /** Where the tooltip goes, or false for none (when a visible label sits next to it). */
  tip?: 'bottom' | 'top' | false;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  pressed,
  iconSize,
  tip = 'bottom',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'icon-btn',
        variant !== 'ghost' && `icon-btn--${variant}`,
        size !== 'md' && `icon-btn--${size}`,
        className,
      )}
      aria-label={label}
      aria-pressed={pressed}
      data-tip={tip ? label : undefined}
      data-tip-side={tip === 'top' ? 'top' : undefined}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? (size === 'sm' ? 16 : size === 'lg' ? 22 : 18)} />
    </button>
  );
}
