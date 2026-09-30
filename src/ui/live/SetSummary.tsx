import { useEffect, useId, useRef, useState } from 'react';
import { formatNumber, t, tp } from '../../i18n';
import type { Session } from '../../coaching/session';
import { difficultyText, summaryText } from '../../coaching/summary';
import { Button, cx, Icon, Stat } from '../kit';

/** How long the note next to the share button stays. */
const NOTE_MS = 2200;

async function share(text: string): Promise<string> {
  try {
    // A phone offers its own sheet (messages, mail, notes); anywhere else the summary goes to the clipboard.
    const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (touch && typeof navigator.share === 'function') {
      await navigator.share({ text });
      return t('live.shared');
    }
    await navigator.clipboard.writeText(text);
    return t('live.copied');
  } catch (err) {
    // Closing the share sheet is not a failure.
    return err instanceof DOMException && err.name === 'AbortError' ? '' : t('live.copyFailed');
  }
}

/** The set at a glance: how many skills, their difficulty, the execution the pose earns, the time in the air, and what to work on next. */
export function SetSummary({ session, title }: { session: Session; title: string }) {
  const s = session.summary;
  const focusId = useId();
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onShare = async () => {
    const result = await share(summaryText(session, title));
    setNote(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(''), NOTE_MS);
  };

  // Two siblings, not one: on a phone the list of skills comes between them (styles/live.css).
  return (
    <>
      <section className={cx('live-summary', s.skills > 0 && 'live-summary--more')} aria-label={t('live.set')}>
        <div className="live-summary__top">
          <p className="ins-count">
            {[
              tp('count.skills', s.skills),
              s.pending > 0 ? t('live.toCheck', { n: s.pending }) : null,
              s.cutOff > 0 ? t('live.cutOffCount', { n: s.cutOff }) : null,
            ]
              .filter(Boolean)
              .join(t('list.separator'))}
          </p>
          <span className="live-summary__share">
            <span role="status" className="live-summary__note">
              {note}
            </span>
            <Button size="sm" onClick={() => void onShare()} title={t('live.copyTitle')}>
              {t('live.copySummary')}
            </Button>
          </span>
        </div>

        <div className="live-figs">
          <Stat
            className="live-fig"
            label={t('live.difficulty')}
            value={s.skills > 0 ? difficultyText(s.difficulty) : '–'}
            hint={t('live.repeatHint')}
          />
          <Stat
            className="live-fig"
            label={t('live.execution')}
            value={s.execution === null ? '–' : formatNumber(s.execution, 1)}
            hint={s.execution === null ? t('live.nothingJudged') : t('live.estimate')}
          />
          <Stat
            className="live-fig"
            label={t('live.inTheAir')}
            value={s.flightS > 0 ? formatNumber(s.flightS, 1) : '–'}
            unit={s.flightS > 0 ? 's' : undefined}
            hint={t('live.allSkills')}
          />
        </div>

        {s.warnings.map((w) => (
          <p key={w} className="live-warn">
            <Icon name="alert" size={15} />
            <span>{w}</span>
          </p>
        ))}
      </section>

      {s.skills > 0 && (
        <section className="live-focus" aria-labelledby={focusId}>
          <h3 className="live-h" id={focusId}>
            {t('live.workOn')}
          </h3>
          {s.focus.length > 0 ? (
            <ol className="live-focus__list">
              {s.focus.map((f) => (
                <li key={f.id}>
                  <p className="live-focus__title">
                    {f.title}
                    <span className="live-focus__summary">{f.summary}</span>
                  </p>
                  <p className="live-focus__text">{f.text}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="live-quiet">{t('live.nothingStands')}</p>
          )}
        </section>
      )}
    </>
  );
}
