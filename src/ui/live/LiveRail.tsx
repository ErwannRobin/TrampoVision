import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { LiveJump, Session } from '../../coaching/session';
import { useMediaQuery, useMinWidth, useReducedMotion } from '../hooks';
import { Button, Icon, cx } from '../kit';
import { EmptyState } from '../rail/insights/EmptyState';
import { DataChecks, Folds } from '../rail/insights/WorthKnowing';
import { focusTarget, scrollTopToReveal } from '../rail/insights/layout';
import { SetSummary } from './SetSummary';
import { SkillDetail, SkillRow, type SkillActions } from './SkillCard';

export interface LiveRailProps {
  session: Session;
  /** Selected jump, 0-based. */
  selected: number;
  /** Choose a jump: select it and move the video to its takeoff. */
  onSelect: (jump: number) => void;
  onPlayJump: () => void;
  /** The guess for this jump is right. */
  onConfirm: (jump: number) => void;
  /** This jump was another element of the table. */
  onPick: (jump: number, elementId: string) => void;
  /** This jump is none of the elements of the table. */
  onOther: (jump: number) => void;
  /** Take the label of this jump back. */
  onClear: (jump: number) => void;
  /** The deduction the person gives this jump (null takes it back). */
  onDeduction: (jump: number, deduction: number | null) => void;
  /** Labels can be saved (the video is identified). */
  canLabel: boolean;
  /** Open the settings. */
  onOpenSetup: () => void;
  /** Show the athlete's and the coach's views, with every measurement. */
  onShowAdvanced: () => void;
  /** Things worth double-checking before trusting the numbers (from analysisWarnings). */
  notes: string[];
  /** The name of the clip, for the text that is shared. */
  title: string;
}

type Item = { kind: 'skill'; jump: LiveJump } | { kind: 'bounces'; jumps: LiveJump[] };

/** A straight jump, seen whole: between the skills it is a bounce, not a skill. */
const isBounce = (j: LiveJump) => j.complete && !!j.element && !j.isSkill && !j.other;

/** Straight jumps between the skills are bounces: they are folded into one line each time, so the skills stand out. */
export function groupJumps(jumps: readonly LiveJump[]): Item[] {
  const out: Item[] = [];
  for (const j of jumps) {
    if (!isBounce(j)) out.push({ kind: 'skill', jump: j });
    else {
      const last = out[out.length - 1];
      if (last?.kind === 'bounces') last.jumps.push(j);
      else out.push({ kind: 'bounces', jumps: [j] });
    }
  }
  return out;
}

/** The nearest ancestor that really scrolls: the rail on a wide screen. Where the page scrolls instead, there is none. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Where the page itself scrolls (a narrow screen), the video and its controls are pinned at the top and the row belongs below them:
 * the page's scroll-padding-top says how much room they take (styles/live.css). Nothing is pinned on a short screen (0): there the page
 * stays where it is.
 */
function revealInPage(list: HTMLElement, row: HTMLElement, smooth: boolean) {
  const pinned = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  if (pinned === 0) return;
  const box = list.getBoundingClientRect();
  if (box.bottom <= pinned || box.top >= window.innerHeight) return;
  const at = row.getBoundingClientRect();
  if (at.top >= pinned && at.bottom <= window.innerHeight) return;
  row.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
}

