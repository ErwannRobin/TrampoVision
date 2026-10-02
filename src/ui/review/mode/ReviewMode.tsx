import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { download } from '../../../analysis/export';
import { parseLabelFile } from '../../../eval/labels';
import {
  EMPTY_ANSWERS,
  answersOfPrediction,
  answersOfRecord,
  applyLabelFile,
  disagreesWithGuess,
  labelFileOfRecords,
  labelFileText,
  reviewStatusOf,
  withNote,
  withReviewFlag,
  withStageAnswers,
  type ReviewStatus,
} from '../../../dataset/stageLabel';
import type { JumpRecord, StageAnswers } from '../../../dataset/types';
import { t, tx } from '../../../i18n';
import { elementById } from '../../../skills/fig/elements';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import type { ElementCandidate } from '../../../skills/types';
import { fmt, pct } from '../../format';
import { useLocalStorage } from '../../hooks';
import { confidenceTier, TIER_TEXT } from '../../insights';
import {
  Badge,
  Button,
  ConfidenceMeter,
  Disclosure,
  Icon,
  IconButton,
  Segmented,
  Switch,
  type BadgeTone,
} from '../../kit';
import type { Playhead } from '../../playhead';
import { Detected } from '../Detected';
import { Keycap } from '../Keycap';
import { jumpPlayRange } from '../logic';
import { movementFromPrediction } from '../../../dataset/movementLabel';
import { AnswerPanel } from './AnswerPanel';
import { Candidates, Curves, Flags, Measured } from './Evidence';
import {
  REVIEW_FILTERS,
  answer,
  dataFlags,
  filterMask,
  nextToLabel,
  reviewCounts,
  reviewKey,
  stepInMask,
  type ReviewAction,
  type ReviewFilter,
  type ReviewItem,
} from './logic';

export interface ReviewModeProps {
  skills: SkillAnalysis;
  /** The record each detected jump has right now, with the label if one was saved. */
  records: JumpRecord[];
  selected: number;
  /** Choose a jump (the video moves to its takeoff). */
  onSelect: (jump: number) => void;
  playhead: Playhead;
  speed: number;
  onSpeed: (speed: number) => void;
  /** Where the labels belong; null while it is being read. */
  videoId: string | null;
  fileName: string;
  baseName: string;
  /** Saves records in the local dataset. */
  onSave: (records: JumpRecord[]) => void;
  onClose: () => void;
  /** The browser's own storage could not be used: labels stay in memory only. */
  storageWarning: string | null;
}

const STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  unlabeled: 'outline',
  partial: 'warn',
  done: 'ok',
  'cannot-tell': 'neutral',
  'bad-segmentation': 'neutral',
};
const SPEEDS = [0.25, 0.5, 1] as const;
/** How long the label stays on screen before the review moves on to the next jump. */
const ADVANCE_MS = 450;
const UNDO_DEPTH = 50;

interface UndoEntry {
  index: number;
  before: JumpRecord;
}

/**
 * The review mode: one jump at a time, looping in the video, with what the classifier made of it, what it measured and what is wrong
 * with the data on one side, and the buttons that say what it really was on the other. Labels are saved in the local dataset as they are
 * given (and can be downloaded in the format `make eval-run` scores against), and the review moves on by itself when a jump is done.
 */
