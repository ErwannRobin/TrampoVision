import { useEffect, useId, useMemo } from 'react';
import { download } from '../analysis/export';
import { t, tp, tx, useLocale } from '../i18n';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { buildEvaluationReport, toEvaluationCsv, toEvaluationJson } from '../dataset/export';
import { findFailures } from '../dataset/failures';
import { agrees, computeMetrics, predictionOf } from '../dataset/metrics';
import { movementFromPrediction, movementOfRecord, type MovementLabel } from '../dataset/movementLabel';
import { reviewStatusOf } from '../dataset/stageLabel';
import { TRUTH_TEXT, type JumpRecord } from '../dataset/types';
import { elementById, elementName } from '../skills/fig/elements';
import type { DatasetApi } from '../dataset/useDataset';
import { pct } from './format';
import { confidenceTier, TIER_TEXT } from './insights';
import { Badge, Button, ConfidenceMeter, Field, Segmented } from './kit';
import { useRangeButton, type Playhead } from './playhead';
import { DatasetBar } from './review/DatasetBar';
import { Detected } from './review/Detected';
import { FailureCase } from './review/FailureCase';
import { Keycap } from './review/Keycap';
import { MovementPicker } from './review/MovementPicker';
import { describeCounts, jumpPlayRange, labelStatus, nextUnlabeled, reportCaveats } from './review/logic';
import { ReportCaveats, ReportFigures } from './review/ReportFigures';
import { ConfusionMatrix, PerClassTable } from './review/ReportTables';

export { DatasetBar };
export type { DatasetBarProps } from './review/DatasetBar';

export interface EvaluatePanelProps {
  skills: SkillAnalysis;
  selected: number;
  onSelect: (jump: number) => void;
  playhead: Playhead;
  videoId: string | null;
  /** The record each detected jump has right now (with the label if one was saved). */
  fresh: JumpRecord[];
  /** Ids of the fresh records that are stored in the dataset. */
  savedIds: Set<string>;
  staleCount: number;
  dataset: DatasetApi;
  baseName: string;
  /** Saves what the jump was (its parts), which also makes it a reference example when they name one element; null removes the label. */
  onMovement: (jump: number, movement: MovementLabel | null) => void;
  /** The person cannot tell what the jump was. */
  onUnknown: (jump: number) => void;
  /** Labelled examples per element, over the whole dataset. */
  exampleCounts: ReadonlyMap<string, number>;
  onNote: (jump: number, note: string) => void;
  onSaveAll: () => void;
  onUpdateStale: () => void;
}

/**
 * Review one detected jump at a time: what the classifier said, what you say, saved on this computer. It sits in the
 * coach's Review tab, whose header already moves between jumps, so it only acts on the selected one.
 */