function Bounces({
  jumps,
  selected,
  onSelect,
}: {
  jumps: LiveJump[];
  selected: number;
  onSelect: (jump: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const inside = jumps.some((j) => j.index === selected);
  const shown = open || inside;
  const label =
    jumps.length === 1
      ? t('live.bounce', { n: jumps[0].number })
      : t('live.bounces', { count: jumps.length, from: jumps[0].number, to: jumps[jumps.length - 1].number });
  return (
    <li className="live-bounces">
      <button type="button" className="live-bounces__toggle" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        <span>{label}</span>
        <Icon name="chevron-down" size={16} className="live-bounces__chevron" />
      </button>
      {shown && (
        <ul className="live-bounces__list">
          {jumps.map((j) => (
            <li key={j.index}>
              <button
                type="button"
                className="live-bounce"
                aria-current={j.index === selected ? 'true' : undefined}
                onClick={() => onSelect(j.index)}
              >
                <span className="num">{j.number}</span>
                <span>{t('live.bounceItem')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A rail this wide (inside its padding) puts the set in a column of its own, beside the list, and one this wide shows the selected skill
 * in a third column instead of under its row. Only where the rail has a height of its own to scroll in (the wide layout).
 */
const TWO_COLUMNS_PX = 720;
const THREE_COLUMNS_PX = 1180;
const WIDE_SCREEN = '(min-width: 1100px)';

/**
 * The whole tool, for a coach or an athlete on the trampoline: what each skill was, how hard it is, what execution the pose earns and what
 * to fix, and the totals of the set. Tap a skill to see it on the video, say if the guess is right, or change it: the answer is saved and
 * the classifier learns from it.
 */
export function LiveRail(props: LiveRailProps) {
  if (props.session.jumps.length === 0) return <EmptyState notes={props.notes} onOpenSetup={props.onOpenSetup} />;
  return <LiveSet {...props} />;
}

function LiveSet(props: LiveRailProps) {
  const { session, selected, onSelect } = props;
  // Beside a portrait clip the rail is wide: the set, the list and the selected skill side by side, each column scrolling on its own.
  const rootRef = useRef<HTMLDivElement>(null);
  const wideScreen = useMediaQuery(WIDE_SCREEN);
  const room2 = useMinWidth(rootRef, TWO_COLUMNS_PX);
  const room3 = useMinWidth(rootRef, THREE_COLUMNS_PX);
  const columns = !wideScreen || !room2 ? 1 : room3 ? 3 : 2;
  const detailBeside = columns === 3;
  const items = useMemo(() => groupJumps(session.jumps), [session.jumps]);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const skillIndexes = useMemo(() => items.flatMap((i) => (i.kind === 'skill' ? [i.jump.index] : [])), [items]);

  // When the selection moves from elsewhere (the timeline, the video playing), keep the row in view inside the rail, only while the list
  // is on screen. On a narrow screen the page scrolls and the video stays pinned above the results: there a row that was tapped goes below
  // the video; the page never moves for the timeline, which a finger may be dragging.
  const previous = useRef(selected);
  const tapped = useRef(-1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (previous.current === selected) return;
    previous.current = selected;
    const fromTap = tapped.current === selected;
    tapped.current = -1;
    const list = listRef.current;
    const row = rows.current[selected];
    if (!list || !row) return;
    const scroller = scrollParent(list);
    if (!scroller) {
      if (fromTap) revealInPage(list, row, !reduced);
      return;
    }
    const view = scroller.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (box.bottom <= view.top || box.top >= view.bottom) return;
    const top = scrollTopToReveal(view, row.getBoundingClientRect(), scroller.scrollTop, 8);
    if (top !== null) scroller.scrollTo({ top, behavior: 'smooth' });
  }, [selected, reduced]);

  const actionsFor = (j: LiveJump): SkillActions => ({
    onPlay: props.onPlayJump,
    onConfirm: () => props.onConfirm(j.index),
    onPick: (id) => props.onPick(j.index, id),
    onOther: () => props.onOther(j.index),
    onClear: () => props.onClear(j.index),
    onDeduction: (d) => props.onDeduction(j.index, d),
    canLabel: props.canLabel,
  });

  // Straight jumps between the skills have no detail of their own: they only show which one is playing.
  const shown = session.jumps.find((j) => j.index === selected) ?? session.jumps[0];

  const list = (
    <section className="live-list" aria-label={t('live.skills')}>
      {session.summary.skills === 0 && <p className="live-quiet">{t('live.noSkill')}</p>}
      <div className="live-list__head" aria-hidden="true">
        <h3 className="live-h">{t('live.skills')}</h3>
        <span className="live-list__col">{t('live.colDifficulty')}</span>
        <span className="live-list__col">{t('live.colExecution')}</span>
      </div>
      <ul ref={listRef} className="live-list__body">
        {items.map((item) =>
          item.kind === 'bounces' ? (
            <Bounces key={`b${item.jumps[0].index}`} jumps={item.jumps} selected={selected} onSelect={onSelect} />
          ) : (
            <li key={item.jump.index} className={cx('live-item', item.jump.index === selected && 'live-item--on')}>
              <SkillRow
                jump={item.jump}
                selected={item.jump.index === selected}
                detailBelow={!detailBeside}
                onSelect={() => {
                  if (item.jump.index !== selected) tapped.current = item.jump.index;
                  onSelect(item.jump.index);
                }}
                buttonRef={(el) => {
                  rows.current[item.jump.index] = el;
                }}
                onKeyDown={(e) => {
                  const at = skillIndexes.indexOf(item.jump.index);
                  const to = focusTarget(e.key, at, skillIndexes.length);
                  if (to === null) return;
                  e.preventDefault();
                  rows.current[skillIndexes[to]]?.focus();
                }}
              />
              {!detailBeside && item.jump.index === selected && (
                <SkillDetail key={item.jump.index} jump={item.jump} actions={actionsFor(item.jump)} />
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );

  const rest = (
    <>
      {props.notes.length > 0 && (
        <Folds>
          <DataChecks notes={props.notes} />
        </Folds>
      )}

      <section className="ins-section live-foot">
        <Button variant="ghost" size="sm" className="ins-coach" onClick={props.onShowAdvanced}>
          {t('live.showTechnical')}
        </Button>
        <p className="ins-quiet">{t('live.technicalText')}</p>
      </section>
    </>
  );

  const detail = (
    <div className="live-col live-col--detail" key={shown.index}>
      {isBounce(shown) ? (
        <p className="live-h">{t('live.bounce', { n: shown.number })}</p>
      ) : (
        <SkillDetail jump={shown} actions={actionsFor(shown)} />
      )}
    </div>
  );
  const summary = <SetSummary session={session} title={props.title} />;

  return (
    <div
      ref={rootRef}
      className={cx('live', columns > 1 && 'live--split')}
      data-columns={columns > 1 ? columns : undefined}
    >
      {columns === 3 ? (
        <>
          <div className="live-col">
            {summary}
            {rest}
          </div>
          <div className="live-col">{list}</div>
          {detail}
        </>
      ) : columns === 2 ? (
        <>
          <div className="live-col">
            {summary}
            {rest}
          </div>
          <div className="live-col">{list}</div>
        </>
      ) : (
        <>
          {summary}
          {list}
          {rest}
        </>
      )}
    </div>
  );
}
