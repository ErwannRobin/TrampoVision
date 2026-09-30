import { useState } from 'react';
import { difficultyRange } from '../../skills/fig/difficulty';
import type { LiveJump } from '../../coaching/session';
import { OTHER_LABEL } from '../../coaching/display';
import { deductionText, difficultyText } from '../../coaching/summary';
import { Button, Disclosure, cx } from '../kit';
import { ElementPicker } from './ElementPicker';

/** The deductions a person can give a skill, in points (§20.1: 0.0 to 0.5). */
const SCORES = [0, 0.1, 0.2, 0.3, 0.4, 0.5] as const;

export interface SkillActions {
  onPlay: () => void;
  /** The guess is right. */
  onConfirm: () => void;
  /** It was another element of the table. */
  onPick: (elementId: string) => void;
  /** It is none of the elements of the table. */
  onOther: () => void;
  /** Take the label back: the classifier's guess counts again. */
  onClear: () => void;
  /** The deduction the person gives, or null to take it back. */
  onDeduction: (deduction: number | null) => void;
  /** Labels can be saved (the video is identified). */
  canLabel: boolean;
}

const nameOf = (j: LiveJump): string => {
  if (j.other) return OTHER_LABEL;
  if (!j.element) return j.complete ? 'Not named' : 'Cut off by the clip';
  return j.source === 'auto' && j.certainty === 'tentative' ? `${j.element.name}?` : j.element.name;
};

/** What the row says under the name: how sure it is, in words. */
export function subline(j: LiveJump): string {
  const parts: string[] = [];
  if (!j.complete) parts.push('Filmed only in part');
  else if (j.other) parts.push('Not in the list');
  else if (j.source === 'coach') parts.push('Your label');
  else if (j.pending) parts.push('Best guess, not counted yet');
  else if (j.forced) parts.push('Best guess');
  else if (j.certainty === 'tentative') parts.push('Not sure');
  if (j.directionAssumed && j.source === 'auto') parts.push('direction assumed');
  if (j.repeated) parts.push('repeat, does not count');
  return parts.join(', ');
}

const tone = (deduction: number | null) =>
  deduction === null
    ? undefined
    : deduction === 0
      ? 'live-row__fig--ok'
      : deduction >= 0.3
        ? 'live-row__fig--warn'
        : undefined;