export function ReviewMode({
  skills,
  records,
  selected,
  onSelect,
  playhead,
  speed,
  onSpeed,
  videoId,
  fileName,
  baseName,
  onSave,
  onClose,
  storageWarning,
}: ReviewModeProps) {
  const n = skills.jumps.length;
  const k = Math.min(selected, Math.max(0, n - 1));
  const jump = skills.jumps[k];
  const record: JumpRecord | undefined = records[k];
  const confidentAt = skills.config.temporal.confidentAt;

  const [filter, setFilter] = useLocalStorage<ReviewFilter>('trampovision.reviewFilter', 'all', REVIEW_FILTERS);
  const [advance, setAdvance] = useLocalStorage<'on' | 'off'>('trampovision.reviewAdvance', 'on', ['on', 'off']);
  const [message, setMessage] = useState('');
  const [undoDepth, setUndoDepth] = useState(0);
  const undo = useRef<UndoEntry[]>([]);
  const timer = useRef<number | undefined>(undefined);

  const guesses = useMemo(() => skills.jumps.map((j) => answersOfPrediction(j.prediction)), [skills.jumps]);
  const items = useMemo<ReviewItem[]>(
    () =>
      skills.jumps.map((j, i) => {
        const r = records[i];
        return {
          status: r ? reviewStatusOf(r) : 'unlabeled',
          disagrees: r ? disagreesWithGuess(r, guesses[i]) : false,
          confidence: j.prediction.confidence,
        };
      }),
    [skills.jumps, records, guesses],
  );
  const statuses = useMemo(() => items.map((i) => i.status), [items]);
  const mask = useMemo(() => filterMask(filter, items, confidentAt), [filter, items, confidentAt]);
  const counts = useMemo(() => reviewCounts(statuses), [statuses]);
  const shown = mask.filter(Boolean).length;

  // The handlers below are called from a key listener that is set up once: they read what is current through this.
  const live = useRef({ k, n, mask, statuses, items, records, guesses, advance, videoId, onSave, onSelect });
  live.current = { k, n, mask, statuses, items, records, guesses, advance, videoId, onSave, onSelect };

  const cancelAdvance = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => cancelAdvance, [cancelAdvance]);
  // Any other way of moving to a jump (the timeline, the strip, the keys) ends a move that was about to happen.
  useEffect(() => cancelAdvance(), [k, cancelAdvance]);

  // The jump on screen plays on a loop, from a moment before takeoff to a moment after landing.
  const [from, to] = jump ? jumpPlayRange(jump.cycle) : [0, 0];
  const replay = useCallback(() => {
    if (to > from) playhead.playRange(from, to, true);
  }, [playhead, from, to]);
  useEffect(() => {
    replay();
  }, [replay, k]);
  useEffect(() => () => playhead.pause(), [playhead]);

  const commit = (next: JumpRecord, action: ReviewAction['kind']) => {
    const { k: at, records: all, statuses: before, mask: inFilter, advance: auto } = live.current;
    const prior = all[at];
    undo.current = [...undo.current.slice(-(UNDO_DEPTH - 1)), { index: at, before: prior }];
    setUndoDepth(undo.current.length);
    setMessage('');
    live.current.onSave([next]);
    const after = reviewStatusOf(next);
    const settled = after === 'done' || after === 'cannot-tell' || after === 'bad-segmentation';
    const wasSettled = before[at] === 'done' || before[at] === 'cannot-tell' || before[at] === 'bad-segmentation';
    cancelAdvance();
    if (
      auto === 'on' &&
      settled &&
      (!wasSettled || action === 'accept' || action === 'cannotTell' || action === 'badSegmentation')
    ) {
      const target = nextToLabel(
        before.map((s, i) => (i === at ? after : s)),
        inFilter,
        at,
      );
      if (target !== null) timer.current = window.setTimeout(() => live.current.onSelect(target), ADVANCE_MS);
    }
  };

  const act = (action: ReviewAction, via: 'key' | 'button') => {
    const { k: at, records: all, guesses: g, videoId: vid, mask: inFilter } = live.current;
    const r = all[at];
    if (action.kind === 'undo') {
      const entry = undo.current.pop();
      setUndoDepth(undo.current.length);
      if (!entry) return;
      cancelAdvance();
      live.current.onSave([entry.before]);
      if (entry.index !== at) live.current.onSelect(entry.index);
      return;
    }
    if (action.kind === 'replay') return replay();
    if (action.kind === 'next') {
      const target = stepInMask(inFilter, at);
      if (target !== null) live.current.onSelect(target);
      return;
    }
    if (!r || !vid) return;
    const status = reviewStatusOf(r);
    switch (action.kind) {
      case 'accept': {
        const guess = g[at];
        if (guess) commit(withStageAnswers(r, guess), 'accept');
        return;
      }
      case 'cannotTell':
        return commit(withReviewFlag(r, status === 'cannot-tell' ? null : 'cannot-tell'), action.kind);
      case 'badSegmentation':
        return commit(withReviewFlag(r, status === 'bad-segmentation' ? null : 'bad-segmentation'), action.kind);
      case 'clear':
        if (status !== 'unlabeled') commit(withStageAnswers(r, EMPTY_ANSWERS), 'clear');
        return;
      default: {
        const next = answer(answersOfRecord(r), action, { toggle: via === 'button' });
        if (next) commit(withStageAnswers(r, next), action.kind);
      }
    }
  };
  const actRef = useRef(act);
  actRef.current = act;

  const pickCandidate = (c: ElementCandidate) => {
    const m = c.movement;
    const a: StageAnswers = {
      somersaults: m.somersaults,
      direction: m.somersaults > 0 ? m.direction : null,
      halfTwists: Math.round(m.twists * 2),
      position: m.position,
    };
    const r = live.current.records[live.current.k];
    if (r && live.current.videoId) commit(withStageAnswers(r, a), 'accept');
  };

  // The button that opened the review is not where the keys should land.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || target?.isContentEditable || e.repeat) return;
      // Enter on a button reached with the keyboard presses that button. After a click the button keeps the focus, and Enter still means "accept".
      if (e.key === 'Enter' && tag === 'BUTTON' && target?.matches(':focus-visible')) return;
      const action = reviewKey(e);
      if (!action) return;
      e.preventDefault();
      actRef.current(action, 'key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const importLabels = async (file: File) => {
    try {
      const parsed = parseLabelFile(await file.text());
      if (!videoId) return;
      if (parsed.videoId !== videoId) {
        const ok = window.confirm(t('rm.labelsMismatch', { id: parsed.fileName ?? parsed.videoId }));
        if (!ok) return;
      }
      const applied = applyLabelFile(parsed, records);
      if (applied.records.length) onSave(applied.records);
      setMessage(
        t('rm.labelsImported', {
          n: applied.records.length,
          blank: applied.blank,
          unmatched: applied.unmatched.length,
        }),
      );
    } catch (e) {
      setMessage(t('rm.labelsError', { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  if (n === 0 || !jump) {
    return (
      <div className="rm">
        <header className="rm-head">
          <h2 className="rm-title">{t('rm.title')}</h2>
          <IconButton icon="close" label={t('rm.close')} onClick={onClose} />
        </header>
        <p className="review-empty">{t('review.noJump')}</p>
      </div>
    );
  }

  const status = items[k].status;
  const flagged = status === 'cannot-tell' || status === 'bad-segmentation' ? status : null;
  const answers = record ? answersOfRecord(record) : EMPTY_ANSWERS;
  const guess = guesses[k];
  const guessElement = jump.prediction.elementId ? elementById(jump.prediction.elementId) : undefined;
  const canSave = !!videoId && !!record;
  const tier = confidenceTier(jump.prediction, skills.config.minConfidence);
  const flags = dataFlags(jump.features, skills.config, record?.twist?.estimate ?? null);
  const note = record?.truth?.note ?? '';

  return (
    <div className="rm" data-status={status}>
      <header className="rm-head">
        <h2 className="rm-title">{t('rm.title')}</h2>
        <IconButton icon="close" label={t('rm.close')} onClick={onClose} />
      </header>

      <div className="review-progress">
        <span className="review-progress__text">
          {tx('rm.progress', {
            done: <span className="num">{counts.settled}</span>,
            total: <span className="num">{n}</span>,
          })}
        </span>
        <div className="review-progress__track" aria-hidden="true">
          <div className="review-progress__fill" style={{ width: `${(counts.settled / n) * 100}%` }} />
        </div>
      </div>
      {counts.settled === n && <p className="rm-alldone">{t('rm.allDone')}</p>}

      <div className="rm-bar">
        <Segmented<ReviewFilter>
          size="sm"
          ariaLabel={t('rm.filter')}
          value={filter}
          onChange={setFilter}
          options={REVIEW_FILTERS.map((f) => ({ value: f, label: t(`rm.filter.${f}`) }))}
        />
        <span className="rm-bar__count num" role="status">
          {t('rm.shown', { shown, total: n })}
        </span>
      </div>

      <JumpStrip
        items={items}
        mask={mask}
        selected={k}
        names={skills.jumps.map((j) => j.prediction.label)}
        onSelect={onSelect}
      />

      <div className="rm-jump">
        <div className="rm-jump__nav">
          <Button
            size="sm"
            variant="ghost"
            disabled={stepInMask(mask, k, -1) === null}
            aria-keyshortcuts="["
            onClick={() => {
              const target = stepInMask(mask, k, -1);
              if (target !== null) onSelect(target);
            }}
          >
            ‹ {t('rm.prev')}
          </Button>
          <h3 className="rm-jump__title">{t('rm.jumpOf', { n: k + 1, total: n })}</h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={stepInMask(mask, k) === null}
            onClick={() => act({ kind: 'next' }, 'button')}
          >
            {t('rm.next')} ›<Keycap>N</Keycap>
          </Button>
        </div>
        <div className="rm-jump__meta">
          <Badge tone={STATUS_TONE[status]}>{t(`rm.status.${status}`)}</Badge>
          <span className="faint num">{fmt(jump.cycle.flightTimeS, 2)} s</span>
          <span className="rm-speed" role="group" aria-label={t('rm.speed')}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className="rm-speed__btn num"
                aria-pressed={speed === s}
                onClick={() => onSpeed(s)}
              >
                {s}×
              </button>
            ))}
            <button type="button" className="rm-speed__btn" onClick={replay} aria-keyshortcuts="R">
              <Icon name="loop" size={14} />
              {t('rm.replay')}
            </button>
          </span>
        </div>
      </div>

      {storageWarning && <p className="review-warning">{storageWarning}</p>}
      {!canSave && <p className="review-hint">{t('review.status.reading')}</p>}

      <AnswerPanel
        answers={answers}
        guess={guess}
        guessName={jump.prediction.label}
        guessDifficulty={guessElement?.difficulty ?? null}
        flagged={flagged}
        disabled={!canSave}
        canUndo={undoDepth > 0}
        onAction={(a) => act(a, 'button')}
      />

      <label className="rm-note">
        <span className="rm-note__label">{t('review.noteLabel')}</span>
        <input
          key={`${record?.id}:${status}`}
          className="input"
          type="text"
          defaultValue={note}
          disabled={!canSave || status === 'unlabeled'}
          placeholder={t('review.notePlaceholder')}
          onBlur={(e) => {
            if (record && e.target.value !== note) onSave([withNote(record, e.target.value)]);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>

      <section className="rm-section">
        <h3 className="review-heading">{t('review.classifierSays')}</h3>
        <div className="review-classifier">
          <div className="review-classifier__head">
            <span className="review-classifier__skill t-brand">
              <Detected movement={movementFromPrediction(jump.prediction)}>{jump.prediction.label}</Detected>
            </span>
            <span className="review-classifier__pct num" title={t('ins.scoreNote')}>
              {pct(jump.prediction.confidence)}
            </span>
          </div>
          <ConfidenceMeter value={jump.prediction.confidence} tier={tier} label={t('coach.classifierConfidence')} />
          <p className="review-classifier__tier">{TIER_TEXT[tier]}</p>
        </div>
        <Candidates prediction={jump.prediction} disabled={!canSave} onUse={pickCandidate} />
      </section>

      <section className="rm-section">
        <h3 className="review-heading">{t('rm.measured')}</h3>
        <Measured prediction={jump.prediction} />
      </section>

      <section className="rm-section">
        <h3 className="review-heading">{t('rm.flags')}</h3>
        <Flags flags={flags} />
      </section>

      <section className="rm-section">
        <h3 className="review-heading">{t('rm.curves')}</h3>
        <Curves record={record} />
      </section>

      <section className="rm-section rm-section--foot">
        <Switch
          checked={advance === 'on'}
          onChange={(on) => setAdvance(on ? 'on' : 'off')}
          label={t('rm.autoAdvance')}
        />
        <div className="review-actions">
          <Button
            size="sm"
            icon="download"
            disabled={!videoId}
            title={t('rm.labelsDownloadHint')}
            onClick={() =>
              videoId &&
              download(
                `${baseName}-labels.json`,
                labelFileText(labelFileOfRecords(records, videoId, fileName)),
                'application/json',
              )
            }
          >
            {t('rm.labelsDownload')}
          </Button>
          <label className="btn btn--secondary btn--sm review-file">
            <Icon name="upload" size={15} />
            {t('rm.labelsImport')}
            <input
              className="sr-only"
              type="file"
              accept="application/json,.json"
              disabled={!videoId}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importLabels(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {message && (
          <p className="review-note" role="status">
            {message}
          </p>
        )}
        <Disclosure title={t('rm.keysTitle')}>
          <p className="review-note">{t('rm.keys')}</p>
        </Disclosure>
      </section>
    </div>
  );
}

/** Every jump of the clip as a button in time order: its number, its state, and which ones the filter shows. */
function JumpStrip({
  items,
  mask,
  selected,
  names,
  onSelect,
}: {
  items: readonly ReviewItem[];
  mask: readonly boolean[];
  selected: number;
  names: readonly string[];
  onSelect: (jump: number) => void;
}) {
  const current = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [selected]);
  return (
    <nav className="rm-strip" aria-label={t('rm.neighbours')}>
      {items.map((item, i) => (
        <button
          key={i}
          ref={i === selected ? current : undefined}
          type="button"
          className="rm-jumpchip num"
          data-status={item.status}
          data-dim={!mask[i]}
          aria-current={i === selected ? 'true' : undefined}
          title={`${names[i]} · ${t(`rm.status.${item.status}`)}`}
          aria-label={t('rm.chip', { n: i + 1, status: t(`rm.status.${item.status}`) })}
          onClick={() => onSelect(i)}
        >
          {i + 1}
        </button>
      ))}
    </nav>
  );
}
