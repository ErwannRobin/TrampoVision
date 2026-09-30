import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../coaching/session';
import { difficultyText, summaryText } from '../../coaching/summary';
import { Button, Icon, Stat } from '../kit';

/** How long the note next to the share button stays. */
const NOTE_MS = 2200;

async function share(text: string): Promise<string> {
  try {
    // A phone offers its own sheet (messages, mail, notes); anywhere else the summary goes to the clipboard.
    const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (touch && typeof navigator.share === 'function') {
      await navigator.share({ text });
      return 'Shared';
    }
    await navigator.clipboard.writeText(text);
    return 'Copied';
  } catch (err) {
    // Closing the share sheet is not a failure.
    return err instanceof DOMException && err.name === 'AbortError' ? '' : 'Could not copy';
  }
}

/** The set at a glance: how many skills, their difficulty, the execution the pose earns, the time in the air, and what to work on next. */
export function SetSummary({ session, title }: { session: Session; title: string }) {
  const s = session.summary;
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onShare = async () => {
    const result = await share(summaryText(session, title));
    setNote(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(''), NOTE_MS);
  };

  return (
    <section className="live-summary" aria-label="The set">
      <div className="live-summary__top">
        <p className="ins-count">
          {s.skills} {s.skills === 1 ? 'skill' : 'skills'}
          {s.pending > 0 && `, ${s.pending} to check`}
          {s.cutOff > 0 && `, ${s.cutOff} cut off`}
        </p>
        <span className="live-summary__share">
          <span role="status" className="live-summary__note">
            {note}
          </span>
          <Button size="sm" onClick={() => void onShare()} title="Copy the skills, scores and what to work on as text">
            Copy summary
          </Button>
        </span>
      </div>

      <div className="live-figs">
        <Stat
          className="live-fig"
          label="Difficulty"
          value={s.skills > 0 ? difficultyText(s.difficulty) : '–'}
          hint="A repeat counts once"
        />
        <Stat
          className="live-fig"
          label="Execution"
          value={s.execution === null ? '–' : s.execution.toFixed(1)}
          hint={s.execution === null ? 'Nothing judged' : 'Estimate, out of 10'}
        />
        <Stat
          className="live-fig"
          label="In the air"
          value={s.flightS > 0 ? s.flightS.toFixed(1) : '–'}
          unit={s.flightS > 0 ? 's' : undefined}
          hint="All skills together"
        />
      </div>

      {s.warnings.map((w) => (
        <p key={w} className="live-warn">
          <Icon name="alert" size={15} />
          <span>{w}</span>
        </p>
      ))}

      {s.skills > 0 && (
        <div className="live-focus">
          <h3 className="live-h">Work on next</h3>
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
            <p className="live-quiet">
              Nothing stands out. No deduction was found in what one camera can see, and the landings were near the
              center.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
