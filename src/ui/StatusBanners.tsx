import { useEffect } from 'react';
import { t } from '../i18n';
import { Banner } from './kit';
import type { Status } from './types';

export interface StatusBannersProps {
  status: Status;
  /** An informational note (a conversion happened, saved data was opened). */
  notice: string;
  /** Why an export failed ('' when none). */
  exportError: string;
  onDismissStatus: () => void;
  onDismissNotice: () => void;
  onDismissExportError: () => void;
}

const NOTICE_MS = 9000;

/** Errors, things to check and notes, floating over the top of the workspace. Progress is shown by the stage instead. */
export function StatusBanners({
  status,
  notice,
  exportError,
  onDismissStatus,
  onDismissNotice,
  onDismissExportError,
}: StatusBannersProps) {
  const warning = status.kind === 'error' && status.severity === 'warning';
  const showStatus = status.kind === 'error';
  const showNotice = !!notice && status.kind !== 'error';

  // A note is good news or a courtesy: it leaves by itself. Errors and things to check stay until dismissed.
  useEffect(() => {
    if (!showNotice) return;
    const timer = window.setTimeout(onDismissNotice, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [showNotice, notice, onDismissNotice]);

  if (!showStatus && !showNotice && !exportError) return null;
  return (
    <div className="banners">
      {status.kind === 'error' && (
        <Banner
          tone={warning ? 'warning' : 'error'}
          title={warning ? t('status.warning') : t('status.error')}
          onDismiss={onDismissStatus}
        >
          {status.message}
        </Banner>
      )}
      {showNotice && (
        <Banner tone="info" onDismiss={onDismissNotice}>
          {notice}
        </Banner>
      )}
      {exportError && (
        <Banner tone="error" title={t('status.exportFailed')} onDismiss={onDismissExportError}>
          {exportError}
        </Banner>
      )}
    </div>
  );
}
