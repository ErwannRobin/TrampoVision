import { useState } from 'react';
import type { SetSummary } from '../../history/store';
import { getLocale, t, tp, useLocale } from '../../i18n';
import { fmt } from '../format';
import { Button, IconButton } from '../kit';

/** The first screen lists this many sets, the newest first. The store keeps more (see `HISTORY_LIMIT`). */
export const RECENT_SHOWN = 5;

export interface RecentSetsProps {
  /** Every stored set, newest first. */
  sets: SetSummary[];
  /** A file is being read: a set cannot be opened now. */
  busy: boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

/** A day, or a day and a time, the way the language writes it. */
function when(iso: string, withTime: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(
    getLocale(),
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(date);
}

/** What a set is called: the clip it came from, else the day it was made. */
export function setName(set: Pick<SetSummary, 'fileName' | 'savedAt'>): string {
  const name = set.fileName.trim();
  return name && name !== 'trampovision' ? name : t('landing.recentUntitled', { date: when(set.savedAt, false) });
}

/**
 * The sets that were analyzed before, kept on this device: name, date, how many skills and the difficulty. One tap reopens a set
 * (without the video); each one can be removed, and the whole history can be cleared after a second tap. Nothing when there are none.
 */
export function RecentSets({ sets, busy, onOpen, onRemove, onClear }: RecentSetsProps) {
  useLocale(); // the dates and the names follow the language
  const [asking, setAsking] = useState(false);
  if (sets.length === 0) return null;
  return (
    <section className="recent" aria-labelledby="recent-title">
      <div className="recent__head">
        <h2 className="recent__title" id="recent-title">
          {t('landing.recent')}
        </h2>
        {!asking && (
          <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
            {t('landing.recentClear')}
          </Button>
        )}
      </div>
      {asking && (
        <div className="recent__ask" role="group" aria-label={t('landing.recentClear')}>
          <p>{t('landing.recentClearAsk')}</p>
          <div className="recent__ask-actions">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setAsking(false);
                onClear();
              }}
            >
              {t('landing.recentClearYes')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
      <ul className="recent__list">
        {sets.slice(0, RECENT_SHOWN).map((set) => {
          const name = setName(set);
          return (
            <li className="recent__item" key={set.id}>
              <button type="button" className="recent__open" disabled={busy} onClick={() => onOpen(set.id)}>
                <span className="recent__name">{name}</span>
                <span className="recent__when">{when(set.savedAt, true)}</span>
                <span className="recent__skills">{tp('count.skills', set.skills)}</span>
                <span className="recent__difficulty">
                  {t('live.difficulty')} <span className="num">{fmt(set.difficulty, 1)}</span>
                </span>
              </button>
              <IconButton
                icon="trash"
                label={t('landing.recentRemove', { name })}
                tip={false}
                onClick={() => onRemove(set.id)}
              />
            </li>
          );
        })}
      </ul>
      <p className="recent__note">{t('landing.recentNote')}</p>
    </section>
  );
}
