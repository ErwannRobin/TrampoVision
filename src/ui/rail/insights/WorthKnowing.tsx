import type { ReactNode } from 'react';
import { t, tp } from '../../../i18n';
import type { Limitation } from '../../../skills/types';
import { Disclosure } from '../../kit';
import { Fade } from './Fade';

/** How many of a jump's limitations show at once; the rest wait behind a disclosure. */
const VISIBLE = 2;

function Notes({ items }: { items: Limitation[] }) {
  return (
    <ul className="ins-notes">
      {items.map((l) => (
        <li key={l.signal + l.problem} className="ins-note">
          <p className="ins-note__signal">{l.signal}</p>
          <p className="ins-note__text">{l.problem}</p>
          <p className="ins-note__text">
            <span className="ins-note__tag">{t('ins.whatHelps')}</span> {l.needed}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Disclosures that share their hairlines. The hidden tail keeps the last one from closing itself with a hairline of its
 * own: the section that follows already starts with one.
 */
export function Folds({ children }: { children: ReactNode }) {
  return (
    <div className="ins-folds">
      {children}
      <span hidden />
    </div>
  );
}

/** What the analysis says about the whole clip, from `analysisWarnings`. */
export function DataChecks({ notes }: { notes: string[] }) {
  return (
    <Disclosure title={t('ins.dataChecks')} meta={notes.length}>
      <ul className="ins-notes">
        {notes.map((note) => (
          <li key={note} className="ins-note">
            <p className="ins-note__text">{note}</p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

interface Props {
  jump: number;
  limitations: Limitation[];
  notes: string[];
}

/** What the data could not settle for this jump: the first two limitations, the rest on demand, then the clip's checks. */
export function WorthKnowing({ jump, limitations, notes }: Props) {
  const rest = limitations.slice(VISIBLE);
  return (
    <section className="ins-section">
      <h3 className="ins-h">{t('ins.worth')}</h3>
      <Fade on={jump}>
        {limitations.length > 0 ? (
          <Notes items={limitations.slice(0, VISIBLE)} />
        ) : (
          <p className="ins-quiet">{t('ins.noProblem')}</p>
        )}
      </Fade>
      {(rest.length > 0 || notes.length > 0) && (
        <Folds>
          {rest.length > 0 && (
            <Disclosure key={jump} className="ins-fade" title={tp('ins.more', rest.length)}>
              <Notes items={rest} />
            </Disclosure>
          )}
          {notes.length > 0 && <DataChecks notes={notes} />}
        </Folds>
      )}
    </section>
  );
}
