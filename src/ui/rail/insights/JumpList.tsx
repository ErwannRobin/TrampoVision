import { useEffect, useRef, type CSSProperties } from 'react';
import { fmt } from '../../format';
import { useReducedMotion } from '../../hooks';
import { TIER_TEXT, type JumpComparisonRow } from '../../insights';
import { cx } from '../../kit';
import { barWidth, focusTarget, scrollTopToReveal } from './layout';
import { useSeen } from './useSeen';

/** The nearest ancestor that really scrolls: the rail on a wide screen. Where the page scrolls instead, there is none. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** A measurement in a row: the figure, its small unit, and the unit spelled out for a screen reader. */
function Figure({
  value,
  unit,
  word,
  className,
}: {
  value: number | null;
  unit: string;
  word: string;
  className?: string;
}) {
  const text = fmt(value, 2);
  const has = text !== fmt(null);
  return (
    <span className={cx('ins-row__fig num', className)}>
      {text}
      {has && <span className="ins-row__unit">{unit}</span>}
      {has && <span className="sr-only"> {word}</span>}
    </span>
  );
}

interface Props {
  rows: JumpComparisonRow[];
  selected: number;
  onSelect: (jump: number) => void;
}

/**
 * Every jump of the clip in one list: the skill, a bar for the height as a share of the best jump of this clip, the
 * height and the air time. Buttons in a list, so it works with the keyboard; arrows move between rows.
 */
export function JumpList({ rows, selected, onSelect }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const seen = useSeen(bodyRef);
  const reduced = useReducedMotion();

  // When the selection moves from elsewhere (the timeline, the [ and ] keys), keep the row in view inside the rail. Only
  // while the list is on screen: from the timeline, the answer at the top is what the person came to see. Never the page.
  const previous = useRef(selected);
  useEffect(() => {
    if (previous.current === selected) return;
    previous.current = selected;
    const body = bodyRef.current;
    const row = buttons.current[selected];
    const scroller = body && row ? scrollParent(body) : null;
    if (!body || !row || !scroller) return;
    const view = scroller.getBoundingClientRect();
    const list = body.getBoundingClientRect();
    if (list.bottom <= view.top || list.top >= view.bottom) return;
    const top = scrollTopToReveal(view, row.getBoundingClientRect(), scroller.scrollTop, 8);
    if (top !== null) scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  }, [selected, reduced]);

  const anyCutOff = rows.some((row) => !row.complete);

  return (
    <section className="ins-section ins-list">
      <div className="ins-list__head">
        <h3 className="ins-h">Jumps in this clip</h3>
        <span className="ins-list__col">Height</span>
        <span className="ins-list__col">Air time</span>
      </div>
      <div ref={bodyRef} className="ins-list__body" style={{ '--sel': selected } as CSSProperties}>
        <span className="ins-list__thumb" aria-hidden="true" />
        <ul>
          {rows.map((row) => {
            const on = row.index === selected;
            return (
              <li key={row.index}>
                <button
                  type="button"
                  ref={(el) => {
                    buttons.current[row.index] = el;
                  }}
                  className="ins-row"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onSelect(row.index)}
                  onKeyDown={(e) => {
                    const to = focusTarget(e.key, row.index, rows.length);
                    if (to === null) return;
                    e.preventDefault();
                    buttons.current[to]?.focus();
                  }}
                >
                  <span className={cx('ins-row__num num', on && 'ins-row__num--on')}>
                    <span className="sr-only">Jump </span>
                    {row.number}
                  </span>
                  <span className="ins-row__main">
                    <span className="ins-row__skill">
                      <span className="ins-row__label" title={row.label}>
                        {row.label}
                      </span>
                      {row.tier !== 'high' && (
                        <>
                          <span className="ins-row__unsure" title={TIER_TEXT[row.tier]} aria-hidden="true" />
                          <span className="sr-only">, {TIER_TEXT[row.tier]}</span>
                        </>
                      )}
                      {!row.complete && <span className="sr-only">, cut off by the clip</span>}
                    </span>
                    <span className="ins-row__bar" aria-hidden="true">
                      <span
                        className={cx(
                          'ins-row__fill',
                          on && 'ins-row__fill--on',
                          !row.complete && 'ins-row__fill--open',
                        )}
                        style={{ width: seen ? barWidth(row.heightShare) : '0%' }}
                      />
                    </span>
                  </span>
                  <Figure value={row.heightM} unit="m" word="meters" />
                  <Figure value={row.flightTimeS} unit="s" word="seconds" className="ins-row__fig--time" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="ins-list__note">
        Bars compare jumps within this clip.{anyCutOff && ' A dashed bar is a jump cut off by the clip.'}
      </p>
    </section>
  );
}
