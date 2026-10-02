import { useState } from 'react';
import { formatNumber, lower, t, tx } from '../../i18n';
import { difficultyRange } from '../../skills/fig/difficulty';
import { elementName } from '../../skills/fig/elements';
import type { LiveJump } from '../../coaching/session';
import { jumpName as nameOf } from '../../coaching/display';
import { deductionText, difficultyText } from '../../coaching/summary';
import { Button, Disclosure, Icon, cx } from '../kit';
import { useRangeButton } from '../playhead';
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

/** What the row says under the name: how sure it is, in words. */
export function subline(j: LiveJump): string {
  const parts: string[] = [];
  if (!j.complete) parts.push(t('live.sub.partial'));
  else if (j.other) parts.push(t('live.sub.notInList'));
  else if (j.source === 'coach') parts.push(t('live.sub.yours'));
  else if (j.pending) parts.push(t('live.sub.pending'));
  else if (j.forced) parts.push(t('live.sub.guess'));
  else if (j.certainty === 'tentative') parts.push(t('live.sub.notSure'));
  if (j.directionAssumed && j.source === 'auto') parts.push(t('live.sub.direction'));
  if (j.repeated) parts.push(t('live.sub.repeat'));
  return parts.join(t('list.separator'));
}

const tone = (deduction: number | null) =>
  deduction === null
    ? undefined
    : deduction === 0
      ? 'live-row__fig--ok'
      : deduction >= 0.3
        ? 'live-row__fig--warn'
        : undefined;

/** A small flag: the routine starts here. */
export function RoutineFlag() {
  return (
    <span className="live-flag" title={t('live.routineStart')}>
      <Icon name="flag" size={13} />
      <span className="sr-only">{t('live.routineStart')}</span>
    </span>
  );
}

/** One skill of the set on one line: its number, name, difficulty and execution. */
export function SkillRow({
  jump,
  selected,
  startsRoutine = false,
  detailBelow = true,
  onSelect,
  onKeyDown,
  buttonRef,
}: {
  jump: LiveJump;
  selected: boolean;
  /** The routine starts with this skill. */
  startsRoutine?: boolean;
  /** The selected row opens its detail under it (the default), rather than the detail being somewhere else on the page. */
  detailBelow?: boolean;
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
      aria-expanded={detailBelow ? selected : undefined}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className={cx('live-row__num num', selected && 'live-row__num--on')}>
        <span className="sr-only">{t('live.skill')} </span>
        {jump.number}
      </span>
      <span className="live-row__main">
        <span className="live-row__name">
          <span className="live-row__label" title={nameOf(jump)}>
            {nameOf(jump)}
          </span>
          {unsure && <span className="live-row__unsure" aria-hidden="true" />}
          {startsRoutine && <RoutineFlag />}
        </span>
        {sub && <span className="live-row__sub">{sub}</span>}
      </span>
      <span className="live-row__fig num" title={jump.pending ? t('live.notCounted') : t('live.difficulty')}>
        <span className="sr-only">{t('live.difficulty')} </span>
        {jump.element && !jump.pending ? difficultyText(jump.counted) : '–'}
      </span>
      <span
        className={cx('live-row__fig num', !jump.pending && tone(jump.deduction))}
        title={jump.pending ? t('live.notCounted') : t('live.executionDeduction')}
      >
        <span className="sr-only">{t('live.execution')} </span>
        {jump.pending ? '–' : deductionText(jump.deduction)}
      </span>
    </button>
  );
}