/** One skill of the set on one line: its number, name, difficulty and execution. */
export function SkillRow({
  jump,
  selected,
  onSelect,
  onKeyDown,
  buttonRef,
}: {
  jump: LiveJump;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const sub = subline(jump);
  const unsure = jump.source === 'auto' && (jump.forced || jump.certainty === 'tentative');
  return (
    <button
      type="button"
      ref={buttonRef}
      className="live-row"
      aria-current={selected ? 'true' : undefined}
      aria-expanded={selected}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className={cx('live-row__num num', selected && 'live-row__num--on')}>
        <span className="sr-only">Skill </span>
        {jump.number}
      </span>
      <span className="live-row__main">
        <span className="live-row__name">
          <span className="live-row__label" title={nameOf(jump)}>
            {nameOf(jump)}
          </span>
          {unsure && <span className="live-row__unsure" aria-hidden="true" />}
        </span>
        {sub && <span className="live-row__sub">{sub}</span>}
      </span>
      <span className="live-row__fig num" title={jump.pending ? 'Not counted until you check it' : 'Difficulty'}>
        <span className="sr-only">Difficulty </span>
        {jump.element && !jump.pending ? difficultyText(jump.counted) : '–'}
      </span>
      <span
        className={cx('live-row__fig num', !jump.pending && tone(jump.deduction))}
        title={jump.pending ? 'Not counted until you check it' : 'Execution deduction'}
      >
        <span className="sr-only">Execution </span>
        {jump.pending ? '–' : deductionText(jump.deduction)}
      </span>
    </button>
  );
}

function CallBlock({ jump, actions }: { jump: LiveJump; actions: SkillActions }) {
  const [changing, setChanging] = useState(false);
  const e = jump.element;
  const disabled = !actions.canLabel;
  const pick = (id: string) => {
    setChanging(false);
    actions.onPick(id);
  };
  return (
    <section className="live-block live-block--call">
      {jump.other ? (
        <p className="live-say">You said this is none of the skills in the list. It is left out of the totals.</p>
      ) : e ? (
        <p className="live-say">
          {jump.source === 'coach' ? 'You said this is a ' : jump.forced ? 'Best guess: a ' : 'This looks like a '}
          <strong>{e.name}</strong>.
          {jump.directionAssumed && jump.source === 'auto' && ' Front or back could not be told, so back is assumed.'}
        </p>
      ) : null}
      {jump.source === 'auto' && jump.why && <p className="live-quiet">{jump.why}</p>}
      <div className="live-actions">
        {jump.source !== 'coach' && !jump.other && e && (
          <Button size="sm" variant="primary" icon="check" disabled={disabled} onClick={actions.onConfirm}>
            Yes, that is it
          </Button>
        )}
        <Button size="sm" aria-expanded={changing} disabled={disabled} onClick={() => setChanging(!changing)}>
          {changing ? 'Close' : 'Change'}
        </Button>
        {(jump.source === 'coach' || jump.other) && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={actions.onClear}>
            Undo
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="play"
          className="live-actions__play"
          title="Play this skill with a little run-up and landing"
          onClick={actions.onPlay}
        >
          Play
        </Button>
      </div>
      {changing && (
        <div className="live-change">
          {jump.alternatives.length > 0 && (
            <>
              <p className="live-h">It could be</p>
              <ul className="live-alts">
                {jump.alternatives.slice(0, 3).map((a) => (
                  <li key={a.elementId}>
                    <button type="button" className="live-alt" onClick={() => pick(a.elementId)}>
                      <span>{a.name}</span>
                      <span className="num live-alt__d" title="Difficulty">
                        {difficultyText(a.difficulty)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Disclosure title="Another skill" defaultOpen={jump.alternatives.length === 0}>
            <ElementPicker key={e?.id ?? 'none'} element={e} onPick={pick} />
          </Disclosure>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setChanging(false);
              actions.onOther();
            }}
          >
            It is none of these
          </Button>
        </div>
      )}
      {!actions.canLabel && <p className="live-quiet">Labels can be saved once the video is identified.</p>}
    </section>
  );
}

function DifficultyBlock({ jump }: { jump: LiveJump }) {
  const d = jump.difficulty;
  if (!d || !jump.element) return null;
  const range = jump.directionAssumed ? difficultyRange({ ...jump.element, direction: null }) : null;
  return (
    <section className="live-block">
      <div className="live-block__head">
        <h4 className="live-h">Difficulty</h4>
        <span className="live-block__val num">{difficultyText(d.value)}</span>
      </div>
      {d.parts.length > 0 ? (
        <dl className="live-parts">
          {d.parts.map((p) => (
            <div key={p.label} title={`FIG Code of Points 2025-2028, §${p.rule}`}>
              <dt>{p.label}</dt>
              <dd className="num">{difficultyText(p.value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="live-quiet">A straight jump is not an element: it has no difficulty.</p>
      )}
      {jump.easier && (
        <p className="live-quiet live-quiet--note">
          The body looked like a {jump.easier.measured}
          {jump.easier.hipDeg !== null &&
            jump.easier.kneeDeg !== null &&
            ` (hips ${Math.round(jump.easier.hipDeg)}°, knees ${Math.round(jump.easier.kneeDeg)}°)`}
          . A judge gives the least difficult shape: {jump.easier.element.name} is worth{' '}
          {difficultyText(jump.easier.element.difficulty)}.
        </p>
      )}
      {jump.repeated && (
        <p className="live-quiet">The same element was done earlier, so it counts for nothing in a routine.</p>
      )}
      {range && range.min !== range.max && (
        <p className="live-quiet">
          Front would be worth {difficultyText(range.min)}: the direction matters for a double or a triple.
        </p>
      )}
    </section>
  );
}

function ExecutionBlock({ jump, actions }: { jump: LiveJump; actions: SkillActions }) {
  const x = jump.execution;
  return (
    <section className="live-block">
      <div className="live-block__head">
        <h4 className="live-h">Execution</h4>
        <span className="live-block__val num">{deductionText(jump.deduction)}</span>
      </div>
      {x?.checked ? (
        x.items.length ? (
          <ul className="live-deductions">
            {x.items.map((d) => (
              <li key={d.id}>
                <span className="live-deductions__label">{d.label}</span>
                <span className="num live-deductions__val">{deductionText(d.value)}</span>
                <span className="live-deductions__detail">{d.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="live-quiet">No deduction found in what one camera can see.</p>
        )
      ) : (
        <p className="live-quiet">Not judged: {x?.reason ?? 'this skill has no measured shape.'}</p>
      )}
      {x && x.quality < 0.5 && x.checked && (
        <p className="live-quiet">The athlete was hard to see here, so treat this as a rough estimate.</p>
      )}
      <div className="live-yours" role="group" aria-label="Your execution score">
        <span className="live-yours__name">Your deduction</span>
        <div className="live-chips">
          {SCORES.map((v) => (
            <button
              key={v}
              type="button"
              className="live-chip live-chip--num num"
              aria-pressed={jump.coachDeduction === v}
              disabled={!actions.canLabel}
              onClick={() => actions.onDeduction(jump.coachDeduction === v ? null : v)}
            >
              {deductionText(v)}
            </button>
          ))}
        </div>
      </div>
      {jump.coachDeduction !== null && jump.proposed !== null && jump.coachDeduction !== jump.proposed && (
        <p className="live-quiet">The app proposed {deductionText(jump.proposed)}.</p>
      )}
      {x && x.unchecked.length > 0 && (
        <Disclosure title="Not checked">
          <ul className="live-unchecked">
            {x.unchecked.map((u) => (
              <li key={u.id}>
                <strong>{u.label}.</strong> {u.why}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

function TipsBlock({ jump }: { jump: LiveJump }) {
  if (jump.tips.length === 0) return null;
  return (
    <section className="live-block">
      <h4 className="live-h">What to fix</h4>
      <ul className="live-tips">
        {jump.tips.map((t) => (
          <li key={`${t.id}-${t.title}`} className="live-tip">
            <p className="live-tip__title">{t.title}</p>
            <p className="live-tip__text">{t.text}</p>
            {t.gain === 0 && <p className="live-tip__detail">{t.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The selected skill in full: what it was and whether that is right, how hard it is, what the pose earns, and what to fix. */
export function SkillDetail({ jump, actions }: { jump: LiveJump; actions: SkillActions }) {
  return (
    <div className="live-detail">
      {jump.complete ? (
        <>
          <CallBlock jump={jump} actions={actions} />
          <DifficultyBlock jump={jump} />
          {jump.isSkill && <ExecutionBlock jump={jump} actions={actions} />}
          <TipsBlock jump={jump} />
        </>
      ) : (
        <>
          <p className="live-quiet">
            The clip starts or ends during this skill, so it cannot be named or judged. Film a little before the takeoff
            and after the landing.
          </p>
          <div className="live-actions">
            <Button size="sm" icon="play" onClick={actions.onPlay}>
              Play
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
