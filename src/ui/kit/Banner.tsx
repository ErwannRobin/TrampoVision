import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { cx } from './cx';
import { IconButton } from './Button';
import { Icon } from './icons';

export type BannerTone = 'info' | 'warning' | 'error';

/**
 * Something the user should know. An error is solid and red; a warning is dashed (the app carried on but is not sure);
 * info is plain. Errors are announced at once, the rest politely.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cx('banner', tone !== 'info' && `banner--${tone}`, className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={tone === 'info' ? 'info' : 'alert'} size={18} className="banner__icon" />
      <div className="banner__body">
        {title && <div className="banner__title">{title}</div>}
        {children && <div className="banner__text">{children}</div>}
      </div>
      {(action || onDismiss) && (
        <div className="banner__actions">
          {action}
          {onDismiss && (
            <IconButton icon="close" label={t('common.dismiss')} size="sm" onClick={onDismiss} tip={false} />
          )}
        </div>
      )}
    </div>
  );
}
