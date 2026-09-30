import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveJump, Session } from '../../coaching/session';
import { Button, cx } from '../kit';
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

/** Straight jumps between the skills are bounces: they are folded into one line each time, so the skills stand out. */
export function groupJumps(jumps: readonly LiveJump[]): Item[] {
  const out: Item[] = [];
  for (const j of jumps) {
    const bounce = j.complete && !!j.element && !j.isSkill && !j.other;
    if (!bounce) out.push({ kind: 'skill', jump: j });
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
      ? `Straight jump ${jumps[0].number}`
      : `${jumps.length} straight jumps, ${jumps[0].number} to ${jumps[jumps.length - 1].number}`;
  return (
    <li className="live-bounces">
      <button type="button" className="live-bounces__toggle" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        {label}
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
                <span>Straight jump</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The whole tool, for a coach or an athlete on the trampoline: what each skill was, how hard it is, what execution the pose earns and what
 * to fix, and the totals of the set. Tap a skill to see it on the video, say if the guess is right, or change it: the answer is saved and
 * the classifier learns from it.
 */
export function LiveRail(props: LiveRailProps) {
  const { session, selected, onSelect } = props;
  const items = useMemo(() => groupJumps(session.jumps), [session.jumps]);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const skillIndexes = useMemo(() => items.flatMap((i) => (i.kind === 'skill' ? [i.jump.index] : [])), [items]);

  // When the selection moves from elsewhere (the timeline, the video playing), keep the row in view inside the rail, only while the list
  // is on screen. Never the page: on a narrow screen the video would scroll away.
  const previous = useRef(selected);
  useEffect(() => {
    if (previous.current === selected) return;
    previous.current = selected;
    const list = listRef.current;
    const row = rows.current[selected];
    const scroller = list && row ? scrollParent(list) : null;
    if (!list || !row || !scroller) return;
    const view = scroller.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (box.bottom <= view.top || box.top >= view.bottom) return;
    const top = scrollTopToReveal(view, row.getBoundingClientRect(), scroller.scrollTop, 8);
    if (top !== null) scroller.scrollTo({ top, behavior: 'smooth' });
  }, [selected]);

  if (session.jumps.length === 0) return <EmptyState notes={props.notes} onOpenSetup={props.onOpenSetup} />;

  const actionsFor = (j: LiveJump): SkillActions => ({
    onPlay: props.onPlayJump,
    onConfirm: () => props.onConfirm(j.index),
    onPick: (id) => props.onPick(j.index, id),
    onOther: () => props.onOther(j.index),
    onClear: () => props.onClear(j.index),
    onDeduction: (d) => props.onDeduction(j.index, d),
    canLabel: props.canLabel,
  });

  return (
    <div className="live">
      <SetSummary session={session} title={props.title} />

      <section className="live-list" aria-label="Skills">
        {session.summary.skills === 0 && (
          <p className="live-quiet">
            No skill found, only straight jumps. Film a set with somersaults or twists to score them.
          </p>
        )}
        <div className="live-list__head" aria-hidden="true">
          <h3 className="live-h">Skills</h3>
          <span className="live-list__col">Difficulty</span>
          <span className="live-list__col">Execution</span>
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
                  onSelect={() => onSelect(item.jump.index)}
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
                {item.jump.index === selected && (
                  <SkillDetail key={item.jump.index} jump={item.jump} actions={actionsFor(item.jump)} />
                )}
              </li>
            ),
          )}
        </ul>
      </section>

      {props.notes.length > 0 && (
        <Folds>
          <DataChecks notes={props.notes} />
        </Folds>
      )}

      <section className="ins-section live-foot">
        <Button variant="ghost" size="sm" className="ins-coach" onClick={props.onShowAdvanced}>
          Show technical details
        </Button>
        <p className="ins-quiet">
          The athlete and coach views add the evidence behind each skill, every measurement, the twist analysis and all
          the charts.
        </p>
      </section>
    </div>
  );
}