function CallBlock({ jump, actions }: { jump: LiveJump; actions: SkillActions }) {
  const [changing, setChanging] = useState(false);
  const play = useRangeButton('skill', actions.onPlay);
  const e = jump.element;
  const disabled = !actions.canLabel;
  const pick = (id: string) => {
    setChanging(false);
    actions.onPick(id);
  };
  return (
    <section className="live-block live-block--call">
      {jump.other ? (
        <p className="live-say">{t('live.say.other')}</p>
      ) : e ? (
        <p className="live-say">
          {tx(jump.source === 'coach' ? 'live.say.coach' : jump.forced ? 'live.say.forced' : 'live.say.auto', {
            name: <strong>{elementName(e)}</strong>,
          })}
          {jump.directionAssumed && jump.source === 'auto' && t('sentence.gap') + t('live.say.directionAssumed')}
        </p>
      ) : null}
      {jump.source === 'auto' && jump.why && <p className="live-quiet">{jump.why}</p>}
      <div className="live-actions">
        {jump.source !== 'coach' && !jump.other && e && (
          <Button size="sm" variant="primary" icon="check" disabled={disabled} onClick={actions.onConfirm}>
            {t('live.yes')}
          </Button>
        )}
        <Button size="sm" aria-expanded={changing} disabled={disabled} onClick={() => setChanging(!changing)}>
          {changing ? t('common.close') : t('common.change')}
        </Button>
        {(jump.source === 'coach' || jump.other) && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={actions.onClear}>
            {t('common.undo')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={play.playing ? 'pause' : 'play'}
          className="live-actions__play"
          title={play.playing ? t('transport.pause') : t('live.playTitle')}
          onClick={play.press}
        >
          {play.playing ? t('transport.pause') : t('common.play')}
        </Button>
      </div>
      {changing && (
        <div className="live-change">
          {jump.alternatives.length > 0 && (
            <>
              <p className="live-h">{t('live.couldBe')}</p>
              <ul className="live-alts">
                {jump.alternatives.slice(0, 3).map((a) => (
                  <li key={a.elementId}>
                    <button type="button" className="live-alt" onClick={() => pick(a.elementId)}>
                      <span>{a.name}</span>
                      <span className="num live-alt__d" title={t('live.difficulty')}>
                        {difficultyText(a.difficulty)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Disclosure title={t('live.anotherSkill')} defaultOpen={jump.alternatives.length === 0}>
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
            {t('live.noneOfThese')}
          </Button>
        </div>
      )}
      {!actions.canLabel && <p className="live-quiet">{t('live.cannotLabel')}</p>}
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
        <h4 className="live-h">{t('live.difficulty')}</h4>
        <span className="live-block__val num">{difficultyText(d.value)}</span>
      </div>
      {d.parts.length > 0 ? (
        <dl className="live-parts">
          {d.parts.map((p) => (
            <div key={p.label} title={t('live.partTitle', { rule: p.rule })}>
              <dt>{p.label}</dt>
              <dd className="num">{difficultyText(p.value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="live-quiet">{t('live.noElement')}</p>
      )}
      {jump.easier && (
        <p className="live-quiet live-quiet--note">
          {t(jump.easier.hipDeg !== null && jump.easier.kneeDeg !== null ? 'live.easierDetail' : 'live.easier', {
            measured: lower(t(`pos.${jump.easier.measured}`)),
            hip: `${Math.round(jump.easier.hipDeg ?? NaN)}°`,
            knee: `${Math.round(jump.easier.kneeDeg ?? NaN)}°`,
            element: elementName(jump.easier.element),
            value: difficultyText(jump.easier.element.difficulty),
          })}
        </p>
      )}
      {jump.repeated && <p className="live-quiet">{t('live.repeated')}</p>}
      {range && range.min !== range.max && (
        <p className="live-quiet">{t('live.frontWorth', { value: difficultyText(range.min) })}</p>
      )}
    </section>
  );
}

/** The time in the air, and how high it says the jump went: the height needs no scale, only gravity. */
function AirBlock({ jump }: { jump: LiveJump }) {
  if (jump.flightS === null || jump.airRiseM === null) return null;
  return (
    <section className="live-block">
      <div className="live-block__head">
        <h4 className="live-h">{t('live.air')}</h4>
        <span className="live-block__val num">
          {formatNumber(jump.flightS, 2)} <span className="unit">s</span>
        </span>
      </div>
      <dl className="live-parts">
        <div title={t('live.airRiseTitle')}>
          <dt>{t('live.airRise')}</dt>
          <dd className="num">
            ≈ {formatNumber(jump.airRiseM, 1)} <span className="unit">m</span>
          </dd>
        </div>
      </dl>
      <p className="live-quiet">{t('live.airNote')}</p>
    </section>
  );
}

function ExecutionBlock({ jump, actions }: { jump: LiveJump; actions: SkillActions }) {
  const x = jump.execution;
  return (
    <section className="live-block">
      <div className="live-block__head">
        <h4 className="live-h">{t('live.execution')}</h4>
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
          <p className="live-quiet">{t('live.noDeduction')}</p>
        )
      ) : (
        <p className="live-quiet">
          {x?.reason ? t('live.notJudged', { reason: x.reason }) : t('live.notJudgedDefault')}
        </p>
      )}
      {x && x.quality < 0.5 && x.checked && <p className="live-quiet">{t('live.hardToSee')}</p>}
      <div className="live-yours" role="group" aria-label={t('live.yourScore')}>
        <span className="live-yours__name">{t('live.yourDeduction')}</span>
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
        <p className="live-quiet">{t('live.proposed', { value: deductionText(jump.proposed) })}</p>
      )}
      {x && x.unchecked.length > 0 && (
        <Disclosure title={t('live.unchecked')}>
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
      <h4 className="live-h">{t('live.fix')}</h4>
      <ul className="live-tips">
        {jump.tips.map((tip) => (
          <li key={`${tip.id}-${tip.title}`} className="live-tip">
            <p className="live-tip__title">{tip.title}</p>
            <p className="live-tip__text">{tip.text}</p>
            {tip.gain === 0 && <p className="live-tip__detail">{tip.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The selected skill in full: what it was and whether that is right, how hard it is, what the pose earns, and what to fix. */
export function SkillDetail({ jump, actions }: { jump: LiveJump; actions: SkillActions }) {
  const play = useRangeButton('skill-partial', actions.onPlay);
  return (
    <div className="live-detail">
      {jump.complete ? (
        <>
          <CallBlock jump={jump} actions={actions} />
          <DifficultyBlock jump={jump} />
          <AirBlock jump={jump} />
          {jump.isSkill && <ExecutionBlock jump={jump} actions={actions} />}
          <TipsBlock jump={jump} />
        </>
      ) : (
        <>
          <p className="live-quiet">{t('live.clipCutsSkill')}</p>
          <div className="live-actions">
            <Button size="sm" icon={play.playing ? 'pause' : 'play'} onClick={play.press}>
              {play.playing ? t('transport.pause') : t('common.play')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