export function EvaluatePanel({
  skills,
  selected,
  onSelect,
  playhead,
  videoId,
  fresh,
  savedIds,
  staleCount,
  dataset,
  baseName,
  onMovement,
  onUnknown,
  exampleCounts,
  onNote,
  onSaveAll,
  onUpdateStale,
}: EvaluatePanelProps) {
  const n = skills.jumps.length;
  const k = Math.min(selected, Math.max(0, n - 1));
  const jump = skills.jumps[k];
  const rec = fresh[k];
  const truth = rec?.truth?.label ?? null;
  const predicted = rec ? predictionOf(rec) : null;
  const canLabel = !!videoId && !!rec;
  const movement = rec ? movementOfRecord(rec) : null;
  const cannotTell = !!rec && reviewStatusOf(rec) === 'cannot-tell';
  const figureId = rec?.figure?.elementId ?? null;
  const labeled = useMemo(() => skills.jumps.map((_, j) => !!fresh[j]?.truth), [skills.jumps, fresh]);
  const labeledCount = labeled.filter(Boolean).length;
  const playRange = useRangeButton('review', () => {
    if (!jump) return;
    const [start, end] = jumpPlayRange(jump.cycle);
    playhead.playRange(start, end, false);
  });

  const goNextUnlabeled = () => {
    const next = nextUnlabeled(labeled, k);
    if (next !== null) onSelect(next);
  };

  // N goes to the next unlabeled jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.repeat ||
        (target && /INPUT|TEXTAREA|SELECT|BUTTON/.test(target.tagName))
      )
        return;
      if (e.key === 'n' || e.key === 'N') {
        const next = nextUnlabeled(labeled, k);
        if (next !== null) onSelect(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [labeled, k, onSelect]);

  if (n === 0) {
    return (
      <div className="review">
        <p className="review-empty">{t('review.noJump')}</p>
        <DatasetBar dataset={dataset} baseName={baseName} />
      </div>
    );
  }

  const tier = confidenceTier(jump.prediction, skills.config.minConfidence);
  const agree = truth !== null && predicted !== null && agrees(truth, predicted);
  const saved = !!rec && savedIds.has(rec.id);
  const status = labelStatus({ ready: canLabel, labeled: truth !== null, saved });
  const note = rec?.truth?.note ?? '';
  // A new field per jump, and per label being set or cleared, so it never shows the text of another jump or label.
  const noteKey = `${rec?.id}:${truth ? 'labeled' : 'unlabeled'}`;

  return (
    <div className="review">
      <div className="review-section review-section--lead">
        <div className="review-actions">
          <Button size="sm" icon={playRange.playing ? 'pause' : 'play'} onClick={playRange.press}>
            {playRange.playing ? t('transport.pause') : t('ins.playJump')}
          </Button>
          <Button size="sm" disabled={labeledCount === n} aria-keyshortcuts="N" onClick={goNextUnlabeled}>
            {t('review.nextUnlabeled')}
            <Keycap>N</Keycap>
          </Button>
        </div>
        <div className="review-progress">
          <span className="review-progress__text">
            {tx('review.progress', {
              done: <span className="num">{labeledCount}</span>,
              total: <span className="num">{n}</span>,
            })}
          </span>
          <div className="review-progress__track" aria-hidden="true">
            <div className="review-progress__fill" style={{ width: `${(labeledCount / n) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="review-section">
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
          <p className="review-note">{jump.prediction.summary}</p>
        </div>
      </div>

      <div className="review-section">
        <div className="review-section__head">
          <h3 className="review-heading">{t('review.yourLabel')}</h3>
          <span role="status">
            {truth && <Badge tone={agree ? 'ok' : 'danger'}>{agree ? t('review.matches') : t('review.differs')}</Badge>}
          </span>
        </div>
        <MovementPicker
          key={rec?.id}
          movement={movement}
          predicted={movementFromPrediction(jump.prediction)}
          cannotTell={cannotTell}
          disabled={!canLabel}
          onChange={(m) => onMovement(k, m)}
          onUnknown={() => onUnknown(k)}
          onClear={() => onMovement(k, null)}
        />
        {(truth || !canLabel) && (
          <p className="review-hint" role="status">
            {status}
          </p>
        )}
        <Field label={t('review.noteLabel')} hint={canLabel && !truth ? t('review.noteHint') : undefined}>
          <input
            key={noteKey}
            className="input"
            type="text"
            defaultValue={note}
            disabled={!canLabel || !truth}
            placeholder={t('review.notePlaceholder')}
            onBlur={(e) => {
              if (e.target.value !== note) onNote(k, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Field>
      </div>

      {figureId && (
        <p className="review-note">
          {t('review.savedExample', {
            name: elementById(figureId) ? elementName(elementById(figureId)!) : figureId,
            count: exampleCounts.get(figureId) ?? 0,
          })}
        </p>
      )}

      {staleCount > 0 && (
        <div className="review-stale" role="status">
          <p>{tp('review.stale', staleCount)}</p>
          <Button size="sm" icon="refresh" onClick={onUpdateStale}>
            {t('review.updatePredictions')}
          </Button>
        </div>
      )}

      <DatasetBar dataset={dataset} baseName={baseName} onSaveAll={onSaveAll} saveCount={n} canSave={!!videoId} />
    </div>
  );
}

export interface EvaluationReportProps {
  records: JumpRecord[];
  videoId: string | null;
  scope: 'video' | 'all';
  onScope: (s: 'video' | 'all') => void;
  baseName: string;
  /** Move the video to a jump of the current video, by its apex time. */
  onGoTo: (apexS: number) => void;
}

/**
 * How the classifier's answers compare with the labels in the dataset. It lays itself out by the width it is given:
 * full width under the charts, or a narrow column on the first screen.
 */
export function EvaluationReport({ records, videoId, scope, onScope, baseName, onGoTo }: EvaluationReportProps) {
  const titleId = useId();
  const locale = useLocale();
  const scoped = useMemo(
    () => (scope === 'video' ? records.filter((r) => r.videoId === videoId) : records),
    [records, videoId, scope],
  );
  const metrics = useMemo(() => computeMetrics(scoped), [scoped]);
  const failures = useMemo(() => findFailures(scoped), [scoped, locale]); // oxlint-disable-line react-hooks/exhaustive-deps
  const o = metrics.overall;
  const configs = new Set(scoped.map((r) => JSON.stringify(r.analysis.config))).size;
  const noExample = metrics.perClass.filter((c) => c.support === 0).map((c) => TRUTH_TEXT[c.label]);

  return (
    <section className="review-report" aria-labelledby={titleId}>
      <header className="review-report__intro">
        <div className="review-report__head">
          <h3 className="review-report__title" id={titleId}>
            {t('report.title')}
          </h3>
          {videoId && (
            <Segmented
              size="sm"
              ariaLabel={t('report.scope')}
              value={scope}
              onChange={onScope}
              options={[
                { value: 'video', label: t('report.thisVideo') },
                { value: 'all', label: t('report.allVideos') },
              ]}
            />
          )}
          <div className="review-report__exports">
            <Button
              size="sm"
              icon="download"
              disabled={!scoped.length}
              onClick={() =>
                download(
                  `${baseName}-evaluation.json`,
                  toEvaluationJson(buildEvaluationReport(scoped, { kind: scope, videoId: videoId ?? undefined })),
                  'application/json',
                )
              }
            >
              {t('report.json')}
            </Button>
            <Button
              size="sm"
              icon="download"
              disabled={!scoped.length}
              onClick={() => download(`${baseName}-evaluation.csv`, toEvaluationCsv(metrics), 'text/csv')}
            >
              {t('report.csv')}
            </Button>
          </div>
        </div>
        <p className="review-note">{describeCounts(metrics.counts)}</p>
      </header>

      {o.n === 0 ? (
        <p className="review-empty">{t('report.empty')}</p>
      ) : (
        <>
          <ReportFigures overall={o} />
          <ReportCaveats items={reportCaveats(o.n, noExample, configs)} />
          <div className="review-report__tables">
            <div className="review-block">
              <h4 className="review-block__title">{t('report.perClass')}</h4>
              <PerClassTable metrics={metrics} />
            </div>
            <div className="review-block">
              <h4 className="review-block__title">{t('report.confusion')}</h4>
              <ConfusionMatrix metrics={metrics} />
            </div>
          </div>
        </>
      )}

      <div className="review-block">
        <h4 className="review-block__title">
          {t('report.failures')} <span className="review-block__count num">{failures.length}</span>
        </h4>
        <p className="review-note">{t('report.failuresNote')}</p>
        {failures.length === 0 ? (
          <p className="review-note">{o.n === 0 ? t('report.nothingLabeled') : t('report.noDisagreement')}</p>
        ) : (
          <div className="review-fails">
            {failures.map((f, i) => (
              <FailureCase
                key={f.record.id}
                failure={f}
                open={i < 3}
                canGoTo={f.record.videoId === videoId}
                onGoTo={onGoTo}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
