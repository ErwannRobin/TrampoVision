import { useEffect, useMemo, useState } from 'react';
import { download } from '../analysis/export';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { buildEvaluationReport, flatRows, toDatasetCsv, toDatasetJson, toEvaluationCsv, toEvaluationJson } from '../dataset/export';
import { findFailures, type Failure } from '../dataset/failures';
import { agrees, computeMetrics, predictionOf, PREDICTED_COLUMNS, PREDICTED_TEXT } from '../dataset/metrics';
import type { DatasetApi } from '../dataset/useDataset';
import { TRUTH_LABELS, TRUTH_TEXT, type JumpRecord, type TruthLabel } from '../dataset/types';
import type { Playhead } from './playhead';

const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`);
const KEYS: Record<string, TruthLabel> = { '1': 'straight', '2': 'tuck', '3': 'pike', '4': 'back', '5': 'front', '6': 'unknown' };

interface PanelProps {
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

/** Review one detected jump at a time: what the classifier said, what you say, saved on this computer. */
export function EvaluatePanel({ skills, selected, onSelect, playhead, videoId, fresh, savedIds, staleCount, dataset, baseName, onLabel, onNote, onSaveAll, onUpdateStale }: PanelProps) {
  const n = skills.jumps.length;
  const k = Math.min(selected, Math.max(0, n - 1));
  const jump = skills.jumps[k];
  const rec = fresh[k];
  const truth = rec?.truth?.label ?? null;
  const predicted = rec ? predictionOf(rec) : null;
  const canLabel = !!videoId && !!rec;
  const labeledCount = fresh.filter((r) => r.truth).length;

  const nextUnlabeled = () => {
    for (let s = 1; s <= n; s++) {
      const j = (k + s) % n;
      if (!fresh[j]?.truth) return onSelect(j);
    }
  };

  // Keys 1-6 label the jump on screen, N goes to the next unlabeled one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      if (KEYS[e.key] && canLabel) onLabel(k, KEYS[e.key]);
      else if (e.key === 'n' || e.key === 'N') nextUnlabeled();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, canLabel, fresh, onLabel]);

  if (n === 0) {
    return (
      <div className="metrics skill">
        <h3>Evaluate</h3>
        <p className="muted small">No jump found in this video, so there is nothing to label.</p>
        <DatasetBar dataset={dataset} baseName={baseName} />
      </div>
    );
  }

  return (
    <div className="metrics skill">
      <h3>
        Review jumps
        <span className="muted mono">
          <button className="tiny" disabled={k === 0} onClick={() => onSelect(k - 1)} aria-label="Previous jump">‹</button>
          {' '}jump {k + 1} / {n}{' '}
          <button className="tiny" disabled={k === n - 1} onClick={() => onSelect(k + 1)} aria-label="Next jump">›</button>
        </span>
      </h3>

      <div className="review-actions">
        <button onClick={() => playhead.playRange((jump.cycle.takeoffTimeS ?? jump.cycle.apexTimeS) - 0.4, (jump.cycle.landingTimeS ?? jump.cycle.apexTimeS) + 0.3, false)}>▶ Play jump</button>
        <button onClick={nextUnlabeled} disabled={labeledCount === n} title="Key: N">Next unlabeled ›</button>
        <span className="muted small">{labeledCount} of {n} labeled</span>
      </div>

      <div className="skillcard weak">
        <div className="muted small">The classifier says</div>
        <div className="skillname">{jump.prediction.label}</div>
        <div className="skillconf">Confidence: {pct(jump.prediction.confidence)}</div>
        <p className="muted small">{jump.prediction.summary}</p>
      </div>

      <h3>Your label {truth && <span className={`badge ${predicted && agrees(truth, predicted) ? 'ok' : 'off'}`}>{predicted && agrees(truth, predicted) ? 'matches the prediction' : 'differs from the prediction'}</span>}</h3>
      <div className="labelrow" role="group" aria-label="Ground-truth label">
        {TRUTH_LABELS.map((l, i) => (
          <button key={l} className={truth === l ? 'primary' : ''} disabled={!canLabel} onClick={() => onLabel(k, l)} title={`Key: ${i + 1}`} aria-pressed={truth === l}>
            {TRUTH_TEXT[l]}
          </button>
        ))}
        <button disabled={!canLabel || !truth} onClick={() => onLabel(k, null)}>Clear</button>
      </div>
      <p className="muted small">
        {!videoId ? 'Reading the video id…' : truth ? (savedIds.has(rec.id) ? 'Saved in this browser. ' : '') : 'Watch the jump, then choose what it really was. '}
        Unknown = you cannot tell, or it is not one of these five. Keys 1–6 label, N goes to the next unlabeled jump.
      </p>
      <label className="notefield">
        Note (optional)
        <input key={rec?.id} type="text" defaultValue={rec?.truth?.note ?? ''} disabled={!canLabel || !truth} onBlur={(e) => e.target.value !== (rec?.truth?.note ?? '') && onNote(k, e.target.value)} placeholder="e.g. camera moved, athlete twisted" />
      </label>

      {staleCount > 0 && (
        <p className="warnings">
          {staleCount} saved jump{staleCount > 1 ? 's' : ''} of this video {staleCount > 1 ? 'were' : 'was'} predicted with other settings or data.{' '}
          <button onClick={onUpdateStale}>Update predictions</button>
        </p>
      )}

      <DatasetBar dataset={dataset} baseName={baseName} onSaveAll={onSaveAll} saveCount={n} canSave={!!videoId} />
    </div>
  );
}

/** Counts, save, export, import and delete of the dataset stored in this browser. */
export function DatasetBar({ dataset, baseName, onSaveAll, saveCount, canSave }: { dataset: DatasetApi; baseName: string; onSaveAll?: () => void; saveCount?: number; canSave?: boolean }) {
  const [message, setMessage] = useState('');
  const labeled = dataset.records.filter((r) => r.truth).length;
  const videos = new Set(dataset.records.map((r) => r.videoId)).size;
  const onImport = async (f: File) => {
    try {
      const { added, updated, kept } = await dataset.importText(await f.text());
      setMessage(`Imported: ${added} added, ${updated} updated, ${kept} kept (already newer here).`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <h3>Dataset on this computer</h3>
      <p className="small">
        <strong>{dataset.records.length}</strong> jump{dataset.records.length === 1 ? '' : 's'} from {videos} video{videos === 1 ? '' : 's'}, <strong>{labeled}</strong> labeled.{' '}
        <span className="muted">{dataset.kind === 'indexeddb' ? 'Stored in this browser only (IndexedDB). Nothing is uploaded.' : dataset.kind === 'memory' ? 'Kept in memory only.' : 'Opening the local database…'}</span>
      </p>
      {dataset.warning && <p className="warnings">{dataset.warning}</p>}
      {dataset.error && <p className="warnings">{dataset.error}</p>}
      <div className="review-actions">
        {onSaveAll && <button disabled={!canSave} onClick={onSaveAll} title="Stores every detected jump of this video, with its measurements and prediction">Save all {saveCount} jumps</button>}
        <button disabled={!dataset.records.length} onClick={() => download(`${baseName}-dataset.json`, toDatasetJson(dataset.records), 'application/json')}>Dataset JSON</button>
        <button disabled={!dataset.records.length} onClick={() => download(`${baseName}-dataset.csv`, toDatasetCsv(dataset.records), 'text/csv')}>Dataset CSV</button>
      </div>
      <div className="review-actions">
        <label className="filebtn">
          Import dataset…
          <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }} />
        </label>
        <button
          className="danger"
          disabled={!dataset.records.length}
          onClick={() => window.confirm(`Delete all ${dataset.records.length} saved jumps and their labels from this browser? Export first if you want to keep them.`) && void dataset.clear()}
        >
          Delete all…
        </button>
      </div>
      {message && <p className="small" role="status">{message}</p>}
    </>
  );
}

// --- Report ---------------------------------------------------------------------------------------------------------

interface ReportProps {
  records: JumpRecord[];
  videoId: string | null;
  scope: 'video' | 'all';
  onScope: (s: 'video' | 'all') => void;
  baseName: string;
  /** Move the video to a jump of the current video, by its apex time. */
  onGoTo: (apexS: number) => void;
}

export function EvaluationReport({ records, videoId, scope, onScope, baseName, onGoTo }: ReportProps) {
  const scoped = useMemo(() => (scope === 'video' ? records.filter((r) => r.videoId === videoId) : records), [records, videoId, scope]);
  const metrics = useMemo(() => computeMetrics(scoped), [scoped]);
  const failures = useMemo(() => findFailures(scoped), [scoped]);
  const o = metrics.overall;
  const configs = new Set(scoped.map((r) => JSON.stringify(r.analysis.config))).size;
  const noExample = metrics.perClass.filter((c) => c.support === 0).map((c) => TRUTH_TEXT[c.label]);
  const maxCell = Math.max(1, ...metrics.matrix.counts.flat());

  return (
    <section className="panel evaluation" aria-label="Evaluation">
      <div className="jumpbar">
        <strong>Evaluation</strong>
        {videoId && (
          <div className="seg" role="group" aria-label="Scope">
            <button className={scope === 'video' ? 'primary' : ''} onClick={() => onScope('video')}>This video</button>
            <button className={scope === 'all' ? 'primary' : ''} onClick={() => onScope('all')}>All saved videos</button>
          </div>
        )}
        <span className="muted small">{scoped.length} saved jump{scoped.length === 1 ? '' : 's'}, {metrics.counts.labeled} labeled ({metrics.counts.known} with one of the five skills, {metrics.counts.unknown} Unknown, {metrics.counts.unlabeled} unlabeled)</span>
        <span className="spacer" />
        <button disabled={!scoped.length} onClick={() => download(`${baseName}-evaluation.json`, toEvaluationJson(buildEvaluationReport(scoped, { kind: scope, videoId: videoId ?? undefined })), 'application/json')}>Evaluation JSON</button>
        <button disabled={!scoped.length} onClick={() => download(`${baseName}-evaluation.csv`, toEvaluationCsv(metrics), 'text/csv')}>Evaluation CSV</button>
      </div>

      {o.n === 0 ? (
        <p className="notice">No labeled jumps yet. Label jumps in the Evaluate tab (or press keys 1–6): accuracy, precision, recall and the confusion matrix appear here. Unknown does not count in them.</p>
      ) : (
        <>
          <div className="statrow">
            <Stat label="Accuracy" value={pct(o.accuracy)} sub={o.ci95 ? `95% interval ${pct(o.ci95.lo)}–${pct(o.ci95.hi)}` : ''} big />
            <Stat label="Jumps evaluated" value={String(o.n)} sub="known label" />
            <Stat label="Balanced accuracy" value={pct(o.balancedAccuracy)} sub="mean recall per class" />
            <Stat label="Answered" value={pct(o.coverage)} sub={`${o.answered} of ${o.n}; right when answered: ${pct(o.accuracyWhenAnswered)}`} />
            <Stat label={`Wrong at ≥${Math.round(o.confidentAt * 100)}%`} value={String(o.confidentWrong)} sub={`mean confidence right ${pct(o.meanConfidenceCorrect)}, wrong ${pct(o.meanConfidenceWrong)}`} />
          </div>
          <ul className="caveats small">
            {o.n < 30 && <li>Only {o.n} jump{o.n === 1 ? '' : 's'}: with so few, the true accuracy can be far from the number above (see the interval). Label more jumps, of every skill.</li>}
            {noExample.length > 0 && <li>No example yet of: {noExample.join(', ')}. Those rows have no recall.</li>}
            {configs > 1 && <li>These predictions were made with {configs} different threshold sets. Use “Update predictions” in the Evaluate tab before comparing them.</li>}
            <li>Not classified and “somersault, direction unknown” count as wrong here, because the classifier did not answer. If you change the thresholds while looking at these jumps, the accuracy becomes training accuracy: it will look better than it is.</li>
          </ul>

          <h3>Per class</h3>
          <div className="scroll">
            <table className="mono evaltable">
              <thead>
                <tr><th>Class</th><th>Samples</th><th>Predicted</th><th>Precision</th><th>Recall (95% interval)</th><th title="How often 'is it this class?' was answered right">Accuracy 1-vs-rest</th></tr>
              </thead>
              <tbody>
                {metrics.perClass.map((c) => (
                  <tr key={c.label}>
                    <td>{TRUTH_TEXT[c.label]}</td>
                    <td>{c.support}</td>
                    <td>{c.predicted}</td>
                    <td>{pct(c.precision)}</td>
                    <td>{pct(c.recall)} {c.recallCi95 && <span className="muted">({pct(c.recallCi95.lo)}–{pct(c.recallCi95.hi)})</span>}</td>
                    <td>{pct(c.accuracyOneVsRest)}</td>
                  </tr>
                ))}
                <tr className="muted"><td>Unknown</td><td>{metrics.samplesPerClass.unknown}</td><td colSpan={4}>not in accuracy, precision or recall</td></tr>
              </tbody>
            </table>
          </div>

          <h3>Confusion matrix <span className="muted small">rows = what you said, columns = what the classifier said</span></h3>
          <div className="scroll">
            <table className="mono matrix">
              <thead>
                <tr>
                  <th>true \ predicted</th>
                  {PREDICTED_COLUMNS.map((c) => <th key={c}>{PREDICTED_TEXT[c]}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {metrics.matrix.rows.map((row, i) => (
                  <tr key={row}>
                    <th scope="row">{TRUTH_TEXT[row]}</th>
                    {PREDICTED_COLUMNS.map((col, j) => {
                      const v = metrics.matrix.counts[i][j];
                      const good = agrees(row, col);
                      return (
                        <td key={col} className={v ? (good ? 'cell-ok' : 'cell-off') : ''} style={v ? { ['--strength' as string]: 0.15 + 0.6 * (v / maxCell) } : undefined}>
                          {v || '·'}
                        </td>
                      );
                    })}
                    <td className="muted">{metrics.samplesPerClass[row]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3>Failure cases ({failures.length}) <span className="muted small">labeled ≠ predicted; low-confidence ones are included; wrong answers first, most confident first</span></h3>
      {failures.length === 0 ? (
        <p className="muted small">{o.n === 0 ? 'Nothing labeled yet.' : 'No disagreement between your labels and the predictions.'}</p>
      ) : (
        failures.map((f, i) => <FailureCard key={f.record.id} failure={f} open={i < 3} canGoTo={f.record.videoId === videoId} onGoTo={onGoTo} />)
      )}
    </section>
  );
}

function Stat({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className={`stat ${big ? 'big' : ''}`}>
      <div className="muted small">{label}</div>
      <div className="statvalue mono">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

const STATUS_ICON = { ok: '✓', off: '✗', unknown: '?' } as const;
const STATUS_TEXT = { ok: 'agrees with the label', off: 'differs from what the label needs', unknown: 'no data' } as const;

function FailureCard({ failure: f, open, canGoTo, onGoTo }: { failure: Failure; open: boolean; canGoTo: boolean; onGoTo: (apexS: number) => void }) {
  const r = f.record;
  const p = r.prediction;
  const off = f.checks.filter((c) => c.status === 'off').length;
  return (
    <details className="failure" open={open}>
      <summary>
        <strong>{r.source.fileName} · jump {r.jumpId}</strong> — labeled <strong>{TRUTH_TEXT[f.truth]}</strong>, predicted <strong>{PREDICTED_TEXT[f.predicted]}</strong> at {pct(f.confidence)}{' '}
        {f.lowConfidence ? <span className="badge weak">low confidence</span> : <span className="badge off">confident</span>}{' '}
        <span className="muted small">{off} check{off === 1 ? '' : 's'} differ</span>
      </summary>
      {canGoTo && <p><button onClick={() => onGoTo(r.timestamps.apexS)}>Show this jump in the video</button></p>}
      <div className="failgrid">
        <div>
          <h4>Label against measurement</h4>
          <table className="mono checks">
            <thead><tr><th></th><th>Signal</th><th>The label needs</th><th>Measured</th></tr></thead>
            <tbody>
              {f.checks.map((c) => (
                <tr key={c.signal} className={`check-${c.status}`}>
                  <td title={STATUS_TEXT[c.status]} aria-label={STATUS_TEXT[c.status]}>{STATUS_ICON[c.status]}</td>
                  <td>{c.signal}</td>
                  <td>{c.expected}</td>
                  <td>{c.measured}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">✗ marks where the measurement differs from what the label needs. It does not say which one is right: check the video.</p>
        </div>
        <div>
          <h4>What the classifier saw</h4>
          <p className="small">{p.summary}</p>
          <ul className="evidence">
            {p.evidence.map((e) => (
              <li key={e.key}><span className="ev-label">{e.label}:</span> <span className="mono">{e.text}</span></li>
            ))}
          </ul>
          {p.limitations.length > 0 && (
            <ul className="warnings limits">
              {p.limitations.map((l) => (
                <li key={l.signal + l.problem}><strong>{l.signal}.</strong> {l.problem} <em>Needed:</em> {l.needed}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Sparks record={r} />
      <details>
        <summary>All extracted features ({flatRows(r).length})</summary>
        <dl className="mono featurelist">
          {flatRows(r).map(([k, v]) => (
            <div key={k} className="row"><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </details>
    </details>
  );
}

/** Hip angle, knee angle and rotation over the normalized jump, straight from the stored sequence. */
function Sparks({ record }: { record: JumpRecord }) {
  const seq = record.sequence;
  if (!seq) return <p className="muted small">This jump was cut off by the clip: no sequence.</p>;
  const col = (name: string) => seq.data.map((row) => row[seq.columns.indexOf(name)]);
  return (
    <div className="sparks">
      <Spark title="Hip angle" values={col('hip_angle_deg')} unit="°" domain={[0, 180]} guides={[record.analysis.config.position.hipFoldedMaxDeg]} />
      <Spark title="Knee angle" values={col('knee_angle_deg')} unit="°" domain={[0, 180]} guides={[record.analysis.config.position.kneeBentMaxDeg]} />
      <Spark title="Rotation since takeoff" values={col('orient_turns')} unit=" turns" />
      <Spark title="Center of mass height" values={col('com_h_body')} unit=" body lengths" />
    </div>
  );
}

function Spark({ title, values, unit, domain, guides = [] }: { title: string; values: number[]; unit: string; domain?: [number, number]; guides?: number[] }) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return <div className="spark"><div className="muted small">{title}: no data</div></div>;
  const lo = domain ? domain[0] : Math.min(...finite, 0);
  const hi = domain ? domain[1] : Math.max(...finite, lo + 0.5);
  const W = 150;
  const H = 40;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (W - 4);
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return (
    <div className="spark">
      <div className="muted small">{title}: {Math.min(...finite).toFixed(unit === ' turns' || unit.includes('body') ? 2 : 0)} to {Math.max(...finite).toFixed(unit === ' turns' || unit.includes('body') ? 2 : 0)}{unit}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={title}>
        <rect x="0" y="0" width={W} height={H} rx="4" className="spark-bg" />
        {guides.map((g) => <line key={g} x1="2" x2={W - 2} y1={y(g)} y2={y(g)} className="spark-guide" />)}
        <path d={d} className="spark-line" fill="none" />
      </svg>
    </div>
  );
}

