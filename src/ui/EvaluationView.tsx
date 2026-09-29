import { useEffect, useId, useMemo } from 'react';
import { download } from '../analysis/export';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { buildEvaluationReport, toEvaluationCsv, toEvaluationJson } from '../dataset/export';
import { findFailures } from '../dataset/failures';
import { agrees, computeMetrics, predictionOf } from '../dataset/metrics';
import { TRUTH_TEXT, type JumpRecord, type TruthLabel } from '../dataset/types';
import type { DatasetApi } from '../dataset/useDataset';
import { pct, plural } from './format';
import { confidenceTier, TIER_TEXT } from './insights';
import { Badge, Button, ConfidenceMeter, Field, Icon, Segmented } from './kit';
import type { Playhead } from './playhead';
import { DatasetBar } from './review/DatasetBar';
import { FailureCase } from './review/FailureCase';
import { Keycap, LabelPicker } from './review/LabelPicker';
import { describeCounts, jumpPlayRange, labelForKey, labelStatus, nextUnlabeled, reportCaveats } from './review/logic';
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
  onLabel: (jump: number, label: TruthLabel | null) => void;
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
  onLabel,
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
  const labeled = useMemo(() => skills.jumps.map((_, j) => !!fresh[j]?.truth), [skills.jumps, fresh]);
  const labeledCount = labeled.filter(Boolean).length;

  const goNextUnlabeled = () => {
    const next = nextUnlabeled(labeled, k);
    if (next !== null) onSelect(next);
  };

  // Keys 1-6 label the jump on screen, N goes to the next unlabeled one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      const label = labelForKey(e.key);
      if (label) {
        if (canLabel) onLabel(k, label);
      } else if (e.key === 'n' || e.key === 'N') {
        const next = nextUnlabeled(labeled, k);
        if (next !== null) onSelect(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [k, canLabel, labeled, onLabel, onSelect]);

  if (n === 0) {
    return (
      <div className="review">
        <p className="review-empty">No jump found in this video, so there is nothing to label.</p>
        <DatasetBar dataset={dataset} baseName={baseName} />
      </div>
    );
  }

  const [from, to] = jumpPlayRange(jump.cycle);
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
          <Button size="sm" icon="play" onClick={() => playhead.playRange(from, to, false)}>
            Play jump
          </Button>
          <Button size="sm" disabled={labeledCount === n} aria-keyshortcuts="N" onClick={goNextUnlabeled}>
            Next unlabeled
            <Keycap>N</Keycap>
          </Button>
        </div>
        <div className="review-progress">
          <span className="review-progress__text">
            <span className="num">{labeledCount}</span> of <span className="num">{n}</span> labeled
          </span>
          <div className="review-progress__track" aria-hidden="true">
            <div className="review-progress__fill" style={{ width: `${(labeledCount / n) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="review-section">
        <h3 className="review-heading">The classifier says</h3>
        <div className="review-classifier">
          <div className="review-classifier__head">
            <span className="review-classifier__skill t-brand">{jump.prediction.label}</span>
            <span className="review-classifier__pct num" title="Heuristic score, not a probability">
              {pct(jump.prediction.confidence)}
            </span>
          </div>
          <ConfidenceMeter value={jump.prediction.confidence} tier={tier} label="Classifier confidence" />
          <p className="review-classifier__tier">{TIER_TEXT[tier]}</p>
          <p className="review-note">{jump.prediction.summary}</p>
        </div>
      </div>

      <div className="review-section">
        <div className="review-section__head">
          <h3 className="review-heading">Your label</h3>
          <span role="status">
            {truth && (
              <Badge tone={agree ? 'ok' : 'danger'}>
                {agree ? 'Matches the prediction' : 'Differs from the prediction'}
              </Badge>
            )}
          </span>
        </div>
        <LabelPicker truth={truth} disabled={!canLabel} onPick={(label) => onLabel(k, label)} />
        <div className="review-label-foot">
          <p className="review-hint" role="status">
            {saved && truth && <Icon name="check" size={14} strokeWidth={2.2} className="review-hint__ok" />}
            {status}
          </p>
          <Button variant="ghost" size="sm" disabled={!canLabel || !truth} onClick={() => onLabel(k, null)}>
            Clear
          </Button>
        </div>
        <p className="review-note">Unknown means you cannot tell, or it is not one of these five.</p>
        <Field label="Note (optional)" hint={canLabel && !truth ? 'Choose a label to add a note.' : undefined}>
          <input
            key={noteKey}
            className="input"
            type="text"
            defaultValue={note}
            disabled={!canLabel || !truth}
            placeholder="e.g. camera moved, athlete twisted"
            onBlur={(e) => {
              if (e.target.value !== note) onNote(k, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Field>
      </div>

      {staleCount > 0 && (
        <div className="review-stale" role="status">
          <p>
            {staleCount} saved {plural(staleCount, 'jump')} of this video {staleCount > 1 ? 'were' : 'was'} predicted
            with other settings or data.
          </p>
          <Button size="sm" icon="refresh" onClick={onUpdateStale}>
            Update predictions
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
  const scoped = useMemo(
    () => (scope === 'video' ? records.filter((r) => r.videoId === videoId) : records),
    [records, videoId, scope],
  );
  const metrics = useMemo(() => computeMetrics(scoped), [scoped]);
  const failures = useMemo(() => findFailures(scoped), [scoped]);
  const o = metrics.overall;
  const configs = new Set(scoped.map((r) => JSON.stringify(r.analysis.config))).size;
  const noExample = metrics.perClass.filter((c) => c.support === 0).map((c) => TRUTH_TEXT[c.label]);

  return (
    <section className="review-report" aria-labelledby={titleId}>
      <header className="review-report__intro">
        <div className="review-report__head">
          <h3 className="review-report__title" id={titleId}>
            Evaluation
          </h3>
          {videoId && (
            <Segmented
              size="sm"
              ariaLabel="Scope"
              value={scope}
              onChange={onScope}
              options={[
                { value: 'video', label: 'This video' },
                { value: 'all', label: 'All saved videos' },
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
              Evaluation JSON
            </Button>
            <Button
              size="sm"
              icon="download"
              disabled={!scoped.length}
              onClick={() => download(`${baseName}-evaluation.csv`, toEvaluationCsv(metrics), 'text/csv')}
            >
              Evaluation CSV
            </Button>
          </div>
        </div>
        <p className="review-note">{describeCounts(metrics.counts)}</p>
      </header>

      {o.n === 0 ? (
        <p className="review-empty">
          No labeled jumps yet. Label jumps in the Review tab (or press keys 1 to 6): accuracy, precision, recall and
          the confusion matrix appear here. Unknown does not count in them.
        </p>
      ) : (
        <>
          <ReportFigures overall={o} />
          <ReportCaveats items={reportCaveats(o.n, noExample, configs)} />
          <div className="review-report__tables">
            <div className="review-block">
              <h4 className="review-block__title">Per class</h4>
              <PerClassTable metrics={metrics} />
            </div>
            <div className="review-block">
              <h4 className="review-block__title">Confusion matrix</h4>
              <ConfusionMatrix metrics={metrics} />
            </div>
          </div>
        </>
      )}

      <div className="review-block">
        <h4 className="review-block__title">
          Failure cases <span className="review-block__count num">{failures.length}</span>
        </h4>
        <p className="review-note">
          Jumps where your label and the prediction differ, including low-confidence ones. Wrong answers come first, the
          most confident first.
        </p>
        {failures.length === 0 ? (
          <p className="review-note">
            {o.n === 0 ? 'Nothing labeled yet.' : 'No disagreement between your labels and the predictions.'}
          </p>
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
