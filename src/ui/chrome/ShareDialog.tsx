import { useEffect, useId, useRef, useState } from 'react';
import { formatPercent, getLocale, t, useLocale } from '../../i18n';
import { SHARE_DAYS, shareLink, type StoredShare } from '../../sync/share';
import { Banner, Button, IconButton } from '../kit';

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  /** The link of this clip, when one was made (or opened) already. */
  existing: StoredShare | null;
  /** Puts the analysis in the video and uploads it. `onProgress`: null while the file is made, then the share uploaded (0..1). */
  onCreate: (opts: { onProgress: (fraction: number | null) => void; signal: AbortSignal }) => Promise<StoredShare>;
  /** Removes the shared copy. */
  onStop: (share: StoredShare) => Promise<void>;
}

type Phase =
  | { kind: 'ask' }
  | { kind: 'working'; progress: number | null }
  | { kind: 'done'; share: StoredShare }
  | { kind: 'stopping'; share: StoredShare }
  | { kind: 'stopped' };

const day = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(date);
};

/**
 * Sharing the clip as a link: what leaves the browser and for how long is said first, then the upload, then the link to copy or
 * send, and the way to remove the shared copy. Nothing is uploaded before the person asks for the link.
 */
export function ShareDialog({ open, onClose, existing, onCreate, onStop }: ShareDialogProps) {
  useLocale();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  // Each opening starts from what is known of this clip then, whatever it becomes while the dialog is open.
  useEffect(() => {
    if (!open) return;
    setPhase(existing ? { kind: 'done', share: existing } : { kind: 'ask' });
    setError('');
    setNote('');
  }, [open]); // oxlint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  async function create() {
    const ctl = new AbortController();
    abort.current = ctl;
    setError('');
    setPhase({ kind: 'working', progress: null });
    try {
      const share = await onCreate({
        signal: ctl.signal,
        onProgress: (progress) => !ctl.signal.aborted && setPhase({ kind: 'working', progress }),
      });
      if (!ctl.signal.aborted) setPhase({ kind: 'done', share });
    } catch (err) {
      if (ctl.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase({ kind: 'ask' });
    }
  }

  async function stop(share: StoredShare) {
    setError('');
    setPhase({ kind: 'stopping', share });
    try {
      await onStop(share);
      setPhase({ kind: 'stopped' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase({ kind: 'done', share });
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setNote(t('live.copied'));
    } catch {
      setNote(t('live.copyFailed'));
    }
  }

  async function send(link: string) {
    try {
      await navigator.share({ url: link, title: t('share.title') });
    } catch {
      /* closing the share sheet is not a failure */
    }
  }

  const canSend = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <dialog
      ref={dialog}
      className="settings share"
      aria-labelledby={titleId}
      onClose={close}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget && phase.kind !== 'working') close();
        pressedBackdrop.current = false;
      }}
    >
      {open && (
        <div className="settings__panel">
          <header className="settings__head">
            <h2 className="settings__title" id={titleId}>
              {t('share.title')}
            </h2>
            <IconButton icon="close" label={t('setup.close')} tip={false} onClick={close} />
          </header>

          <div className="settings__body share__body">
            {error && <Banner tone="error">{error}</Banner>}

            {(phase.kind === 'ask' || phase.kind === 'working') && (
              <>
                <p>{t('share.text')}</p>
                <p className="share__fine">{t('share.where', { days: SHARE_DAYS })}</p>
                <p className="share__fine">{t('share.consent')}</p>
                {phase.kind === 'ask' ? (
                  <Button variant="primary" size="lg" icon="upload" block onClick={() => void create()}>
                    {t('share.create')}
                  </Button>
                ) : (
                  <div className="share__progress">
                    <progress max={1} value={phase.progress ?? undefined} aria-labelledby={`${titleId}-p`} />
                    <p id={`${titleId}-p`} role="status">
                      {phase.progress === null
                        ? t('share.preparing')
                        : t('share.uploading', { percent: formatPercent(phase.progress) })}
                    </p>
                    <Button
                      onClick={() => {
                        abort.current?.abort();
                        setPhase({ kind: 'ask' });
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                )}
              </>
            )}

            {(phase.kind === 'done' || phase.kind === 'stopping') && (
              <>
                <label className="share__label" htmlFor={`${titleId}-link`}>
                  {t('share.link')}
                </label>
                <input
                  id={`${titleId}-link`}
                  className="share__link"
                  readOnly
                  value={shareLink(phase.share.id)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="share__actions">
                  <Button variant="primary" onClick={() => void copy(shareLink(phase.share.id))}>
                    {t('share.copy')}
                  </Button>
                  {canSend && <Button onClick={() => void send(shareLink(phase.share.id))}>{t('share.send')}</Button>}
                  <span role="status" className="share__note">
                    {note}
                  </span>
                </div>
                {phase.share.expiresAt && (
                  <p className="share__fine">{t('share.until', { date: day(phase.share.expiresAt) })}</p>
                )}
                {phase.share.deleteKey && (
                  <div className="share__stop">
                    <p className="share__fine">{t('share.stopText')}</p>
                    <Button
                      variant="danger"
                      icon="trash"
                      disabled={phase.kind === 'stopping'}
                      onClick={() => void stop(phase.share)}
                    >
                      {t('share.stop')}
                    </Button>
                  </div>
                )}
              </>
            )}

            {phase.kind === 'stopped' && <p role="status">{t('share.stopped')}</p>}
          </div>
        </div>
      )}
    </dialog>
  );
}
